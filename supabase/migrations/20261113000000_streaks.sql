-- Streaks and results.
--
--   * A streak is the run of days (India time) you've voted on at least one
--     poll, ending today or yesterday (it's still alive until midnight).
--     Guests' votes count too, so signing in keeps the streak.
--   * my_streak(): current, best (last 400 days), and whether you voted today.
--   * recent_results(): polls you voted on or made that closed in the last
--     3 days, with the winning answer and your pick (for Activity).
--   * Pushes: the 9am Poll of the Day mentions your streak; at 8pm a streak of
--     3+ days that hasn't voted today gets "ends at midnight" (the Poll of the
--     Day switch covers both).

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

-- ─── Pushes: streak line on Poll of the Day, and the 8pm streak saver ──────

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
         'comments:' || p.id || ':' || extract(epoch from upto)::bigint
  from public.comments c
  join public.polls p on p.id = c.poll_id
  join public.profiles u on u.id = c.user_id
  where c.created_at > since and c.created_at <= upto and not c.is_hidden
    and p.creator_id is not null and c.user_id <> p.creator_id
    and public.push_wanted(p.creator_id, 'comments')
  group by p.id, p.creator_id, p.question
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

