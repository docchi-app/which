-- Views: how many people saw a poll.
--
-- A view is one person seeing a poll (at least half the card on screen for a
-- second, or opening its link). Each person counts once per poll; the
-- creator's own views don't count. Views come in far more often than anything
-- else, so they're written as cheaply as Postgres allows:
--
--   1. The app batches views (one request every few seconds at most, up to 50
--      polls) and never re-sends a poll it already counted on that device.
--   2. record_views() appends the batch to view_buffer: an UNLOGGED table with
--      no indexes, so a write is a plain append (no WAL, no locks on polls).
--   3. views_rollup() runs every 10 seconds (pg_cron): it empties the buffer,
--      keeps one row per (poll, person) in poll_viewers, and adds the new
--      people to polls.view_count with one update per poll. A popular poll's
--      row is touched once per run, not once per view.
--
-- poll_viewers is only needed while a poll can still get views: rows for
-- polls closed over a day ago are deleted (the total stays). If the database
-- ever crashed, at most the last few seconds of buffered views are lost.
-- The rollup interval is one setting: see the cron block at the end.

alter table public.polls add column if not exists view_count integer not null default 0;

create unlogged table if not exists public.view_buffer (
  poll_id   uuid not null,
  viewer_id uuid,        -- signed in (or a guest)
  anon_key  bigint,      -- signed out: a hash made by the app's server, never an IP
  at        timestamptz not null default now()
);

create table if not exists public.poll_viewers (
  poll_id uuid not null references public.polls(id) on delete cascade,
  viewer  bigint not null,
  primary key (poll_id, viewer)
);

alter table public.view_buffer enable row level security;
alter table public.poll_viewers enable row level security;
revoke all on public.view_buffer, public.poll_viewers from public, anon, authenticated;

-- Signed in (or a guest): up to 50 polls per call; anything else is ignored.
create or replace function public.record_views(polls uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or polls is null then
    return;
  end if;
  insert into public.view_buffer (poll_id, viewer_id)
  select distinct x, uid from unnest(polls[1:50]) x where x is not null;
  -- Without pg_cron, the next viewer does the counting (at most every 10 seconds).
  perform public.views_rollup_if_due();
end;
$$;

-- Signed out (opened from a WhatsApp or X link): only the app's server can call
-- this, with the shared secret; key is its hash of the visitor's connection.
-- Returns how many polls it took (a number, so the server gets a plain reply).
create or replace function public.record_views_anon(secret text, key text, polls uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  if key is null or polls is null then
    return 0;
  end if;
  insert into public.view_buffer (poll_id, anon_key)
  select distinct x, hashtextextended('anon:' || key, 0) from unnest(polls[1:50]) x where x is not null;
  get diagnostics n = row_count;
  perform public.views_rollup_if_due();
  return n;
end;
$$;

create or replace function public.views_rollup()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  last_cleanup timestamptz;
begin
  -- One at a time; a run that finds another in progress just leaves.
  if not pg_try_advisory_xact_lock(hashtext('docchi.views')) then
    return;
  end if;

  with taken as (
    delete from public.view_buffer returning poll_id, viewer_id, anon_key
  ),
  valid as (
    select distinct t.poll_id, coalesce(hashtextextended(t.viewer_id::text, 0), t.anon_key) as viewer
    from taken t
    join public.polls p on p.id = t.poll_id
    where p.deleted_at is null
      and p.creator_id is distinct from t.viewer_id
      and p.closes_at > now() - interval '1 day'
      and (p.kind <> 'snap' or p.photo_status = 'live')
      and (case when t.viewer_id is not null then public.can_view_poll(p.id, t.viewer_id)
                else p.visibility <> 'circle' end)
  ),
  added as (
    insert into public.poll_viewers (poll_id, viewer)
    select v.poll_id, v.viewer from valid v
    on conflict do nothing
    returning poll_id
  )
  update public.polls p set view_count = p.view_count + n.c
  from (select a.poll_id, count(*)::int as c from added a group by a.poll_id) n
  where p.id = n.poll_id;

  insert into public.app_state (key, at) values ('views_rollup', now())
  on conflict (key) do update set at = excluded.at;

  -- Hourly: forget who saw polls that closed over a day ago (the totals stay).
  select a.at into last_cleanup from public.app_state a where a.key = 'views_cleanup';
  if last_cleanup is null or last_cleanup < now() - interval '1 hour' then
    delete from public.poll_viewers v
    using public.polls p
    where p.id = v.poll_id and p.closes_at < now() - interval '1 day';
    insert into public.app_state (key, at) values ('views_cleanup', now())
    on conflict (key) do update set at = excluded.at;
  end if;
end;
$$;

create or replace function public.views_rollup_if_due()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce((select a.at from public.app_state a where a.key = 'views_rollup'), '-infinity') < now() - interval '10 seconds' then
    perform public.views_rollup();
  end if;
end;
$$;

revoke execute on function public.record_views(uuid[]) from public, anon;
grant execute on function public.record_views(uuid[]) to authenticated;
revoke execute on function public.record_views_anon(text, text, uuid[]) from public;
grant execute on function public.record_views_anon(text, text, uuid[]) to anon, authenticated;
revoke execute on function public.views_rollup() from public, anon, authenticated;
revoke execute on function public.views_rollup_if_due() from public, anon, authenticated;

-- ─── view_count on every poll the app loads (no extra requests) ─────────────

drop function if exists public.get_feed(text, int, text);
drop function if exists public.get_poll(uuid);
drop function if exists public.my_polls(text, int, text);
drop function if exists public.profile_polls(text, int, text);
drop function if exists public.poll_cards(uuid[]);

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
    case when b.is_system then 'docchi' else pr.username::text end,
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

create function public.get_feed(tab text default 'trending', max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer, view_count integer,
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
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.view_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

create function public.get_poll(poll uuid)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer, view_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
         c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.view_count, c.created_at,
         c.closes_at, c.my_option_id, c.options
  from public.poll_cards(array(
    select p.id from public.polls p
    where p.id = poll and p.deleted_at is null and not p.is_hidden and p.created_at <= now()
      and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
  )) c;
$$;

create function public.my_polls(which text default 'mine', max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer, view_count integer,
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
        and p.deleted_at is null and not p.is_hidden and p.kind <> 'snap'
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
      where p.creator_id = uid and p.deleted_at is null and not p.is_hidden and p.kind <> 'snap'
        and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
      order by p.created_at desc, p.id desc
      limit lim
    ) q;
  end if;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.view_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

create function public.profile_polls(name text, max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer, view_count integer,
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
      and p.visibility = 'public' and not p.is_system and p.kind <> 'snap' and p.created_at <= now()
      and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
    order by p.created_at desc, p.id desc
    limit lim
  ) q;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.view_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

revoke execute on function public.poll_cards(uuid[]) from public, anon, authenticated;
revoke execute on function public.get_feed(text, int, text) from public;
grant execute on function public.get_feed(text, int, text) to anon, authenticated;
revoke execute on function public.get_poll(uuid) from public;
grant execute on function public.get_poll(uuid) to anon, authenticated;
revoke execute on function public.my_polls(text, int, text) from public, anon;
grant execute on function public.my_polls(text, int, text) to authenticated;
revoke execute on function public.profile_polls(text, int, text) from public;
grant execute on function public.profile_polls(text, int, text) to anon, authenticated;

-- Count every 10 seconds with pg_cron (Supabase: Database → Extensions → pg_cron).
-- Later, with more traffic: select cron.alter_job((select jobid from cron.job where jobname = 'docchi-views'), schedule => '30 seconds');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('docchi-views', '10 seconds', 'select public.views_rollup()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); viewers will trigger the counting themselves', sqlerrm;
end;
$$;
