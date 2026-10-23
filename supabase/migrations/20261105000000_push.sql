-- Phone push notifications.
-- Phones subscribe from Profile → Notifications (save_push_subscription). Every
-- couple of minutes pg_cron pings the app's /api/push/run, which calls
-- push_collect(): it turns new events into rows in `notifications` (votes
-- milestones, circle activity, results, Poll of the Day) and hands back a
-- batch to send. The app sends them with web-push and reports dead
-- subscriptions to push_gone().
--
-- One-time setup after running this file (SQL Editor; needs pg_cron and pg_net):
--   select public.schedule_push('https://<your-app>.vercel.app', '<PUSH_CRON_SECRET>');

create table public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- What each person wants pushed. No row = everything on.
create table public.push_settings (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  votes    boolean not null default true,
  circle   boolean not null default true,
  results  boolean not null default true,
  daily    boolean not null default true
);
alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon, authenticated;

-- The outbox. `dedupe` makes every event notify once.
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('votes', 'circle', 'results', 'daily', 'test')),
  title       text not null,
  body        text not null,
  url         text not null,
  tag         text,
  dedupe      text not null unique,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index notifications_pending_idx on public.notifications (created_at) where sent_at is null;
create index notifications_user_sent_idx on public.notifications (user_id, sent_at);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- Highest vote milestone the creator has been told about.
alter table public.polls add column notified_votes int not null default 0;

create or replace function public.vote_milestone(n int)
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(max(m), 0) from unnest(array[10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]) m
  where m <= n;
$$;

-- Existing polls start at their current milestone, so nobody gets a backlog.
update public.polls set notified_votes = public.vote_milestone(vote_count) where vote_count >= 10;

-- The sender proves itself with a shared secret (set by schedule_push).
create table public.push_config (
  id           int primary key default 1 check (id = 1),
  secret_hash  text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.push_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_config c
                 where c.secret_hash = encode(sha256(convert_to(coalesce(secret, ''), 'UTF8')), 'hex'));
$$;
revoke execute on function public.push_secret_ok(text) from public, anon, authenticated;

-- ─── For the app (signed in) ───────────────────────────────────────────────

create or replace function public.save_push_subscription(endpoint text, p256dh text, auth_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if endpoint !~ '^https://' or char_length(endpoint) > 1000 or char_length(p256dh) > 200 or char_length(auth_key) > 100 then
    raise exception 'docchi:bad_subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth)
  values (save_push_subscription.endpoint, uid, save_push_subscription.p256dh, auth_key)
  on conflict on constraint push_subscriptions_pkey do update
  set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  -- Ten devices is plenty; drop the oldest beyond that.
  delete from public.push_subscriptions s
  where s.user_id = uid
    and s.endpoint not in (select s2.endpoint from public.push_subscriptions s2
                           where s2.user_id = uid order by s2.created_at desc limit 10);
end;
$$;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.delete_push_subscription(endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  where s.endpoint = delete_push_subscription.endpoint and s.user_id = auth.uid();
$$;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.get_push_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'votes', coalesce(s.votes, true), 'circle', coalesce(s.circle, true),
    'results', coalesce(s.results, true), 'daily', coalesce(s.daily, true))
  from (select 1) x
  left join public.push_settings s on s.user_id = auth.uid();
$$;
grant execute on function public.get_push_settings() to authenticated;

create or replace function public.set_push_settings(votes boolean, circle boolean, results boolean, daily boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  insert into public.push_settings as p (user_id, votes, circle, results, daily)
  values (auth.uid(), set_push_settings.votes, set_push_settings.circle, set_push_settings.results, set_push_settings.daily)
  on conflict on constraint push_settings_pkey do update
  set votes = excluded.votes, circle = excluded.circle, results = excluded.results, daily = excluded.daily;
end;
$$;
grant execute on function public.set_push_settings(boolean, boolean, boolean, boolean) to authenticated;

-- ─── For the sender (/api/push/run) ────────────────────────────────────────

-- People with a phone subscribed and this kind of push switched on.
create or replace function public.push_wanted(person uuid, what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = person)
     and coalesce((select case what when 'votes' then p.votes when 'circle' then p.circle
                                    when 'results' then p.results when 'daily' then p.daily else true end
                   from public.push_settings p where p.user_id = person), true);
$$;
revoke execute on function public.push_wanted(uuid, text) from public, anon, authenticated;

create or replace function public.quote_q(q text)
returns text
language sql
immutable
set search_path = ''
as $$ select '“' || case when char_length(q) > 80 then left(q, 79) || '…' else q end || '”' $$;

-- Turns what happened since the last run into notifications.
create or replace function public.push_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  since timestamptz := coalesce((select a.at from public.app_state a where a.key = 'push_scan'), now());
  upto timestamptz := now();
  today date := (upto at time zone 'Asia/Kolkata')::date;
  potd record;
begin
  -- Vote milestones (10, 25, 50, 100, …) on your polls.
  with hit as (
    update public.polls p
    set notified_votes = public.vote_milestone(p.vote_count)
    where p.vote_count >= 10
      and public.vote_milestone(p.vote_count) > p.notified_votes
      and p.closes_at > upto - interval '1 day'
    returning p.id, p.creator_id, p.question, p.is_system, p.is_hidden, p.deleted_at, p.notified_votes
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select h.creator_id, 'votes', 'Your poll is popping 🎉',
         public.quote_q(h.question) || ' just hit ' || to_char(h.notified_votes, 'FM999,999') || ' votes.',
         '/p/' || h.id, 'votes:' || h.id, 'votes:' || h.id || ':' || h.notified_votes
  from hit h
  where h.creator_id is not null and not h.is_system and not h.is_hidden and h.deleted_at is null
    and public.push_wanted(h.creator_id, 'votes')
  on conflict (dedupe) do nothing;

  -- Circle requests, to the circle's owner.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.owner_id, 'circle', 'Circle request', '@' || m.username || ' wants to join your circle.',
         '/profile?tab=circle', 'circle-requests',
         'req:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.created_at)::bigint
  from public.circle_members c
  join public.profiles m on m.id = c.member_id
  where c.status = 'pending' and c.created_at > since and c.created_at <= upto
    and public.push_wanted(c.owner_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Accepted requests, to the person who asked.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', 'You''re in! 🎉', '@' || o.username || ' let you into their circle.',
         '/u/' || o.username, 'circle-in:' || c.owner_id,
         'acc:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.accepted_at)::bigint
  from public.circle_members c
  join public.profiles o on o.id = c.owner_id
  where c.status = 'accepted' and c.accepted_at > since and c.accepted_at <= upto
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- New circle polls, to everyone in that circle (or the chosen groups).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', '@' || o.username || ' asked their circle',
         coalesce(p.teaser, p.question), '/p/' || p.id, 'cpoll:' || p.id, 'cpoll:' || p.id || ':' || c.member_id
  from public.polls p
  join public.profiles o on o.id = p.creator_id
  join public.circle_members c on c.owner_id = p.creator_id and c.status = 'accepted'
  where p.visibility = 'circle' and p.deleted_at is null and not p.is_hidden
    and p.created_at > since and p.created_at <= upto
    and public.can_view_poll(p.id, c.member_id)
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Results, when a poll with a few votes closes: its creator and its voters.
  with closed as (
    select p.id, p.creator_id, p.question, p.vote_count,
           (select o.text from public.poll_options o where o.poll_id = p.id order by o.vote_count desc, o.position limit 1) as top_text,
           (select max(o.vote_count) from public.poll_options o where o.poll_id = p.id) as top_votes,
           (select count(*) from public.poll_options o where o.poll_id = p.id
              and o.vote_count = (select max(o2.vote_count) from public.poll_options o2 where o2.poll_id = p.id)) as leaders
    from public.polls p
    where p.closes_at > since and p.closes_at <= upto
      and p.deleted_at is null and not p.is_hidden and p.vote_count >= 3
  ),
  who as (
    select c.*, v.user_id as person, false as is_creator
    from closed c join public.votes v on v.poll_id = c.id
    where v.user_id is distinct from c.creator_id
    union all
    select c.*, c.creator_id, true from closed c where c.creator_id is not null
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select w.person, 'results',
         case when w.is_creator then 'Your poll closed' else 'Results are in' end,
         public.quote_q(w.question) || ' → ' ||
           case when w.leaders > 1 then 'it''s a tie!'
                else w.top_text || ' won with ' || round(100.0 * w.top_votes / nullif(w.vote_count, 0)) || '%.' end,
         '/p/' || w.id, 'results:' || w.id, 'results:' || w.id || ':' || w.person
  from who w
  where public.push_wanted(w.person, 'results')
  on conflict (dedupe) do nothing;

  -- Poll of the Day, once a day from 9am India time.
  if (upto at time zone 'Asia/Kolkata')::time >= time '09:00'
     and coalesce((select a.at from public.app_state a where a.key = 'push_daily'), '-infinity')
         < (today::timestamp at time zone 'Asia/Kolkata') then
    select p.id, coalesce(p.teaser, p.question) as q into potd
    from public.polls p
    where p.featured_on = today and p.deleted_at is null and not p.is_hidden
      and p.created_at <= upto and p.closes_at > upto;
    if potd.id is not null then
      insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
      select s.user_id, 'daily', 'Poll of the Day ☀️', potd.q, '/?poll=' || potd.id, 'daily',
             'daily:' || today || ':' || s.user_id
      from (select distinct ps.user_id from public.push_subscriptions ps) s
      where public.push_wanted(s.user_id, 'daily')
        and not exists (select 1 from public.votes v where v.poll_id = potd.id and v.user_id = s.user_id)
      on conflict (dedupe) do nothing;
    end if;
    insert into public.app_state (key, at) values ('push_daily', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  insert into public.app_state (key, at) values ('push_scan', upto)
  on conflict (key) do update set at = excluded.at;

  -- Old outbox rows go after a week.
  delete from public.notifications n where n.created_at < upto - interval '7 days';
end;
$$;
revoke execute on function public.push_scan() from public, anon, authenticated;

-- One batch to send: scans for new events, then claims up to max_rows
-- notifications (one row per device). Nothing goes out between 11pm and 8am
-- India time (they wait, and expire after 12 hours), and nobody gets more
-- than 8 a day.
create or replace function public.push_collect(secret text, max_rows int default 300)
returns table (id bigint, endpoint text, p256dh text, auth text, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
  day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  -- Only one sender at a time.
  if not pg_try_advisory_xact_lock(hashtext('docchi.push')) then
    return;
  end if;

  perform public.push_scan();
  if local_hour >= 23 or local_hour < 8 then
    return;
  end if;

  return query
  with pending as (
    select n.id, n.user_id,
           row_number() over (partition by n.user_id
                              order by case n.kind when 'test' then 0 when 'circle' then 1 when 'results' then 2
                                                   when 'votes' then 3 else 4 end, n.created_at) as rn
    from public.notifications n
    where n.sent_at is null and n.created_at > now() - interval '12 hours'
  ),
  picked as (
    select pe.id from pending pe
    where pe.rn <= 8 - (select count(*) from public.notifications x
                        where x.user_id = pe.user_id and x.sent_at >= day_start and x.kind <> 'test')
    order by pe.id
    limit greatest(coalesce(max_rows, 300), 1)
  ),
  claimed as (
    update public.notifications n set sent_at = now()
    where n.id in (select pk.id from picked pk)
    returning n.id, n.user_id, n.title, n.body, n.url, n.tag
  )
  select c.id, s.endpoint, s.p256dh, s.auth,
         jsonb_build_object('title', c.title, 'body', c.body, 'url', c.url, 'tag', c.tag)
  from claimed c
  join public.push_subscriptions s on s.user_id = c.user_id;
end;
$$;
revoke execute on function public.push_collect(text, int) from public;
grant execute on function public.push_collect(text, int) to anon, authenticated;

-- Subscriptions the push service says are gone (404/410).
create or replace function public.push_gone(secret text, endpoints text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  delete from public.push_subscriptions s where s.endpoint = any (endpoints);
end;
$$;
revoke execute on function public.push_gone(text, text[]) from public;
grant execute on function public.push_gone(text, text[]) to anon, authenticated;

-- "Send me a test": the person's own devices, at most 3 tests an hour.
create or replace function public.push_test_targets(secret text, person uuid)
returns table (endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  if (select count(*) from public.notifications n
      where n.user_id = person and n.kind = 'test' and n.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'docchi:too_many' using errcode = '54000';
  end if;
  insert into public.notifications (user_id, kind, title, body, url, dedupe, sent_at)
  values (person, 'test', 'test', 'test', '/', 'test:' || person || ':' || extract(epoch from clock_timestamp()), now());
  return query select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s where s.user_id = person;
end;
$$;
revoke execute on function public.push_test_targets(text, uuid) from public;
grant execute on function public.push_test_targets(text, uuid) to anon, authenticated;

-- ─── One-time setup ───────────────────────────────────────────────────────

-- Saves the secret and asks pg_cron to ping the app every 2 minutes.
create or replace function public.schedule_push(site_url text, secret text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(secret, '')) < 24 then
    raise exception 'Use a long random secret (24+ characters), the same as PUSH_CRON_SECRET in Vercel.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Turn on pg_cron first: Database → Extensions → pg_cron.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Turn on pg_net first: Database → Extensions → pg_net.';
  end if;
  insert into public.push_config (id, secret_hash)
  values (1, encode(sha256(convert_to(secret, 'UTF8')), 'hex'))
  on conflict (id) do update set secret_hash = excluded.secret_hash;
  perform cron.schedule('docchi-push', '*/2 * * * *', format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb, timeout_milliseconds := 60000)',
    rtrim(site_url, '/') || '/api/push/run',
    jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json')::text));
  return 'Push scheduled every 2 minutes → ' || rtrim(site_url, '/') || '/api/push/run';
end;
$$;
revoke execute on function public.schedule_push(text, text) from public, anon, authenticated;
