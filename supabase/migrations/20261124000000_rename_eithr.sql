-- Docchi is now Eithr (said "ee-ther").
--
-- 1. Docchi's own polls show as "by @eithr" (poll_cards).
-- 2. "New on Eithr 🗳️" notifications (push_scan).
-- 3. Usernames starting with "eithr" are reserved, like "docchi" already was.
-- Internal names (error codes, storage keys) keep "docchi": nobody sees them.

create or replace function public.poll_cards(ids uuid[])
returns table (
  ord            bigint,
  id             uuid,
  kind           text,
  visibility     text,
  is_mine        boolean,
  locked         boolean,
  audience       text,
  question       text,
  teaser         text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
  share_count    integer,
  comment_count  integer,
  view_count     integer,
  created_at     timestamptz,
  closes_at      timestamptz,
  my_option_id   uuid,
  options        jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      x.ord,
      p.*,
      v.option_id as my_option_id,
      coalesce(p.creator_id = auth.uid(), false) as mine,
      case when p.visibility = 'circle' then not coalesce(public.can_view_poll(p.id, auth.uid()), false) else false end as is_locked,
      (v.option_id is not null or p.closes_at <= now() or coalesce(p.creator_id = auth.uid(), false)) as can_see
    from unnest(ids) with ordinality as x(id, ord)
    join public.polls p on p.id = x.id
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
    -- A snap shows once its photo passed the check (its creator sees it while it's checked).
    where p.kind <> 'snap' or p.photo_status = 'live' or p.creator_id = auth.uid()
  )
  select
    b.ord,
    b.id,
    b.kind,
    b.visibility,
    b.mine,
    b.is_locked,
    case when b.mine and b.visibility = 'circle' then
      coalesce((select string_agg(g.name, ', ' order by g.name) from public.poll_audience a
                join public.circle_groups g on g.id = a.group_id where a.poll_id = b.id), 'Whole circle')
    end,
    case when b.is_locked or (b.kind = 'mystery' and not b.can_see) then null else b.question end,
    case when b.is_locked then null else b.teaser end,
    case when b.is_system then 'eithr' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_on = (now() at time zone 'Asia/Kolkata')::date, false),
    b.vote_count,
    b.share_count,
    public.live_comment_count(b.id),
    -- Never fewer views than votes (a vote is a view; the count can lag a few seconds).
    greatest(b.view_count, b.vote_count),
    b.created_at,
    b.closes_at,
    b.my_option_id,
    case when b.is_locked then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object(
                'id', o.id,
                'text', o.text,
                'votes', case when b.can_see then o.vote_count end)
              order by o.position)
         from public.poll_options o where o.poll_id = b.id)
    end
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;
revoke execute on function public.poll_cards(uuid[]) from public, anon, authenticated;

create or replace function public.push_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Look back 2 minutes past the last run: a row whose transaction started before that run but
  -- committed after it would otherwise be missed. The dedupe keys stop repeats.
  since timestamptz := coalesce((select a.at from public.app_state a where a.key = 'push_scan'), now()) - interval '2 minutes';
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

create or replace function public.username_problem(name text, for_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when name !~ '^[a-z0-9_]{3,20}$' then 'format'
    when name ~ '^(guest_|docchi|eithr|admin|support|moderator|official|system)' then 'reserved'
    when public.has_blocked_term(regexp_replace(name, '[_0-9]+', ' ', 'g')) then 'blocked'
    when exists (select 1 from public.profiles p where p.username = name and p.id is distinct from for_user) then 'taken'
    else 'ok'
  end;
$$;
revoke execute on function public.username_problem(text, uuid) from public, anon, authenticated;
