-- Fresh drafts through the day: refresh runs at 1 pm and 6 pm India time, timely drafts that
-- expire, headline ages, and which model wrote each run.
--
-- 1. agent_settings: refresh_1pm, refresh_6pm (both on), refresh_drafts (3, 1–5) and
--    timely_hours (12, 2–48: a timely draft not approved by then expires).
-- 2. agent_runs.slot ('morning', '13', '18', 'manual') and .model (which AI wrote it: OpenAI, or
--    Sarvam when OpenAI failed). agent_start runs the morning set at 6:30, then the latest refresh
--    that's due, once each a day; a refresh gets today's headlines so it writes only about new ones.
-- 3. content_trends: published_at (the headline's own time), region and an English gloss for
--    trends in other languages. content_drafts: source_at (its headline's time) and expires_at.
-- 4. agent_save takes the model; a refresh's push says "🆕 N fresh drafts". admin_drafts shows the
--    refresh settings and today's expired drafts; admin_trends lists every run of the day.
--
-- Same functions as 20261211000000_content_agent.sql apart from those changes. Safe to run twice.

alter table public.agent_settings add column if not exists refresh_1pm boolean not null default true;
alter table public.agent_settings add column if not exists refresh_6pm boolean not null default true;
alter table public.agent_settings add column if not exists refresh_drafts int not null default 3;
alter table public.agent_settings add column if not exists timely_hours int not null default 12;
alter table public.agent_settings drop constraint if exists agent_settings_refresh_drafts_check;
alter table public.agent_settings add constraint agent_settings_refresh_drafts_check check (refresh_drafts between 1 and 5);
alter table public.agent_settings drop constraint if exists agent_settings_timely_hours_check;
alter table public.agent_settings add constraint agent_settings_timely_hours_check check (timely_hours between 2 and 48);

alter table public.agent_runs add column if not exists slot text;
alter table public.agent_runs add column if not exists model text;
update public.agent_runs set slot = case when manual then 'manual' else 'morning' end where slot is null;
alter table public.agent_runs alter column slot set default 'morning';
alter table public.agent_runs drop constraint if exists agent_runs_slot_check;
alter table public.agent_runs add constraint agent_runs_slot_check check (slot in ('morning', '13', '18', 'manual'));

alter table public.content_trends add column if not exists published_at timestamptz;
alter table public.content_trends add column if not exists region text;
alter table public.content_trends add column if not exists gloss text;

alter table public.content_drafts add column if not exists source_at timestamptz;
alter table public.content_drafts add column if not exists expires_at timestamptz;

-- The old signatures (one parameter fewer) would stay alongside the new ones.
drop function if exists public.agent_save(text, bigint, jsonb, jsonb, text);
drop function if exists public.agent_start(text);
drop function if exists public.admin_agent_settings(boolean, int, int, text, int, text[]);

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
    'run_slot', (select r.slot from public.agent_runs r where r.id = x.run_id),
    'run_model', (select r.model from public.agent_runs r where r.id = x.run_id), 'poll_id', x.poll_id, 'created_at', x.created_at, 'posted_at', x.posted_at, 'error', x.error,
    'votes', (select p.vote_count from public.polls p where p.id = x.poll_id),
    'spark', (select l.spark from public.polls p, public.likes_polls(p.created_at - interval '1 minute', p.created_at + interval '1 minute') l
              where p.id = x.poll_id and l.id = p.id));
$$;
revoke execute on function public.agent_draft_json(public.content_drafts) from public, anon, authenticated;

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
           public.agent_clean_answers(public.agent_text_array(e.value -> 'answers')) as a
    from jsonb_array_elements(case when jsonb_typeof(drafts) = 'array' then drafts else '[]'::jsonb end) with ordinality e
    where jsonb_typeof(e.value) = 'object'
    limit 12
  ), ok as (
    select d.* from d
    where char_length(d.q) between 3 and 140 and d.a is not null
      and not public.has_blocked_term(d.q || ' ' || array_to_string(d.a, ' '))
  ), ins as (
    insert into public.content_drafts (run_id, question, answers, topic, feel, timely, lang, slot, why, source, post_as, publish_at, open_days, source_at, expires_at)
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
           case when (ok.v ->> 'open_days') in ('1', '3', '7') then (ok.v ->> 'open_days')::int else 1 end,
           case when ok.v ->> 'source_at' ~ '^\d{4}-\d{2}-\d{2}T' then least((ok.v ->> 'source_at')::timestamptz, now()) end,
           -- A timely draft not approved within the set hours (Admin → Drafts settings) expires.
           case when coalesce((ok.v ->> 'timely')::boolean, false) then now() + make_interval(hours => hours) end
    from ok order by ok.i
    returning question
  )
  select count(*), (array_agg(ins.question))[1] into n_drafts, top from ins;

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
  update public.content_drafts x set status = 'expired'
  where x.status = 'new' and (x.expires_at < now() or x.created_at < now() - interval '3 days');
  delete from public.content_trends t where t.created_at < now() - interval '14 days';
  delete from public.agent_runs r where r.started_at < now() - interval '90 days';
  return n;
end;
$$;
revoke execute on function public.post_due_drafts(text) from public;
grant execute on function public.post_due_drafts(text) to anon, authenticated;

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
                                   'timely_hours', s.timely_hours),
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
  timely_hours int default null
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
      updated_at = now()
  where a.id = 1
  returning * into s;
  perform public.admin_event('agent', case when s.paused then 'Paused · ' else '' end || s.drafts_per_day || ' drafts, '
    || s.posts_per_day || ' posts a day, as ' || s.post_as || ', Hinglish ' || s.hinglish || '%'
    || case when cardinality(s.topics_off) > 0 then ', off: ' || array_to_string(s.topics_off, ', ') else '' end
    || ', refresh ' || concat_ws(' + ', case when s.refresh_1pm then '1 pm' end, case when s.refresh_6pm then '6 pm' end, case when not s.refresh_1pm and not s.refresh_6pm then 'off' end)
    || ' (' || s.refresh_drafts || '), timely ' || s.timely_hours || 'h');
  return jsonb_build_object('paused', s.paused, 'drafts_per_day', s.drafts_per_day, 'posts_per_day', s.posts_per_day,
                            'post_as', s.post_as, 'hinglish', s.hinglish, 'topics_off', to_jsonb(s.topics_off),
                            'refresh_1pm', s.refresh_1pm, 'refresh_6pm', s.refresh_6pm, 'refresh_drafts', s.refresh_drafts,
                            'timely_hours', s.timely_hours);
end;
$$;
revoke execute on function public.admin_agent_settings(boolean, int, int, text, int, text[], boolean, boolean, int, int) from public, anon;
grant execute on function public.admin_agent_settings(boolean, int, int, text, int, text[], boolean, boolean, int, int) to authenticated;

create or replace function public.admin_trends()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid bigint := (select r.id from public.agent_runs r where r.status = 'done' and r.trends > 0 order by r.started_at desc limit 1);
  -- Every run that read headlines on the day of the latest one (the morning set plus refreshes).
  rday date := (select r.day from public.agent_runs r where r.id = rid);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'read_at', (select r.started_at from public.agent_runs r where r.id = rid),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'source', t.source, 'title', t.title, 'url', t.url,
                'idea_question', t.idea_question, 'idea_answers', to_jsonb(t.idea_answers), 'topic', t.topic, 'feel', t.feel,
                'timely', t.timely, 'lang', t.lang, 'skip_reason', t.skip_reason, 'drafted', t.drafted,
                'published_at', t.published_at, 'region', t.region, 'gloss', t.gloss, 'run_slot', t.slot, 'read_at', t.started_at)
                order by (t.skip_reason is not null), t.started_at desc, t.id), '[]'::jsonb)
              -- Each story once, as it was first read that day (a second full run reads the same ones).
              from (select distinct on (lower(left(c.title, 60))) c.*, r.slot, r.started_at
                    from public.content_trends c join public.agent_runs r on r.id = c.run_id
                    where r.day = rday and r.status = 'done'
                    order by lower(left(c.title, 60)), r.started_at, c.id) t),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'day', c.day, 'label', c.label, 'added_by', c.added_by) order by c.day), '[]'::jsonb)
                 from public.content_calendar c where c.day between today and today + 60)
  );
end;
$$;
revoke execute on function public.admin_trends() from public, anon;
grant execute on function public.admin_trends() to authenticated;

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
  insert into public.content_drafts (run_id, question, answers, topic, feel, timely, lang, slot, why, source, post_as, publish_at, open_days, source_at, expires_at)
  values (t.run_id, t.idea_question, t.idea_answers, t.topic, t.feel, t.timely, t.lang, 'trend',
          'From Trending now: ' || left(t.title, 120), t.source,
          (select s.post_as from public.agent_settings s where s.id = 1),
          case when at8 > now() + interval '10 minutes' then at8 else now() + interval '1 hour' end,
          case when t.timely then 1 else 3 end, t.published_at,
          case when t.timely then now() + make_interval(hours => (select s.timely_hours from public.agent_settings s where s.id = 1)) end)
  returning id into did;
  update public.content_trends c set drafted = true where c.id = t.id;
  return did;
end;
$$;
revoke execute on function public.admin_draft_from_trend(bigint) from public, anon;
grant execute on function public.admin_draft_from_trend(bigint) to authenticated;
