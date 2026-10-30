-- What people like: every poll gets three tags, and Admin → Content → What people like
-- adds up how each tag does.
--
-- 1. Tags on polls: topic (cricket, food, …), feel (debate, emotional, …), timely or
--    evergreen, and language (English, Hinglish, Hindi). The 2-minute job asks the AI for
--    them (polls_to_tag → set_poll_tags), newest first, so old polls get tagged too, about
--    600 an hour. The admin can change a poll's tags; the AI then leaves that poll alone.
-- 2. Spark: a score out of 100 per poll from how many who saw it voted (40), shares per
--    vote (25), comments per vote (20) and how close the result was (15). Needs 5 people
--    to have seen it.
-- 3. admin_likes(days): Spark by topic, feel, topic + feel, language, time of day, timing
--    and who posted (Eithr, the admin, people), the best polls, and recent tags to check.
--    Test accounts' polls are left out; the admin's own count, as "you".
--
-- Safe to run twice.

-- ─── 1. Tags ─────────────────────────────────────────────────────────────────

alter table public.polls add column if not exists topic text;
alter table public.polls add column if not exists feel text;
alter table public.polls add column if not exists timely boolean;
alter table public.polls add column if not exists lang text;
alter table public.polls add column if not exists tagged_at timestamptz;
alter table public.polls add column if not exists tag_source text;
alter table public.polls add column if not exists tag_tries smallint not null default 0;

alter table public.polls drop constraint if exists polls_topic_check;
alter table public.polls add constraint polls_topic_check check (topic is null or topic in (
  'cricket', 'sports', 'movies', 'music', 'tv', 'celebs', 'food', 'festivals', 'travel', 'fashion',
  'college', 'work', 'tech', 'science', 'relationships', 'family', 'daily', 'news', 'fun'));
alter table public.polls drop constraint if exists polls_feel_check;
alter table public.polls add constraint polls_feel_check check (feel is null or feel in (
  'debate', 'relatable', 'emotional', 'nostalgia', 'would_you', 'predict', 'quiz', 'funny'));
alter table public.polls drop constraint if exists polls_lang_check;
alter table public.polls add constraint polls_lang_check check (lang is null or lang in ('en', 'hinglish', 'hi', 'other'));
alter table public.polls drop constraint if exists polls_tag_source_check;
alter table public.polls add constraint polls_tag_source_check check (tag_source is null or tag_source in ('ai', 'admin'));

create index if not exists polls_untagged_idx on public.polls (created_at desc)
  where tagged_at is null and deleted_at is null;

-- For the 2-minute job: polls without tags, newest first (3 tries each). Job only.
create or replace function public.polls_to_tag(secret text, max_rows int default 20)
returns table (id uuid, kind text, question text, teaser text, options text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  return query
  select p.id, p.kind, p.question, p.teaser,
         array(select o.text from public.poll_options o where o.poll_id = p.id order by o.position)
  from public.polls p
  where p.tagged_at is null and p.deleted_at is null and not p.is_hidden and p.tag_tries < 3
  order by p.created_at desc
  limit greatest(least(coalesce(max_rows, 20), 50), 1);
end;
$$;
revoke execute on function public.polls_to_tag(text, int) from public;
grant execute on function public.polls_to_tag(text, int) to anon, authenticated;

-- The AI's tags for one poll (topic null: it couldn't tag it, try again later). A poll the
-- admin tagged is left as it is. Job only.
create or replace function public.set_poll_tags(secret text, poll uuid, topic text, feel text, timely boolean, lang text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  if set_poll_tags.topic is null then
    update public.polls p set tag_tries = p.tag_tries + 1 where p.id = poll and p.tagged_at is null;
    return;
  end if;
  update public.polls p
  set topic = set_poll_tags.topic, feel = set_poll_tags.feel, timely = coalesce(set_poll_tags.timely, false),
      lang = set_poll_tags.lang, tagged_at = now(), tag_source = 'ai'
  where p.id = poll and p.tag_source is distinct from 'admin';
end;
$$;
revoke execute on function public.set_poll_tags(text, uuid, text, text, boolean, text) from public;
grant execute on function public.set_poll_tags(text, uuid, text, text, boolean, text) to anon, authenticated;

-- The admin changes a poll's tags (goes in the admin log). Admin only.
create or replace function public.admin_set_poll_tags(poll uuid, topic text, feel text, timely boolean, lang text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text;
begin
  perform public.require_admin();
  update public.polls p
  set topic = admin_set_poll_tags.topic, feel = admin_set_poll_tags.feel, timely = coalesce(admin_set_poll_tags.timely, false),
      lang = admin_set_poll_tags.lang, tagged_at = now(), tag_source = 'admin'
  where p.id = poll
  returning p.question into q;
  if q is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  perform public.admin_event('tags', left(q, 60) || ' → ' || coalesce(admin_set_poll_tags.topic, '–') || ' · '
                                     || coalesce(admin_set_poll_tags.feel, '–'));
end;
$$;
revoke execute on function public.admin_set_poll_tags(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_set_poll_tags(uuid, text, text, boolean, text) to authenticated;

-- ─── 2. Spark ────────────────────────────────────────────────────────────────

-- Out of 100: voted ÷ saw (60% or more: 40), shares per vote (10% or more: 25), comments per
-- vote (15% or more: 20), and closeness (an even split: 15; one answer taking everything: 0;
-- under 5 votes: 7.5). Null under 5 people who saw it. Internal.
create or replace function public.poll_spark(views int, votes int, shares int, comments int, top_votes int, answers int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when greatest(coalesce(views, 0), coalesce(votes, 0)) < 5 then null else round(
      least(1, (votes::numeric / greatest(views, votes)) / 0.6) * 40
    + least(1, (coalesce(shares, 0)::numeric / greatest(votes, 1)) / 0.1) * 25
    + least(1, (coalesce(comments, 0)::numeric / greatest(votes, 1)) / 0.15) * 20
    + case when votes < 5 or coalesce(answers, 0) < 2 then 7.5
           else greatest(0, least(1, 1 - ((top_votes::numeric / votes) - 1.0 / answers) / (1 - 1.0 / answers))) * 15 end
  ) end;
$$;
revoke execute on function public.poll_spark(int, int, int, int, int, int) from public, anon, authenticated;

-- Every poll posted in a stretch of time, with its tags and Spark. Test accounts' polls,
-- deleted and hidden ones are left out. Internal.
create or replace function public.likes_polls(from_at timestamptz, to_at timestamptz)
returns table (id uuid, question text, kind text, visibility text, who text, author text, topic text, feel text,
               timely boolean, lang text, created_at timestamptz, views int, votes int, shares int, comments int,
               split text, spark numeric, tag_source text)
language sql
stable
security definer
set search_path = ''
as $$
  with ps as (
    select q.*, pr.is_admin as by_admin, pr.username::text as uname,
           (select count(*)::int from public.comments c where c.poll_id = q.id and not c.is_hidden) as n_comments,
           (select coalesce(max(o.vote_count), 0) from public.poll_options o where o.poll_id = q.id) as top_votes,
           (select count(*)::int from public.poll_options o where o.poll_id = q.id) as n_answers,
           (select coalesce(sum(o.vote_count), 0) from public.poll_options o where o.poll_id = q.id) as answer_votes
    from public.polls q
    left join public.profiles pr on pr.id = q.creator_id
    where q.created_at >= from_at and q.created_at < to_at
      and q.deleted_at is null and not q.is_hidden
      and not coalesce(pr.is_test, false)
  )
  select ps.id, ps.question, ps.kind, ps.visibility,
         case when ps.is_system then 'eithr' when ps.by_admin then 'you' else 'people' end,
         case when ps.is_system then 'eithr' when ps.visibility = 'public' then ps.uname end,
         ps.topic, ps.feel, ps.timely, ps.lang, ps.created_at, ps.view_count, ps.vote_count, ps.share_count, ps.n_comments,
         case when ps.answer_votes > 0 then
           (select string_agg(round(100.0 * o.vote_count / ps.answer_votes)::text, '/' order by o.vote_count desc)
            from public.poll_options o where o.poll_id = ps.id) end,
         public.poll_spark(ps.view_count, ps.vote_count, ps.share_count, ps.n_comments, ps.top_votes, ps.n_answers),
         ps.tag_source
  from ps;
$$;
revoke execute on function public.likes_polls(timestamptz, timestamptz) from public, anon, authenticated;

-- ─── 3. Admin → Content → What people like ───────────────────────────────────

create or replace function public.admin_likes(days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 14), 90), 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
  since timestamptz := ((today - (d - 1))::timestamp at time zone 'Asia/Kolkata');
  prev_since timestamptz := ((today - (2 * d - 1))::timestamp at time zone 'Asia/Kolkata');
begin
  perform public.require_admin();
  return (
    with cur as (select * from public.likes_polls(since, now() + interval '1 minute') x),
    prev as (select * from public.likes_polls(prev_since, since) x),
    sc as (select * from cur where cur.spark is not null),
    pv as (select * from prev where prev.spark is not null)
    select jsonb_build_object(
      'days', d,
      'polls', (select count(*) from cur),
      'scored', (select count(*) from sc),
      'tagged', (select count(*) from cur where cur.topic is not null),
      'voters', (select count(distinct v.user_id) from public.votes v where v.poll_id in (select cur.id from cur)),
      'untagged_all', (select count(*) from public.polls p where p.tagged_at is null and p.deleted_at is null and not p.is_hidden and p.tag_tries < 3),
      'last_tagged', (select max(p.tagged_at) from public.polls p where p.tag_source = 'ai'),
      'topics', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s,
                   'prev', (select round(avg(pv.spark)) from pv where pv.topic = t.k),
                   'prev_n', (select count(*) from pv where pv.topic = t.k)) order by t.s desc), '[]'::jsonb)
                 from (select sc.topic as k, count(*) as n, round(avg(sc.spark)) as s from sc where sc.topic is not null group by sc.topic) t),
      'feels', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s,
                   'prev', (select round(avg(pv.spark)) from pv where pv.feel = t.k),
                   'prev_n', (select count(*) from pv where pv.feel = t.k)) order by t.s desc), '[]'::jsonb)
                 from (select sc.feel as k, count(*) as n, round(avg(sc.spark)) as s from sc where sc.feel is not null group by sc.feel) t),
      'grid', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'feel', t.feel, 'n', t.n, 'spark', t.s) order by t.s desc), '[]'::jsonb)
               from (select sc.topic, sc.feel, count(*) as n, round(avg(sc.spark)) as s from sc
                     where sc.topic is not null and sc.feel is not null group by sc.topic, sc.feel) t),
      'langs', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s, 'votes', t.v) order by t.s desc), '[]'::jsonb)
                from (select sc.lang as k, count(*) as n, round(avg(sc.spark)) as s, round(avg(sc.votes)) as v
                      from sc where sc.lang is not null group by sc.lang) t),
      'times', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s, 'votes', t.v) order by t.s desc), '[]'::jsonb)
                from (select case when h >= 6 and h < 12 then 'morning' when h >= 12 and h < 17 then 'afternoon'
                                  when h >= 17 and h < 21 then 'evening' when h >= 21 then 'night' else 'late' end as k,
                             count(*) as n, round(avg(sp)) as s, round(avg(vt)) as v
                      from (select extract(hour from sc.created_at at time zone 'Asia/Kolkata') as h, sc.spark as sp, sc.votes as vt from sc) hs
                      group by 1) t),
      'timing', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s, 'votes', t.v) order by t.s desc), '[]'::jsonb)
                 from (select case when sc.timely then 'timely' else 'evergreen' end as k, count(*) as n,
                              round(avg(sc.spark)) as s, round(avg(sc.votes)) as v
                       from sc where sc.topic is not null group by 1) t),
      'who', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'n', t.n, 'spark', t.s, 'votes', t.v) order by t.s desc), '[]'::jsonb)
              from (select sc.who as k, count(*) as n, round(avg(sc.spark)) as s, round(avg(sc.votes)) as v from sc group by sc.who) t),
      'best', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'question', b.question, 'kind', b.kind, 'who', b.who,
                 'author', b.author, 'topic', b.topic, 'feel', b.feel, 'timely', b.timely, 'lang', b.lang, 'spark', b.spark,
                 'votes', b.votes, 'shares', b.shares, 'comments', b.comments, 'split', b.split) order by b.spark desc), '[]'::jsonb)
               from (select * from sc order by sc.spark desc, sc.votes desc limit 8) b),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'question', r.question, 'kind', r.kind, 'topic', r.topic,
                   'feel', r.feel, 'timely', r.timely, 'lang', r.lang, 'source', r.tag_source, 'spark', r.spark) order by r.created_at desc), '[]'::jsonb)
                 from (select * from cur order by cur.created_at desc limit 30) r)
    )
  );
end;
$$;
revoke execute on function public.admin_likes(int) from public, anon;
grant execute on function public.admin_likes(int) to authenticated;
