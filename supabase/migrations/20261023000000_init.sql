-- Docchi: initial schema.
-- Data model from docs/poll-app-validation.md. `users` lives in public.profiles,
-- one row per auth.users row (Supabase owns auth.users).

create extension if not exists citext;

-- ─── Tables ────────────────────────────────────────────────────────────────

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    citext not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  avatar_url  text,
  is_admin    boolean not null default false,
  is_banned   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.polls (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid references public.profiles (id) on delete set null,
  question     text not null check (char_length(question) between 3 and 140),
  is_system    boolean not null default false,
  -- Date this poll is Poll of the Day (system polls only). One per day.
  featured_on  date unique,
  vote_count   integer not null default 0,
  share_count  integer not null default 0,
  is_hidden    boolean not null default false,
  created_at   timestamptz not null default now(),
  closes_at    timestamptz not null default now() + interval '3 days',
  check (closes_at > created_at)
);

create index polls_created_at_idx on public.polls (created_at desc) where not is_hidden;

create table public.poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls (id) on delete cascade,
  position    smallint not null check (position between 0 and 3),
  text        text not null check (char_length(text) between 1 and 60),
  vote_count  integer not null default 0,
  unique (poll_id, position)
);

create table public.votes (
  poll_id     uuid not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  option_id   uuid not null references public.poll_options (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id)          -- one vote per person, enforced here
);

create index votes_user_idx on public.votes (user_id, created_at desc);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 200),
  created_at  timestamptz not null default now(),
  -- Hidden from the app after this; the row is kept for moderation review.
  expires_at  timestamptz not null default now() + interval '24 hours',
  is_hidden   boolean not null default false
);

create index comments_poll_idx on public.comments (poll_id, created_at desc);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('poll', 'comment', 'user')),
  target_id    uuid not null,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (char_length(reason) between 1 and 500),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (target_type, target_id, reporter_id)
);

-- ─── Row level security ────────────────────────────────────────────────────
-- Clients read through RLS; every write goes through the functions below.

alter table public.profiles     enable row level security;
alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes        enable row level security;
alter table public.comments     enable row level security;
alter table public.reports      enable row level security;

create policy "profiles are public" on public.profiles
  for select using (true);

create policy "visible polls are public" on public.polls
  for select using (not is_hidden);

create policy "options of visible polls are public" on public.poll_options
  for select using (
    exists (select 1 from public.polls p where p.id = poll_id and not p.is_hidden)
  );

create policy "you can see your own votes" on public.votes
  for select using (user_id = auth.uid());

create policy "live comments are public" on public.comments
  for select using (not is_hidden and expires_at > now());

-- reports: no client policies yet (admin panel comes later).

-- Results stay hidden until you vote, so per-option counts are never readable
-- straight from the table. They come from get_feed / cast_vote only.
revoke all on public.poll_options from anon, authenticated;
grant select (id, poll_id, position, text) on public.poll_options to anon, authenticated;

revoke insert, update, delete on public.profiles, public.polls, public.votes,
  public.comments, public.reports from anon, authenticated;

-- ─── New user → profile ────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    'guest_' || substr(replace(new.id::text, '-', ''), 1, 10),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Feed ──────────────────────────────────────────────────────────────────
-- One row per poll, options as JSON. Option counts are null until the caller
-- has voted or the poll has closed.

create or replace function public.get_feed(tab text default 'trending', max_rows int default 30)
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
       from public.poll_options o where o.poll_id = b.id)
  from base b
  left join public.profiles pr on pr.id = b.creator_id
  order by
    coalesce(b.featured_today, false) desc,
    case when tab = 'new' then extract(epoch from b.created_at)
         -- Hacker News-style decay; good enough until a scheduled job keeps a score.
         else (b.vote_count + 1) / power(extract(epoch from now() - b.created_at) / 3600 + 2, 1.5)
    end desc
  limit least(greatest(max_rows, 1), 100);
$$;

grant execute on function public.get_feed(text, int) to anon, authenticated;

-- ─── Voting ────────────────────────────────────────────────────────────────
-- Saves the vote and bumps both counters in one transaction, then returns the
-- results. Voting twice returns the existing results without counting again.

create or replace function public.cast_vote(target_poll uuid, target_option uuid)
returns table (my_option_id uuid, vote_count integer, options jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inserted int;
begin
  if uid is null then
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
         from public.poll_options o where o.poll_id = target_poll)
    from public.polls p
    join public.votes v on v.poll_id = p.id and v.user_id = uid
    where p.id = target_poll;
end;
$$;

revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;
