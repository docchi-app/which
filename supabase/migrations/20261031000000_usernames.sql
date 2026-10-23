-- Real usernames for everyone signed in with Google.
--   * Until now an account kept its placeholder guest_… name until its first
--     poll. Now every Google account gets a username built from its Google
--     name straight away (existing accounts are filled in below).
--   * That name is only a starting point: username_confirmed stays false
--     until the person confirms or changes it in the "Pick your @name" sheet,
--     which the app shows once and can't be skipped.
--   * Anonymous guests from the first release keep guest_… (they can't vote
--     or use circles anyway).
--   * Circles need a real username.

alter table public.profiles add column username_confirmed boolean not null default false;

-- Names people already chose (first poll, or Edit on the profile) count as confirmed.
update public.profiles set username_confirmed = true where username::text not like 'guest\_%';

-- Usernames: digits and _ count as word breaks for the word filter, so
-- "rudeword22" is caught too.
create or replace function public.username_problem(name text, for_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when name !~ '^[a-z0-9_]{3,20}$' then 'format'
    when name ~ '^(guest_|docchi|admin|support|moderator|official|system)' then 'reserved'
    when public.has_blocked_term(regexp_replace(name, '[_0-9]+', ' ', 'g')) then 'blocked'
    when exists (select 1 from public.profiles p where p.username = name and p.id is distinct from for_user) then 'taken'
    else 'ok'
  end;
$$;
revoke execute on function public.username_problem(text, uuid) from public, anon, authenticated;

-- The first free username built from `seed` (a display name or email), for
-- `for_user`. Never fails: falls back to pollster1234-style names.
create or replace function public.pick_username(seed text, for_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  base text := left(trim(both '_' from regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9]+', '_', 'g')), 14);
  head text := split_part(base, '_', 1);
  c text;
begin
  if length(base) < 3 or public.has_blocked_term(regexp_replace(base, '[_0-9]+', ' ', 'g')) then
    base := 'pollster';
    head := base;
  end if;
  if length(head) < 3 then head := base; end if;
  foreach c in array array[
    base, head, head || '_' || left(split_part(base, '_', 2), 1), head || '_polls',
    base || floor(random() * 90 + 10)::int, head || floor(random() * 900 + 100)::int
  ] loop
    c := left(trim(both '_' from c), 20);
    if public.username_problem(c, for_user) = 'ok' then
      return c;
    end if;
  end loop;
  loop
    c := 'pollster' || floor(random() * 900000 + 100000)::int;
    if public.username_problem(c, for_user) = 'ok' then
      return c;
    end if;
  end loop;
end;
$$;
revoke execute on function public.pick_username(text, uuid) from public, anon, authenticated;

-- Google name → email name, from an auth user's metadata.
create or replace function public.name_seed(meta jsonb, email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(trim(meta ->> 'full_name'), ''),
    nullif(trim(meta ->> 'name'), ''),
    nullif(split_part(coalesce(email, ''), '@', 1), '')
  );
$$;
revoke execute on function public.name_seed(jsonb, text) from public, anon, authenticated;

-- ─── New accounts and guests who link Google ──────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seed text := public.name_seed(new.raw_user_meta_data, new.email);
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    case
      when coalesce(new.is_anonymous, false) or seed is null
        then 'guest_' || substr(replace(new.id::text, '-', ''), 1, 10)
      else public.pick_username(seed, new.id)
    end,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seed text := public.name_seed(new.raw_user_meta_data, new.email);
begin
  -- An automatic name, not one the person chose: leave it unconfirmed.
  perform set_config('docchi.auto_name', 'on', true);
  update public.profiles p
  set avatar_url = coalesce(
        p.avatar_url,
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'),
      -- A guest who just linked Google gets a starting username too.
      username = case
        when p.username::text like 'guest\_%' and not coalesce(new.is_anonymous, false) and seed is not null
          then public.pick_username(seed, new.id)
        else p.username
      end
  where p.id = new.id;
  perform set_config('docchi.auto_name', 'off', true);
  return new;
end;
$$;

-- ─── Fill in names for existing Google accounts (oldest first) ─────────────

do $$
declare
  u record;
begin
  for u in
    select p.id, public.name_seed(a.raw_user_meta_data, a.email) as seed
    from public.profiles p
    join auth.users a on a.id = p.id
    where p.username::text like 'guest\_%'
      and not coalesce(a.is_anonymous, false)
      and public.name_seed(a.raw_user_meta_data, a.email) is not null
    order by p.created_at
  loop
    update public.profiles set username = public.pick_username(u.seed, u.id) where id = u.id;
  end loop;
end;
$$;

-- ─── Read paths ────────────────────────────────────────────────────────────

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'username', case when pr.username::text like 'guest\_%' then null else pr.username::text end,
    'username_confirmed', pr.username_confirmed,
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

-- Free names to offer in the "Pick your @name" sheet.
create or replace function public.username_suggestions(seed text default null)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select public.suggest_usernames(coalesce(
    seed,
    (select public.name_seed(a.raw_user_meta_data, a.email) from auth.users a where a.id = auth.uid())
  ));
$$;
grant execute on function public.username_suggestions(text) to authenticated;

-- ─── Setting the name ──────────────────────────────────────────────────────
-- Confirming the suggested name (same name) or picking a new one both mark it
-- confirmed. The once-a-week limit only applies after it's been confirmed.

create or replace function public.update_username(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_user();
  me public.profiles;
  problem text;
begin
  select * into me from public.profiles where id = uid for update;
  if me.username = lower(name) then
    update public.profiles set username_confirmed = true where id = uid;
    return;
  end if;
  if me.username_confirmed and me.username_changed_at > now() - interval '7 days' then
    raise exception 'docchi:username_too_soon' using errcode = 'P0001';
  end if;
  problem := public.username_problem(lower(coalesce(name, '')), uid);
  if problem <> 'ok' then
    raise exception 'docchi:username_%', problem using errcode = 'P0001';
  end if;
  begin
    update public.profiles
    set username = lower(name),
        username_confirmed = true,
        username_changed_at = case when me.username_confirmed then now() else null end
    where id = uid;
  exception when unique_violation then
    raise exception 'docchi:username_taken' using errcode = 'P0001';
  end;
end;
$$;

-- Picking a username on the first poll also confirms it.
create or replace function public.confirm_username_after_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username::text not like 'guest\_%' and old.username is distinct from new.username
     and coalesce(current_setting('docchi.auto_name', true), 'off') <> 'on' then
    new.username_confirmed := true;
  end if;
  return new;
end;
$$;

create trigger profiles_confirm_username
  before update of username on public.profiles
  for each row
  when (old.username::text like 'guest\_%')
  execute function public.confirm_username_after_poll();

-- ─── Circles need a real username ──────────────────────────────────────────

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
  if exists (select 1 from public.profiles where id = me and username::text like 'guest\_%') then
    raise exception 'docchi:need_username' using errcode = 'P0001';
  end if;
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

-- Requests from guest-named accounts that can't be accepted anymore.
delete from public.circle_members c
using public.profiles p
where p.id = c.member_id and p.username::text like 'guest\_%' and c.status = 'pending';
