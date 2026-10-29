-- Admin → Run → Limits: polls a day and snaps a day per person, set by the admin.
--
-- Polls go from 5 to 10 a day (snaps stay at 3). Both now count from midnight India time, so
-- "You can post again after midnight" is true (polls used to count the last 24 hours). Hot
-- takes and mystery polls stay at 1 a day, inside the polls limit. The admin isn't limited.
-- The database reads the number each time someone posts, so a change works at once.
--
-- create_poll, create_poll_status and create_snap are the same as before (20261114000000 and
-- 20261203000000) except for the limit checks. Safe to run twice.

create table if not exists public.app_settings (
  key         text primary key,
  value       int not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;

insert into public.app_settings (key, value) values ('polls_per_day', 10), ('snaps_per_day', 3)
on conflict (key) do nothing;

-- A limit's number (the default if it was never set). Internal.
create or replace function public.limit_of(name text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value from public.app_settings s where s.key = limit_of.name),
                  case limit_of.name when 'polls_per_day' then 10 when 'snaps_per_day' then 3 end);
$$;
revoke execute on function public.limit_of(text) from public, anon, authenticated;

-- Midnight today, India time. Internal.
create or replace function public.ist_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
$$;
revoke execute on function public.ist_day_start() from public, anon, authenticated;

-- Read the limits, or change them (each change goes in the admin log). Admin only.
create or replace function public.admin_limits(polls int default null, snaps int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_polls int;
  before_snaps int;
begin
  perform public.require_admin();
  before_polls := public.limit_of('polls_per_day');
  before_snaps := public.limit_of('snaps_per_day');
  if polls is not null and polls not between 1 and 50 then
    raise exception 'docchi:out_of_range' using errcode = '22023';
  end if;
  if snaps is not null and snaps not between 1 and 20 then
    raise exception 'docchi:out_of_range' using errcode = '22023';
  end if;
  if polls is not null and polls <> before_polls then
    insert into public.app_settings as s (key, value) values ('polls_per_day', polls)
    on conflict (key) do update set value = excluded.value, updated_at = now();
    perform public.admin_event('limits', 'Polls a day: ' || before_polls || ' → ' || polls);
  end if;
  if snaps is not null and snaps <> before_snaps then
    insert into public.app_settings as s (key, value) values ('snaps_per_day', snaps)
    on conflict (key) do update set value = excluded.value, updated_at = now();
    perform public.admin_event('limits', 'Snaps a day: ' || before_snaps || ' → ' || snaps);
  end if;
  return jsonb_build_object(
    'polls', public.limit_of('polls_per_day'),
    'snaps', public.limit_of('snaps_per_day'),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'detail', e.detail) order by e.at desc), '[]'::jsonb)
                from (select x.at, x.detail from public.admin_events x where x.action = 'limits' order by x.at desc limit 10) e));
end;
$$;
revoke execute on function public.admin_limits(int, int) from public, anon;
grant execute on function public.admin_limits(int, int) to authenticated;

-- ─── The posting functions, now reading the limits ───────────────────────────

create or replace function public.create_poll(
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

  -- Polls a day (Admin → Limits), India time: resets at midnight. Deleted polls still count.
  -- Hot takes and mystery polls: 1 a day, inside it. The admin isn't limited.
  if not me.is_admin and (select count(*) from public.polls x
      where x.creator_id = uid and x.kind <> 'snap' and x.created_at >= public.ist_day_start()) >= public.limit_of('polls_per_day') then
    raise exception 'docchi:daily_limit' using errcode = 'P0001';
  end if;

  if not me.is_admin and k <> 'classic' and exists (
      select 1 from public.polls p
      where p.creator_id = uid and p.kind in ('hot_take', 'mystery') and p.created_at >= public.ist_day_start()) then
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
  snapped int;
  poll_cap int := public.limit_of('polls_per_day');
  snap_cap int := public.limit_of('snaps_per_day');
  suggestions text[];
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into me from public.profiles where id = uid;
  select count(*) filter (where kind <> 'snap'), count(*) filter (where kind in ('hot_take', 'mystery')),
         count(*) filter (where kind = 'snap')
    into posted, special, snapped
    from public.polls
    where creator_id = uid and created_at >= public.ist_day_start();
  if me.username::text like 'guest\_%' then
    suggestions := public.suggest_usernames(name_seed);
  end if;
  return jsonb_build_object(
    'signed_in', true,
    'username', case when me.username::text like 'guest\_%' then null else me.username::text end,
    'suggestions', to_jsonb(coalesce(suggestions, '{}')),
    'poll_limit', poll_cap,
    'snap_limit', snap_cap,
    'polls_left', case when me.is_admin then poll_cap else greatest(poll_cap - posted, 0) end,
    'snaps_left', case when me.is_admin then snap_cap else greatest(snap_cap - snapped, 0) end,
    'special_left', case when me.is_admin then 1 else greatest(1 - special, 0) end
  );
end;
$$;
create or replace function public.create_snap(photo_path text, question text, answers text[],
                                              visibility text default 'circle', live boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  vis text := coalesce(visibility, 'circle');
  q text := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
  opts text[] := '{}';
  a text;
  new_id uuid;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  select * into me from public.profiles where id = uid;
  if me.is_banned then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  if me.username::text like 'guest\_%' then
    raise exception 'docchi:need_username' using errcode = 'P0001';
  end if;

  if vis not in ('public', 'circle', 'link') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  if vis = 'public' and me.created_at > now() - interval '1 day' then
    raise exception 'docchi:snap_too_new' using errcode = 'P0001';
  end if;
  if vis = 'circle' and not exists (select 1 from public.circle_members c where c.owner_id = uid and c.status = 'accepted') then
    raise exception 'docchi:empty_circle' using errcode = 'P0001';
  end if;

  -- Snaps a day (Admin → Limits), India time (resets at midnight). Deleted snaps still count.
  -- The admin isn't limited.
  if not me.is_admin and (select count(*) from public.polls p
      where p.creator_id = uid and p.kind = 'snap' and p.created_at >= public.ist_day_start()) >= public.limit_of('snaps_per_day') then
    raise exception 'docchi:snap_limit' using errcode = 'P0001';
  end if;

  if char_length(q) not between 3 and 80 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;
  foreach a in array coalesce(answers, '{}') loop
    a := regexp_replace(trim(coalesce(a, '')), '\s+', ' ', 'g');
    if char_length(a) not between 1 and 24 then
      raise exception 'docchi:answer_length' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(opts) o where lower(o) = lower(a)) then
      raise exception 'docchi:duplicate_answers' using errcode = '22023';
    end if;
    opts := opts || a;
  end loop;
  if cardinality(opts) not between 2 and 4 then
    raise exception 'docchi:answer_count' using errcode = '22023';
  end if;
  if public.has_blocked_term(q || ' ' || array_to_string(opts, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;

  if photo_path is null or split_part(photo_path, '/', 1) <> uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.polls p where p.photo_path = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;

  insert into public.polls (creator_id, kind, question, visibility, closes_at, photo_path, photo_status, photo_live)
  values (uid, 'snap', q, vis, now() + interval '24 hours', create_snap.photo_path, 'pending', coalesce(live, false))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text from unnest(opts) with ordinality as o(text, ord);

  return new_id;
end;
$$;
revoke execute on function public.create_snap(text, text, text[], text, boolean) from public, anon;
grant execute on function public.create_snap(text, text, text[], text, boolean) to authenticated;
