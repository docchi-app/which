-- Notifications stopped going out: push_scan calls streak_of(), which comes from
-- 20261113000000_streaks.sql, and that migration never ran on the live database. Every
-- sender run failed at the Poll of the Day step, and since it all ran in one transaction,
-- nothing was sent at all.
--
-- 1. The three functions from the streaks migration, unchanged (its old push_scan is left out:
--    later migrations replaced it).
-- 2. push_collect: a scan that fails no longer blocks sending. The error is kept in
--    push_errors (newest first: select * from public.push_errors order by at desc), and
--    whatever is already queued still goes out.
-- 3. push_scan looks back at most 6 hours, so after an outage people don't get a burst of
--    old friend requests and comments.
--
-- Check that every migration ran with supabase/checks/migration-check.sql.

create or replace function public.streak_of(person uuid)
returns table (current_days int, best_days int, voted_today boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select distinct (v.created_at at time zone 'Asia/Kolkata')::date as day
    from public.votes v
    where v.user_id = person and v.created_at > now() - interval '400 days'
  ), runs as (
    select max(g.day) as last_day, count(*)::int as len
    from (select d.day, d.day - (row_number() over (order by d.day))::int as grp from d) g
    group by g.grp
  ), t as (
    select (now() at time zone 'Asia/Kolkata')::date as today
  )
  select
    coalesce((select r.len from runs r, t where r.last_day >= t.today - 1 order by r.last_day desc limit 1), 0),
    coalesce((select max(r.len) from runs r), 0),
    exists (select 1 from d, t where d.day = t.today);
$$;
revoke execute on function public.streak_of(uuid) from public, anon, authenticated;

create or replace function public.my_streak()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('current', s.current_days, 'best', s.best_days, 'today', s.voted_today)
  from public.streak_of(auth.uid()) s;
$$;
grant execute on function public.my_streak() to authenticated;

-- Polls I voted on or made that closed in the last 3 days.
create or replace function public.recent_results()
returns table (poll_id uuid, question text, kind text, vote_count int, winner text, winner_pct int, my_pick text, mine boolean, closed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.question, p.teaser), p.kind, p.vote_count,
         w.text,
         case when p.vote_count > 0 then round(100.0 * w.vote_count / p.vote_count)::int else 0 end,
         mo.text,
         p.creator_id = auth.uid(),
         p.closes_at
  from public.polls p
  left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
  left join public.poll_options mo on mo.id = v.option_id
  cross join lateral (
    select o.text, o.vote_count from public.poll_options o
    where o.poll_id = p.id order by o.vote_count desc, o.position limit 1
  ) w
  where auth.uid() is not null
    and (v.option_id is not null or p.creator_id = auth.uid())
    and p.closes_at <= now() and p.closes_at > now() - interval '3 days'
    and p.deleted_at is null and not p.is_hidden
    and public.can_view_poll(p.id, auth.uid())
  order by p.closes_at desc
  limit 10;
$$;
grant execute on function public.recent_results() to authenticated;

create table if not exists public.push_errors (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  step    text not null,
  message text not null
);
alter table public.push_errors enable row level security;
revoke all on table public.push_errors from public, anon, authenticated;

create or replace function public.push_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Look back 2 minutes past the last run: a row whose transaction started before that run but
  -- committed after it would otherwise be missed. The dedupe keys stop repeats. Never more than
  -- 6 hours: after an outage, older friend requests and comments aren't news anymore.
  since timestamptz := greatest(
    coalesce((select a.at from public.app_state a where a.key = 'push_scan'), now()) - interval '2 minutes',
    now() - interval '6 hours');
  upto timestamptz := now();
  today date := (upto at time zone 'Asia/Kolkata')::date;
  potd record;
begin
  -- Vote milestones (3, 5, 10, 25, 50, 100, …) on your polls.
  with hit as (
    update public.polls p
    set notified_votes = public.vote_milestone(p.vote_count)
    where p.vote_count >= 3
      and public.vote_milestone(p.vote_count) > p.notified_votes
      and p.closes_at > upto - interval '1 day'
    returning p.id, p.creator_id, p.question, p.is_system, p.is_hidden, p.deleted_at, p.notified_votes
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select h.creator_id, 'votes', case when h.notified_votes < 10 then 'People are voting 👀' else 'Your poll is popping 🎉' end,
         public.quote_q(h.question) || ' just hit ' || to_char(h.notified_votes, 'FM999,999') || ' votes.',
         '/p/' || h.id, 'votes:' || h.id, 'votes:' || h.id || ':' || h.notified_votes
  from hit h
  where h.creator_id is not null and not h.is_system and not h.is_hidden and h.deleted_at is null
    and public.push_wanted(h.creator_id, 'votes')
  on conflict (dedupe) do nothing;

  -- Friend requests, to the person asked.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.owner_id, 'circle', 'Friend request', '@' || m.username || ' wants to be friends.',
         '/friends', 'circle-requests',
         'req:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.created_at)::bigint
  from public.circle_members c
  join public.profiles m on m.id = c.member_id
  where c.status = 'pending' and c.initiator and c.created_at > since and c.created_at <= upto
    and public.push_wanted(c.owner_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Accepted requests, to the person who asked (not the reverse row made on accepting).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', 'New friend 🎉', 'You and @' || o.username || ' are friends now.',
         '/u/' || o.username, 'circle-in:' || c.owner_id,
         'acc:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.accepted_at)::bigint
  from public.circle_members c
  join public.profiles o on o.id = c.owner_id
  where c.status = 'accepted' and c.initiator and c.accepted_at > since and c.accepted_at <= upto
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- New friends-only polls, to their friends (or the chosen lists).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', '@' || o.username || ' asked their friends',
         coalesce(p.teaser, p.question), '/p/' || p.id, 'cpoll:' || p.id, 'cpoll:' || p.id || ':' || c.member_id
  from public.polls p
  join public.profiles o on o.id = p.creator_id
  join public.circle_members c on c.owner_id = p.creator_id and c.status = 'accepted'
  where p.visibility = 'circle' and p.deleted_at is null and not p.is_hidden
    and (p.kind <> 'snap' or p.photo_status = 'live')
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

  -- New comments on your poll: one push per poll per run.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select p.creator_id, 'comments',
         case when count(*) = 1 then '@' || min(u.username::text) || ' commented'
              else count(*) || ' new comments' end,
         public.quote_q(p.question) || ' · “' || left((array_agg(c.text order by c.created_at desc))[1], 80) || '”',
         '/p/' || p.id || '?comments=1', 'comments:' || p.id,
         'comments:' || p.id || ':' || extract(epoch from max(c.created_at))::bigint
  from public.comments c
  join public.polls p on p.id = c.poll_id
  join public.profiles u on u.id = c.user_id
  where c.created_at > since and c.created_at <= upto and not c.is_hidden
    and p.creator_id is not null and c.user_id <> p.creator_id
    and public.push_wanted(p.creator_id, 'comments')
  group by p.id, p.creator_id, p.question
  on conflict (dedupe) do nothing;

  -- New polls from Eithr, as they go live (the Poll of the Day has its own 9am push below).
  -- One that unlocks overnight waits for the morning (quiet hours).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select s.user_id, 'daily', 'New on Eithr 🗳️', coalesce(p.teaser, p.question),
         '/?poll=' || p.id, 'docchi-poll',
         'docpoll:' || p.id || ':' || s.user_id
  from public.polls p
  cross join (select distinct ps.user_id from public.push_subscriptions ps) s
  where p.is_system and p.featured_on is null and p.deleted_at is null and not p.is_hidden
    and p.visibility = 'public'
    and p.created_at > since and p.created_at <= upto and p.closes_at > upto
    and public.push_wanted(s.user_id, 'daily')
    and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = s.user_id)
  on conflict (dedupe) do nothing;

  -- Poll of the Day, once a day from 9am India time: an invitation to vote, or, if you
  -- already have, how it's going.
  if (upto at time zone 'Asia/Kolkata')::time >= time '09:00'
     and coalesce((select a.at from public.app_state a where a.key = 'push_daily'), '-infinity')
         < (today::timestamp at time zone 'Asia/Kolkata') then
    select p.id, coalesce(p.teaser, p.question) as q, p.question as full_q, p.vote_count,
           (select o.text from public.poll_options o where o.poll_id = p.id
            order by o.vote_count desc, o.position limit 1) as top_text,
           (select max(o.vote_count) from public.poll_options o where o.poll_id = p.id) as top_votes
    into potd
    from public.polls p
    where p.featured_on = today and p.deleted_at is null and not p.is_hidden
      and p.created_at <= upto and p.closes_at > upto;
    if potd.id is not null then
      insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
      select s.user_id, 'daily', 'Poll of the Day ☀️',
             potd.q || case when st.current_days >= 2
                            then ' · Keep your 🔥 ' || st.current_days || '-day streak going' else '' end,
             '/?poll=' || potd.id, 'daily',
             'daily:' || today || ':' || s.user_id
      from (select distinct ps.user_id from public.push_subscriptions ps) s
      cross join lateral public.streak_of(s.user_id) st
      where public.push_wanted(s.user_id, 'daily')
        and not exists (select 1 from public.votes v where v.poll_id = potd.id and v.user_id = s.user_id)
      on conflict (dedupe) do nothing;

      insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
      select s.user_id, 'daily', 'Poll of the Day ☀️',
             public.quote_q(potd.full_q) || ' → ' ||
               case when potd.vote_count >= 3
                    then potd.top_text || ' leads with ' || round(100.0 * potd.top_votes / potd.vote_count) || '% so far.'
                    else 'see how everyone''s voting.' end,
             '/?poll=' || potd.id, 'daily',
             'daily:' || today || ':' || s.user_id
      from (select distinct ps.user_id from public.push_subscriptions ps) s
      where public.push_wanted(s.user_id, 'daily')
        and exists (select 1 from public.votes v where v.poll_id = potd.id and v.user_id = s.user_id)
      on conflict (dedupe) do nothing;
    end if;
    insert into public.app_state (key, at) values ('push_daily', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  -- Streak saver, once a day from 8pm India time: a streak of 3+ days that ends at midnight.
  if (upto at time zone 'Asia/Kolkata')::time >= time '20:00'
     and coalesce((select a.at from public.app_state a where a.key = 'push_streak'), '-infinity')
         < (today::timestamp at time zone 'Asia/Kolkata') then
    insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
    select s.user_id, 'daily', 'Your 🔥 ' || st.current_days || '-day streak ends at midnight',
           'One vote keeps it going.', '/', 'streak', 'streak:' || today || ':' || s.user_id
    from (select distinct ps.user_id from public.push_subscriptions ps) s
    cross join lateral public.streak_of(s.user_id) st
    where public.push_wanted(s.user_id, 'daily')
      and st.current_days >= 3 and not st.voted_today
    on conflict (dedupe) do nothing;
    insert into public.app_state (key, at) values ('push_streak', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  insert into public.app_state (key, at) values ('push_scan', upto)
  on conflict (key) do update set at = excluded.at;

  -- Old outbox rows go after a week.
  delete from public.notifications n where n.created_at < upto - interval '7 days';
end;
$$;
revoke execute on function public.push_scan() from public, anon, authenticated;

create or replace function public.push_collect(secret text, max_rows int default 300)
returns table (id bigint, endpoint text, p256dh text, auth text, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  -- Only one sender at a time.
  if not pg_try_advisory_xact_lock(hashtext('docchi.push')) then
    return;
  end if;

  -- A scan that fails (say, a missing function) mustn't stop what's already queued from going
  -- out. Each one runs on its own; its error is kept in push_errors (the last 200).
  begin
    perform public.push_scan();
  exception when others then
    insert into public.push_errors (step, message) values ('push_scan', sqlerrm);
  end;
  begin
    perform public.props_scan();
  exception when others then
    insert into public.push_errors (step, message) values ('props_scan', sqlerrm);
  end;
  delete from public.push_errors e where e.id <= (select max(x.id) - 200 from public.push_errors x);
  if local_hour >= 23 or local_hour < 8 then
    return;
  end if;

  return query
  -- Everything waiting goes out (no daily cap), oldest first.
  with picked as (
    select n.id from public.notifications n
    where n.sent_at is null and n.created_at > now() - interval '12 hours'
    order by n.id
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
