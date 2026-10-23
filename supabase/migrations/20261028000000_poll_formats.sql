-- Poll formats and the verified badge.
--   classic  : a question with 2–4 answers (what we had).
--   hot_take : a statement; the answers are always Agree / Disagree.
--   mystery  : you see a teaser ("Pick a colour") and the answers; the real
--              question stays hidden until you vote (or the poll closes).
-- Anyone can post a hot take or a mystery poll, but only one of those a day
-- (it still counts toward the 5 polls a day). Docchi's own polls are verified.

alter table public.polls
  add column kind text not null default 'classic' check (kind in ('classic', 'hot_take', 'mystery')),
  add column teaser text check (teaser is null or char_length(teaser) between 3 and 60),
  add constraint mystery_has_teaser check (kind <> 'mystery' or teaser is not null);

-- ─── Read paths: hide a mystery question until it may be seen ───────────────

drop function if exists public.get_feed(text, int, int);
drop function if exists public.get_poll(uuid);
drop function if exists public.poll_rows(uuid);

create function public.poll_rows(only_poll uuid default null)
returns table (
  id             uuid,
  kind           text,
  question       text,
  teaser         text,
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
    b.kind,
    case when b.kind = 'mystery' and not b.can_see then null else b.question end,
    b.teaser,
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
    (b.vote_count + 1) / power(extract(epoch from now() - b.created_at) / 3600 + 2, 1.5)
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;

revoke execute on function public.poll_rows(uuid) from public, anon, authenticated;

create function public.get_feed(tab text default 'trending', max_rows int default 30, skip int default 0)
returns table (
  id uuid, kind text, question text, teaser text, creator text, is_system boolean,
  featured_today boolean, vote_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.question, r.teaser, r.creator, r.is_system, r.featured_today, r.vote_count,
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

create function public.get_poll(poll uuid)
returns table (
  id uuid, kind text, question text, teaser text, creator text, is_system boolean,
  featured_today boolean, vote_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.question, r.teaser, r.creator, r.is_system, r.featured_today, r.vote_count,
         r.comment_count, r.created_at, r.closes_at, r.my_option_id, r.options
  from public.poll_rows(poll) r;
$$;

grant execute on function public.get_poll(uuid) to anon, authenticated;

-- ─── Voting: also return the question, so a mystery poll can reveal it ──────

drop function if exists public.cast_vote(uuid, uuid);

create function public.cast_vote(target_poll uuid, target_option uuid)
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
    where p.id = target_poll and not p.is_hidden and p.closes_at > now() and p.created_at <= now();
  if not found then
    raise exception 'poll is closed or missing' using errcode = 'P0002';
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

revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;

-- ─── Creating: formats and the one-special-a-day rule ──────────────────────

create or replace function public.create_poll_status(name_seed text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  posted int;
  special int;
  suggestions text[];
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into me from public.profiles where id = uid;
  select count(*), count(*) filter (where kind <> 'classic') into posted, special
    from public.polls
    where creator_id = uid and created_at > now() - interval '24 hours';
  if me.username::text like 'guest\_%' then
    suggestions := public.suggest_usernames(name_seed);
  end if;
  return jsonb_build_object(
    'signed_in', true,
    'username', case when me.username::text like 'guest\_%' then null else me.username::text end,
    'suggestions', to_jsonb(coalesce(suggestions, '{}')),
    'polls_left', greatest(5 - posted, 0),
    'special_left', greatest(1 - special, 0)
  );
end;
$$;

drop function if exists public.create_poll(text, text[], int, text);

create function public.create_poll(
  question text,
  answers text[],
  days int,
  username text default null,
  kind text default 'classic',
  teaser text default null
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

  insert into public.polls (creator_id, kind, question, teaser, closes_at)
  values (uid, k, q, t, now() + make_interval(days => days))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text
  from unnest(clean) with ordinality as o(text, ord);

  return new_id;
end;
$$;

revoke execute on function public.create_poll(text, text[], int, text, text, text) from public, anon;
grant execute on function public.create_poll(text, text[], int, text, text, text) to authenticated;
