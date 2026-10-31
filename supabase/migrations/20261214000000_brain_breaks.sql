-- Brain breaks ("Dimaag lagao 👀"): polls with a right answer, a few a week, written by the content
-- agent, checked by a second AI and approved by the admin like any draft.
--
-- 1. polls.kind 'brain'. The right answer and the one-line why live in brain_answers, which nobody
--    can read directly: brain_reveal gives them only to someone who has voted (or, for a guest, who
--    sends the pick they made), so no one sees the answer before answering.
-- 2. brain_flags: "Wrong answer?" from people who voted, one per person per poll, shown in Admin.
-- 3. agent_settings: brain_per_week (3: Mon, Wed, Fri; 0 turns them off, 7 is daily), brain_hour
--    (13, India time) and brain_sorts_off (kinds turned off). content_drafts: slot 'brain',
--    brain_sort, correct (the right answer's position), answer_why and checked (the second AI got the
--    same answer without being told it). A Brain break draft the second check disagreed with is saved
--    as skipped, only to show why it was dropped.
-- 4. agent_start asks for a Brain break on its days; agent_save, agent_make_poll, admin_drafts,
--    admin_draft_save and admin_agent_settings handle them.
-- 5. brain_reveal, brain_flag and my_brain_score (right answers so far, for your own profile).
--
-- Safe to run twice.

-- ─── 1. Tables and columns ───────────────────────────────────────────────────

alter table public.polls drop constraint if exists polls_kind_check;
alter table public.polls add constraint polls_kind_check check (kind in ('classic', 'hot_take', 'mystery', 'snap', 'brain'));

create table if not exists public.brain_answers (
  poll_id     uuid primary key references public.polls (id) on delete cascade,
  option_id   uuid not null references public.poll_options (id) on delete cascade,
  why         text not null check (char_length(why) between 3 and 200),
  sort        text not null check (sort in ('myth', 'first', 'bigger', 'gk', 'teaser', 'twister', 'guess', 'odd')),
  created_at  timestamptz not null default now()
);

create table if not exists public.brain_flags (
  poll_id     uuid not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.brain_answers enable row level security;
alter table public.brain_flags enable row level security;
revoke all on table public.brain_answers, public.brain_flags from public, anon, authenticated;

alter table public.agent_settings add column if not exists brain_per_week int not null default 3;
alter table public.agent_settings add column if not exists brain_hour int not null default 13;
alter table public.agent_settings add column if not exists brain_sorts_off text[] not null default '{}';
alter table public.agent_settings drop constraint if exists agent_settings_brain_per_week_check;
alter table public.agent_settings add constraint agent_settings_brain_per_week_check check (brain_per_week between 0 and 7);
alter table public.agent_settings drop constraint if exists agent_settings_brain_hour_check;
alter table public.agent_settings add constraint agent_settings_brain_hour_check check (brain_hour between 8 and 22);

alter table public.content_drafts add column if not exists brain_sort text;
alter table public.content_drafts add column if not exists correct int;
alter table public.content_drafts add column if not exists answer_why text;
alter table public.content_drafts add column if not exists checked boolean not null default false;
alter table public.content_drafts drop constraint if exists content_drafts_slot_check;
alter table public.content_drafts add constraint content_drafts_slot_check
  check (slot in ('timely', 'emotional', 'best', 'experiment', 'trend', 'manual', 'brain'));
alter table public.content_drafts drop constraint if exists content_drafts_brain_sort_check;
alter table public.content_drafts add constraint content_drafts_brain_sort_check
  check (brain_sort is null or brain_sort in ('myth', 'first', 'bigger', 'gk', 'teaser', 'twister', 'guess', 'odd'));
alter table public.content_drafts drop constraint if exists content_drafts_correct_check;
alter table public.content_drafts add constraint content_drafts_correct_check check (correct is null or correct between 0 and 3);
alter table public.content_drafts drop constraint if exists content_drafts_answer_why_check;
alter table public.content_drafts add constraint content_drafts_answer_why_check check (answer_why is null or char_length(answer_why) <= 200);

-- ─── 2. Helpers ──────────────────────────────────────────────────────────────

-- Is this India-time day one of the Brain break days? 3 a week: Mon, Wed, Fri.
create or replace function public.brain_day(d date, per_week int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from d)::int = any (case per_week
    when 1 then array[3] when 2 then array[2, 5] when 3 then array[1, 3, 5] when 4 then array[1, 3, 5, 7]
    when 5 then array[1, 2, 3, 4, 5] when 6 then array[1, 2, 3, 4, 5, 6] when 7 then array[1, 2, 3, 4, 5, 6, 7]
    else array[]::int[] end);
$$;
revoke execute on function public.brain_day(date, int) from public, anon, authenticated;

-- How many of those who voted got it right (0–100), or null with no votes yet.
create or replace function public.brain_right_pct(poll uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else round(100.0 * count(*) filter (where v.option_id = b.option_id) / count(*))::int end
  from public.brain_answers b join public.votes v on v.poll_id = b.poll_id
  where b.poll_id = poll;
$$;
revoke execute on function public.brain_right_pct(uuid) from public, anon, authenticated;

-- ─── 3. Old signatures (the new ones take more) ──────────────────────────────

drop function if exists public.admin_agent_settings(boolean, int, int, text, int, text[], boolean, boolean, int, int);
drop function if exists public.admin_draft_save(uuid, text, text[], text, text, boolean, text, text, timestamptz, int, boolean, boolean);

-- ─── 4. The agent and Admin (same as before apart from Brain breaks) ──────────

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
    'status', x.status, 'expires_at', x.expires_at, 'source_at', x.source_at,
    'brain_sort', x.brain_sort, 'correct', x.correct, 'explain', x.answer_why, 'checked', x.checked,
    'flags', (select count(*) from public.brain_flags f where f.poll_id = x.poll_id),
    'right_pct', (select public.brain_right_pct(x.poll_id) where x.poll_id is not null),
    'run_slot', (select r.slot from public.agent_runs r where r.id = x.run_id),
    'run_model', (select r.model from public.agent_runs r where r.id = x.run_id), 'poll_id', x.poll_id, 'created_at', x.created_at, 'posted_at', x.posted_at, 'error', x.error,
    'votes', (select p.vote_count from public.polls p where p.id = x.poll_id),
    'spark', (select l.spark from public.polls p, public.likes_polls(p.created_at - interval '1 minute', p.created_at + interval '1 minute') l
              where p.id = x.poll_id and l.id = p.id));
$$;
revoke execute on function public.agent_draft_json(public.content_drafts) from public, anon, authenticated;

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
  -- A Brain break (a draft with a right answer) is its own kind; the answer goes in brain_answers.
  kind text := case when d.slot = 'brain' and d.correct is not null and d.answer_why is not null then 'brain' else 'classic' end;
begin
  if public.has_blocked_term(d.question || ' ' || array_to_string(d.answers, ' ') || ' ' || coalesce(d.answer_why, '')) then
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
    values (admin.id, d.question, kind, 'public', starts, starts + make_interval(days => d.open_days),
            d.topic, d.feel, d.timely, d.lang, case when d.topic is not null then now() end, case when d.topic is not null then 'ai' end)
    returning id into pid;
  else
    insert into public.polls (question, kind, is_system, featured_on, quiet, created_at, closes_at, topic, feel, timely, lang, tagged_at, tag_source)
    values (d.question, kind, true, featured, not d.notify, starts, starts + make_interval(days => d.open_days),
            d.topic, d.feel, d.timely, d.lang, case when d.topic is not null then now() end, case when d.topic is not null then 'ai' end)
    returning id into pid;
  end if;
  insert into public.poll_options (poll_id, position, text)
  select pid, o.ord - 1, o.text from unnest(d.answers) with ordinality as o(text, ord);
  if kind = 'brain' then
    insert into public.brain_answers (poll_id, option_id, why, sort)
    select pid, o.id, d.answer_why, coalesce(d.brain_sort, 'gk') from public.poll_options o where o.poll_id = pid and o.position = d.correct;
    if not found then
      raise exception 'docchi:answers' using errcode = '22023';
    end if;
  end if;
  return pid;
end;
$$;
revoke execute on function public.agent_make_poll(public.content_drafts, date) from public, anon, authenticated;

create or replace function public.agent_start(secret text, at_time timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- at_time: for tests, the moment to decide for (default now).
  ist timestamp := coalesce(at_time, now()) at time zone 'Asia/Kolkata';
  today date := ist::date;
  s public.agent_settings;
  asked timestamptz := (select a.at from public.app_state a where a.key = 'agent_request');
  last_start timestamptz := (select max(r.started_at) from public.agent_runs r);
  manual boolean;
  rid bigint;
  due_slot text;
  since timestamptz := now() - interval '14 days';
  brain_wanted int := 0;
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
  -- What's due: the morning set (6:30 am), then a refresh at 1 pm and at 6 pm (only the
  -- latest one that's due, so a late morning doesn't fire both). "Write drafts now": a full set.
  if manual then
    due_slot := 'manual';
  elsif s.paused or ist::time < time '06:30' then
    return null;
  elsif not exists (select 1 from public.agent_runs r where r.day = today and r.slot in ('morning', 'manual')) then
    due_slot := 'morning';
  elsif ist::time >= time '18:00' and s.refresh_6pm then
    due_slot := '18';
  elsif ist::time >= time '13:00' and ist::time < time '18:00' and s.refresh_1pm then
    due_slot := '13';
  else
    return null;
  end if;
  if due_slot in ('13', '18') and exists (select 1 from public.agent_runs r where r.day = today and r.slot = due_slot) then
    return null;
  end if;
  -- A Brain break is due on this day's morning (or "Write drafts now") set when today is one of its
  -- days, its time is still more than an hour away, and none is waiting or out for today.
  if due_slot in ('morning', 'manual') and s.brain_per_week > 0 and public.brain_day(today, s.brain_per_week)
     and ist::time < make_time(s.brain_hour - 1, 0, 0)
     and cardinality(s.brain_sorts_off) < 8
     and not exists (select 1 from public.content_drafts d where d.slot = 'brain' and d.status in ('new', 'scheduled', 'posted')
                     and (d.publish_at at time zone 'Asia/Kolkata')::date = today) then
    brain_wanted := 1;
  end if;
  insert into public.agent_runs (day, manual, slot) values (today, manual, due_slot) returning id into rid;
  return (
    with lp as (select * from public.likes_polls(since, now() + interval '1 minute') l where l.spark is not null)
    select jsonb_build_object(
      'run_id', rid,
      'kind', case when due_slot in ('13', '18') then 'refresh' else 'full' end,
      'slot', due_slot,
      'drafts_wanted', case when due_slot in ('13', '18') then s.refresh_drafts else s.drafts_per_day end,
      -- Headlines already read today, so a refresh only writes about new stories.
      'seen_today', (select coalesce(jsonb_agg(distinct lower(left(t.title, 60))), '[]'::jsonb) from public.content_trends t
                     join public.agent_runs r on r.id = t.run_id where r.day = today),
      'now', now(),
      'brain', jsonb_build_object(
        'wanted', brain_wanted,
        'hour', s.brain_hour,
        'sorts', (select coalesce(jsonb_agg(k), '[]'::jsonb) from unnest(array['myth', 'first', 'bigger', 'gk', 'teaser', 'twister', 'guess', 'odd']) k where k <> all (s.brain_sorts_off)),
        -- The ones out lately: their kind and how many got them right, to pick the next kind and how hard.
        'results', (select coalesce(jsonb_agg(jsonb_build_object('sort', y.sort, 'question', y.question, 'votes', y.vote_count, 'right_pct', y.pct) order by y.created_at desc), '[]'::jsonb)
                    from (select b.sort, p.question, p.vote_count, p.created_at, public.brain_right_pct(p.id) as pct
                          from public.brain_answers b join public.polls p on p.id = b.poll_id
                          where p.deleted_at is null order by p.created_at desc limit 12) y),
        'recent', (select coalesce(jsonb_agg(d.question), '[]'::jsonb) from (select x.question from public.content_drafts x
                   where x.slot = 'brain' order by x.created_at desc limit 80) d)),
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
revoke execute on function public.agent_start(text, timestamptz) from public;
grant execute on function public.agent_start(text, timestamptz) to anon, authenticated;

create or replace function public.agent_save(secret text, run_id bigint, drafts jsonb, trends jsonb, error text default null, model text default null)
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
  hours int := (select s.timely_hours from public.agent_settings s where s.id = 1);
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  select * into r from public.agent_runs x where x.id = agent_save.run_id;
  if r.id is null or r.status <> 'running' then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if agent_save.error is not null then
    update public.agent_runs x set status = 'failed', finished_at = now(), error = left(agent_save.error, 300), model = left(agent_save.model, 40) where x.id = r.id;
    return jsonb_build_object('alert', null);
  end if;

  with t as (
    select e.value as v from jsonb_array_elements(case when jsonb_typeof(trends) = 'array' then trends else '[]'::jsonb end) e
    where jsonb_typeof(e.value) = 'object' limit 40
  ), ins as (
    insert into public.content_trends (run_id, source, title, url, idea_question, idea_answers, topic, feel, timely, lang, skip_reason, published_at, region, gloss)
    select r.id, left(coalesce(t.v ->> 'source', 'News'), 40), left(t.v ->> 'title', 200),
           case when t.v ->> 'url' ~ '^https://' then left(t.v ->> 'url', 500) end,
           nullif(left(public.agent_clean_text(t.v ->> 'idea_question'), 140), ''),
           public.agent_clean_answers(public.agent_text_array(t.v -> 'idea_answers')),
           case when t.v ->> 'topic' in ('cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
                 'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun') then t.v ->> 'topic' end,
           case when t.v ->> 'feel' in ('debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny') then t.v ->> 'feel' end,
           coalesce((t.v ->> 'timely')::boolean, true),
           case when t.v ->> 'lang' in ('en', 'hinglish', 'hi', 'other') then t.v ->> 'lang' end,
           nullif(left(t.v ->> 'skip_reason', 120), ''),
           case when t.v ->> 'published_at' ~ '^\d{4}-\d{2}-\d{2}T' then least((t.v ->> 'published_at')::timestamptz, now()) end,
           nullif(left(t.v ->> 'region', 40), ''),
           nullif(left(t.v ->> 'gloss', 120), '')
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
           public.agent_clean_answers(public.agent_text_array(e.value -> 'answers')) as a,
           coalesce(e.value ->> 'slot' = 'brain', false) as brain,
           nullif(left(public.agent_clean_text(e.value ->> 'explain'), 201), '') as ex,
           case when e.value ->> 'correct' ~ '^[0-3]$' then (e.value ->> 'correct')::int end as c
    from jsonb_array_elements(case when jsonb_typeof(drafts) = 'array' then drafts else '[]'::jsonb end) with ordinality e
    where jsonb_typeof(e.value) = 'object'
    limit 12
  ), ok as (
    select d.* from d
    where char_length(d.q) between 3 and 140 and d.a is not null
      and not public.has_blocked_term(d.q || ' ' || array_to_string(d.a, ' ') || ' ' || coalesce(d.ex, ''))
      -- A Brain break needs its kind, a right answer that is one of its answers, and the why.
      and (not d.brain or (d.v ->> 'brain_sort' in ('myth', 'first', 'bigger', 'gk', 'teaser', 'twister', 'guess', 'odd') and d.c < cardinality(d.a)
                           and char_length(d.ex) between 3 and 200))
  ), ins as (
    insert into public.content_drafts (run_id, question, answers, topic, feel, timely, lang, slot, why, source, post_as, publish_at, open_days, source_at, expires_at,
                                       brain_sort, correct, answer_why, checked, status, error)
    select r.id, ok.q, ok.a,
           case when ok.v ->> 'topic' in ('cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
                 'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun') then ok.v ->> 'topic' end,
           case when ok.v ->> 'feel' in ('debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny') then ok.v ->> 'feel' end,
           coalesce((ok.v ->> 'timely')::boolean, false),
           case when ok.v ->> 'lang' in ('en', 'hinglish', 'hi', 'other') then ok.v ->> 'lang' end,
           case when ok.v ->> 'slot' in ('timely', 'emotional', 'best', 'experiment', 'trend', 'brain') then ok.v ->> 'slot' else 'best' end,
           left(ok.v ->> 'why', 240), left(ok.v ->> 'source', 120),
           case when ok.v ->> 'post_as' = 'you' then 'you' else 'eithr' end,
           greatest(coalesce((ok.v ->> 'publish_at')::timestamptz, now() + interval '1 hour'), now() + interval '5 minutes'),
           case when (ok.v ->> 'open_days') in ('1', '3', '7') then (ok.v ->> 'open_days')::int else 1 end,
           case when ok.v ->> 'source_at' ~ '^\d{4}-\d{2}-\d{2}T' then least((ok.v ->> 'source_at')::timestamptz, now()) end,
           -- A timely draft not approved within the set hours (Admin → Drafts settings) expires.
           case when ok.brain then greatest(coalesce((ok.v ->> 'publish_at')::timestamptz, now() + interval '1 hour'), now() + interval '5 minutes') + interval '5 hours'
                when coalesce((ok.v ->> 'timely')::boolean, false) then now() + make_interval(hours => hours) end,
           case when ok.brain then ok.v ->> 'brain_sort' end,
           case when ok.brain then ok.c end,
           case when ok.brain then ok.ex end,
           ok.brain and (ok.v -> 'checked') = 'true'::jsonb,
           -- A Brain break the second check didn't agree with is kept only to show why it was dropped.
           case when ok.brain and (ok.v -> 'checked') is distinct from 'true'::jsonb then 'skipped' else 'new' end,
           case when ok.brain and (ok.v -> 'checked') is distinct from 'true'::jsonb then coalesce(nullif(left(ok.v ->> 'drop_reason', 120), ''), 'The two checks disagreed') end
    from ok order by ok.i
    returning question, status
  )
  select count(*) filter (where ins.status = 'new'), (array_agg(ins.question) filter (where ins.status = 'new'))[1] into n_drafts, top from ins;

  update public.agent_runs x set status = 'done', finished_at = now(), drafts = n_drafts, trends = n_trends, model = left(agent_save.model, 40) where x.id = r.id;
  if n_drafts = 0 or admin is null then
    return jsonb_build_object('alert', null, 'drafts', n_drafts, 'trends', n_trends);
  end if;
  return jsonb_build_object(
    'drafts', n_drafts, 'trends', n_trends,
    'alert', jsonb_build_object('title', case when r.slot in ('13', '18') then '🆕 ' || n_drafts || ' fresh ' || case when n_drafts = 1 then 'draft' else 'drafts' end
                                             else '✍️ ' || n_drafts || ' drafts ready' end,
                                'body', 'Top pick: ' || public.quote_q(top),
                                'url', '/admin#drafts', 'tag', 'agent-drafts'),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                from public.push_subscriptions s where s.user_id = admin));
end;
$$;
revoke execute on function public.agent_save(text, bigint, jsonb, jsonb, text, text) from public;
grant execute on function public.agent_save(text, bigint, jsonb, jsonb, text, text) to anon, authenticated;

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
                                   'post_as', s.post_as, 'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off),
                                   'refresh_1pm', s.refresh_1pm, 'refresh_6pm', s.refresh_6pm, 'refresh_drafts', s.refresh_drafts,
                                   'timely_hours', s.timely_hours, 'brain_per_week', s.brain_per_week, 'brain_hour', s.brain_hour,
                                   'brain_sorts_off', to_jsonb(s.brain_sorts_off)),
    -- Brain breaks the second check dropped today, and the last ones out with how many got them right.
    'brain_dropped', (select coalesce(jsonb_agg(jsonb_build_object('question', x.question, 'brain_sort', x.brain_sort, 'error', x.error) order by x.created_at desc), '[]'::jsonb)
                      from public.content_drafts x where x.slot = 'brain' and x.status = 'skipped' and x.decided_at is null
                        and (x.created_at at time zone 'Asia/Kolkata')::date = today),
    'brain_out', (select coalesce(jsonb_agg(jsonb_build_object('poll_id', y.id, 'question', y.question, 'sort', y.sort, 'votes', y.vote_count,
                    'right_pct', public.brain_right_pct(y.id), 'flags', (select count(*) from public.brain_flags f where f.poll_id = y.id),
                    'created_at', y.created_at) order by y.created_at desc), '[]'::jsonb)
                  from (select p.id, p.question, p.vote_count, p.created_at, b.sort from public.brain_answers b join public.polls p on p.id = b.poll_id
                        where p.deleted_at is null order by p.created_at desc limit 8) y),
    'expired_today', (select coalesce(jsonb_agg(jsonb_build_object('question', x.question, 'expires_at', x.expires_at) order by x.expires_at desc), '[]'::jsonb)
                      from public.content_drafts x where x.status = 'expired' and x.expires_at is not null
                        and (x.expires_at at time zone 'Asia/Kolkata')::date = today),
    'last_run', (select jsonb_build_object('started_at', r.started_at, 'finished_at', r.finished_at, 'status', r.status,
                                           'drafts', r.drafts, 'trends', r.trends, 'error', r.error, 'manual', r.manual,
                                           'slot', r.slot, 'model', r.model)
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

create or replace function public.admin_agent_settings(
  paused boolean default null, drafts_per_day int default null, posts_per_day int default null,
  post_as text default null, hinglish int default null, topics_off text[] default null,
  refresh_1pm boolean default null, refresh_6pm boolean default null, refresh_drafts int default null,
  timely_hours int default null, brain_per_week int default null, brain_hour int default null, brain_sorts_off text[] default null
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
     or refresh_drafts is not null and refresh_drafts not between 1 and 5
     or timely_hours is not null and timely_hours not between 2 and 48
     or brain_per_week is not null and brain_per_week not between 0 and 7
     or brain_hour is not null and brain_hour not between 8 and 22
     or brain_sorts_off is not null and exists (select 1 from unnest(brain_sorts_off) t where t not in ('myth', 'first', 'bigger', 'gk', 'teaser', 'twister', 'guess', 'odd'))
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
      refresh_1pm = coalesce(admin_agent_settings.refresh_1pm, a.refresh_1pm),
      refresh_6pm = coalesce(admin_agent_settings.refresh_6pm, a.refresh_6pm),
      refresh_drafts = coalesce(admin_agent_settings.refresh_drafts, a.refresh_drafts),
      timely_hours = coalesce(admin_agent_settings.timely_hours, a.timely_hours),
      brain_per_week = coalesce(admin_agent_settings.brain_per_week, a.brain_per_week),
      brain_hour = coalesce(admin_agent_settings.brain_hour, a.brain_hour),
      brain_sorts_off = coalesce(admin_agent_settings.brain_sorts_off, a.brain_sorts_off),
      updated_at = now()
  where a.id = 1
  returning * into s;
  perform public.admin_event('agent', case when s.paused then 'Paused · ' else '' end || s.drafts_per_day || ' drafts, '
    || s.posts_per_day || ' posts a day, as ' || s.post_as || ', Hinglish ' || s.hinglish || '%'
    || case when cardinality(s.topics_off) > 0 then ', off: ' || array_to_string(s.topics_off, ', ') else '' end
    || ', refresh ' || concat_ws(' + ', case when s.refresh_1pm then '1 pm' end, case when s.refresh_6pm then '6 pm' end, case when not s.refresh_1pm and not s.refresh_6pm then 'off' end)
    || ' (' || s.refresh_drafts || '), timely ' || s.timely_hours || 'h'
    || ', Brain breaks ' || s.brain_per_week || '/week at ' || s.brain_hour || ':00'
    || case when cardinality(s.brain_sorts_off) > 0 then ' (off: ' || array_to_string(s.brain_sorts_off, ', ') || ')' else '' end);
  return jsonb_build_object('paused', s.paused, 'drafts_per_day', s.drafts_per_day, 'posts_per_day', s.posts_per_day,
                            'post_as', s.post_as, 'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off),
                            'refresh_1pm', s.refresh_1pm, 'refresh_6pm', s.refresh_6pm, 'refresh_drafts', s.refresh_drafts,
                            'timely_hours', s.timely_hours, 'brain_per_week', s.brain_per_week, 'brain_hour', s.brain_hour,
                            'brain_sorts_off', to_jsonb(s.brain_sorts_off));
end;
$$;
revoke execute on function public.admin_agent_settings(boolean, int, int, text, int, text[], boolean, boolean, int, int, int, int, text[]) from public, anon;
grant execute on function public.admin_agent_settings(boolean, int, int, text, int, text[], boolean, boolean, int, int, int, int, text[]) to authenticated;

create or replace function public.admin_draft_save(
  draft uuid, question text, answers text[], topic text, feel text, timely boolean, lang text,
  post_as text, publish_at timestamptz, open_days int, poll_of_day boolean, notify boolean,
  correct int default null, answer_why text default null
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
  ex text := nullif(left(public.agent_clean_text(answer_why), 201), '');
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
  -- A Brain break keeps a right answer (one of its answers) and the why.
  if x.slot = 'brain' and (correct is null or correct not between 0 and cardinality(a) - 1 or char_length(coalesce(ex, '')) not between 3 and 200) then
    raise exception 'docchi:brain_answer' using errcode = '22023';
  end if;
  if public.has_blocked_term(q || ' ' || array_to_string(a, ' ') || ' ' || coalesce(ex, '')) then
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
      correct = case when x.slot = 'brain' then admin_draft_save.correct end,
      answer_why = case when x.slot = 'brain' then ex end,
      poll_of_day = coalesce(admin_draft_save.poll_of_day, false) and admin_draft_save.post_as = 'eithr' and x.status = 'new',
      notify = coalesce(admin_draft_save.notify, false) and admin_draft_save.post_as = 'eithr'
  where d.id = x.id
  returning * into x;
  return public.agent_draft_json(x);
end;
$$;
revoke execute on function public.admin_draft_save(uuid, text, text[], text, text, boolean, text, text, timestamptz, int, boolean, boolean, int, text) from public, anon;
grant execute on function public.admin_draft_save(uuid, text, text[], text, text, boolean, text, text, timestamptz, int, boolean, boolean, int, text) to authenticated;


-- ─── 5. For people ───────────────────────────────────────────────────────────

-- The right answer and why, once you've answered: your vote, or for a guest (whose vote isn't
-- saved until they sign in) the pick they made. Also after the poll closes. Null otherwise.
create or replace function public.brain_reveal(poll uuid, pick uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p public.polls;
  b public.brain_answers;
  mine uuid;
begin
  select * into p from public.polls x where x.id = poll;
  if p.id is null or p.kind <> 'brain' or p.deleted_at is not null or p.is_hidden or not public.can_view_poll(poll, uid) then
    return null;
  end if;
  select * into b from public.brain_answers x where x.poll_id = poll;
  if b.poll_id is null then
    return null;
  end if;
  if uid is not null then
    select v.option_id into mine from public.votes v where v.poll_id = poll and v.user_id = uid;
  end if;
  if mine is null and pick is not null and exists (select 1 from public.poll_options o where o.id = pick and o.poll_id = poll) then
    mine := pick;
  end if;
  if mine is null and p.closes_at > now() and not coalesce(public.is_admin_user(uid), false) then
    return null;
  end if;
  return jsonb_build_object('option_id', b.option_id, 'why', b.why, 'sort', b.sort,
    'right', case when mine is null then null else mine = b.option_id end,
    'right_pct', public.brain_right_pct(poll),
    'flagged', uid is not null and exists (select 1 from public.brain_flags f where f.poll_id = poll and f.user_id = uid));
end;
$$;
revoke execute on function public.brain_reveal(uuid, uuid) from public;
grant execute on function public.brain_reveal(uuid, uuid) to anon, authenticated;

-- "Wrong answer?": someone who voted thinks the answer is wrong. Once per person per poll.
create or replace function public.brain_flag(poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'docchi:sign_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.brain_answers b join public.votes v on v.poll_id = b.poll_id
                 where b.poll_id = poll and v.user_id = uid) then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  insert into public.brain_flags (poll_id, user_id) values (poll, uid) on conflict do nothing;
end;
$$;
revoke execute on function public.brain_flag(uuid) from public, anon;
grant execute on function public.brain_flag(uuid) to authenticated;

-- Your own Brain break score, for the teaser on your profile (nobody else sees it).
create or replace function public.my_brain_score()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('right', count(*) filter (where v.option_id = b.option_id), 'tried', count(*))
  from public.brain_answers b join public.votes v on v.poll_id = b.poll_id
  where v.user_id = auth.uid();
$$;
revoke execute on function public.my_brain_score() from public, anon;
grant execute on function public.my_brain_score() to authenticated;
