-- Scale: pick first, then build.
-- Every list (feeds, profile, voted) used to build a card for every poll it
-- might show, then sort and keep 30: the cost grew with the whole table.
-- Now each list picks its ~30 poll ids from an index, and only those get
-- built (results, access, comments) by poll_cards(). Pages use a cursor
-- ("after this one") instead of OFFSET, so page 50 costs the same as page 1
-- and nothing repeats or gets skipped when scores move.
--
-- Trending reads a stored hot_score (votes with time decay), refreshed at most
-- every 5 minutes: by pg_cron if it's enabled, otherwise by the next feed
-- load that finds it stale.
--
-- Feeds now show polls you haven't voted on; the ones you have voted on live
-- in Profile → Voted.

alter table public.polls add column hot_score double precision not null default 0;

-- ─── Indexes ───────────────────────────────────────────────────────────────

create index polls_hot_idx on public.polls (hot_score desc, id desc)
  where visibility = 'public' and deleted_at is null and not is_hidden;
create index polls_new_idx on public.polls (created_at desc, id desc)
  where visibility = 'public' and deleted_at is null and not is_hidden;
-- Profile, Circle tab, rate limits ("polls by this person, newest first").
create index polls_creator_idx on public.polls (creator_id, created_at desc, id desc)
  where deleted_at is null;
drop index if exists public.polls_created_at_idx;

create index circle_members_member_created_idx on public.circle_members (member_id, created_at);
create index circle_group_members_member_idx on public.circle_group_members (member_id);
create index poll_audience_group_idx on public.poll_audience (group_id);
create index votes_option_idx on public.votes (option_id);

-- Username search: a trigram index serves "starts with" and "contains" fast.
create extension if not exists pg_trgm;
create index profiles_username_trgm_idx on public.profiles using gin ((username::text) gin_trgm_ops);

-- ─── Trending score ────────────────────────────────────────────────────────

create table public.app_state (key text primary key, at timestamptz not null);
alter table public.app_state enable row level security;
revoke all on public.app_state from anon, authenticated;

-- votes + 1, decayed by age in hours (Hacker News style).
create or replace function public.hot_score_for(votes integer, created timestamptz)
returns double precision
language sql
stable
set search_path = ''
as $$
  select (votes + 1) / power(greatest(extract(epoch from now() - created) / 3600, 0) + 2, 1.5);
$$;

create or replace function public.refresh_hot_scores()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.polls p
  set hot_score = case
    when p.closes_at > now() and p.created_at <= now() then public.hot_score_for(p.vote_count, p.created_at)
    else 0 end
  where p.closes_at > now() or p.hot_score <> 0;
  insert into public.app_state (key, at) values ('hot_scores', now())
  on conflict (key) do update set at = excluded.at;
$$;
revoke execute on function public.refresh_hot_scores() from public, anon, authenticated;

-- Refresh if older than 5 minutes; only one caller does it at a time.
create or replace function public.maybe_refresh_hot_scores()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select at from public.app_state where key = 'hot_scores'), '-infinity') < now() - interval '5 minutes'
     and pg_try_advisory_xact_lock(hashtext('docchi.hot_scores')) then
    perform public.refresh_hot_scores();
  end if;
end;
$$;
revoke execute on function public.maybe_refresh_hot_scores() from public, anon, authenticated;

-- New polls start with their score, so they show up straight away.
create or replace function public.set_initial_hot_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.hot_score := public.hot_score_for(new.vote_count, least(new.created_at, now()));
  return new;
end;
$$;
create trigger polls_initial_hot_score before insert on public.polls
  for each row execute function public.set_initial_hot_score();

select public.refresh_hot_scores();

-- Use pg_cron when it's available (Supabase: Database → Extensions → pg_cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('docchi-hot-scores', '*/5 * * * *', 'select public.refresh_hot_scores()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); feeds will refresh scores themselves', sqlerrm;
end;
$$;

-- ─── Access check: public polls skip the work ─────────────────────────────

create or replace function public.can_view_poll(poll uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.visibility <> 'circle' then true
    when viewer is null then false
    when p.creator_id = viewer then true
    else exists (
      select 1 from public.circle_members c
      where c.owner_id = p.creator_id and c.member_id = viewer and c.status = 'accepted'
        and (
          not exists (select 1 from public.poll_audience a where a.poll_id = p.id)
          or exists (select 1 from public.poll_audience a
                     join public.circle_group_members m on m.group_id = a.group_id and m.member_id = viewer
                     where a.poll_id = p.id)
        )
    )
  end
  from public.polls p
  where p.id = poll;
$$;

-- ─── Building cards for a handful of polls ────────────────────────────────

drop function if exists public.get_feed(text, int, int);
drop function if exists public.get_poll(uuid);
drop function if exists public.my_polls(text, int, int);
drop function if exists public.profile_polls(text, int, int);
drop function if exists public.poll_rows(uuid, text);

-- One card per id, in the order given. All lookups are by primary key or
-- poll_id, so the cost is per card, not per table.
create function public.poll_cards(ids uuid[])
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
    case when b.is_system then 'docchi' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_on = (now() at time zone 'Asia/Kolkata')::date, false),
    b.vote_count,
    b.share_count,
    (select count(*)::int from public.comments c
      where c.poll_id = b.id and not c.is_hidden and c.expires_at > now()),
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

-- Cursors are "<sort value>|<poll id>" strings, opaque to the app. Anything
-- else reads as "from the start".
create or replace function public.cursor_value(after text)
returns double precision
language sql
immutable
set search_path = ''
as $$ select case when after ~* '^(-?[0-9.]+(e[-+]?[0-9]+)?|infinity)\|[0-9a-f-]{36}$' then split_part(after, '|', 1)::double precision end $$;

create or replace function public.cursor_id(after text)
returns uuid
language sql
immutable
set search_path = ''
as $$ select case when after ~* '^(-?[0-9.]+(e[-+]?[0-9]+)?|infinity)\|[0-9a-f-]{36}$' then split_part(after, '|', 2)::uuid end $$;

-- ─── Lists ─────────────────────────────────────────────────────────────────

-- tab: 'trending' | 'new' | 'circle'. Pass the last row's cursor as `after`
-- for the next page. Polls you've voted on are left out.
create function public.get_feed(tab text default 'trending', max_rows int default 30, after text default null)
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
  picked_ids uuid[] := '{}';
  picked_cur text[] := '{}';
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

  elsif tab = 'new' then
    select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
    into picked_ids, picked_cur
    from (
      select p.id, p.created_at
      from public.polls p
      where p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
        and p.created_at <= now() and p.closes_at > now()
        and (p.featured_on is null or p.featured_on <= today)
        and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
        and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid)
      order by p.created_at desc, p.id desc
      limit lim
    ) q;

  else
    perform public.maybe_refresh_hot_scores();
    -- Poll of the Day leads page one (if you haven't voted on it).
    if after is null then
      select p.id into potd from public.polls p
      where p.featured_on = today and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
        and p.created_at <= now() and p.closes_at > now()
        and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid);
    end if;
    select coalesce(array_agg(q.id order by q.hot_score desc, q.id desc), '{}'),
           coalesce(array_agg(q.hot_score::text || '|' || q.id order by q.hot_score desc, q.id desc), '{}')
    into picked_ids, picked_cur
    from (
      select p.id, p.hot_score
      from public.polls p
      where p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
        and p.hot_score > 0
        and p.created_at <= now() and p.closes_at > now()
        and (p.featured_on is null or p.featured_on < today)
        and (av is null or (p.hot_score, p.id) < (av, aid))
        and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid)
      order by p.hot_score desc, p.id desc
      limit lim - (case when potd is null then 0 else 1 end)
    ) q;
    if potd is not null then
      picked_ids := potd || picked_ids;
      -- Its cursor sits above every score, so paging after it starts from the top.
      picked_cur := 'Infinity|ffffffff-ffff-ffff-ffff-ffffffffffff'::text || picked_cur;
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
grant execute on function public.get_feed(text, int, text) to anon, authenticated;

-- One poll by its link (closed ones too).
create function public.get_poll(poll uuid)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
         c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
         c.closes_at, c.my_option_id, c.options
  from public.poll_cards(array(
    select p.id from public.polls p
    where p.id = poll and p.deleted_at is null and not p.is_hidden and p.created_at <= now()
      and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
  )) c;
$$;
grant execute on function public.get_poll(uuid) to anon, authenticated;

-- Your polls ('mine') or the ones you voted on ('voted'), newest first.
create function public.my_polls(which text default 'mine', max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb, cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(max_rows, 30), 1), 100);
  av double precision := public.cursor_value(after);
  aid uuid := public.cursor_id(after);
  picked_ids uuid[];
  picked_cur text[];
begin
  if which = 'voted' then
    -- Newest vote first, straight off the (user_id, created_at) index.
    select coalesce(array_agg(q.poll_id order by q.created_at desc, q.poll_id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.poll_id order by q.created_at desc, q.poll_id desc), '{}')
    into picked_ids, picked_cur
    from (
      select v.poll_id, v.created_at
      from public.votes v
      join public.polls p on p.id = v.poll_id
      where v.user_id = uid
        and (av is null or (extract(epoch from v.created_at), v.poll_id) < (av, aid))
        and p.deleted_at is null and not p.is_hidden
        and (p.visibility <> 'circle' or public.can_view_poll(p.id, uid))
      order by v.created_at desc, v.poll_id desc
      limit lim
    ) q;
  else
    select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
    into picked_ids, picked_cur
    from (
      select p.id, p.created_at
      from public.polls p
      where p.creator_id = uid and p.deleted_at is null and not p.is_hidden
        and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
      order by p.created_at desc, p.id desc
      limit lim
    ) q;
  end if;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;
grant execute on function public.my_polls(text, int, text) to authenticated;

-- Someone's public polls, newest first.
create function public.profile_polls(name text, max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb, cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim int := least(greatest(coalesce(max_rows, 30), 1), 100);
  av double precision := public.cursor_value(after);
  aid uuid := public.cursor_id(after);
  owner uuid;
  picked_ids uuid[];
  picked_cur text[];
begin
  select u.id into owner from public.profiles u where u.username = lower(name);
  select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
         coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
  into picked_ids, picked_cur
  from (
    select p.id, p.created_at
    from public.polls p
    where p.creator_id = owner and p.deleted_at is null and not p.is_hidden
      and p.visibility = 'public' and not p.is_system and p.created_at <= now()
      and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
    order by p.created_at desc, p.id desc
    limit lim
  ) q;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;
grant execute on function public.profile_polls(text, int, text) to anon, authenticated;

-- ─── Search ────────────────────────────────────────────────────────────────
-- Same results as before; the LIKE on username::text now uses the trigram index.

create or replace function public.search_people(q text)
returns table (username text, avatar_url text, their_circle text, my_circle text)
language sql
stable
security definer
set search_path = ''
as $$
  with found as (
    select p.id, p.username, p.avatar_url
    from public.profiles p
    where char_length(trim(coalesce(q, ''))) >= 2
      and p.username::text like replace(replace(lower(trim(q)), '_', '\_'), '%', '\%') || '%'
      and p.username::text not like 'guest\_%'
      and not p.is_banned
      and p.id is distinct from auth.uid()
    order by char_length(p.username::text), p.username
    limit 25
  )
  select
    f.username::text,
    f.avatar_url,
    coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
               from public.circle_members c where c.owner_id = f.id and c.member_id = auth.uid()), 'none'),
    coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
               from public.circle_members c where c.owner_id = auth.uid() and c.member_id = f.id), 'none')
  from found f
  where not public.is_blocked_between(f.id, auth.uid())
  order by char_length(f.username::text), f.username
  limit 10;
$$;
