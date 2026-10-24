-- Friends: circles become two-way friendships.
--
-- The tables stay (circle_members, circle_groups…), but an accepted pair is
-- now stored both ways: when you accept my request, (you, me) is accepted and
-- (me, you) is added, so each of us sees the other's friends-only polls and
-- both lists line up. `initiator` marks the row of the person who asked
-- (false on the row added on accepting), for badges, pushes and limits.
-- The function names keep "circle" so apps from before this change keep working:
--   request_circle(name)      add friend (accepts at once if they already asked you)
--   respond_request(name, ok) accept / decline
--   leave_circle / remove_from_circle(name)  unfriend, cancel or decline (both directions)
-- Groups are shown as "lists"; poll visibility 'circle' is shown as "Friends".
--
-- Also here:
--   * poll_access: link-only polls you've opened show in your feed (record_open).
--   * get_feed: Trending and New show every live poll you can see: public,
--     your friends' friends-only polls, and link polls you opened or voted on.
--   * friends_voted(poll): how many friends voted (and who), never their picks.
--   * suggest_friends(): mutual friends, creators you vote on, this week's top creators.
--   * Invite links: /u/<name>?invite=<code> makes you friends straight away.

alter table public.circle_members add column initiator boolean not null default true;

-- Everyone already accepted into a circle becomes friends both ways.
insert into public.circle_members (owner_id, member_id, status, created_at, accepted_at, initiator)
select c.member_id, c.owner_id, 'accepted', coalesce(c.accepted_at, c.created_at), coalesce(c.accepted_at, c.created_at), false
from public.circle_members c
where c.status = 'accepted'
on conflict (owner_id, member_id) do update
  set status = 'accepted', accepted_at = coalesce(public.circle_members.accepted_at, excluded.accepted_at);

-- Two people who asked each other: friends.
update public.circle_members c
set status = 'accepted', accepted_at = now()
where c.status = 'pending'
  and exists (select 1 from public.circle_members r where r.owner_id = c.member_id and r.member_id = c.owner_id);

-- Only the asking row counts toward the request rate limit.
create or replace function public.limit_circle_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.initiator and auth.uid() is not null and (select count(*) from public.circle_members c
      where c.member_id = new.member_id and c.initiator and c.created_at > now() - interval '10 minutes') >= 20 then
    perform public.slow_down();
  end if;
  return new;
end;
$$;

-- ─── Becoming friends ──────────────────────────────────────────────────────

-- `accepter` takes up `asker`'s request (which must exist): both rows accepted.
create or replace function public.make_friends(accepter uuid, asker uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.circle_members where owner_id = accepter and status = 'accepted') >= 500
     or (select count(*) from public.circle_members where owner_id = asker and status = 'accepted') >= 500 then
    raise exception 'docchi:circle_full' using errcode = 'P0001';
  end if;
  update public.circle_members
  set status = 'accepted', accepted_at = now()
  where owner_id = accepter and member_id = asker and status = 'pending';
  insert into public.circle_members (owner_id, member_id, status, accepted_at, initiator)
  values (asker, accepter, 'accepted', now(), false)
  on conflict (owner_id, member_id) do update set status = 'accepted', accepted_at = now();
end;
$$;
revoke execute on function public.make_friends(uuid, uuid) from public, anon, authenticated;

-- Add @name as a friend. Returns 'member' (friends) or 'pending' (asked).
create or replace function public.request_circle(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if exists (select 1 from public.profiles where id = me and username::text like 'guest\_%') then
    raise exception 'docchi:need_username' using errcode = 'P0001';
  end if;
  if them = me then
    raise exception 'docchi:self' using errcode = '22023';
  end if;
  if public.is_blocked_between(me, them) then
    raise exception 'docchi:blocked' using errcode = '42501';
  end if;
  if exists (select 1 from public.circle_members where owner_id = them and member_id = me) then
    return (select case status when 'accepted' then 'member' else 'pending' end
            from public.circle_members where owner_id = them and member_id = me);
  end if;
  -- They already asked me: that's a yes.
  if exists (select 1 from public.circle_members where owner_id = me and member_id = them and status = 'pending') then
    perform public.make_friends(me, them);
    return 'member';
  end if;
  if (select count(*) from public.circle_members
      where member_id = me and initiator and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'docchi:request_limit' using errcode = 'P0001';
  end if;
  insert into public.circle_members (owner_id, member_id) values (them, me);
  return 'pending';
end;
$$;
grant execute on function public.request_circle(text) to authenticated;

-- Accept or decline @name's friend request.
create or replace function public.respond_request(name text, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if not accept then
    delete from public.circle_members where owner_id = me and member_id = them and status = 'pending';
    return;
  end if;
  if not exists (select 1 from public.circle_members where owner_id = me and member_id = them and status = 'pending') then
    raise exception 'docchi:no_request' using errcode = 'P0002';
  end if;
  perform public.make_friends(me, them);
end;
$$;
grant execute on function public.respond_request(text, boolean) to authenticated;

-- Unfriend @name, or cancel / decline a request: gone both ways (and from my lists).
create or replace function public.leave_circle(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  delete from public.circle_members
  where (owner_id = me and member_id = them) or (owner_id = them and member_id = me);
end;
$$;
grant execute on function public.leave_circle(text) to authenticated;

create or replace function public.remove_from_circle(name text)
returns void
language sql
security definer
set search_path = ''
as $$ select public.leave_circle(name) $$;
grant execute on function public.remove_from_circle(text) to authenticated;

-- Badge: requests waiting for me, and requests of mine accepted in the last 3 days.
create or replace function public.circle_badge()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', (select count(*) from public.circle_members where owner_id = auth.uid() and status = 'pending'),
    'accepted_recently', (select count(*) from public.circle_members
                           where member_id = auth.uid() and status = 'accepted' and initiator
                             and accepted_at > now() - interval '3 days')
  );
$$;
grant execute on function public.circle_badge() to authenticated;

-- ─── Invite links ──────────────────────────────────────────────────────────

alter table public.profiles add column invite_code text unique;

-- My invite code (made the first time it's asked for).
create or replace function public.my_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  code text;
begin
  select invite_code into code from public.profiles where id = me;
  if code is null then
    code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    update public.profiles set invite_code = code where id = me;
  end if;
  return code;
end;
$$;
grant execute on function public.my_invite_code() to authenticated;

-- Opened @name's invite link: friends straight away (they shared it). Returns
-- 'member', or 'self' for your own link.
create or replace function public.accept_invite(name text, code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if not exists (select 1 from public.profiles where id = them and invite_code = code) then
    raise exception 'docchi:bad_invite' using errcode = 'P0002';
  end if;
  if them = me then
    return 'self';
  end if;
  if public.is_blocked_between(me, them) then
    raise exception 'docchi:blocked' using errcode = '42501';
  end if;
  if exists (select 1 from public.circle_members where owner_id = them and member_id = me and status = 'accepted') then
    return 'member';
  end if;
  -- As if they had asked me and I said yes, so they hear about it.
  insert into public.circle_members (owner_id, member_id) values (me, them)
  on conflict (owner_id, member_id) do nothing;
  perform public.make_friends(me, them);
  return 'member';
end;
$$;
grant execute on function public.accept_invite(text, text) to authenticated;

-- ─── Link polls you've opened ──────────────────────────────────────────────

create table public.poll_access (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  poll_id  uuid not null references public.polls (id) on delete cascade,
  at       timestamptz not null default now(),
  primary key (user_id, poll_id)
);
alter table public.poll_access enable row level security;
revoke all on public.poll_access from anon, authenticated;

-- Opened a link-only poll: it shows in my feed from now on.
create or replace function public.record_open(poll uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.poll_access (user_id, poll_id)
  select auth.uid(), p.id from public.polls p
  where p.id = poll and auth.uid() is not null and p.visibility = 'link'
    and p.deleted_at is null and p.creator_id is distinct from auth.uid()
  on conflict do nothing;
$$;
grant execute on function public.record_open(uuid) to authenticated;

-- May this poll show in `viewer`'s Trending / New? Public: yes. Otherwise
-- your own, friends-only ones you're in, and link polls you've opened.
create or replace function public.in_feed(p public.polls, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.visibility = 'public'
    or (viewer is not null and (
          p.creator_id = viewer
          or (p.visibility = 'circle' and public.can_view_poll(p.id, viewer))
          or (p.visibility = 'link' and exists (
                select 1 from public.poll_access a where a.user_id = viewer and a.poll_id = p.id))));
$$;
revoke execute on function public.in_feed(public.polls, uuid) from public, anon, authenticated;

-- ─── Feed ──────────────────────────────────────────────────────────────────
-- As before, with every poll you can see in Trending and New (not only public
-- ones). The Circle tab (now Friends) is unchanged.

create or replace function public.get_feed(tab text default 'trending', max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb, cursor text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(max_rows, 30), 1), 100);
  today date := (now() at time zone 'Asia/Kolkata')::date;
  av double precision := public.cursor_value(after);
  aid uuid := public.cursor_id(after);
  in_voted boolean := av is not null and after ~ '\|v$';
  top text := 'Infinity|ffffffff-ffff-ffff-ffff-ffffffffffff';
  picked_ids uuid[] := '{}';
  picked_cur text[] := '{}';
  more_ids uuid[];
  more_cur text[];
  potd uuid;
begin
  if tab = 'circle' then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
    into picked_ids, picked_cur
    from (
      select p.id, p.created_at
      from (
        select c.owner_id from public.circle_members c where c.member_id = uid and c.status = 'accepted'
        union all
        select uid where uid is not null
      ) o
      cross join lateral (
        select p.id, p.created_at, p.visibility, p.creator_id
        from public.polls p
        where p.creator_id = o.owner_id
          and p.deleted_at is null and not p.is_hidden
          and p.closes_at > now() and p.created_at <= now()
          and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
          and (p.visibility = 'circle' or (p.visibility = 'public' and o.owner_id <> uid))
        order by p.created_at desc, p.id desc
        limit lim * 2
      ) p
      where p.visibility = 'public' or public.can_view_poll(p.id, uid)
      order by p.created_at desc, p.id desc
      limit lim
    ) q;

  else
    if tab <> 'new' then
      perform public.maybe_refresh_hot_scores();
      select p.id into potd from public.polls p
      where p.featured_on = today and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
        and p.created_at <= now() and p.closes_at > now();
    end if;

    -- 1. Polls you haven't voted on.
    if not in_voted then
      if potd is not null and after is null
         and not exists (select 1 from public.votes v where v.poll_id = potd and v.user_id = uid) then
        picked_ids := array[potd];
        picked_cur := array[top];
      end if;

      if tab = 'new' then
        select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
               coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
        into more_ids, more_cur
        from (
          select p.id, p.created_at
          from public.polls p
          where p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on <= today)
            and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
            and public.in_feed(p, uid)
            and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid)
          order by p.created_at desc, p.id desc
          limit lim
        ) q;
      else
        select coalesce(array_agg(q.id order by q.hot_score desc, q.id desc), '{}'),
               coalesce(array_agg(q.hot_score::text || '|' || q.id order by q.hot_score desc, q.id desc), '{}')
        into more_ids, more_cur
        from (
          select p.id, p.hot_score
          from public.polls p
          where p.deleted_at is null and not p.is_hidden
            and p.hot_score > 0
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on < today)
            and (av is null or (p.hot_score, p.id) < (av, aid))
            and public.in_feed(p, uid)
            and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid)
          order by p.hot_score desc, p.id desc
          limit lim - cardinality(picked_ids)
        ) q;
      end if;
      picked_ids := picked_ids || more_ids;
      picked_cur := picked_cur || more_cur;
    end if;

    -- 2. Then the ones you have, starting from the top once the first part runs out.
    if cardinality(picked_ids) < lim and uid is not null then
      if not in_voted and potd is not null
         and exists (select 1 from public.votes v where v.poll_id = potd and v.user_id = uid) then
        picked_ids := picked_ids || potd;
        picked_cur := picked_cur || (top || '|v');
      end if;

      if tab = 'new' then
        select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
               coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id || '|v' order by q.created_at desc, q.id desc), '{}')
        into more_ids, more_cur
        from (
          select p.id, p.created_at
          from public.votes v
          join public.polls p on p.id = v.poll_id
          where v.user_id = uid
            and p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on <= today)
            and (p.visibility <> 'circle' or public.can_view_poll(p.id, uid))
            and (not in_voted or (extract(epoch from p.created_at), p.id) < (av, aid))
          order by p.created_at desc, p.id desc
          limit lim - cardinality(picked_ids)
        ) q;
      else
        select coalesce(array_agg(q.id order by q.hot_score desc, q.id desc), '{}'),
               coalesce(array_agg(q.hot_score::text || '|' || q.id || '|v' order by q.hot_score desc, q.id desc), '{}')
        into more_ids, more_cur
        from (
          select p.id, p.hot_score
          from public.votes v
          join public.polls p on p.id = v.poll_id
          where v.user_id = uid
            and p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on < today)
            and (p.visibility <> 'circle' or public.can_view_poll(p.id, uid))
            and (not in_voted or (p.hot_score, p.id) < (av, aid))
          order by p.hot_score desc, p.id desc
          limit lim - cardinality(picked_ids)
        ) q;
      end if;
      picked_ids := picked_ids || more_ids;
      picked_cur := picked_cur || more_cur;
    end if;
  end if;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

-- ─── Friends on a poll ─────────────────────────────────────────────────────

-- How many of my friends voted on a poll, and the latest few of them. Never
-- what they picked (circle_picks does that, for friends-only polls only).
-- Shown once I've voted, or on my own poll, or after it closes.
create or replace function public.friends_voted(poll uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select pr.username::text as username, pr.avatar_url, v.created_at
    from public.polls p
    join public.votes v on v.poll_id = p.id and v.counted
    join public.circle_members c on c.owner_id = auth.uid() and c.member_id = v.user_id and c.status = 'accepted'
    join public.profiles pr on pr.id = v.user_id
    where p.id = poll and p.deleted_at is null
      and public.can_view_poll(p.id, auth.uid())
      and (p.creator_id = auth.uid() or p.closes_at <= now()
           or exists (select 1 from public.votes mine where mine.poll_id = p.id and mine.user_id = auth.uid()))
  )
  select jsonb_build_object(
    'count', (select count(*) from f),
    'people', coalesce((select jsonb_agg(jsonb_build_object('username', x.username, 'avatar_url', x.avatar_url))
                        from (select * from f order by f.created_at desc limit 5) x), '[]'::jsonb));
$$;
grant execute on function public.friends_voted(uuid) to authenticated;

-- People I might know: friends of friends, people whose polls I vote on, and
-- this week's top creators. Not friends already, not asked, not blocked.
create or replace function public.suggest_friends()
returns table (username text, avatar_url text, mutual int, voted int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  return query
  with mine as (
    select c.member_id from public.circle_members c where c.owner_id = me and c.status = 'accepted'
  ), cand as (
    select x.id, sum(x.mutual)::int as mutual, sum(x.voted)::int as voted, max(x.top) as top
    from (
      select c.member_id as id, 1 as mutual, 0 as voted, 0 as top
      from public.circle_members c
      where c.owner_id in (select m.member_id from mine m) and c.status = 'accepted'
      union all
      select p.creator_id, 0, 1, 0
      from public.votes v join public.polls p on p.id = v.poll_id
      where v.user_id = me and not p.is_system and p.deleted_at is null and p.creator_id is not null
      union all
      select s.subject, 0, 0, 101 - s.rank
      from public.leader_scores s
      where s.week = public.week_of(now()) and s.board = 'creators' and s.rank <= 20
    ) x
    group by x.id
  )
  select pr.username::text, pr.avatar_url, cand.mutual, cand.voted
  from cand
  join public.profiles pr on pr.id = cand.id
  where cand.id <> me
    and not pr.is_banned and pr.username::text not like 'guest\_%'
    and not exists (select 1 from public.circle_members c
                    where (c.owner_id = me and c.member_id = cand.id) or (c.owner_id = cand.id and c.member_id = me))
    and not public.is_blocked_between(me, cand.id)
  order by cand.mutual desc, cand.voted desc, cand.top desc, pr.username
  limit 10;
end;
$$;
grant execute on function public.suggest_friends() to authenticated;

-- ─── Activity: include each poll's question (for the bell's Activity screen) ─

create or replace function public.my_activity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.id, p.question, p.teaser, p.vote_count, p.created_at, s.votes as seen_votes, s.seen_at
    from public.polls p
    left join public.seen_polls s on s.user_id = p.creator_id and s.poll_id = p.id
    where p.creator_id = auth.uid() and p.deleted_at is null and not p.is_hidden
      and p.created_at > now() - interval '30 days'
    order by p.created_at desc
    limit 100
  ),
  news as (
    select m.id, m.question, m.created_at,
           greatest(m.vote_count - coalesce(m.seen_votes, 0), 0) as new_votes,
           (select count(*)::int from public.comments c
             where c.poll_id = m.id and not c.is_hidden
               and c.created_at > greatest(coalesce(m.seen_at, m.created_at), now() - interval '24 hours')
               and c.user_id <> auth.uid()) as new_comments
    from mine m
  )
  select jsonb_build_object(
    'votes', coalesce(sum(n.new_votes), 0),
    'comments', coalesce(sum(n.new_comments), 0),
    'polls', coalesce(jsonb_agg(jsonb_build_object('poll_id', n.id, 'question', n.question,
                                                   'votes', n.new_votes, 'comments', n.new_comments)
                                order by n.created_at desc)
                      filter (where n.new_votes > 0 or n.new_comments > 0), '[]'))
  from news n;
$$;
grant execute on function public.my_activity() to authenticated;

-- ─── Pushes: friend wording, and no "accepted" push to the one who accepted ─

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

