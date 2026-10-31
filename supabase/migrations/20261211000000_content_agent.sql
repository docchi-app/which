-- The content agent: every morning it reads what's trending in India and what people liked on
-- Eithr, and writes poll drafts. Nothing posts until the admin approves it.
--
-- 1. Tables: agent_settings (one row), agent_runs, content_trends (what it read, with a poll
--    idea each), content_calendar (days coming up; a few fixed ones to start, the admin adds
--    more), content_drafts (new → scheduled → posted, or skipped / expired / failed).
-- 2. polls.quiet: a poll Eithr posts from a draft doesn't send "New on Eithr" to everyone unless
--    the draft says to (a trigger drops those notifications; push_scan is unchanged).
-- 3. The job (PUSH_CRON_SECRET): agent_start (is a run due? 6:30 am India time, or "Write
--    drafts now"), agent_save (drafts and trends in; the admin's push out), post_due_drafts
--    (approved drafts go live at their time; old ones expire).
-- 4. The admin: admin_drafts, admin_draft_save, admin_drafts_approve, admin_drafts_skip,
--    admin_draft_unschedule, admin_agent_settings, admin_agent_request, admin_trends,
--    admin_draft_from_trend, admin_calendar_add, admin_calendar_remove.
--
-- Safe to run twice.

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.agent_settings (
  id              int primary key default 1 check (id = 1),
  paused          boolean not null default false,
  drafts_per_day  int not null default 8 check (drafts_per_day between 4 and 12),
  posts_per_day   int not null default 4 check (posts_per_day between 1 and 8),
  post_as         text not null default 'eithr' check (post_as in ('eithr', 'you')),
  hinglish        int not null default 50 check (hinglish between 0 and 100),
  topics_off      text[] not null default '{}',
  updated_at      timestamptz not null default now()
);
insert into public.agent_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.agent_runs (
  id           bigint generated always as identity primary key,
  day          date not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'done', 'failed')),
  manual       boolean not null default false,
  drafts       int not null default 0,
  trends       int not null default 0,
  error        text
);
create index if not exists agent_runs_day_idx on public.agent_runs (day desc, started_at desc);

create table if not exists public.content_trends (
  id             bigint generated always as identity primary key,
  run_id         bigint references public.agent_runs (id) on delete cascade,
  created_at     timestamptz not null default now(),
  source         text not null,
  title          text not null,
  url            text,
  idea_question  text,
  idea_answers   text[],
  topic          text,
  feel           text,
  timely         boolean not null default true,
  lang           text,
  skip_reason    text,
  drafted        boolean not null default false
);
create index if not exists content_trends_run_idx on public.content_trends (run_id);

create table if not exists public.content_calendar (
  id        bigint generated always as identity primary key,
  day       date not null,
  label     text not null check (char_length(label) between 2 and 60),
  added_by  text not null default 'admin' check (added_by in ('seed', 'admin')),
  unique (day, label)
);

-- Fixed-date days only (festivals that move each year are for the admin to add).
insert into public.content_calendar (day, label, added_by) values
  ('2026-11-08', 'Diwali', 'seed'),
  ('2026-11-14', 'Children''s Day', 'seed'),
  ('2026-12-25', 'Christmas', 'seed'),
  ('2026-12-31', 'New Year''s Eve', 'seed'),
  ('2027-01-01', 'New Year', 'seed'),
  ('2027-01-13', 'Lohri', 'seed'),
  ('2027-01-26', 'Republic Day', 'seed'),
  ('2027-02-14', 'Valentine''s Day', 'seed'),
  ('2027-03-08', 'Women''s Day', 'seed'),
  ('2027-04-01', 'April Fools'' Day', 'seed'),
  ('2027-06-21', 'Yoga Day', 'seed'),
  ('2027-08-15', 'Independence Day', 'seed'),
  ('2027-09-05', 'Teachers'' Day', 'seed'),
  ('2027-10-02', 'Gandhi Jayanti', 'seed'),
  ('2027-10-31', 'Halloween', 'seed')
on conflict (day, label) do nothing;

create table if not exists public.content_drafts (
  id           uuid primary key default gen_random_uuid(),
  run_id       bigint references public.agent_runs (id) on delete set null,
  created_at   timestamptz not null default now(),
  question     text not null check (char_length(question) between 3 and 140),
  answers      text[] not null check (cardinality(answers) between 2 and 4),
  topic        text,
  feel         text,
  timely       boolean not null default false,
  lang         text,
  slot         text not null default 'manual' check (slot in ('timely', 'emotional', 'best', 'experiment', 'trend', 'manual')),
  why          text,
  source       text,
  post_as      text not null default 'eithr' check (post_as in ('eithr', 'you')),
  publish_at   timestamptz not null,
  open_days    int not null default 1 check (open_days in (1, 3, 7)),
  poll_of_day  boolean not null default false,
  notify       boolean not null default false,
  status       text not null default 'new' check (status in ('new', 'scheduled', 'posted', 'skipped', 'expired', 'failed')),
  poll_id      uuid references public.polls (id) on delete set null,
  decided_at   timestamptz,
  posted_at    timestamptz,
  error        text,
  check (topic is null or topic in ('cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
                                    'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun')),
  check (feel is null or feel in ('debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny')),
  check (lang is null or lang in ('en', 'hinglish', 'hi', 'other'))
);
create index if not exists content_drafts_status_idx on public.content_drafts (status, publish_at);

alter table public.agent_settings enable row level security;
alter table public.agent_runs enable row level security;
alter table public.content_trends enable row level security;
alter table public.content_calendar enable row level security;
alter table public.content_drafts enable row level security;
revoke all on table public.agent_settings, public.agent_runs, public.content_trends, public.content_calendar, public.content_drafts
  from public, anon, authenticated;

-- ─── 2. Quiet polls ──────────────────────────────────────────────────────────

alter table public.polls add column if not exists quiet boolean not null default false;

-- push_scan makes "New on Eithr" notifications (dedupe 'docpoll:<poll>:<person>') for every
-- Eithr poll that goes live; a quiet one makes none. Internal.
create or replace function public.skip_quiet_poll_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dedupe like 'docpoll:%' and exists (
      select 1 from public.polls p
      where p.quiet and p.id::text = split_part(new.dedupe, ':', 2)) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.skip_quiet_poll_notice() from public, anon, authenticated;
drop trigger if exists notifications_skip_quiet on public.notifications;
create trigger notifications_skip_quiet before insert on public.notifications
  for each row execute function public.skip_quiet_poll_notice();

-- ─── Shared pieces (internal) ────────────────────────────────────────────────

-- Answers cleaned the way create_poll does: trimmed, 1–40 characters, no repeats, 2–4 of them.
-- Null when they don't pass.
create or replace function public.agent_clean_answers(answers text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text[] := '{}';
  a text;
begin
  foreach a in array coalesce(answers, '{}') loop
    a := regexp_replace(trim(coalesce(a, '')), '\s+', ' ', 'g');
    continue when a = '';
    if char_length(a) > 40 or lower(a) = any (select lower(x) from unnest(clean) x) then
      return null;
    end if;
    clean := clean || a;
  end loop;
  return case when cardinality(clean) between 2 and 4 then clean end;
end;
$$;
revoke execute on function public.agent_clean_answers(text[]) from public, anon, authenticated;

-- A JSON list of strings as text[] (anything else: empty). Internal.
create or replace function public.agent_text_array(j jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'array'
              then array(select x.v #>> '{}' from jsonb_array_elements(j) x(v) where jsonb_typeof(x.v) = 'string')
              else '{}'::text[] end;
$$;
revoke execute on function public.agent_text_array(jsonb) from public, anon, authenticated;

create or replace function public.agent_clean_text(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(trim(coalesce(input, '')), '\s+', ' ', 'g');
$$;
revoke execute on function public.agent_clean_text(text) from public, anon, authenticated;

-- Makes the poll for a draft: Eithr's (system) or the admin's own, tagged from the draft.
-- featured: the Poll of the Day date (Eithr only), starting at that day's start (or now).
create or replace function public.agent_make_poll(d public.content_drafts, featured date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin public.profiles;
  pid uuid;
  starts timestamptz := now();
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if public.has_blocked_term(d.question || ' ' || array_to_string(d.answers, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;
  if featured is not null then
    if featured < today then
      raise exception 'docchi:past_day' using errcode = '22023';
    end if;
    if exists (select 1 from public.polls x where x.featured_on = featured and x.deleted_at is null) then
      raise exception 'docchi:day_taken' using errcode = '23505';
    end if;
    update public.polls x set featured_on = null where x.featured_on = featured and x.deleted_at is not null;
    starts := case when featured = today then now() else featured::timestamp at time zone 'Asia/Kolkata' end;
  end if;
  if d.post_as = 'you' then
    select * into admin from public.profiles p where p.is_admin limit 1;
    if admin.id is null or admin.username::text like 'guest\_%' then
      raise exception 'docchi:no_username' using errcode = 'P0001';
    end if;
    insert into public.polls (creator_id, question, kind, visibility, created_at, closes_at, topic, feel, timely, lang, tagged_at, tag_source)
    values (admin.id, d.question, 'classic', 'public', starts, starts + make_interval(days => d.open_days),
            d.topic, d.feel, d.timely, d.lang, case when d.topic is not null then now() end, case when d.topic is not null then 'ai' end)
    returning id into pid;
  else
    insert into public.polls (question, kind, is_system, featured_on, quiet, created_at, closes_at, topic, feel, timely, lang, tagged_at, tag_source)
    values (d.question, 'classic', true, featured, not d.notify, starts, starts + make_interval(days => d.open_days),
            d.topic, d.feel, d.timely, d.lang, case when d.topic is not null then now() end, case when d.topic is not null then 'ai' end)
    returning id into pid;
  end if;
  insert into public.poll_options (poll_id, position, text)
  select pid, o.ord - 1, o.text from unnest(d.answers) with ordinality as o(text, ord);
  return pid;
end;
$$;
revoke execute on function public.agent_make_poll(public.content_drafts, date) from public, anon, authenticated;

-- Drafts going out on one India-time day (scheduled or posted).
create or replace function public.agent_posts_on(d date, not_id uuid default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.content_drafts x
  where x.status in ('scheduled', 'posted') and (x.publish_at at time zone 'Asia/Kolkata')::date = d
    and x.id is distinct from not_id;
$$;
revoke execute on function public.agent_posts_on(date, uuid) from public, anon, authenticated;

create or replace function public.agent_draft_json(x public.content_drafts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', x.id, 'question', x.question, 'answers', to_jsonb(x.answers), 'topic', x.topic, 'feel', x.feel,
    'timely', x.timely, 'lang', x.lang, 'slot', x.slot, 'why', x.why, 'source', x.source, 'post_as', x.post_as,
    'publish_at', x.publish_at, 'open_days', x.open_days, 'poll_of_day', x.poll_of_day, 'notify', x.notify,
    'status', x.status, 'poll_id', x.poll_id, 'created_at', x.created_at, 'posted_at', x.posted_at, 'error', x.error,
    'votes', (select p.vote_count from public.polls p where p.id = x.poll_id),
    'spark', (select l.spark from public.polls p, public.likes_polls(p.created_at - interval '1 minute', p.created_at + interval '1 minute') l
              where p.id = x.poll_id and l.id = p.id));
$$;
revoke execute on function public.agent_draft_json(public.content_drafts) from public, anon, authenticated;

-- ─── 3. The job ──────────────────────────────────────────────────────────────

-- A run is due at 6:30 am India time once a day (unless paused), or when the admin asked
-- ("Write drafts now"). Returns null, or what the agent needs to write. Job only.
create or replace function public.agent_start(secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ist timestamp := now() at time zone 'Asia/Kolkata';
  today date := ist::date;
  s public.agent_settings;
  asked timestamptz := (select a.at from public.app_state a where a.key = 'agent_request');
  last_start timestamptz := (select max(r.started_at) from public.agent_runs r);
  manual boolean;
  rid bigint;
  since timestamptz := now() - interval '14 days';
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('eithr.agent')) then
    return null;
  end if;
  -- A run that never finished (the function was stopped) counts as failed after 10 minutes.
  update public.agent_runs r set status = 'failed', finished_at = now(), error = coalesce(r.error, 'Stopped before it finished')
  where r.status = 'running' and r.started_at < now() - interval '10 minutes';
  if exists (select 1 from public.agent_runs r where r.status = 'running') then
    return null;
  end if;
  select * into s from public.agent_settings where id = 1;
  manual := asked is not null and asked > coalesce(last_start, '-infinity');
  if not manual and (s.paused or ist::time < time '06:30'
                     or exists (select 1 from public.agent_runs r where r.day = today and not r.manual)) then
    return null;
  end if;
  insert into public.agent_runs (day, manual) values (today, manual) returning id into rid;
  return (
    with lp as (select * from public.likes_polls(since, now() + interval '1 minute') l where l.spark is not null)
    select jsonb_build_object(
      'run_id', rid,
      'now', now(),
      'today', today,
      'settings', jsonb_build_object('drafts_per_day', s.drafts_per_day, 'posts_per_day', s.posts_per_day, 'post_as', s.post_as,
                                     'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off)),
      'scored', (select count(*) from lp),
      'topics', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s) order by t.s desc), '[]'::jsonb)
                 from (select lp.topic as k, count(*) as n, round(avg(lp.spark)) as s from lp where lp.topic is not null group by lp.topic) t),
      'feels', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s) order by t.s desc), '[]'::jsonb)
                from (select lp.feel as k, count(*) as n, round(avg(lp.spark)) as s from lp where lp.feel is not null group by lp.feel) t),
      'combos', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'feel', t.feel, 'n', t.n, 'spark', t.s) order by t.s desc), '[]'::jsonb)
                 from (select lp.topic, lp.feel, count(*) as n, round(avg(lp.spark)) as s from lp
                       where lp.topic is not null and lp.feel is not null group by lp.topic, lp.feel order by 4 desc limit 12) t),
      'langs', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s)), '[]'::jsonb)
                from (select lp.lang as k, count(*) as n, round(avg(lp.spark)) as s from lp where lp.lang is not null group by lp.lang) t),
      -- Questions only from public polls (never friends-only or link polls).
      'best', (select coalesce(jsonb_agg(b.question), '[]'::jsonb) from (select lp.question from lp where lp.visibility = 'public' order by lp.spark desc limit 8) b),
      -- Recent questions, so it doesn't repeat itself or Eithr.
      'recent', (select coalesce(jsonb_agg(q.question), '[]'::jsonb) from (
                   (select p.question from public.polls p where (p.is_system or p.creator_id in (select pr.id from public.profiles pr where pr.is_admin))
                      and p.visibility = 'public' and p.created_at > now() - interval '45 days' and p.deleted_at is null order by p.created_at desc limit 60)
                   union
                   (select d.question from public.content_drafts d where d.created_at > now() - interval '30 days' order by d.created_at desc limit 60)) q),
      'calendar', (select coalesce(jsonb_agg(jsonb_build_object('day', c.day, 'label', c.label) order by c.day), '[]'::jsonb)
                   from public.content_calendar c where c.day between today and today + 14),
      'open_slots', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d, 'taken', public.agent_posts_on(g.d))), '[]'::jsonb)
                     from (select generate_series(today, today + 1, interval '1 day')::date as d) g)
    )
  );
end;
$$;
revoke execute on function public.agent_start(text) from public;
grant execute on function public.agent_start(text) to anon, authenticated;

-- The run's drafts and the trends it read. Drafts that don't pass the same checks as a poll
-- (length, answers, blocked words) are left out. Returns the admin's push ("8 drafts ready")
-- when there are drafts. error: the run failed. Job only.
create or replace function public.agent_save(secret text, run_id bigint, drafts jsonb, trends jsonb, error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
  n_drafts int := 0;
  n_trends int := 0;
  admin uuid := (select p.id from public.profiles p where p.is_admin limit 1);
  top text;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  select * into r from public.agent_runs x where x.id = agent_save.run_id;
  if r.id is null or r.status <> 'running' then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if agent_save.error is not null then
    update public.agent_runs x set status = 'failed', finished_at = now(), error = left(agent_save.error, 300) where x.id = r.id;
    return jsonb_build_object('alert', null);
  end if;

  with t as (
    select e.value as v from jsonb_array_elements(case when jsonb_typeof(trends) = 'array' then trends else '[]'::jsonb end) e
    where jsonb_typeof(e.value) = 'object' limit 40
  ), ins as (
    insert into public.content_trends (run_id, source, title, url, idea_question, idea_answers, topic, feel, timely, lang, skip_reason)
    select r.id, left(coalesce(t.v ->> 'source', 'News'), 40), left(t.v ->> 'title', 200),
           case when t.v ->> 'url' ~ '^https://' then left(t.v ->> 'url', 500) end,
           nullif(left(public.agent_clean_text(t.v ->> 'idea_question'), 140), ''),
           public.agent_clean_answers(public.agent_text_array(t.v -> 'idea_answers')),
           case when t.v ->> 'topic' in ('cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
                 'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun') then t.v ->> 'topic' end,
           case when t.v ->> 'feel' in ('debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny') then t.v ->> 'feel' end,
           coalesce((t.v ->> 'timely')::boolean, true),
           case when t.v ->> 'lang' in ('en', 'hinglish', 'hi', 'other') then t.v ->> 'lang' end,
           nullif(left(t.v ->> 'skip_reason', 120), '')
    from t where coalesce(t.v ->> 'title', '') <> ''
    returning 1
  )
  select count(*) into n_trends from ins;
  -- An idea with blocked words, or for a skipped story, has no idea.
  update public.content_trends c set idea_question = null, idea_answers = null
  where c.run_id = r.id and (c.skip_reason is not null or c.idea_answers is null
        or public.has_blocked_term(coalesce(c.idea_question, '') || ' ' || array_to_string(coalesce(c.idea_answers, '{}'), ' ')));

  with d as (
    select e.value as v, e.ordinality as i,
           left(public.agent_clean_text(e.value ->> 'question'), 141) as q,
           public.agent_clean_answers(public.agent_text_array(e.value -> 'answers')) as a
    from jsonb_array_elements(case when jsonb_typeof(drafts) = 'array' then drafts else '[]'::jsonb end) with ordinality e
    where jsonb_typeof(e.value) = 'object'
    limit 12
  ), ok as (
    select d.* from d
    where char_length(d.q) between 3 and 140 and d.a is not null
      and not public.has_blocked_term(d.q || ' ' || array_to_string(d.a, ' '))
  ), ins as (
    insert into public.content_drafts (run_id, question, answers, topic, feel, timely, lang, slot, why, source, post_as, publish_at, open_days)
    select r.id, ok.q, ok.a,
           case when ok.v ->> 'topic' in ('cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
                 'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun') then ok.v ->> 'topic' end,
           case when ok.v ->> 'feel' in ('debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny') then ok.v ->> 'feel' end,
           coalesce((ok.v ->> 'timely')::boolean, false),
           case when ok.v ->> 'lang' in ('en', 'hinglish', 'hi', 'other') then ok.v ->> 'lang' end,
           case when ok.v ->> 'slot' in ('timely', 'emotional', 'best', 'experiment', 'trend') then ok.v ->> 'slot' else 'best' end,
           left(ok.v ->> 'why', 240), left(ok.v ->> 'source', 120),
           case when ok.v ->> 'post_as' = 'you' then 'you' else 'eithr' end,
           greatest(coalesce((ok.v ->> 'publish_at')::timestamptz, now() + interval '1 hour'), now() + interval '5 minutes'),
           case when (ok.v ->> 'open_days') in ('1', '3', '7') then (ok.v ->> 'open_days')::int else 1 end
    from ok order by ok.i
    returning question
  )
  select count(*), (array_agg(ins.question))[1] into n_drafts, top from ins;

  update public.agent_runs x set status = 'done', finished_at = now(), drafts = n_drafts, trends = n_trends where x.id = r.id;
  if n_drafts = 0 or admin is null then
    return jsonb_build_object('alert', null, 'drafts', n_drafts, 'trends', n_trends);
  end if;
  return jsonb_build_object(
    'drafts', n_drafts, 'trends', n_trends,
    'alert', jsonb_build_object('title', '✍️ ' || n_drafts || ' drafts ready', 'body', 'Top pick: ' || public.quote_q(top),
                                'url', '/admin#drafts', 'tag', 'agent-drafts'),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                from public.push_subscriptions s where s.user_id = admin));
end;
$$;
revoke execute on function public.agent_save(text, bigint, jsonb, jsonb, text) from public;
grant execute on function public.agent_save(text, bigint, jsonb, jsonb, text) to anon, authenticated;

-- Approved drafts whose time has come go live; new drafts older than 3 days expire; trends
-- and runs are kept 14 and 90 days. Returns how many went live. Job only.
create or replace function public.post_due_drafts(secret text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.content_drafts;
  pid uuid;
  n int := 0;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  for d in select * from public.content_drafts x where x.status = 'scheduled' and x.publish_at <= now()
           order by x.publish_at limit 10 for update skip locked loop
    begin
      pid := public.agent_make_poll(d);
      update public.content_drafts x set status = 'posted', poll_id = pid, posted_at = now(), error = null where x.id = d.id;
      n := n + 1;
    exception when others then
      update public.content_drafts x set status = 'failed', error = coalesce(substring(sqlerrm from 'docchi:(\w+)'), left(sqlerrm, 200))
      where x.id = d.id;
    end;
  end loop;
  update public.content_drafts x set status = 'expired' where x.status = 'new' and x.created_at < now() - interval '3 days';
  delete from public.content_trends t where t.created_at < now() - interval '14 days';
  delete from public.agent_runs r where r.started_at < now() - interval '90 days';
  return n;
end;
$$;
revoke execute on function public.post_due_drafts(text) from public;
grant execute on function public.post_due_drafts(text) to anon, authenticated;

-- ─── 4. The admin ────────────────────────────────────────────────────────────

create or replace function public.admin_drafts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.agent_settings;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_admin();
  select * into s from public.agent_settings where id = 1;
  return jsonb_build_object(
    'new', (select coalesce(jsonb_agg(public.agent_draft_json(x) order by x.publish_at), '[]'::jsonb)
            from public.content_drafts x where x.status = 'new'),
    'scheduled', (select coalesce(jsonb_agg(public.agent_draft_json(x) order by x.publish_at), '[]'::jsonb)
                  from public.content_drafts x where x.status = 'scheduled'),
    'posted', (select coalesce(jsonb_agg(public.agent_draft_json(y.x) order by (y.x).posted_at desc), '[]'::jsonb) from (
                 select x from public.content_drafts x where x.status in ('posted', 'failed') order by coalesce(x.posted_at, x.created_at) desc limit 20) y),
    'settings', jsonb_build_object('paused', s.paused, 'drafts_per_day', s.drafts_per_day, 'posts_per_day', s.posts_per_day,
                                   'post_as', s.post_as, 'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off)),
    'last_run', (select jsonb_build_object('started_at', r.started_at, 'finished_at', r.finished_at, 'status', r.status,
                                           'drafts', r.drafts, 'trends', r.trends, 'error', r.error, 'manual', r.manual)
                 from public.agent_runs r order by r.started_at desc limit 1),
    'requested_at', (select a.at from public.app_state a where a.key = 'agent_request'),
    'today_posts', public.agent_posts_on(today),
    'tomorrow_posts', public.agent_posts_on(today + 1),
    'admin_username', (select case when p.username::text like 'guest\_%' then null else p.username::text end
                       from public.profiles p where p.is_admin limit 1)
  );
end;
$$;
revoke execute on function public.admin_drafts() from public, anon;
grant execute on function public.admin_drafts() to authenticated;

-- Change a draft (new or scheduled). Admin only.
create or replace function public.admin_draft_save(
  draft uuid, question text, answers text[], topic text, feel text, timely boolean, lang text,
  post_as text, publish_at timestamptz, open_days int, poll_of_day boolean, notify boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.content_drafts;
  q text := left(public.agent_clean_text(question), 141);
  a text[] := public.agent_clean_answers(answers);
begin
  perform public.require_admin();
  select * into x from public.content_drafts d where d.id = draft for update;
  if x.id is null or x.status not in ('new', 'scheduled') then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if char_length(q) not between 3 and 140 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;
  if a is null then
    raise exception 'docchi:answers' using errcode = '22023';
  end if;
  if public.has_blocked_term(q || ' ' || array_to_string(a, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;
  if coalesce(post_as, '') not in ('eithr', 'you') then
    raise exception 'docchi:post_as' using errcode = '22023';
  end if;
  if coalesce(open_days, 0) not in (1, 3, 7) then
    raise exception 'docchi:duration' using errcode = '22023';
  end if;
  if publish_at is null or publish_at > now() + interval '14 days' then
    raise exception 'docchi:when' using errcode = '22023';
  end if;
  if x.status = 'scheduled' and (publish_at at time zone 'Asia/Kolkata')::date <> (x.publish_at at time zone 'Asia/Kolkata')::date
     and public.agent_posts_on((publish_at at time zone 'Asia/Kolkata')::date, x.id) >= (select s.posts_per_day from public.agent_settings s where s.id = 1) then
    raise exception 'docchi:day_full' using errcode = 'P0001';
  end if;
  update public.content_drafts d
  set question = q, answers = a, topic = admin_draft_save.topic, feel = admin_draft_save.feel, timely = coalesce(admin_draft_save.timely, false),
      lang = admin_draft_save.lang, post_as = admin_draft_save.post_as, publish_at = greatest(admin_draft_save.publish_at, now()),
      open_days = admin_draft_save.open_days,
      poll_of_day = coalesce(admin_draft_save.poll_of_day, false) and admin_draft_save.post_as = 'eithr' and x.status = 'new',
      notify = coalesce(admin_draft_save.notify, false) and admin_draft_save.post_as = 'eithr'
  where d.id = x.id
  returning * into x;
  return public.agent_draft_json(x);
end;
$$;
revoke execute on function public.admin_draft_save(uuid, text, text[], text, text, boolean, text, text, timestamptz, int, boolean, boolean) from public, anon;
grant execute on function public.admin_draft_save(uuid, text, text[], text, text, boolean, text, text, timestamptz, int, boolean, boolean) to authenticated;

-- Approve drafts as they are: each is scheduled for its time (a time already past goes out
-- within 2 minutes), or, for a Poll of the Day, made at once for that day. A day already at
-- its "most posts a day" leaves the draft as it is (day_full). Admin only.
create or replace function public.admin_drafts_approve(ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.content_drafts;
  cap int := (select s.posts_per_day from public.agent_settings s where s.id = 1);
  d date;
  pid uuid;
  done int := 0;
  problems jsonb := '[]'::jsonb;
begin
  perform public.require_admin();
  for x in select * from public.content_drafts c where c.id = any(coalesce(ids, '{}')) and c.status = 'new'
           order by c.publish_at for update loop
    if x.publish_at < now() then
      x.publish_at := now();
    end if;
    d := (x.publish_at at time zone 'Asia/Kolkata')::date;
    if not x.poll_of_day and public.agent_posts_on(d) >= cap then
      problems := problems || jsonb_build_object('id', x.id, 'error', 'day_full');
      continue;
    end if;
    if x.poll_of_day then
      begin
        pid := public.agent_make_poll(x, d);
      exception when others then
        problems := problems || jsonb_build_object('id', x.id, 'error', coalesce(substring(sqlerrm from 'docchi:(\w+)'), 'failed'));
        continue;
      end;
      update public.content_drafts c set status = 'posted', poll_id = pid, posted_at = now(), decided_at = now(), publish_at = x.publish_at
      where c.id = x.id;
    else
      update public.content_drafts c set status = 'scheduled', decided_at = now(), publish_at = x.publish_at where c.id = x.id;
    end if;
    done := done + 1;
  end loop;
  if done > 0 then
    perform public.admin_event('drafts', 'Approved ' || done || case when done = 1 then ' draft' else ' drafts' end);
  end if;
  return jsonb_build_object('approved', done, 'problems', problems);
end;
$$;
revoke execute on function public.admin_drafts_approve(uuid[]) from public, anon;
grant execute on function public.admin_drafts_approve(uuid[]) to authenticated;

create or replace function public.admin_drafts_skip(ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform public.require_admin();
  update public.content_drafts c set status = 'skipped', decided_at = now()
  where c.id = any(coalesce(ids, '{}')) and c.status = 'new';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.admin_drafts_skip(uuid[]) from public, anon;
grant execute on function public.admin_drafts_skip(uuid[]) to authenticated;

-- A scheduled draft back to the list (until it's posted). Admin only.
create or replace function public.admin_draft_unschedule(draft uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.content_drafts c set status = 'new', decided_at = null where c.id = draft and c.status = 'scheduled';
  if not found then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.admin_draft_unschedule(uuid) from public, anon;
grant execute on function public.admin_draft_unschedule(uuid) to authenticated;

-- What the agent writes (null keeps a setting). Each change goes in the admin log. Admin only.
create or replace function public.admin_agent_settings(
  paused boolean default null, drafts_per_day int default null, posts_per_day int default null,
  post_as text default null, hinglish int default null, topics_off text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.agent_settings;
begin
  perform public.require_admin();
  if drafts_per_day is not null and drafts_per_day not between 4 and 12
     or posts_per_day is not null and posts_per_day not between 1 and 8
     or hinglish is not null and hinglish not between 0 and 100
     or post_as is not null and post_as not in ('eithr', 'you')
     or topics_off is not null and exists (select 1 from unnest(topics_off) t where t not in (
          'cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
          'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun')) then
    raise exception 'docchi:out_of_range' using errcode = '22023';
  end if;
  update public.agent_settings a
  set paused = coalesce(admin_agent_settings.paused, a.paused),
      drafts_per_day = coalesce(admin_agent_settings.drafts_per_day, a.drafts_per_day),
      posts_per_day = coalesce(admin_agent_settings.posts_per_day, a.posts_per_day),
      post_as = coalesce(admin_agent_settings.post_as, a.post_as),
      hinglish = coalesce(admin_agent_settings.hinglish, a.hinglish),
      topics_off = coalesce(admin_agent_settings.topics_off, a.topics_off),
      updated_at = now()
  where a.id = 1
  returning * into s;
  perform public.admin_event('agent', case when s.paused then 'Paused · ' else '' end || s.drafts_per_day || ' drafts, '
    || s.posts_per_day || ' posts a day, as ' || s.post_as || ', Hinglish ' || s.hinglish || '%'
    || case when cardinality(s.topics_off) > 0 then ', off: ' || array_to_string(s.topics_off, ', ') else '' end);
  return jsonb_build_object('paused', s.paused, 'drafts_per_day', s.drafts_per_day, 'posts_per_day', s.posts_per_day,
                            'post_as', s.post_as, 'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off));
end;
$$;
revoke execute on function public.admin_agent_settings(boolean, int, int, text, int, text[]) from public, anon;
grant execute on function public.admin_agent_settings(boolean, int, int, text, int, text[]) to authenticated;

-- "Write drafts now": the next 2-minute run writes a fresh set. Admin only.
create or replace function public.admin_agent_request()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  insert into public.app_state (key, at) values ('agent_request', now())
  on conflict (key) do update set at = excluded.at;
  return now();
end;
$$;
revoke execute on function public.admin_agent_request() from public, anon;
grant execute on function public.admin_agent_request() to authenticated;

-- Trending now: what the last run read, and the days coming up. Admin only.
create or replace function public.admin_trends()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid bigint := (select r.id from public.agent_runs r where r.status = 'done' and r.trends > 0 order by r.started_at desc limit 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'read_at', (select r.started_at from public.agent_runs r where r.id = rid),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'source', t.source, 'title', t.title, 'url', t.url,
                'idea_question', t.idea_question, 'idea_answers', to_jsonb(t.idea_answers), 'topic', t.topic, 'feel', t.feel,
                'timely', t.timely, 'lang', t.lang, 'skip_reason', t.skip_reason, 'drafted', t.drafted)
                order by (t.skip_reason is not null), t.id), '[]'::jsonb)
              from public.content_trends t where t.run_id = rid),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'day', c.day, 'label', c.label, 'added_by', c.added_by) order by c.day), '[]'::jsonb)
                 from public.content_calendar c where c.day between today and today + 60)
  );
end;
$$;
revoke execute on function public.admin_trends() from public, anon;
grant execute on function public.admin_trends() to authenticated;

-- A trend's poll idea into Drafts (for today 8 pm India time, or in an hour if that's past).
create or replace function public.admin_draft_from_trend(trend bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.content_trends;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  at8 timestamptz := (today + time '20:00') at time zone 'Asia/Kolkata';
  did uuid;
begin
  perform public.require_admin();
  select * into t from public.content_trends c where c.id = trend for update;
  if t.id is null or t.idea_question is null or t.idea_answers is null or t.skip_reason is not null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if t.drafted then
    raise exception 'docchi:already_drafted' using errcode = '23505';
  end if;
  insert into public.content_drafts (run_id, question, answers, topic, feel, timely, lang, slot, why, source, post_as, publish_at, open_days)
  values (t.run_id, t.idea_question, t.idea_answers, t.topic, t.feel, t.timely, t.lang, 'trend',
          'From Trending now: ' || left(t.title, 120), t.source,
          (select s.post_as from public.agent_settings s where s.id = 1),
          case when at8 > now() + interval '10 minutes' then at8 else now() + interval '1 hour' end,
          case when t.timely then 1 else 3 end)
  returning id into did;
  update public.content_trends c set drafted = true where c.id = t.id;
  return did;
end;
$$;
revoke execute on function public.admin_draft_from_trend(bigint) from public, anon;
grant execute on function public.admin_draft_from_trend(bigint) to authenticated;

create or replace function public.admin_calendar_add(on_day date, label_text text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  l text := public.agent_clean_text(label_text);
  cid bigint;
begin
  perform public.require_admin();
  if on_day is null or on_day < (now() at time zone 'Asia/Kolkata')::date or on_day > (now() at time zone 'Asia/Kolkata')::date + 400 then
    raise exception 'docchi:bad_day' using errcode = '22023';
  end if;
  if char_length(l) not between 2 and 60 then
    raise exception 'docchi:label_length' using errcode = '22023';
  end if;
  insert into public.content_calendar (day, label) values (on_day, l)
  on conflict on constraint content_calendar_day_label_key do nothing
  returning id into cid;
  return cid;
end;
$$;
revoke execute on function public.admin_calendar_add(date, text) from public, anon;
grant execute on function public.admin_calendar_add(date, text) to authenticated;

create or replace function public.admin_calendar_remove(entry bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.content_calendar c where c.id = entry;
end;
$$;
revoke execute on function public.admin_calendar_remove(bigint) from public, anon;
grant execute on function public.admin_calendar_remove(bigint) to authenticated;
