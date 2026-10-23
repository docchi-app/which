-- Circles (Instagram "Close Friends" style, with requests).
--   * I ask to join your circle; you accept or decline.
--   * Once accepted I see your circle polls (next PR). It's one-way: for you
--     to see mine, you ask and I accept.
--   * You can sort the people in your circle into groups (Family, Office…).
--   * Blocking removes both directions and stops new requests.
-- Limits: 500 people and 10 groups per circle, 50 requests a day.
-- Everything goes through the functions below; the tables are private.

create table public.circle_members (
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index circle_members_member_idx on public.circle_members (member_id, status);

create table public.circle_groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 24),
  created_at  timestamptz not null default now()
);
create unique index circle_groups_name_idx on public.circle_groups (owner_id, lower(name));

create table public.circle_group_members (
  group_id   uuid not null references public.circle_groups (id) on delete cascade,
  owner_id   uuid not null,
  member_id  uuid not null,
  primary key (group_id, member_id),
  -- Leaving the circle takes you out of its groups too.
  foreign key (owner_id, member_id) references public.circle_members (owner_id, member_id) on delete cascade
);

create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.circle_members       enable row level security;
alter table public.circle_groups        enable row level security;
alter table public.circle_group_members enable row level security;
alter table public.blocks               enable row level security;
revoke all on public.circle_members, public.circle_groups, public.circle_group_members, public.blocks
  from anon, authenticated;

-- ─── Helpers ───────────────────────────────────────────────────────────────

-- The signed-in, non-guest caller, or an error.
create or replace function public.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  return uid;
end;
$$;
revoke execute on function public.require_user() from public, anon, authenticated;

-- A real (non-guest) user by username, or an error.
create or replace function public.user_by_name(name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  select p.id into found_id from public.profiles p
  where p.username = lower(name) and p.username::text not like 'guest\_%' and not p.is_banned;
  if found_id is null then
    raise exception 'docchi:no_user' using errcode = 'P0002';
  end if;
  return found_id;
end;
$$;
revoke execute on function public.user_by_name(text) from public, anon, authenticated;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

-- ─── Profiles and search ───────────────────────────────────────────────────

-- Someone's public profile, with where you stand with them.
--   their_circle: am I in their circle? none | pending | member
--   my_circle:    are they in mine?     none | pending | member
create or replace function public.get_profile(name text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'username', p.username::text,
    'avatar_url', p.avatar_url,
    'joined', p.created_at,
    'is_me', coalesce(p.id = auth.uid(), false),
    'public_polls', (select count(*) from public.polls x
                      where x.creator_id = p.id and x.visibility = 'public' and x.deleted_at is null and not x.is_hidden),
    'votes_received', (select coalesce(sum(x.vote_count), 0) from public.polls x
                        where x.creator_id = p.id and x.visibility = 'public' and x.deleted_at is null),
    'circle_size', (select count(*) from public.circle_members c where c.owner_id = p.id and c.status = 'accepted'),
    'their_circle', coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
                               from public.circle_members c where c.owner_id = p.id and c.member_id = auth.uid()), 'none'),
    'my_circle', coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
                            from public.circle_members c where c.owner_id = auth.uid() and c.member_id = p.id), 'none'),
    'blocked_by_me', exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.id)
  )
  from public.profiles p
  where p.username = lower(name)
    and p.username::text not like 'guest\_%'
    and not p.is_banned
    and not exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid());
$$;
grant execute on function public.get_profile(text) to anon, authenticated;

-- Someone's public polls, newest first (closed ones included).
create or replace function public.profile_polls(name text, max_rows int default 30, skip int default 0)
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

-- Up to 10 people whose username starts with `q`.
create or replace function public.search_people(q text)
returns table (username text, avatar_url text, their_circle text, my_circle text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.username::text,
    p.avatar_url,
    coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
               from public.circle_members c where c.owner_id = p.id and c.member_id = auth.uid()), 'none'),
    coalesce((select case c.status when 'accepted' then 'member' else 'pending' end
               from public.circle_members c where c.owner_id = auth.uid() and c.member_id = p.id), 'none')
  from public.profiles p
  where char_length(trim(coalesce(q, ''))) >= 2
    and p.username::text like replace(replace(lower(trim(q)), '_', '\_'), '%', '\%') || '%'
    and p.username::text not like 'guest\_%'
    and not p.is_banned
    and p.id is distinct from auth.uid()
    and not public.is_blocked_between(p.id, auth.uid())
  order by char_length(p.username::text), p.username
  limit 10;
$$;
grant execute on function public.search_people(text) to authenticated;

-- ─── Requests ──────────────────────────────────────────────────────────────

-- Ask to join @name's circle.
create or replace function public.request_circle(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if them = me then
    raise exception 'docchi:self' using errcode = '22023';
  end if;
  if public.is_blocked_between(me, them) then
    raise exception 'docchi:blocked' using errcode = '42501';
  end if;
  if exists (select 1 from public.circle_members where owner_id = them and member_id = me) then
    return (select case status when 'accepted' then 'member' else 'pending' end
            from public.circle_members where owner_id = them and member_id = me);
  end if;
  if (select count(*) from public.circle_members
      where member_id = me and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'docchi:request_limit' using errcode = 'P0001';
  end if;
  insert into public.circle_members (owner_id, member_id) values (them, me);
  return 'pending';
end;
$$;
grant execute on function public.request_circle(text) to authenticated;

-- Cancel my request, or leave @name's circle.
create or replace function public.leave_circle(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  delete from public.circle_members where owner_id = public.user_by_name(name) and member_id = me;
end;
$$;
grant execute on function public.leave_circle(text) to authenticated;

-- Accept or decline @name's request to join my circle.
create or replace function public.respond_request(name text, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if not accept then
    delete from public.circle_members where owner_id = me and member_id = them and status = 'pending';
    return;
  end if;
  if (select count(*) from public.circle_members where owner_id = me and status = 'accepted') >= 500 then
    raise exception 'docchi:circle_full' using errcode = 'P0001';
  end if;
  update public.circle_members
  set status = 'accepted', accepted_at = now()
  where owner_id = me and member_id = them and status = 'pending';
  if not found then
    raise exception 'docchi:no_request' using errcode = 'P0002';
  end if;
end;
$$;
grant execute on function public.respond_request(text, boolean) to authenticated;

-- Take @name out of my circle (and all its groups).
create or replace function public.remove_from_circle(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  delete from public.circle_members where owner_id = me and member_id = public.user_by_name(name);
end;
$$;
grant execute on function public.remove_from_circle(text) to authenticated;

-- ─── My circle ─────────────────────────────────────────────────────────────

-- Everything the Circle tab on my profile needs.
create or replace function public.my_circle()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('username', p.username::text, 'avatar_url', p.avatar_url, 'at', c.created_at)
                       order by c.created_at desc)
      from public.circle_members c join public.profiles p on p.id = c.member_id
      where c.owner_id = me and c.status = 'pending'), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'username', p.username::text,
               'avatar_url', p.avatar_url,
               'since', c.accepted_at,
               'groups', coalesce((select jsonb_agg(g.group_id) from public.circle_group_members g
                                    where g.owner_id = me and g.member_id = c.member_id), '[]'::jsonb))
             order by p.username)
      from public.circle_members c join public.profiles p on p.id = c.member_id
      where c.owner_id = me and c.status = 'accepted'), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name,
               'count', (select count(*) from public.circle_group_members m where m.group_id = g.id))
             order by g.created_at)
      from public.circle_groups g where g.owner_id = me), '[]'::jsonb),
    -- Circles I'm in, or have asked to join.
    'joined', coalesce((
      select jsonb_agg(jsonb_build_object(
               'username', p.username::text, 'avatar_url', p.avatar_url,
               'status', case c.status when 'accepted' then 'member' else 'pending' end,
               'at', coalesce(c.accepted_at, c.created_at))
             order by coalesce(c.accepted_at, c.created_at) desc)
      from public.circle_members c join public.profiles p on p.id = c.owner_id
      where c.member_id = me), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.my_circle() to authenticated;

-- For the badge on the Profile tab: requests waiting for me, and people who
-- accepted me in the last 3 days.
create or replace function public.circle_badge()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', (select count(*) from public.circle_members where owner_id = auth.uid() and status = 'pending'),
    'accepted_recently', (select count(*) from public.circle_members
                           where member_id = auth.uid() and status = 'accepted'
                             and accepted_at > now() - interval '3 days')
  );
$$;
grant execute on function public.circle_badge() to authenticated;

-- ─── Groups ────────────────────────────────────────────────────────────────

create or replace function public.create_group(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  clean text := regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g');
  new_id uuid;
begin
  if char_length(clean) not between 1 and 24 then
    raise exception 'docchi:group_name' using errcode = '22023';
  end if;
  if public.has_blocked_term(clean) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;
  if (select count(*) from public.circle_groups where owner_id = me) >= 10 then
    raise exception 'docchi:group_limit' using errcode = 'P0001';
  end if;
  begin
    insert into public.circle_groups (owner_id, name) values (me, clean) returning id into new_id;
  exception when unique_violation then
    raise exception 'docchi:group_exists' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;
grant execute on function public.create_group(text) to authenticated;

create or replace function public.rename_group(group_id uuid, name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  clean text := regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g');
begin
  if char_length(clean) not between 1 and 24 then
    raise exception 'docchi:group_name' using errcode = '22023';
  end if;
  if public.has_blocked_term(clean) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;
  begin
    update public.circle_groups g set name = clean where g.id = rename_group.group_id and g.owner_id = me;
  exception when unique_violation then
    raise exception 'docchi:group_exists' using errcode = 'P0001';
  end;
  if not found then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.rename_group(uuid, text) to authenticated;

create or replace function public.delete_group(group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  delete from public.circle_groups g where g.id = delete_group.group_id and g.owner_id = me;
end;
$$;
grant execute on function public.delete_group(uuid) to authenticated;

-- Put @name in a group of mine (or take them out). They must be in my circle.
create or replace function public.set_group_member(group_id uuid, name text, include boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if not exists (select 1 from public.circle_groups g where g.id = set_group_member.group_id and g.owner_id = me) then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
  if not include then
    delete from public.circle_group_members m where m.group_id = set_group_member.group_id and m.member_id = them;
    return;
  end if;
  if not exists (select 1 from public.circle_members c
                 where c.owner_id = me and c.member_id = them and c.status = 'accepted') then
    raise exception 'docchi:not_in_circle' using errcode = 'P0001';
  end if;
  insert into public.circle_group_members (group_id, owner_id, member_id)
  values (set_group_member.group_id, me, them)
  on conflict do nothing;
end;
$$;
grant execute on function public.set_group_member(uuid, text, boolean) to authenticated;

-- ─── Blocking ──────────────────────────────────────────────────────────────

create or replace function public.block_user(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
  them uuid := public.user_by_name(name);
begin
  if them = me then
    raise exception 'docchi:self' using errcode = '22023';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, them) on conflict do nothing;
  delete from public.circle_members
  where (owner_id = me and member_id = them) or (owner_id = them and member_id = me);
end;
$$;
grant execute on function public.block_user(text) to authenticated;

create or replace function public.unblock_user(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_user();
begin
  delete from public.blocks where blocker_id = me and blocked_id = public.user_by_name(name);
end;
$$;
grant execute on function public.unblock_user(text) to authenticated;
