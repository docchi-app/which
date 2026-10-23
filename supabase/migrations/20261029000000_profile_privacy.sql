-- Profile, private polls and deleting.
--   visibility 'public' : in everyone's feed (what we had).
--   visibility 'link'   : only people with the link can open it. It shows in
--                         the feed and on the profile only for its creator and
--                         for people who have voted on it.
--   deleted_at          : the creator deleted it. Hidden everywhere, but the
--                         row stays for moderation review.
-- Creators always see their own poll's results (and a mystery's question).

alter table public.polls
  add column visibility text not null default 'public' check (visibility in ('public', 'link')),
  add column deleted_at timestamptz;

alter table public.profiles add column username_changed_at timestamptz;

-- ─── Direct table reads follow the same rules ──────────────────────────────

drop policy "visible polls are public" on public.polls;
create policy "polls you may see" on public.polls
  for select using (
    deleted_at is null and not is_hidden and (
      visibility = 'public'
      or creator_id = auth.uid()
      or exists (select 1 from public.votes v where v.poll_id = polls.id and v.user_id = auth.uid())
    )
  );

drop policy "options of visible polls are public" on public.poll_options;
create policy "options of polls you may see" on public.poll_options
  for select using (exists (select 1 from public.polls p where p.id = poll_id));

-- The app reads polls only through the functions below, which hide what you
-- may not see yet (results, a mystery's question). Close the direct way in.
revoke select on public.polls from anon, authenticated;
revoke select on public.poll_options from anon, authenticated;

-- ─── Read paths ────────────────────────────────────────────────────────────
-- scope: 'feed' (open polls you may see), 'one' (a single poll by link),
--        'mine' (polls you made), 'voted' (polls you voted on).

drop function if exists public.get_feed(text, int, int);
drop function if exists public.get_poll(uuid);
drop function if exists public.poll_rows(uuid);

create function public.poll_rows(only_poll uuid default null, scope text default 'feed')
returns table (
  id             uuid,
  kind           text,
  visibility     text,
  is_mine        boolean,
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
      (p.creator_id is not distinct from auth.uid() and auth.uid() is not null) as mine,
      (v.option_id is not null or p.closes_at <= now()
        or coalesce(p.creator_id = auth.uid(), false)) as can_see
    from public.polls p
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
    where p.deleted_at is null
      and not p.is_hidden
      and case scope
        when 'mine'  then p.creator_id = auth.uid()
        when 'voted' then v.option_id is not null
        when 'one'   then p.id = only_poll
                          and p.created_at <= now()
                          and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
        else p.closes_at > now()
             and p.created_at <= now()      -- scheduled polls stay out until go-live
             and (p.featured_on is null or p.featured_on <= (now() at time zone 'Asia/Kolkata')::date)
             and (p.visibility = 'public' or p.creator_id = auth.uid() or v.option_id is not null)
      end
  )
  select
    b.id,
    b.kind,
    b.visibility,
    coalesce(b.mine, false),
    case when b.kind = 'mystery' and not b.can_see then null else b.question end,
    b.teaser,
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

revoke execute on function public.poll_rows(uuid, text) from public, anon, authenticated;

create function public.get_feed(tab text default 'trending', max_rows int default 30, skip int default 0)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, question text, teaser text, creator text,
  is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.visibility, r.is_mine, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(null, 'feed') r
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
  id uuid, kind text, visibility text, is_mine boolean, question text, teaser text, creator text,
  is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.visibility, r.is_mine, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(poll, 'one') r;
$$;

grant execute on function public.get_poll(uuid) to anon, authenticated;

-- Your polls ('mine') or the ones you voted on ('voted'), newest first,
-- including closed and link-only ones.
create function public.my_polls(which text default 'mine', max_rows int default 30, skip int default 0)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, question text, teaser text, creator text,
  is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.visibility, r.is_mine, r.question, r.teaser, r.creator, r.is_system,
         r.featured_today, r.vote_count, r.share_count, r.comment_count, r.created_at, r.closes_at,
         r.my_option_id, r.options
  from public.poll_rows(null, case when which = 'voted' then 'voted' else 'mine' end) r
  order by r.created_at desc, r.id
  limit least(greatest(max_rows, 1), 100)
  offset greatest(skip, 0);
$$;

grant execute on function public.my_polls(text, int, int) to authenticated;

-- ─── Profile ───────────────────────────────────────────────────────────────

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'username', case when pr.username::text like 'guest\_%' then null else pr.username::text end,
    'avatar_url', pr.avatar_url,
    'joined', pr.created_at,
    'username_changed_at', pr.username_changed_at,
    'polls_made', (select count(*) from public.polls p where p.creator_id = pr.id and p.deleted_at is null),
    'votes_received', (select coalesce(sum(p.vote_count), 0) from public.polls p
                        where p.creator_id = pr.id and p.deleted_at is null),
    'shares', (select coalesce(sum(p.share_count), 0) from public.polls p
                where p.creator_id = pr.id and p.deleted_at is null),
    'votes_cast', (select count(*) from public.votes v where v.user_id = pr.id)
  )
  from public.profiles pr
  where pr.id = auth.uid();
$$;

grant execute on function public.my_profile() to authenticated;

-- Change your username (at most once a week once it's been set).
create or replace function public.update_username(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  problem text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  select * into me from public.profiles where id = uid for update;
  if me.username = lower(name) then return; end if;
  if me.username::text not like 'guest\_%' and me.username_changed_at > now() - interval '7 days' then
    raise exception 'docchi:username_too_soon' using errcode = 'P0001';
  end if;
  problem := public.username_problem(lower(coalesce(name, '')), uid);
  if problem <> 'ok' then
    raise exception 'docchi:username_%', problem using errcode = 'P0001';
  end if;
  begin
    update public.profiles
    set username = lower(name),
        username_changed_at = case when me.username::text like 'guest\_%' then null else now() end
    where id = uid;
  exception when unique_violation then
    raise exception 'docchi:username_taken' using errcode = 'P0001';
  end;
end;
$$;

grant execute on function public.update_username(text) to authenticated;

-- ─── Managing your polls ───────────────────────────────────────────────────

create or replace function public.set_poll_visibility(poll uuid, visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if set_poll_visibility.visibility not in ('public', 'link') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  update public.polls p
  set visibility = set_poll_visibility.visibility
  where p.id = poll and p.creator_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.set_poll_visibility(uuid, text) to authenticated;

-- Hidden everywhere; the row stays for moderation review.
create or replace function public.delete_poll(poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.polls p
  set deleted_at = now()
  where p.id = poll and p.creator_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.delete_poll(uuid) to authenticated;

-- ─── Voting, sharing and creating respect deleted polls / visibility ──────

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

create or replace function public.record_share(poll uuid, channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  first_share boolean;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return;
  end if;
  if not exists (select 1 from public.polls p where p.id = poll and not p.is_hidden and p.deleted_at is null) then
    return;
  end if;

  first_share := not exists (select 1 from public.shares s where s.poll_id = poll and s.user_id = uid);

  insert into public.shares (poll_id, user_id, channel)
  values (poll, uid, record_share.channel)
  on conflict do nothing;

  if first_share and found then
    update public.polls p set share_count = p.share_count + 1 where p.id = poll;
  end if;
end;
$$;

drop function if exists public.create_poll(text, text[], int, text, text, text);

create function public.create_poll(
  question text,
  answers text[],
  days int,
  username text default null,
  kind text default 'classic',
  teaser text default null,
  visibility text default 'public'
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

  if vis not in ('public', 'link') then
    raise exception 'docchi:visibility' using errcode = '22023';
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

  return new_id;
end;
$$;

revoke execute on function public.create_poll(text, text[], int, text, text, text, text) from public, anon;
grant execute on function public.create_poll(text, text[], int, text, text, text, text) to authenticated;
