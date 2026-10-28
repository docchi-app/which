-- The scrolling feed: live numbers for the cards on screen.
--
-- 1. live_counts(ids): votes, views, comments and the last hour's votes for up to 12 polls,
--    in one small request. The app asks every few seconds for the cards on screen only.
--    Same rules as the cards themselves: results only once you've voted (or the poll closed),
--    nothing from friends-only polls you can't see.
-- 2. polls.recent_votes: votes in the last hour ("🔥 41 in the last hour" on busy polls),
--    worked out at most once a minute by views_rollup (pg_cron, every 10 seconds).
-- 3. views_daily: new views per day (India time), added up by views_rollup, so Admin →
--    Metrics can show votes per 100 views. It starts counting when this runs.

alter table public.polls add column if not exists recent_votes integer not null default 0;
create index if not exists polls_recent_votes_idx on public.polls (id) where recent_votes > 0;

create table if not exists public.views_daily (
  day   date primary key,
  views integer not null default 0
);
alter table public.views_daily enable row level security;
revoke all on table public.views_daily from public, anon, authenticated;

create or replace function public.views_rollup()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  last_cleanup timestamptz;
  last_recent timestamptz;
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
  ),
  bumped as (
    update public.polls p set view_count = p.view_count + n.c
    from (select a.poll_id, count(*)::int as c from added a group by a.poll_id) n
    where p.id = n.poll_id
    returning 1
  )
  -- The day's new views, for votes per view in Admin → Metrics.
  insert into public.views_daily (day, views)
  select (now() at time zone 'Asia/Kolkata')::date, count(*)::int from added having count(*) > 0
  on conflict (day) do update set views = public.views_daily.views + excluded.views;

  insert into public.app_state (key, at) values ('views_rollup', now())
  on conflict (key) do update set at = excluded.at;

  -- At most once a minute: each poll's votes in the last hour (only polls that have some, or had).
  select a.at into last_recent from public.app_state a where a.key = 'recent_votes';
  if last_recent is null or last_recent < now() - interval '1 minute' then
    with r as (
      select v.poll_id, count(*)::int as n
      from public.votes v
      where v.created_at > now() - interval '1 hour'
      group by v.poll_id
    ),
    t as (
      select p.id, coalesce(r.n, 0) as n
      from public.polls p
      left join r on r.poll_id = p.id
      where p.recent_votes > 0 or r.n is not null
    )
    update public.polls p set recent_votes = t.n
    from t
    where p.id = t.id and p.recent_votes <> t.n;
    insert into public.app_state (key, at) values ('recent_votes', now())
    on conflict (key) do update set at = excluded.at;
  end if;

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
revoke execute on function public.views_rollup() from public, anon, authenticated;

-- Live numbers for the cards on screen: at most 12 polls a call.
create or replace function public.live_counts(ids uuid[])
returns table (
  id            uuid,
  vote_count    integer,
  view_count    integer,
  comment_count integer,
  recent_votes  integer,
  options       jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.vote_count, c.view_count, c.comment_count,
         case when c.locked then 0 else p.recent_votes end,
         -- Just each answer's id and count (null until you've voted), not the text again.
         (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'votes', o->'votes')), '[]'::jsonb)
            from jsonb_array_elements(c.options) o)
  from public.poll_cards((select coalesce(array_agg(x), '{}') from unnest(ids[1:12]) x)) c
  join public.polls p on p.id = c.id
  where p.deleted_at is null and not p.is_hidden;
$$;
revoke execute on function public.live_counts(uuid[]) from public;
grant execute on function public.live_counts(uuid[]) to anon, authenticated;

-- Admin → Metrics: votes per 100 views, per day (views counted since this migration ran).
create or replace function public.admin_view_stats(days int default 14)
returns table (day date, views int, votes int, votes_per_100_views numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int := least(greatest(coalesce(days, 14), 1), 90);
begin
  perform public.require_admin();
  return query
  with d as (
    select generate_series(today - (n - 1), today, interval '1 day')::date as day
  ),
  v as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as votes
    from public.votes x
    where x.created_at >= ((today - (n - 1))::timestamp at time zone 'Asia/Kolkata')
    group by 1
  )
  select d.day, coalesce(w.views, 0), coalesce(v.votes, 0),
         round(100.0 * v.votes / nullif(w.views, 0), 1)
  from d
  left join public.views_daily w on w.day = d.day
  left join v on v.day = d.day
  order by d.day desc;
end;
$$;
revoke execute on function public.admin_view_stats(int) from public, anon;
grant execute on function public.admin_view_stats(int) to authenticated;
