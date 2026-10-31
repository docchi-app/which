-- Group links and friends' picks.
--
-- 1. Group links. Sharing a poll to a WhatsApp group makes a link of its own (a 10-letter code).
--    "Quick vote links" (the default) put one link per answer in the message: /v/<code><n>,
--    where n is the answer's place (1–4). One tap opens the poll and the page casts that vote.
--    "Just the link" is /v/<code>. Votes made through a link remember it, so the people in that
--    chat see their own split ("This chat's verdict"). Nobody's name is shown, only counts.
--    The person who shared it gets a push as their group votes (1, 3, 5, 10, 25, 50, 100).
--    Opening a link never votes by itself (WhatsApp opens links to build previews): the page
--    casts the vote with cast_vote, then link_vote tags it.
-- 2. Friends' picks. People choose once whether their friends may see what they picked
--    (profiles.picks_to_friends: null = not asked yet). Fair both ways: only people who share
--    their picks see their friends' picks. Only accepted friends, only after you voted too,
--    never a guest, never a Brain break, and any single pick can be hidden (votes.pick_hidden).
--    "You and a friend" shows how often two friends agree once they've both answered 10 polls.
--
-- Safe to run twice.

-- ─── 1. Group links ───────────────────────────────────────────────────────────

create table if not exists public.share_links (
  code            text primary key check (code ~ '^[0-9a-f]{10}$'),
  poll_id         uuid not null references public.polls (id) on delete cascade,
  created_by      uuid not null references public.profiles (id) on delete cascade,
  style           text not null default 'quick' check (style in ('quick', 'link')),
  created_at      timestamptz not null default now(),
  -- Votes through this link by people other than the one who shared it.
  vote_count      int not null default 0,
  notified_votes  int not null default 0,
  -- When the share button was actually tapped (the sheet makes a link as it opens, so it's ready).
  shared_at       timestamptz
);
alter table public.share_links add column if not exists shared_at timestamptz;
create index if not exists share_links_by_idx on public.share_links (created_by, created_at desc);
create index if not exists share_links_poll_idx on public.share_links (poll_id);
alter table public.share_links enable row level security;
revoke all on table public.share_links from public, anon, authenticated;

alter table public.votes add column if not exists link_code text references public.share_links (code) on delete set null;
create index if not exists votes_link_idx on public.votes (link_code) where link_code is not null;

-- A new group link for a poll I can see. Friends-only polls can't have one (only friends can
-- vote on them). At most 100 a day.
create or replace function public.make_share_link(poll uuid, style text default 'quick')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_code text;
  tries int := 0;
begin
  if uid is null then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  if coalesce(make_share_link.style, '') not in ('quick', 'link') then
    raise exception 'docchi:bad_style' using errcode = '22023';
  end if;
  perform 1 from public.polls p
    where p.id = poll and not p.is_hidden and p.deleted_at is null and p.visibility <> 'circle'
      and public.can_view_poll(p.id, uid);
  if not found then
    raise exception 'docchi:no_poll' using errcode = 'P0002';
  end if;
  if (select count(*) from public.share_links s where s.created_by = uid and s.created_at > now() - interval '1 day') >= 100 then
    raise exception 'docchi:slow_down' using errcode = '54000';
  end if;
  loop
    new_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    begin
      insert into public.share_links (code, poll_id, created_by, style) values (new_code, poll, uid, make_share_link.style);
      return new_code;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;
revoke execute on function public.make_share_link(uuid, text) from public, anon;
grant execute on function public.make_share_link(uuid, text) to authenticated;

-- The share button was tapped with this link (mine only). For counting which kind works.
create or replace function public.mark_link_shared(code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.share_links s set shared_at = coalesce(s.shared_at, now())
  where s.code = lower(mark_link_shared.code) and s.created_by = auth.uid();
$$;
revoke execute on function public.mark_link_shared(text) from public, anon;
grant execute on function public.mark_link_shared(text) to authenticated;

-- Which poll a group link opens (for the link's page and its preview). Anyone, signed out too:
-- the code is the link. Nothing for a removed poll.
create or replace function public.link_poll(code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.poll_id from public.share_links s
  join public.polls p on p.id = s.poll_id
  where s.code = lower(link_poll.code) and not p.is_hidden and p.deleted_at is null;
$$;
revoke execute on function public.link_poll(text) from public;
grant execute on function public.link_poll(text) to anon, authenticated;

-- This chat's verdict: the votes made through this link. The split only once you've voted
-- (or it's your link, or the poll has closed): the same rule as results everywhere.
create or replace function public.link_verdict(code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select s.code, s.poll_id, s.created_by, p.closes_at
    from public.share_links s join public.polls p on p.id = s.poll_id
    where s.code = lower(link_verdict.code) and not p.is_hidden and p.deleted_at is null
      and public.can_view_poll(p.id, auth.uid())
  ), v as (
    select x.option_id from public.votes x join l on x.poll_id = l.poll_id and x.link_code = l.code
  ), me as (
    select exists (select 1 from public.votes x join l on x.poll_id = l.poll_id where x.user_id = auth.uid()) as voted
  )
  select case when l.code is null then null else jsonb_build_object(
    'poll_id', l.poll_id,
    'asker', (select pr.username::text from public.profiles pr where pr.id = l.created_by),
    'mine', l.created_by = auth.uid(),
    'total', (select count(*) from v),
    'voted', me.voted,
    'options', case when me.voted or l.created_by = auth.uid() or l.closes_at <= now() then
      (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'votes', (select count(*) from v where v.option_id = o.id)) order by o.position), '[]'::jsonb)
       from public.poll_options o where o.poll_id = l.poll_id)
    else null end)
  end
  from l, me;
$$;
revoke execute on function public.link_verdict(text) from public, anon;
grant execute on function public.link_verdict(text) to authenticated;

-- After voting from a group link: my vote on that poll joins the link's count (once: a vote
-- belongs to the first link it came through). Tells the person who shared it as it grows.
-- Returns the verdict.
create or replace function public.link_vote(code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l record;
  tagged int;
  n int;
  m int;
  lead_text text;
  lead_votes int;
  next_votes int;
begin
  if uid is null then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  select s.code, s.poll_id, s.created_by, s.notified_votes into l
  from public.share_links s join public.polls p on p.id = s.poll_id
  where s.code = lower(link_vote.code) and not p.is_hidden and p.deleted_at is null;
  if l.code is null then
    raise exception 'docchi:no_link' using errcode = 'P0002';
  end if;

  update public.votes v set link_code = l.code
  where v.poll_id = l.poll_id and v.user_id = uid and v.link_code is null;
  get diagnostics tagged = row_count;

  if tagged = 1 and uid <> l.created_by then
    update public.share_links s set vote_count = s.vote_count + 1 where s.code = l.code
    returning s.vote_count into n;
    m := (select max(x) from unnest(array[1, 3, 5, 10, 25, 50, 100]) x where x <= n);
    if m is not null and m > l.notified_votes then
      update public.share_links s set notified_votes = m where s.code = l.code;
      -- The person who shared it hears about it (signed in, and votes notifications on).
      if exists (select 1 from auth.users u where u.id = l.created_by and not coalesce(u.is_anonymous, false))
         and coalesce((select ps.votes from public.push_settings ps where ps.user_id = l.created_by), true) then
        select o.text, count(x.option_id)::int into lead_text, lead_votes
        from public.poll_options o left join public.votes x on x.option_id = o.id and x.link_code = l.code
        where o.poll_id = l.poll_id group by o.id, o.text, o.position order by count(x.option_id) desc, o.position limit 1;
        select count(x.option_id)::int into next_votes
        from public.poll_options o left join public.votes x on x.option_id = o.id and x.link_code = l.code
        where o.poll_id = l.poll_id group by o.id, o.position order by count(x.option_id) desc, o.position offset 1 limit 1;
        insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
        values (l.created_by, 'votes', 'Your group is voting',
          n || case when n = 1 then ' person' else ' people' end || ' voted from your link'
            || case when lead_votes > coalesce(next_votes, 0) then ' · ' || left(lead_text, 40) || ' leads ' || lead_votes || '–' || coalesce(next_votes, 0)
                    else ' · it''s tied' end,
          '/v/' || l.code, 'link-' || l.code, 'link:' || l.code || ':' || m)
        on conflict (dedupe) do nothing;
      end if;
    end if;
  end if;

  return public.link_verdict(l.code);
end;
$$;
revoke execute on function public.link_vote(text) from public, anon;
grant execute on function public.link_vote(text) to authenticated;

-- A mis-tap from a quick vote link: take my vote back within 15 seconds and pick again. Only a
-- vote made from a group link of this poll (`code`), never anywhere else in the app, and not on a
-- Brain break (the answer shows straight after voting).
drop function if exists public.undo_vote(uuid);
create or replace function public.undo_vote(poll uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v record;
begin
  if uid is null then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  select x.option_id, x.counted, x.link_code, x.created_at into v
  from public.votes x where x.poll_id = poll and x.user_id = uid;
  if v.option_id is null then
    return;
  end if;
  if not exists (select 1 from public.share_links s where s.code = lower(undo_vote.code) and s.poll_id = poll)
     or (v.link_code is not null and v.link_code <> lower(undo_vote.code)) then
    raise exception 'docchi:not_from_link' using errcode = '42501';
  end if;
  if v.created_at < now() - interval '15 seconds'
     or exists (select 1 from public.polls p where p.id = poll and (p.kind = 'brain' or p.closes_at <= now())) then
    raise exception 'docchi:too_late' using errcode = '22023';
  end if;
  delete from public.votes x where x.poll_id = poll and x.user_id = uid;
  if v.counted then
    update public.poll_options o set vote_count = greatest(o.vote_count - 1, 0) where o.id = v.option_id;
    update public.polls p set vote_count = greatest(p.vote_count - 1, 0) where p.id = poll;
  end if;
  if v.link_code is not null then
    update public.share_links s set vote_count = greatest(s.vote_count - 1, 0)
    where s.code = v.link_code and s.created_by <> uid;
  end if;
end;
$$;
revoke execute on function public.undo_vote(uuid, text) from public, anon;
grant execute on function public.undo_vote(uuid, text) to authenticated;

-- Admin: which kind of group link brings more votes. Links shared in the last `days` days,
-- test accounts left out.
create or replace function public.admin_link_styles(days int default 30)
returns table (style text, links bigint, votes bigint, voted_links bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select s.style, count(*), coalesce(sum(s.vote_count), 0)::bigint, count(*) filter (where s.vote_count > 0)
  from public.share_links s join public.profiles pr on pr.id = s.created_by
  where s.created_at > now() - make_interval(days => greatest(least(coalesce(days, 30), 365), 1))
    and s.shared_at is not null and not pr.is_test
  group by s.style order by s.style;
end;
$$;
revoke execute on function public.admin_link_styles(int) from public, anon;
grant execute on function public.admin_link_styles(int) to authenticated;

-- ─── 2. Friends' picks ────────────────────────────────────────────────────────

alter table public.profiles add column if not exists picks_to_friends boolean;
alter table public.votes add column if not exists pick_hidden boolean not null default false;

-- My choice: true (friends see my picks), false (private), null (not asked yet).
create or replace function public.my_picks_setting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pr.picks_to_friends from public.profiles pr where pr.id = auth.uid();
$$;
revoke execute on function public.my_picks_setting() from public, anon;
grant execute on function public.my_picks_setting() to authenticated;

create or replace function public.set_picks_to_friends(share boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  update public.profiles set picks_to_friends = coalesce(share, false) where id = auth.uid();
end;
$$;
revoke execute on function public.set_picks_to_friends(boolean) from public, anon;
grant execute on function public.set_picks_to_friends(boolean) to authenticated;

-- Hide (or show again) my pick on one poll from friends.
create or replace function public.hide_my_pick(poll uuid, hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  update public.votes v set pick_hidden = coalesce(hidden, true) where v.poll_id = poll and v.user_id = auth.uid();
end;
$$;
revoke execute on function public.hide_my_pick(uuid, boolean) from public, anon;
grant execute on function public.hide_my_pick(uuid, boolean) to authenticated;

-- Polls whose picks I've hidden, newest first (Settings).
create or replace function public.my_hidden_picks()
returns table (poll_id uuid, question text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.question, p.teaser)
  from public.votes v join public.polls p on p.id = v.poll_id
  where v.user_id = auth.uid() and v.pick_hidden and p.deleted_at is null
  order by v.created_at desc limit 100;
$$;
revoke execute on function public.my_hidden_picks() from public, anon;
grant execute on function public.my_hidden_picks() to authenticated;

-- What my friends picked on a public or link poll. Only if I share my picks, only once I've
-- voted, only friends who share theirs and didn't hide this one. Never a Brain break.
-- (Friends-only polls already show picks to everyone in them: circle_picks.)
create or replace function public.friend_picks(poll uuid)
returns table (username text, avatar_url text, option_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.username::text, pr.avatar_url, v.option_id
  from public.polls p
  join public.profiles me on me.id = auth.uid() and me.picks_to_friends and not me.is_banned
  join public.votes mine on mine.poll_id = p.id and mine.user_id = me.id and mine.counted
  join public.circle_members c on c.owner_id = me.id and c.status = 'accepted'
  join public.votes v on v.poll_id = p.id and v.user_id = c.member_id and v.counted and not v.pick_hidden
  join public.profiles pr on pr.id = v.user_id and pr.picks_to_friends and not pr.is_banned
  where p.id = poll and not p.is_hidden and p.deleted_at is null
    and p.kind <> 'brain' and p.visibility <> 'circle'
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and public.can_view_poll(p.id, me.id)
    and public.are_friends(me.id, pr.id)
    and not public.is_blocked_between(me.id, pr.id)
  order by v.created_at desc
  limit 50;
$$;
revoke execute on function public.friend_picks(uuid) from public, anon;
grant execute on function public.friend_picks(uuid) to authenticated;

-- The polls two people both answered and may compare: both counted, neither hidden, no Brain
-- breaks, nothing removed. Internal.
create or replace function public.shared_picks(a uuid, b uuid)
returns table (poll_id uuid, same boolean, topic text, question text, answered_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, va.option_id = vb.option_id, p.topic, coalesce(p.question, p.teaser), greatest(va.created_at, vb.created_at)
  from public.votes va
  join public.votes vb on vb.poll_id = va.poll_id and vb.user_id = b and vb.counted and not vb.pick_hidden
  join public.polls p on p.id = va.poll_id
  where va.user_id = a and va.counted and not va.pick_hidden
    and p.kind <> 'brain' and not p.is_hidden and p.deleted_at is null;
$$;
revoke execute on function public.shared_picks(uuid, uuid) from public, anon, authenticated;

-- Can I compare picks with this person? Both share picks, friends both ways, not blocked.
create or replace function public.may_compare(me uuid, them uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select me is not null and me <> them
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and coalesce((select pr.picks_to_friends and not pr.is_banned from public.profiles pr where pr.id = me), false)
    and coalesce((select pr.picks_to_friends and not pr.is_banned from public.profiles pr where pr.id = them), false)
    and public.are_friends(me, them)
    and not public.is_blocked_between(me, them);
$$;
revoke execute on function public.may_compare(uuid, uuid) from public, anon, authenticated;

-- "You and @priya": how often we agree. Null when we can't compare; shared only (no
-- percentages) until we've both answered 10 polls.
create or replace function public.friend_match(name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
  shared int;
  agree int;
begin
  select pr.id into them from public.profiles pr where pr.username = friend_match.name;
  if them is null or not public.may_compare(me, them) then
    return null;
  end if;
  select count(*), count(*) filter (where s.same) into shared, agree from public.shared_picks(me, them) s;
  if shared < 10 then
    return jsonb_build_object('shared', shared);
  end if;
  return jsonb_build_object(
    'shared', shared,
    'agree', agree,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('topic', t.topic, 'shared', t.n, 'agree', t.a) order by t.n desc)
      from (select s.topic, count(*) as n, count(*) filter (where s.same) as a
            from public.shared_picks(me, them) s where s.topic is not null
            group by s.topic having count(*) >= 3 order by count(*) desc limit 3) t), '[]'::jsonb),
    'split', (select jsonb_build_object('poll_id', s.poll_id, 'question', s.question)
              from public.shared_picks(me, them) s where not s.same and s.question is not null
              order by s.answered_at desc limit 1));
end;
$$;
revoke execute on function public.friend_match(text) from public, anon;
grant execute on function public.friend_match(text) to authenticated;

-- My friends by how much we agree (10+ polls in common), most alike first.
create or replace function public.my_matches()
returns table (username text, avatar_url text, shared bigint, agree bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.username::text, pr.avatar_url, m.shared, m.agree
  from public.circle_members c
  join public.profiles pr on pr.id = c.member_id
  cross join lateral (select count(*) as shared, count(*) filter (where s.same) as agree
                      from public.shared_picks(auth.uid(), pr.id) s) m
  where c.owner_id = auth.uid() and c.status = 'accepted'
    and public.may_compare(auth.uid(), pr.id)
    and m.shared >= 10
  order by m.agree::numeric / m.shared desc, m.shared desc
  limit 50;
$$;
revoke execute on function public.my_matches() from public, anon;
grant execute on function public.my_matches() to authenticated;
