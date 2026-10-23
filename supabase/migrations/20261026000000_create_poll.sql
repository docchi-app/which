-- Create poll: anyone signed in (not a guest), up to 5 polls a rolling 24h.
-- The first poll also sets the username (everyone starts as guest_…).
-- Everything the form checks is checked again here.

-- ─── Word filter ───────────────────────────────────────────────────────────
-- Whole-word, case-insensitive. Admins can add rows; the admin panel will
-- manage this later.

create table public.blocked_terms (
  term text primary key check (term ~ '^[a-z0-9 ]+$')
);
alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

insert into public.blocked_terms (term) values
  ('fuck'), ('fucking'), ('fucker'), ('motherfucker'), ('shit'), ('bullshit'),
  ('bitch'), ('cunt'), ('dick'), ('pussy'), ('asshole'), ('bastard'),
  ('whore'), ('slut'), ('retard'), ('nigger'), ('nigga'), ('faggot'), ('fag'),
  ('rape'), ('rapist'),
  ('madarchod'), ('maderchod'), ('behenchod'), ('bhenchod'), ('benchod'),
  ('chutiya'), ('chutiye'), ('chutia'), ('gandu'), ('randi'), ('bhosdike'),
  ('bhosdi'), ('bhosda'), ('lund'), ('lauda'), ('loda'), ('harami'), ('kutiya'),
  ('chodu'), ('chod')
on conflict do nothing;

create or replace function public.has_blocked_term(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocked_terms b
    where lower(input) ~ ('\m' || b.term || '\M')
  );
$$;

revoke execute on function public.has_blocked_term(text) from public, anon, authenticated;

-- ─── Usernames ─────────────────────────────────────────────────────────────

-- 'ok', or why a username can't be used: format | reserved | blocked | taken.
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
    when public.has_blocked_term(replace(name, '_', ' ')) then 'blocked'
    when exists (select 1 from public.profiles p where p.username = name and p.id is distinct from for_user) then 'taken'
    else 'ok'
  end;
$$;

revoke execute on function public.username_problem(text, uuid) from public, anon, authenticated;

-- Up to 3 free usernames built from `seed` (a name or a taken username).
create or replace function public.suggest_usernames(seed text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base text := left(trim(both '_' from regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9]+', '_', 'g')), 14);
  head text := split_part(base, '_', 1);
  candidates text[];
  picks text[] := '{}';
  c text;
begin
  if length(base) < 3 then base := 'pollster'; end if;
  if length(head) < 3 then head := base; end if;
  candidates := array[
    base,
    head,
    head || '_polls',
    base || floor(random() * 90 + 10)::int,
    head || '_' || floor(random() * 900 + 100)::int,
    'the_' || head,
    head || '_says',
    base || floor(random() * 9000 + 1000)::int
  ];
  foreach c in array candidates loop
    c := left(c, 20);
    if public.username_problem(c, auth.uid()) = 'ok' and not c = any(picks) then
      picks := picks || c;
    end if;
    exit when cardinality(picks) = 3;
  end loop;
  return picks;
end;
$$;

revoke execute on function public.suggest_usernames(text) from public, anon, authenticated;

-- What the Create screen needs up front.
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
  suggestions text[];
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into me from public.profiles where id = uid;
  select count(*) into posted from public.polls
    where creator_id = uid and created_at > now() - interval '24 hours';
  if me.username::text like 'guest\_%' then
    suggestions := public.suggest_usernames(name_seed);
  end if;
  return jsonb_build_object(
    'signed_in', true,
    'username', case when me.username::text like 'guest\_%' then null else me.username::text end,
    'suggestions', to_jsonb(coalesce(suggestions, '{}')),
    'polls_left', greatest(5 - posted, 0)
  );
end;
$$;

grant execute on function public.create_poll_status(text) to authenticated;

-- Live check while typing a username.
create or replace function public.check_username(name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problem text := public.username_problem(lower(name), auth.uid());
begin
  return jsonb_build_object(
    'problem', problem,
    'suggestions', to_jsonb(case when problem in ('taken', 'reserved', 'blocked')
                                 then public.suggest_usernames(name) else '{}'::text[] end)
  );
end;
$$;

grant execute on function public.check_username(text) to authenticated;

-- ─── Create poll ───────────────────────────────────────────────────────────
-- Errors are raised as 'docchi:<code>' so the app can show a friendly message.

create or replace function public.create_poll(
  question text,
  answers text[],
  days int,
  username text default null
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

  if (select count(*) from public.polls
      where creator_id = uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'docchi:daily_limit' using errcode = 'P0001';
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

  if days not in (1, 3, 7) then
    raise exception 'docchi:duration' using errcode = '22023';
  end if;

  if public.has_blocked_term(q || ' ' || array_to_string(clean, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;

  insert into public.polls (creator_id, question, closes_at)
  values (uid, q, now() + make_interval(days => days))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text
  from unnest(clean) with ordinality as o(text, ord);

  return new_id;
end;
$$;

revoke execute on function public.create_poll(text, text[], int, text) from public, anon;
grant execute on function public.create_poll(text, text[], int, text) to authenticated;
