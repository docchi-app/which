-- Circle polls.
--   visibility 'circle': only the creator's circle can see and vote on it:
--   the whole circle, or just the groups picked when posting (poll_audience).
--   * Stays out of Trending / New; shows in the Circle tab of the people it's for.
--   * Anyone else opening the link gets a locked card: who it's from, nothing
--     else (no question, no answers), and can't vote.
--   * After voting, people in the circle see who picked what (circle_picks).
-- The Circle tab shows circle polls you can see plus public polls from the
-- circles you're in.

alter table public.polls drop constraint polls_visibility_check;
alter table public.polls add constraint polls_visibility_check check (visibility in ('public', 'link', 'circle'));

create table public.poll_audience (
  poll_id   uuid not null references public.polls (id) on delete cascade,
  group_id  uuid not null references public.circle_groups (id) on delete cascade,
  primary key (poll_id, group_id)
);
alter table public.poll_audience enable row level security;
revoke all on public.poll_audience from anon, authenticated;

-- May `viewer` see poll `poll`? Public and link polls: yes. Circle polls: the
-- creator, and accepted circle members (in one of the chosen groups, if any).
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
revoke execute on function public.can_view_poll(uuid, uuid) from public, anon, authenticated;

-- ─── Read paths ────────────────────────────────────────────────────────────
-- scope: 'feed' (Trending / New), 'circle' (Circle tab), 'one' (by link),
--        'mine', 'voted'.

drop function if exists public.get_feed(text, int, int);
drop function if exists public.get_poll(uuid);
drop function if exists public.my_polls(text, int, int);
drop function if exists public.profile_polls(text, int, int);
drop function if exists public.poll_rows(uuid, text);

create function public.poll_rows(only_poll uuid default null, scope text default 'feed')
returns table (
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
      coalesce(p.creator_id = auth.uid(), false) as mine,
      not public.can_view_poll(p.id, auth.uid()) as is_locked,
      (v.option_id is not null or p.closes_at <= now()
        or coalesce(p.creator_id = auth.uid(), false)) as can_see
    from public.polls p
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
    where p.deleted_at is null
      and not p.is_hidden
      and case scope
        when 'mine'  then p.creator_id = auth.uid()
        when 'voted' then v.option_id is not null and public.can_view_poll(p.id, auth.uid())
        when 'one'   then p.id = only_poll
                          and p.created_at <= now()
                          and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
        when 'circle' then p.closes_at > now()
                          and p.created_at <= now()
                          and (
                            (p.visibility = 'circle' and public.can_view_poll(p.id, auth.uid()))
                            or (p.visibility = 'public' and exists (
                                  select 1 from public.circle_members c
                                  where c.owner_id = p.creator_id and c.member_id = auth.uid()
                                    and c.status = 'accepted'))
                          )
        else p.closes_at > now()
             and p.created_at <= now()      -- scheduled polls stay out until go-live
             and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
             and (p.visibility = 'public'
                  or (p.visibility = 'link' and (p.creator_id = auth.uid() or v.option_id is not null)))
      end
  )
  select
    b.id,
    b.kind,
    b.visibility,
    b.mine,
    b.is_locked,
    -- Who a circle poll is for (only its creator sees this).
    case when b.mine and b.visibility = 'circle' then
      coalesce((select string_agg(g.name, ', ' order by g.name) from public.poll_audience a
                join public.circle_groups g on g.id = a.group_id where a.poll_id = b.id), 'Whole circle')
    end,
    case when b.is_locked or (b.kind = 'mystery' and not b.can_see) then null else b.question end,
    case when b.is_locked then null else b.teaser end,
    case when b.is_system then 'docchi' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_today, false),
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
    end,
    (b.vote_count + 1) / power(extract(epoch from now() - b.created_at) / 3600 + 2, 1.5)
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;
revoke execute on function public.poll_rows(uuid, text) from public, anon, authenticated;

-- tab: 'trending' | 'new' | 'circle'
create function public.get_feed(tab text default 'trending', max_rows int default 30, skip int default 0)
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
  select r.id, r.kind, r.visibility, r.is_mine, r.locked, r.audience, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(null, case when tab = 'circle' then 'circle' else 'feed' end) r
  order by
    case when tab = 'circle' then false else r.my_option_id is not null end,   -- not voted yet first
    case when tab = 'circle' then false else r.featured_today end desc,
    case when tab in ('new', 'circle') then extract(epoch from r.created_at) else r.score end desc,
    r.id
  limit least(greatest(max_rows, 1), 100)
  offset greatest(skip, 0);
$$;
grant execute on function public.get_feed(text, int, int) to anon, authenticated;

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
  select r.id, r.kind, r.visibility, r.is_mine, r.locked, r.audience, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(poll, 'one') r;
$$;
grant execute on function public.get_poll(uuid) to anon, authenticated;

create function public.my_polls(which text default 'mine', max_rows int default 30, skip int default 0)
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
  select r.id, r.kind, r.visibility, r.is_mine, r.locked, r.audience, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(null, case when which = 'voted' then 'voted' else 'mine' end) r
  order by r.created_at desc, r.id
  limit least(greatest(max_rows, 1), 100)
  offset greatest(skip, 0);
$$;
grant execute on function public.my_polls(text, int, int) to authenticated;

create function public.profile_polls(name text, max_rows int default 30, skip int default 0)
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
  select r.id, r.kind, r.visibility, r.is_mine, r.locked, r.audience, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.polls p
  join public.profiles u on u.id = p.creator_id
  cross join lateral public.poll_rows(p.id, 'one') r
  where u.username = lower(name)
    and p.visibility = 'public'
    and not p.is_system
  order by p.created_at desc, p.id
  limit least(greatest(max_rows, 1), 100)
  offset greatest(skip, 0);
$$;
grant execute on function public.profile_polls(text, int, int) to anon, authenticated;

-- Who in the circle picked what, for a circle poll. Only for people who can
-- see the poll and have voted on it (or made it), like the results.
create or replace function public.circle_picks(poll uuid)
returns table (username text, avatar_url text, option_id uuid, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.username::text, pr.avatar_url, v.option_id, v.user_id = auth.uid()
  from public.polls p
  join public.votes v on v.poll_id = p.id
  join public.profiles pr on pr.id = v.user_id
  where p.id = poll
    and p.visibility = 'circle'
    and p.deleted_at is null
    and public.can_view_poll(p.id, auth.uid())
    and (p.creator_id = auth.uid()
         or exists (select 1 from public.votes mine where mine.poll_id = p.id and mine.user_id = auth.uid()))
  order by v.created_at
  limit 200;
$$;
grant execute on function public.circle_picks(uuid) to authenticated;

create or replace function public.set_poll_visibility(poll uuid, visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if set_poll_visibility.visibility not in ('public', 'link', 'circle') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  update public.polls p
  set visibility = set_poll_visibility.visibility
  where p.id = poll and p.creator_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
  -- Switching to the circle later means the whole circle.
  delete from public.poll_audience a where a.poll_id = poll;
end;
$$;

-- ─── Voting and creating ───────────────────────────────────────────────────

create or replace function public.cast_vote(target_poll uuid, target_option uuid)
returns table (my_option_id uuid, vote_count integer, options jsonb, question text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inserted int;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'sign in to vote' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'account is banned' using errcode = '42501';
  end if;

  perform 1 from public.polls p
    where p.id = target_poll and not p.is_hidden and p.deleted_at is null
      and p.closes_at > now() and p.created_at <= now();
  if not found then
    raise exception 'poll is closed or missing' using errcode = 'P0002';
  end if;

  if not public.can_view_poll(target_poll, uid) then
    raise exception 'docchi:circle_only' using errcode = '42501';
  end if;

  perform 1 from public.poll_options o where o.id = target_option and o.poll_id = target_poll;
  if not found then
    raise exception 'option does not belong to poll' using errcode = '22023';
  end if;

  insert into public.votes (poll_id, user_id, option_id)
  values (target_poll, uid, target_option)
  on conflict (poll_id, user_id) do nothing;
  get diagnostics inserted = row_count;

  if inserted = 1 then
    update public.poll_options o set vote_count = o.vote_count + 1 where o.id = target_option;
    update public.polls p set vote_count = p.vote_count + 1 where p.id = target_poll;
  end if;

  return query
    select
      v.option_id,
      p.vote_count,
      (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'votes', o.vote_count)
                        order by o.position)
         from public.poll_options o where o.poll_id = target_poll),
      p.question
    from public.polls p
    join public.votes v on v.poll_id = p.id and v.user_id = uid
    where p.id = target_poll;
end;
$$;

drop function if exists public.create_poll(text, text[], int, text, text, text, text);

create function public.create_poll(
  question text,
  answers text[],
  days int,
  username text default null,
  kind text default 'classic',
  teaser text default null,
  visibility text default 'public',
  groups uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  q text := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
  t text := nullif(regexp_replace(trim(coalesce(teaser, '')), '\s+', ' ', 'g'), '');
  k text := coalesce(kind, 'classic');
  vis text := coalesce(visibility, 'public');
  clean text[];
  a text;
  new_id uuid;
  problem text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;

  select * into me from public.profiles where id = uid for update;
  if me.is_banned then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;

  if k not in ('classic', 'hot_take', 'mystery') then
    raise exception 'docchi:kind' using errcode = '22023';
  end if;

  if vis not in ('public', 'link', 'circle') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;

  if vis = 'circle' then
    if exists (select 1 from unnest(coalesce(groups, '{}')) g
               where not exists (select 1 from public.circle_groups cg where cg.id = g and cg.owner_id = uid)) then
      raise exception 'docchi:not_yours' using errcode = '42501';
    end if;
    -- Someone has to be able to see it.
    if not exists (
        select 1 from public.circle_members c
        where c.owner_id = uid and c.status = 'accepted'
          and (cardinality(coalesce(groups, '{}')) = 0
               or exists (select 1 from public.circle_group_members m
                          where m.member_id = c.member_id and m.group_id = any(groups)))) then
      raise exception 'docchi:empty_circle' using errcode = 'P0001';
    end if;
  end if;

  if (select count(*) from public.polls
      where creator_id = uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'docchi:daily_limit' using errcode = 'P0001';
  end if;

  if k <> 'classic' and exists (
      select 1 from public.polls p
      where p.creator_id = uid and p.kind <> 'classic' and p.created_at > now() - interval '24 hours') then
    raise exception 'docchi:special_limit' using errcode = 'P0001';
  end if;

  -- First poll: pick a username.
  if me.username::text like 'guest\_%' then
    problem := public.username_problem(lower(coalesce(username, '')), uid);
    if problem <> 'ok' then
      raise exception 'docchi:username_%', problem using errcode = 'P0001';
    end if;
    begin
      update public.profiles set username = lower(create_poll.username) where id = uid;
    exception when unique_violation then
      raise exception 'docchi:username_taken' using errcode = 'P0001';
    end;
  end if;

  if char_length(q) < 3 or char_length(q) > 140 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;

  if k = 'hot_take' then
    clean := array['Agree', 'Disagree'];
    t := null;
  else
    clean := '{}';
    foreach a in array coalesce(answers, '{}') loop
      a := regexp_replace(trim(a), '\s+', ' ', 'g');
      if a = '' then continue; end if;
      if char_length(a) > 40 then
        raise exception 'docchi:answer_length' using errcode = '22023';
      end if;
      if exists (select 1 from unnest(clean) x where lower(x) = lower(a)) then
        raise exception 'docchi:duplicate_answers' using errcode = '22023';
      end if;
      clean := clean || a;
    end loop;
    if cardinality(clean) not between 2 and 4 then
      raise exception 'docchi:answer_count' using errcode = '22023';
    end if;
  end if;

  if k = 'mystery' then
    if t is null or char_length(t) not between 3 and 60 then
      raise exception 'docchi:teaser_length' using errcode = '22023';
    end if;
  else
    t := null;
  end if;

  if days not in (1, 3, 7) then
    raise exception 'docchi:duration' using errcode = '22023';
  end if;

  if public.has_blocked_term(q || ' ' || coalesce(t, '') || ' ' || array_to_string(clean, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;

  insert into public.polls (creator_id, kind, question, teaser, visibility, closes_at)
  values (uid, k, q, t, vis, now() + make_interval(days => days))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text
  from unnest(clean) with ordinality as o(text, ord);

  if vis = 'circle' then
    insert into public.poll_audience (poll_id, group_id)
    select new_id, g from unnest(coalesce(groups, '{}')) g on conflict do nothing;
  end if;

  return new_id;
end;
$$;

revoke execute on function public.create_poll(text, text[], int, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.create_poll(text, text[], int, text, text, text, text, uuid[]) to authenticated;
