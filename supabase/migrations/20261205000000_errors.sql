-- Errors: see what breaks, for whom, then report it. (No temporary tables and no
-- SELECT … INTO in this file: the Supabase SQL editor takes those for new tables.)
--
-- The app reports its own errors (a screen that fails to draw, a script error, a failed
-- request); the server routes and the 2-minute job report theirs with the job's secret, and
-- the database job's own errors (push_errors) come in by themselves. Repeats of the same
-- error are grouped into one line, so a hundred copies show as one with a count.
--
--   app_errors         one row per kind of error: message, where, status, first/last seen
--   app_error_events   one row per time it happened: when, who (signed in, guest, visitor),
--                      phone and browser type, app version, the first lines of the stack
--   job_status         when the 2-minute job last ran and what it did
--
-- Never recorded: anything typed into the app, photos, IP addresses, the exact phone
-- model. At most 20 reports per person or browser an hour. Kept 30 days.
-- Admin → Errors reads it; a new error, a spike or one back after a fix pushes the admin.

create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  fingerprint text not null unique,
  source      text not null check (source in ('app', 'server', 'job')),
  kind        text not null default 'Error',
  message     text not null,
  place       text not null default '',
  code        text,
  status      text not null default 'new' check (status in ('new', 'open', 'fixed', 'ignored')),
  came_back   boolean not null default false,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  fixed_at    timestamptz,
  alerted_at  timestamptz,
  alert_kind  text,
  back_alerted boolean not null default false
);
create index if not exists app_errors_last_idx on public.app_errors (last_seen desc);

create table if not exists public.app_error_events (
  id           bigint generated always as identity primary key,
  error_id     bigint not null references public.app_errors (id) on delete cascade,
  at           timestamptz not null default now(),
  who          text not null check (who in ('user', 'guest', 'visitor', 'server')),
  user_id      uuid references public.profiles (id) on delete set null,
  visitor      text,
  device       text,
  browser      text,
  in_app       text,
  installed    boolean,
  app_version  text,
  path         text,
  prev_path    text,
  stack        text
);
create index if not exists app_error_events_error_idx on public.app_error_events (error_id, at desc);
create index if not exists app_error_events_at_idx on public.app_error_events (at);
create index if not exists app_error_events_visitor_idx on public.app_error_events (visitor, at);
create index if not exists app_error_events_user_idx on public.app_error_events (user_id, at);

create table if not exists public.job_status (
  id        int primary key default 1 check (id = 1),
  last_run  timestamptz,
  result    jsonb
);

alter table public.app_errors enable row level security;
alter table public.app_error_events enable row level security;
alter table public.job_status enable row level security;
revoke all on table public.app_errors, public.app_error_events, public.job_status from public, anon, authenticated;

-- One error, grouped: numbers, ids and addresses in the message don't make a new group.
create or replace function public.app_error_fingerprint(source text, kind text, message text, place text)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(source, '') || '|' || coalesce(kind, '') || '|' || coalesce(place, '') || '|' ||
    regexp_replace(regexp_replace(regexp_replace(lower(coalesce(message, '')),
      'https?://[^\s)"'']+', 'url', 'g'),
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'id', 'g'),
      '[0-9]+', '#', 'g'));
$$;
revoke execute on function public.app_error_fingerprint(text, text, text, text) from public, anon, authenticated;

-- Records one occurrence (internal: called by the functions below).
create or replace function public.app_error_record(
  src text, err_kind text, msg text, err_place text, err_code text, err_stack text,
  err_who text, person uuid, browser_code text,
  err_device text, err_browser text, err_in_app text, is_installed boolean,
  version text, err_path text, err_prev text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := left(coalesce(nullif(trim(err_kind), ''), 'Error'), 60);
  m text := left(coalesce(nullif(trim(msg), ''), 'Unknown error'), 300);
  p text := left(coalesce(trim(err_place), ''), 120);
  gid bigint;
begin
  insert into public.app_errors as e (fingerprint, source, kind, message, place, code)
  values (public.app_error_fingerprint(src, k, m, p), src, k, m, p, left(err_code, 160))
  on conflict (fingerprint) do update
    set last_seen = now(),
        code = coalesce(excluded.code, e.code),
        came_back = e.came_back or e.status = 'fixed',
        status = case when e.status = 'fixed' then 'open' else e.status end
  returning e.id into gid;

  insert into public.app_error_events (error_id, who, user_id, visitor, device, browser, in_app, installed,
                                       app_version, path, prev_path, stack)
  values (gid, err_who, person, left(browser_code, 64), left(err_device, 40), left(err_browser, 40),
          left(err_in_app, 40), is_installed, left(version, 40), left(err_path, 120), left(err_prev, 120),
          left(err_stack, 800));
  return gid;
end;
$$;
revoke execute on function public.app_error_record(text, text, text, text, text, text, text, uuid, text, text, text, text, boolean, text, text, text) from public, anon, authenticated;

-- The app reports an error. Anyone can (visitors included), 20 an hour per person or browser.
create or replace function public.report_error(
  message text, kind text default null, place text default null, code text default null,
  stack text default null, visitor text default null, device text default null,
  browser text default null, in_app text default null, installed boolean default null,
  app_version text default null, path text default null, prev_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  guest boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.username::text like 'guest\_%');
  v text := nullif(left(trim(coalesce(report_error.visitor, '')), 64), '');
begin
  if coalesce(trim(report_error.message), '') = '' then
    return;
  end if;
  -- 20 an hour from one person or browser; and a ceiling for everyone together.
  if (select count(*) from public.app_error_events e
      where e.at > now() - interval '1 hour'
        and ((uid is not null and e.user_id = uid) or (v is not null and e.visitor = v))) >= 20 then
    return;
  end if;
  if uid is null and v is null then
    return;
  end if;
  if (select count(*) from public.app_error_events e where e.at > now() - interval '10 minutes') >= 2000 then
    return;
  end if;
  perform public.app_error_record('app', report_error.kind, report_error.message, report_error.place,
    report_error.code, report_error.stack,
    case when uid is null then 'visitor' when guest then 'guest' else 'user' end, uid, v,
    report_error.device, report_error.browser, report_error.in_app, report_error.installed,
    report_error.app_version, report_error.path, report_error.prev_path);
end;
$$;
revoke execute on function public.report_error(text, text, text, text, text, text, text, text, text, boolean, text, text, text) from public;
grant execute on function public.report_error(text, text, text, text, text, text, text, text, text, boolean, text, text, text) to anon, authenticated;

-- The server routes and the 2-minute job report theirs (needs the job's secret).
create or replace function public.report_server_error(secret text, source text, kind text, message text,
                                                      place text, code text default null, stack text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  if report_server_error.source not in ('server', 'job') then
    raise exception 'docchi:source' using errcode = '22023';
  end if;
  if (select count(*) from public.app_error_events e where e.at > now() - interval '10 minutes' and e.who = 'server') >= 500 then
    return;
  end if;
  perform public.app_error_record(report_server_error.source, report_server_error.kind, report_server_error.message,
    report_server_error.place, report_server_error.code, report_server_error.stack,
    'server', null, null, null, null, null, null, null, null, null);
end;
$$;
revoke execute on function public.report_server_error(text, text, text, text, text, text, text) from public;
grant execute on function public.report_server_error(text, text, text, text, text, text, text) to anon, authenticated;

-- The database job's own errors (push_errors) show up in Errors too.
create or replace function public.push_errors_to_errors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.app_error_record('job', 'Database', new.message, 'Background job · ' || new.step, null, null,
    'server', null, null, null, null, null, null, null, null, null);
  return null;
end;
$$;
revoke execute on function public.push_errors_to_errors() from public, anon, authenticated;
drop trigger if exists push_errors_to_errors on public.push_errors;
create trigger push_errors_to_errors after insert on public.push_errors
  for each row execute function public.push_errors_to_errors();

-- How many times in the last hour against its usual rate: 10+ and 5× the hourly average
-- of the day before.
create or replace function public.app_error_spike(err bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select n.last_hour >= 10 and n.last_hour >= 5 * (n.day_before / 24.0)
  from (select
          count(*) filter (where e.at > now() - interval '1 hour') as last_hour,
          count(*) filter (where e.at <= now() - interval '1 hour' and e.at > now() - interval '25 hours') as day_before
        from public.app_error_events e where e.error_id = err) n;
$$;
revoke execute on function public.app_error_spike(bigint) from public, anon, authenticated;

-- Admin → Errors: the list. status: look (new and open), new, open, fixed, ignored or all;
-- source: app, server, job or null for everywhere.
create or replace function public.admin_errors(days int default 1, status_filter text default 'look', source_filter text default null)
returns table (id bigint, source text, kind text, message text, place text, status text, came_back boolean,
               first_seen timestamptz, last_seen timestamptz, times int, people int, spike boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(least(coalesce(days, 1), 30), 1));
begin
  perform public.require_admin();
  return query
  select g.id, g.source, g.kind, g.message, g.place, g.status, g.came_back, g.first_seen, g.last_seen,
         (select count(*)::int from public.app_error_events e where e.error_id = g.id and e.at > since),
         (select count(distinct coalesce(e.user_id::text, e.visitor))::int from public.app_error_events e
           where e.error_id = g.id and e.at > since and coalesce(e.user_id::text, e.visitor) is not null),
         public.app_error_spike(g.id)
  from public.app_errors g
  where g.last_seen > since
    and (source_filter is null or g.source = source_filter)
    and case coalesce(status_filter, 'look')
          when 'look' then g.status in ('new', 'open')
          when 'all' then true
          else g.status = status_filter
        end
  order by (g.status = 'new') desc, g.came_back desc, g.last_seen desc
  limit 200;
end;
$$;
revoke execute on function public.admin_errors(int, text, text) from public, anon;
grant execute on function public.admin_errors(int, text, text) to authenticated;

-- The tiles at the top, and the count on the sidebar.
create or replace function public.admin_errors_summary(days int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 1), 30), 1);
  since timestamptz := now() - make_interval(days => d);
  js public.job_status := (select j from public.job_status j where j.id = 1);
begin
  perform public.require_admin();
  return jsonb_build_object(
    'new', (select count(*) from public.app_errors g where g.status = 'new'),
    'look', (select count(*) from public.app_errors g where g.status in ('new', 'open')),
    'newest', (select g.message from public.app_errors g where g.status = 'new' order by g.first_seen desc limit 1),
    'newest_place', (select g.place from public.app_errors g where g.status = 'new' order by g.first_seen desc limit 1),
    'newest_since', (select g.first_seen from public.app_errors g where g.status = 'new' order by g.first_seen desc limit 1),
    'people', (select count(distinct coalesce(e.user_id::text, e.visitor)) from public.app_error_events e
                where e.at > since and e.who <> 'server'),
    'opened', (select count(distinct v.visitor) from public.visits v
                where v.day > ((now() at time zone 'Asia/Kolkata')::date - d)),
    'times', (select count(*) from public.app_error_events e where e.at > since),
    'kinds', (select count(distinct e.error_id) from public.app_error_events e where e.at > since),
    'job_last_run', js.last_run,
    'job_result', js.result);
end;
$$;
revoke execute on function public.admin_errors_summary(int) from public, anon;
grant execute on function public.admin_errors_summary(int) to authenticated;

-- One error opened: counts, per hour (or per day), phones, who, the latest times.
create or replace function public.admin_error_detail(err bigint, days int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 1), 30), 1);
  since timestamptz := now() - make_interval(days => d);
  g public.app_errors := (select x from public.app_errors x where x.id = err);
begin
  perform public.require_admin();
  if g.id is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', g.id, 'source', g.source, 'kind', g.kind, 'message', g.message, 'place', g.place, 'code', g.code,
    'status', g.status, 'came_back', g.came_back, 'first_seen', g.first_seen, 'last_seen', g.last_seen,
    'fixed_at', g.fixed_at, 'spike', public.app_error_spike(g.id),
    'times', (select count(*) from public.app_error_events e where e.error_id = g.id and e.at > since),
    'people', (select count(distinct coalesce(e.user_id::text, e.visitor)) from public.app_error_events e
                where e.error_id = g.id and e.at > since),
    'times_total', (select count(*) from public.app_error_events e where e.error_id = g.id),
    -- 24 hourly buckets for a day, else one per day; oldest first.
    'buckets', (select coalesce(jsonb_agg(coalesce(c.n, 0) order by s.i desc), '[]'::jsonb)
                from generate_series(case when d = 1 then 23 else d - 1 end, 0, -1) as s(i)
                left join lateral (
                  select count(*) as n from public.app_error_events e
                  where e.error_id = g.id
                    and e.at > now() - (case when d = 1 then interval '1 hour' else interval '1 day' end) * (s.i + 1)
                    and e.at <= now() - (case when d = 1 then interval '1 hour' else interval '1 day' end) * s.i
                ) c on true),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'people', x.people) order by x.people desc), '[]'::jsonb)
                from (select coalesce(e.device, 'Unknown') || ' · ' || coalesce(e.in_app, e.browser, 'Unknown') as label,
                             count(distinct coalesce(e.user_id::text, e.visitor, e.id::text)) as people
                      from public.app_error_events e where e.error_id = g.id and e.at > since
                      group by 1 order by 2 desc limit 6) x),
    'who', jsonb_build_object(
      'user', (select count(distinct e.user_id) from public.app_error_events e where e.error_id = g.id and e.at > since and e.who = 'user'),
      'guest', (select count(distinct coalesce(e.user_id::text, e.visitor)) from public.app_error_events e where e.error_id = g.id and e.at > since and e.who = 'guest'),
      'visitor', (select count(distinct e.visitor) from public.app_error_events e where e.error_id = g.id and e.at > since and e.who = 'visitor'),
      'names', (select coalesce(jsonb_agg(n.username), '[]'::jsonb) from (
                  select p.username::text as username from public.app_error_events e
                  join public.profiles p on p.id = e.user_id
                  where e.error_id = g.id and e.at > since and e.who = 'user'
                  group by p.username order by max(e.at) desc limit 3) n)),
    'versions', (select coalesce(jsonb_agg(distinct e.app_version), '[]'::jsonb) from public.app_error_events e
                 where e.error_id = g.id and e.at > since and e.app_version is not null),
    'latest', (select coalesce(jsonb_agg(jsonb_build_object(
                  'at', l.at, 'who', l.who, 'username', l.username, 'device', l.device, 'browser', l.browser,
                  'in_app', l.in_app, 'installed', l.installed, 'app_version', l.app_version, 'path', l.path,
                  'prev_path', l.prev_path, 'stack', l.stack) order by l.at desc), '[]'::jsonb)
               from (select e.*, p.username::text as username from public.app_error_events e
                     left join public.profiles p on p.id = e.user_id
                     where e.error_id = g.id order by e.at desc limit 5) l));
end;
$$;
revoke execute on function public.admin_error_detail(bigint, int) from public, anon;
grant execute on function public.admin_error_detail(bigint, int) to authenticated;

-- Mark an error open, fixed or ignored (logged). Fixed: if it happens again it comes back.
create or replace function public.admin_error_status(err bigint, new_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg text;
begin
  perform public.require_admin();
  if new_status not in ('open', 'fixed', 'ignored') then
    raise exception 'docchi:status' using errcode = '22023';
  end if;
  update public.app_errors g
  set status = new_status,
      fixed_at = case when new_status = 'fixed' then now() else g.fixed_at end,
      back_alerted = case when new_status = 'fixed' then false else g.back_alerted end,
      came_back = case when new_status = 'open' then g.came_back else false end
  where g.id = err
  returning g.message into msg;
  if msg is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  perform public.admin_event('error_' || new_status, left(msg, 120));
  return new_status;
end;
$$;
revoke execute on function public.admin_error_status(bigint, text) from public, anon;
grant execute on function public.admin_error_status(bigint, text) to authenticated;

-- The 2-minute job: records that it ran, deletes what's over 30 days old, and picks at most
-- one alert for the admin's phone (a new error hitting 3+ people, a spike, or one back after
-- a fix; one an hour; 11 pm–8 am India time only if 25+ people were hit in 2 hours).
create or replace function public.errors_tick(secret text, run jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ist_hour int := extract(hour from now() at time zone 'Asia/Kolkata')::int;
  pick record;
  admin uuid := (select p.id from public.profiles p where p.is_admin limit 1);
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  insert into public.job_status (id, last_run, result) values (1, now(), run)
  on conflict (id) do update set last_run = excluded.last_run, result = excluded.result;

  delete from public.app_error_events e where e.at < now() - interval '30 days';
  delete from public.app_errors g where g.last_seen < now() - interval '30 days';

  if admin is null or exists (select 1 from public.app_errors g where g.alerted_at > now() - interval '1 hour') then
    return jsonb_build_object('alert', null);
  end if;

  for pick in
    select c.* from (
      select g.id, g.message, g.place,
             case when g.came_back and not g.back_alerted then 'back'
                  when g.status = 'new' and g.alerted_at is null then 'new'
                  when public.app_error_spike(g.id) and (g.alerted_at is null or g.alerted_at < now() - interval '6 hours') then 'spike'
             end as what,
             (select count(distinct coalesce(e.user_id::text, e.visitor, e.id::text)) from public.app_error_events e
               where e.error_id = g.id and e.at > now() - interval '2 hours') as recent,
             (select count(distinct coalesce(e.user_id::text, e.visitor, e.id::text)) from public.app_error_events e
               where e.error_id = g.id) as everyone
      from public.app_errors g
      where g.status <> 'ignored' and g.last_seen > now() - interval '2 hours'
    ) c
    where c.what is not null
      and (c.what <> 'new' or c.everyone >= 3)
      and (ist_hour between 8 and 22 or c.recent >= 25)
    order by c.recent desc
    limit 1
  loop
    update public.app_errors g
    set alerted_at = now(), alert_kind = pick.what, back_alerted = g.back_alerted or pick.what = 'back'
    where g.id = pick.id;
    return jsonb_build_object(
      'alert', jsonb_build_object(
        'title', case pick.what when 'new' then '⚠️ New error: ' when 'spike' then '⚠️ Error spike: ' else '⚠️ Back after fix: ' end
                 || left(pick.message, 60),
        'body', pick.recent || case when pick.recent = 1 then ' person' else ' people' end
                || coalesce(' · ' || nullif(pick.place, ''), '') || ' in the last 2 hours. Tap to see it.',
        'url', '/admin#errors/' || pick.id,
        'tag', 'admin-error'),
      'targets', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                  from public.push_subscriptions s where s.user_id = admin));
  end loop;
  return jsonb_build_object('alert', null);
end;
$$;
revoke execute on function public.errors_tick(text, jsonb) from public;
grant execute on function public.errors_tick(text, jsonb) to anon, authenticated;
