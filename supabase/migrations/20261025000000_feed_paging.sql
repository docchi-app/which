-- Feed: polls you've voted on go to the end, closed polls leave the feed,
-- and the feed pages ("load more"). get_poll fetches one poll for a shared
-- link, even after it has closed.

drop function if exists public.get_feed(text, int);

-- One row per visible poll, in the shape the app reads. Option counts are null
-- until the caller has voted or the poll has closed. Internal: called by
-- get_feed / get_poll only.
create or replace function public.poll_rows(only_poll uuid default null)
returns table (
  id             uuid,
  question       text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
  comment_count  integer,
  created_at     timestamptz,
  closes_at      timestamptz,
  my_option_id   uuid,
  options        jsonb,
  score          double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      p.*,
      (p.featured_on = (now() at time zone 'Asia/Kolkata')::date) as featured_today,
      v.option_id as my_option_id,
      (v.option_id is not null or p.closes_at <= now()) as can_see
    from public.polls p
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
    where not p.is_hidden
      and p.created_at <= now()            -- scheduled polls stay out until go-live
      and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
      and (case when only_poll is null then p.closes_at > now() else p.id = only_poll end)
  )
  select
    b.id,
    b.question,
    case when b.is_system then 'docchi' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_today, false),
    b.vote_count,
    (select count(*)::int from public.comments c
      where c.poll_id = b.id and not c.is_hidden and c.expires_at > now()),
    b.created_at,
    b.closes_at,
    b.my_option_id,
    (select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'text', o.text,
              'votes', case when b.can_see then o.vote_count end)
            order by o.position)
       from public.poll_options o where o.poll_id = b.id),
    -- Hacker News-style decay; good enough until a scheduled job keeps a score.
    (b.vote_count + 1) / power(extract(epoch from now() - b.created_at) / 3600 + 2, 1.5)
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;

revoke execute on function public.poll_rows(uuid) from public, anon, authenticated;

create or replace function public.get_feed(tab text default 'trending', max_rows int default 30, skip int default 0)
returns table (
  id             uuid,
  question       text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
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
  select r.id, r.question, r.creator, r.is_system, r.featured_today, r.vote_count,
         r.comment_count, r.created_at, r.closes_at, r.my_option_id, r.options
  from public.poll_rows() r
  order by
    r.my_option_id is not null,            -- not voted yet first
    r.featured_today desc,
    case when tab = 'new' then extract(epoch from r.created_at) else r.score end desc,
    r.id
  limit least(greatest(max_rows, 1), 100)
  offset greatest(skip, 0);
$$;

grant execute on function public.get_feed(text, int, int) to anon, authenticated;

create or replace function public.get_poll(poll uuid)
returns table (
  id             uuid,
  question       text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
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
  select r.id, r.question, r.creator, r.is_system, r.featured_today, r.vote_count,
         r.comment_count, r.created_at, r.closes_at, r.my_option_id, r.options
  from public.poll_rows(poll) r;
$$;

grant execute on function public.get_poll(uuid) to anon, authenticated;
