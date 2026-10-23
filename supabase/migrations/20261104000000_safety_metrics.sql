-- Safety and metrics.
-- 1. Reporting: anyone signed in can report a poll or a person. A poll that
--    3 different people report is hidden until an admin looks at it.
-- 2. Moderation for admins (profiles.is_admin): a queue of reports with
--    Remove / Dismiss / Ban, a log of actions, and undo.
-- 3. Metrics: one row per visitor per day (a random id kept in the browser),
--    so the admin page can show visitors, % who vote, votes per session,
--    share rate and D1/D7 retention next to the targets.
-- 4. Clean-up that matches the Privacy page: removed polls, old comments and
--    resolved reports go after 180 days, visits after 2 years.
--
-- Make yourself an admin (once, in the SQL Editor):
--   update public.profiles set is_admin = true where username = 'your_name';

-- ─── Reports ───────────────────────────────────────────────────────────────

alter table public.polls add column hidden_at timestamptz;
-- 'reports': hidden automatically, waiting for review · 'admin': removed ·
-- 'ban': its creator was banned.
alter table public.polls add column hidden_reason text check (hidden_reason in ('reports', 'admin', 'ban'));

create index reports_open_idx on public.reports (target_type, target_id) where resolved_at is null;
create index reports_reporter_idx on public.reports (reporter_id, created_at);

-- How many different people must report a poll before it hides itself.
create or replace function public.auto_hide_threshold()
returns int language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.report(kind text, reason text, poll uuid default null, name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  p record;
  open_reports int;
  hidden boolean := false;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  if reason is null or reason not in ('hate', 'private_info', 'sexual', 'violence', 'self_harm', 'spam', 'illegal', 'other') then
    raise exception 'docchi:bad_reason' using errcode = '22023';
  end if;
  if (select count(*) from public.reports r where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'docchi:report_limit' using errcode = '54000';
  end if;

  if kind = 'poll' then
    select x.id, x.creator_id, x.is_system, x.is_hidden into p
    from public.polls x where x.id = poll and x.deleted_at is null;
    if not found or not public.can_view_poll(poll, uid) then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if p.creator_id = uid then
      raise exception 'docchi:own_poll' using errcode = '22023';
    end if;
    target := poll;
  elsif kind = 'user' then
    select u.id into target from public.profiles u where u.username = lower(name);
    if target is null then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if target = uid then
      raise exception 'docchi:own_poll' using errcode = '22023';
    end if;
  else
    raise exception 'docchi:bad_kind' using errcode = '22023';
  end if;

  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (kind, target, uid, reason)
  on conflict (target_type, target_id, reporter_id) do nothing;

  if kind = 'poll' and not p.is_system and not p.is_hidden then
    select count(*) into open_reports from public.reports r
    where r.target_type = 'poll' and r.target_id = poll and r.resolved_at is null;
    if open_reports >= public.auto_hide_threshold() then
      update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'reports' where id = poll;
      hidden := true;
    end if;
  end if;

  return jsonb_build_object('hidden', hidden);
end;
$$;
revoke execute on function public.report(text, text, uuid, text) from public, anon;
grant execute on function public.report(text, text, uuid, text) to authenticated;

-- ─── Admin ─────────────────────────────────────────────────────────────────

create table public.mod_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid not null,
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index mod_actions_created_idx on public.mod_actions (created_at desc);
alter table public.mod_actions enable row level security;
revoke all on public.mod_actions from anon, authenticated;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin and not is_banned) then
    raise exception 'docchi:not_admin' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke execute on function public.require_admin() from public, anon, authenticated;

-- my_profile also says whether you're an admin (to show the Admin link).
create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'username', case when pr.username::text like 'guest\_%' then null else pr.username::text end,
    'username_confirmed', pr.username_confirmed,
    'avatar_url', pr.avatar_url,
    'joined', pr.created_at,
    'username_changed_at', pr.username_changed_at,
    'polls_made', (select count(*) from public.polls p where p.creator_id = pr.id and p.deleted_at is null),
    'votes_received', (select coalesce(sum(p.vote_count), 0) from public.polls p
                        where p.creator_id = pr.id and p.deleted_at is null),
    'shares', (select coalesce(sum(p.share_count), 0) from public.polls p
                where p.creator_id = pr.id and p.deleted_at is null),
    'votes_cast', (select count(*) from public.votes v where v.user_id = pr.id),
    'is_admin', pr.is_admin
  )
  from public.profiles pr
  where pr.id = auth.uid();
$$;

-- The queue: one row per reported poll or person, waiting ('open') or
-- recently handled ('done'). Polls hidden by reports come first.
create or replace function public.admin_reports(status text default 'open')
returns table (
  target_type text, target_id uuid, reports int, reasons jsonb, last_at timestamptz,
  question text, teaser text, kind text, visibility text, options text[], created_at timestamptz,
  is_hidden boolean, hidden_reason text,
  username text, avatar_url text, is_banned boolean, user_polls int, user_reports int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  with grouped as (
    select r.target_type, r.target_id, count(*)::int as n,
           max(r.created_at) as last_at,
           (select jsonb_object_agg(x.reason, x.c) from (
              select r2.reason, count(*) as c from public.reports r2
              where r2.target_type = r.target_type and r2.target_id = r.target_id
                and (r2.resolved_at is null) = (status = 'open')
              group by r2.reason) x) as reasons
    from public.reports r
    where (r.resolved_at is null) = (status = 'open')
      and (status = 'open' or r.resolved_at > now() - interval '30 days')
    group by r.target_type, r.target_id
  )
  select g.target_type, g.target_id, g.n, g.reasons, g.last_at,
         p.question, p.teaser, p.kind, p.visibility,
         (select array_agg(o.text order by o.position) from public.poll_options o where o.poll_id = p.id),
         p.created_at, coalesce(p.is_hidden, false), p.hidden_reason,
         u.username::text, u.avatar_url, u.is_banned,
         (select count(*)::int from public.polls q where q.creator_id = u.id and q.deleted_at is null),
         (select count(*)::int from public.reports r3
            left join public.polls q on r3.target_type = 'poll' and q.id = r3.target_id
            where (r3.target_type = 'user' and r3.target_id = u.id) or q.creator_id = u.id)
  from grouped g
  left join public.polls p on g.target_type = 'poll' and p.id = g.target_id
  left join public.profiles u on u.id = case when g.target_type = 'poll' then p.creator_id else g.target_id end
  order by (p.hidden_reason = 'reports') desc nulls last, g.n desc, g.last_at desc
  limit 100;
end;
$$;
grant execute on function public.admin_reports(text) to authenticated;

-- poll: remove · restore · dismiss · ban (bans its creator)
-- user: dismiss · ban · unban
create or replace function public.admin_act(kind text, target uuid, act text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  person uuid;
begin
  if kind = 'poll' then
    select p.creator_id into person from public.polls p where p.id = target;
    if not found then raise exception 'docchi:not_found' using errcode = 'P0002'; end if;
  elsif kind = 'user' then
    person := target;
  else
    raise exception 'docchi:bad_kind' using errcode = '22023';
  end if;

  if kind = 'poll' and act = 'remove' then
    update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'admin' where id = target;
  elsif kind = 'poll' and act = 'restore' then
    update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null where id = target;
  elsif act = 'dismiss' then
    -- Reports were wrong: undo an automatic hide.
    if kind = 'poll' then
      update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null
      where id = target and hidden_reason = 'reports';
    end if;
  elsif act = 'ban' then
    if person is null then raise exception 'docchi:not_found' using errcode = 'P0002'; end if;
    if person = me then raise exception 'docchi:own_poll' using errcode = '22023'; end if;
    update public.profiles set is_banned = true where id = person;
    update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'ban'
    where creator_id = person and (not is_hidden or hidden_reason = 'reports');
    update public.reports r set resolved_at = now()
    where r.resolved_at is null
      and ((r.target_type = 'user' and r.target_id = person)
           or (r.target_type = 'poll' and r.target_id in (select id from public.polls where creator_id = person)));
  elsif kind = 'user' and act = 'unban' then
    update public.profiles set is_banned = false where id = person;
    update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null
    where creator_id = person and hidden_reason = 'ban';
  else
    raise exception 'docchi:bad_action' using errcode = '22023';
  end if;

  if act in ('remove', 'dismiss') then
    update public.reports r set resolved_at = now()
    where r.resolved_at is null and r.target_type = kind and r.target_id = target;
  end if;

  if act in ('restore', 'unban') then
    -- Undoing: mark the latest matching action as undone.
    update public.mod_actions m set undone_at = now()
    where m.id = (select m2.id from public.mod_actions m2
                  where m2.undone_at is null
                    and m2.action = case act when 'restore' then 'remove' else 'ban' end
                    and (m2.target_id = target
                         or (act = 'unban' and m2.target_type = 'poll'
                             and m2.target_id in (select id from public.polls where creator_id = person)))
                  order by m2.created_at desc limit 1);
  end if;

  insert into public.mod_actions (admin_id, action, target_type, target_id)
  values (me, act, kind, target);
end;
$$;
grant execute on function public.admin_act(text, uuid, text) to authenticated;

-- Recent actions, newest first, with what they were about (for undo).
create or replace function public.admin_log(max_rows int default 50)
returns table (
  id uuid, action text, target_type text, target_id uuid, created_at timestamptz, undone boolean,
  admin text, question text, username text, user_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select m.id, m.action, m.target_type, m.target_id, m.created_at, m.undone_at is not null,
         a.username::text, p.question, u.username::text, u.id
  from public.mod_actions m
  left join public.profiles a on a.id = m.admin_id
  left join public.polls p on m.target_type = 'poll' and p.id = m.target_id
  left join public.profiles u on u.id = case when m.target_type = 'poll' then p.creator_id else m.target_id end
  order by m.created_at desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;
grant execute on function public.admin_log(int) to authenticated;

-- ─── Metrics ───────────────────────────────────────────────────────────────

create table public.visits (
  visitor    uuid not null,
  day        date not null,
  user_id    uuid references public.profiles (id) on delete set null,
  sessions   int not null default 1,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (visitor, day)
);
create index visits_day_idx on public.visits (day);
alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;

-- The day each visitor was first seen (for "new visitors" and retention).
create table public.visitors (
  visitor    uuid primary key,
  first_day  date not null
);
create index visitors_first_day_idx on public.visitors (first_day);
alter table public.visitors enable row level security;
revoke all on public.visitors from anon, authenticated;

create index votes_created_idx on public.votes (created_at);
create index shares_created_idx on public.shares (created_at);

-- Called when the app opens (new_session) and when it comes back after a
-- while. One row per visitor per day (India time).
create or replace function public.track_visit(visitor uuid, new_session boolean default true)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.visitors (visitor, first_day)
  values (visitor, (now() at time zone 'Asia/Kolkata')::date)
  on conflict do nothing;
  insert into public.visits as v (visitor, day, user_id)
  values (visitor, (now() at time zone 'Asia/Kolkata')::date, auth.uid())
  on conflict (visitor, day) do update
  set sessions = least(v.sessions + case when new_session then 1 else 0 end, 50),
      user_id = coalesce(auth.uid(), v.user_id),
      last_at = now();
$$;
grant execute on function public.track_visit(uuid, boolean) to anon, authenticated;

-- Votes, voters, shares, new polls and sign-ups for a range of days (India
-- time), counted live. Finished days are counted once into metrics_daily.
create or replace function public.day_counts(from_day date, to_day date)
returns table (day date, votes int, voters int, shares int, polls int, signups int)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select generate_series(from_day, to_day, interval '1 day')::date as day),
  lo as (select (from_day::timestamp at time zone 'Asia/Kolkata') as t0,
                ((to_day + 1)::timestamp at time zone 'Asia/Kolkata') as t1),
  vt as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as votes, count(distinct x.user_id)::int as voters
    from public.votes x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1 group by 1
  ),
  sh as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as shares
    from public.shares x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1 group by 1
  ),
  pl as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as polls
    from public.polls x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1 and not x.is_system group by 1
  ),
  su as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as signups
    from public.profiles x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1
      and x.username::text not like 'guest\_%' group by 1
  )
  select d.day, coalesce(vt.votes, 0), coalesce(vt.voters, 0), coalesce(sh.shares, 0),
         coalesce(pl.polls, 0), coalesce(su.signups, 0)
  from d
  left join vt on vt.day = d.day
  left join sh on sh.day = d.day
  left join pl on pl.day = d.day
  left join su on su.day = d.day;
$$;
revoke execute on function public.day_counts(date, date) from public, anon, authenticated;

create table public.metrics_daily (
  day     date primary key,
  votes   int not null,
  voters  int not null,
  shares  int not null,
  polls   int not null,
  signups int not null
);
alter table public.metrics_daily enable row level security;
revoke all on public.metrics_daily from anon, authenticated;

-- One row per day (India time), newest first.
--   vote_pct: share of visitors who voted · votes_per_session: votes ÷ signed-in sessions
--   share_rate: shares ÷ votes · d1 / d7: share of that day's new visitors seen again 1 / 7 days later
create or replace function public.admin_metrics(days int default 14)
returns table (
  day date, visitors int, new_visitors int, signed_in int, sessions int, signed_sessions int, voters int, votes int,
  shares int, polls int, signups int,
  vote_pct numeric, votes_per_session numeric, share_rate numeric, d1 numeric, d7 numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int := least(greatest(coalesce(days, 14), 1), 90);
  since date := today - (n - 1);
  gap date;
begin
  perform public.require_admin();
  -- Count any finished day in the window that isn't stored yet.
  select min(g.day) into gap
  from generate_series(since, today - 1, interval '1 day') g(day)
  where not exists (select 1 from public.metrics_daily m where m.day = g.day::date);
  if gap is not null then
    insert into public.metrics_daily (day, votes, voters, shares, polls, signups)
    select x.day, x.votes, x.voters, x.shares, x.polls, x.signups from public.day_counts(gap, today - 1) x
    on conflict on constraint metrics_daily_pkey do nothing;
  end if;

  return query
  with d as (
    select generate_series(since, today, interval '1 day')::date as day
  ),
  vis as (
    select v.day, count(*)::int as visitors,
           count(*) filter (where v.user_id is not null)::int as signed_in,
           coalesce(sum(v.sessions) filter (where v.user_id is not null), 0)::int as signed_sessions,
           sum(v.sessions)::int as sessions
    from public.visits v
    where v.day >= since
    group by v.day
  ),
  back as (
    select f.first_day as day, count(*)::int as cohort,
           count(b1.visitor)::numeric as back1, count(b7.visitor)::numeric as back7
    from public.visitors f
    left join public.visits b1 on b1.visitor = f.visitor and b1.day = f.first_day + 1
    left join public.visits b7 on b7.visitor = f.visitor and b7.day = f.first_day + 7
    where f.first_day >= since
    group by f.first_day
  ),
  c as (
    select m.day, m.votes, m.voters, m.shares, m.polls, m.signups
    from public.metrics_daily m where m.day >= since and m.day < today
    union all
    select x.day, x.votes, x.voters, x.shares, x.polls, x.signups from public.day_counts(today, today) x
  )
  select d.day,
         coalesce(vis.visitors, 0), coalesce(back.cohort, 0), coalesce(vis.signed_in, 0), coalesce(vis.sessions, 0),
         coalesce(vis.signed_sessions, 0),
         coalesce(c.voters, 0), coalesce(c.votes, 0), coalesce(c.shares, 0), coalesce(c.polls, 0), coalesce(c.signups, 0),
         round(100.0 * c.voters / nullif(vis.visitors, 0), 1),
         round(c.votes::numeric / nullif(vis.signed_sessions, 0), 1),
         round(100.0 * c.shares / nullif(c.votes, 0), 1),
         case when d.day + 1 < today then round(100 * back.back1 / nullif(back.cohort, 0), 1) end,
         case when d.day + 7 < today then round(100 * back.back7 / nullif(back.cohort, 0), 1) end
  from d
  left join vis on vis.day = d.day
  left join back on back.day = d.day
  left join c on c.day = d.day
  order by d.day desc;
end;
$$;
grant execute on function public.admin_metrics(int) to authenticated;

-- ─── Clean-up ──────────────────────────────────────────────────────────────

create or replace function public.purge_old_records()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.polls
  where (deleted_at < now() - interval '180 days')
     or (is_hidden and hidden_reason in ('admin', 'ban') and hidden_at < now() - interval '180 days');
  delete from public.comments c
  where c.expires_at < now() - interval '180 days'
    and not exists (select 1 from public.reports r
                    where r.target_type = 'comment' and r.target_id = c.id and r.resolved_at is null);
  delete from public.reports where resolved_at < now() - interval '180 days';
  delete from public.reports r
  where r.target_type = 'poll' and not exists (select 1 from public.polls p where p.id = r.target_id);
  delete from public.visits where day < (now() at time zone 'Asia/Kolkata')::date - 730;
  delete from public.visitors f
  where f.first_day < (now() at time zone 'Asia/Kolkata')::date - 730
    and not exists (select 1 from public.visits v where v.visitor = f.visitor);
$$;
revoke execute on function public.purge_old_records() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('docchi-purge', '17 3 * * *', 'select public.purge_old_records()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%)', sqlerrm;
end;
$$;
