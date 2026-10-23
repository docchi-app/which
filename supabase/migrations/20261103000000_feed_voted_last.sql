-- Trending and New show polls you've voted on again, after the ones you
-- haven't (as before the scale migration). Paging walks the unvoted polls
-- first, then carries on through your voted ones; a cursor ending in "|v"
-- means "in the voted part".

create or replace function public.cursor_value(after text)
returns double precision
language sql
immutable
set search_path = ''
as $$ select case when after ~* '^(-?[0-9.]+(e[-+]?[0-9]+)?|infinity)\|[0-9a-f-]{36}(\|v)?$' then split_part(after, '|', 1)::double precision end $$;

create or replace function public.cursor_id(after text)
returns uuid
language sql
immutable
set search_path = ''
as $$ select case when after ~* '^(-?[0-9.]+(e[-+]?[0-9]+)?|infinity)\|[0-9a-f-]{36}(\|v)?$' then split_part(after, '|', 2)::uuid end $$;

-- tab: 'trending' | 'new' | 'circle'. Pass the last row's cursor as `after`
-- for the next page. Trending and New: polls you haven't voted on first
-- (Poll of the Day leading Trending), then the ones you have.
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
          where p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on <= today)
            and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
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
          where p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
            and p.hot_score > 0
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on < today)
            and (av is null or (p.hot_score, p.id) < (av, aid))
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
            and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on <= today)
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
            and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden
            and p.created_at <= now() and p.closes_at > now()
            and (p.featured_on is null or p.featured_on < today)
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
