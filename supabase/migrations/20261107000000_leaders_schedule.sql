-- Weekly leaderboard + scheduling Poll of the Day from /admin.
--
-- Leaderboard: weeks run Monday–Sunday, India time. Two boards:
--   creators: votes their public polls got this week
--   polls:    this week's most-voted public polls
-- Votes only count if they're on someone else's poll, not a Docchi poll,
-- from an account that isn't banned and is at least a day old. Scores are
-- stored (top 100 per board per week) and refreshed every 10 minutes by
-- pg_cron (or, without it, by the first visit after 15 minutes).
-- Past weeks stay, so "last week's champ" is a lookup.

create table public.leader_scores (
  week     date not null,
  board    text not null check (board in ('creators', 'polls')),
  subject  uuid not null,
  rank     int not null,
  score    int not null,
  primary key (week, board, subject)
);
create index leader_scores_rank_idx on public.leader_scores (week, board, rank);
alter table public.leader_scores enable row level security;
revoke all on public.leader_scores from anon, authenticated;

-- Monday of the week `at` falls in, India time.
create or replace function public.week_of(at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('week', (at at time zone 'Asia/Kolkata'))::date $$;

create or replace function public.week_start_ts(week date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select week::timestamp at time zone 'Asia/Kolkata' $$;

-- Votes that count towards the board for a week (see the rules above).
create or replace function public.counted_votes(week date)
returns table (poll_id uuid, creator_id uuid, voter uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select v.poll_id, p.creator_id, v.user_id
  from public.votes v
  join public.polls p on p.id = v.poll_id
  join public.profiles voter on voter.id = v.user_id
  join public.profiles maker on maker.id = p.creator_id
  where v.created_at >= public.week_start_ts(week)
    and v.created_at < public.week_start_ts(week + 7)
    and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden and not p.is_system
    and v.user_id <> p.creator_id
    and not voter.is_banned and not maker.is_banned
    and voter.created_at < v.created_at - interval '1 day';
$$;
revoke execute on function public.counted_votes(date) from public, anon, authenticated;

create or replace function public.refresh_leaderboard(week date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w date := coalesce(week, public.week_of(now()));
begin
  delete from public.leader_scores s where s.week = w;
  insert into public.leader_scores (week, board, subject, rank, score)
  select w, 'creators', c.creator_id, row_number() over (order by c.n desc, c.creator_id), c.n
  from (select cv.creator_id, count(*)::int as n from public.counted_votes(w) cv group by cv.creator_id
        order by n desc, cv.creator_id limit 100) c;
  insert into public.leader_scores (week, board, subject, rank, score)
  select w, 'polls', c.poll_id, row_number() over (order by c.n desc, c.poll_id), c.n
  from (select cv.poll_id, count(*)::int as n from public.counted_votes(w) cv group by cv.poll_id
        order by n desc, cv.poll_id limit 100) c;
  insert into public.app_state (key, at) values ('leaders', now())
  on conflict (key) do update set at = excluded.at;
end;
$$;
revoke execute on function public.refresh_leaderboard(date) from public, anon, authenticated;

-- One person's score for a week, starting from their own polls (fast for anyone).
create or replace function public.my_week_score(person uuid, week date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.polls p
  join public.votes v on v.poll_id = p.id
  join public.profiles voter on voter.id = v.user_id
  where p.creator_id = person
    and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden and not p.is_system
    and p.closes_at > public.week_start_ts(week)
    and v.created_at >= public.week_start_ts(week)
    and v.created_at < public.week_start_ts(week + 7)
    and v.user_id <> person
    and not voter.is_banned
    and voter.created_at < v.created_at - interval '1 day';
$$;
revoke execute on function public.my_week_score(uuid, date) from public, anon, authenticated;

-- Refresh this week when stale (pg_cron does it every 10 minutes; a visit
-- only steps in after 15); finish off last week once it's over.
create or replace function public.maybe_refresh_leaderboard()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  this_week date := public.week_of(now());
begin
  if not pg_try_advisory_xact_lock(hashtext('docchi.leaders')) then
    return;
  end if;
  if coalesce((select a.at from public.app_state a where a.key = 'leaders_final'), '-infinity')
     < public.week_start_ts(this_week) then
    perform public.refresh_leaderboard(this_week - 7);
    insert into public.app_state (key, at) values ('leaders_final', now())
    on conflict (key) do update set at = excluded.at;
  end if;
  if coalesce((select a.at from public.app_state a where a.key = 'leaders'), '-infinity') < now() - interval '15 minutes' then
    perform public.refresh_leaderboard(this_week);
  end if;
end;
$$;
revoke execute on function public.maybe_refresh_leaderboard() from public, anon, authenticated;

-- board: 'creators' | 'polls' · which: 'this' | 'last'
create or replace function public.get_leaderboard(board text default 'creators', which text default 'this')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  w date := public.week_of(now()) - case when which = 'last' then 7 else 0 end;
  b text := case when board = 'polls' then 'polls' else 'creators' end;
  list jsonb;
  me jsonb;
  champ jsonb;
  my_score int;
begin
  perform public.maybe_refresh_leaderboard();

  if b = 'creators' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', s.rank, 'score', s.score, 'username', u.username::text, 'avatar_url', u.avatar_url,
             'is_me', u.id = uid) order by s.rank), '[]')
    into list
    from public.leader_scores s
    join public.profiles u on u.id = s.subject
    where s.week = w and s.board = 'creators' and s.rank <= 50;

    if uid is not null then
      select jsonb_build_object('rank', s.rank, 'score', s.score) into me
      from public.leader_scores s where s.week = w and s.board = 'creators' and s.subject = uid;
      if me is null then
        my_score := public.my_week_score(uid, w);
        me := jsonb_build_object('rank', null, 'score', my_score);
      end if;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', s.rank, 'score', s.score, 'poll_id', p.id, 'kind', p.kind,
             -- A mystery question stays hidden until you've voted (or it closed).
             'question', case when p.kind = 'mystery' and p.closes_at > now()
                                   and not exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = uid)
                              then p.teaser else p.question end,
             'username', u.username::text, 'avatar_url', u.avatar_url,
             'closed', p.closes_at <= now(), 'is_me', p.creator_id = uid) order by s.rank), '[]')
    into list
    from public.leader_scores s
    join public.polls p on p.id = s.subject
    left join public.profiles u on u.id = p.creator_id
    where s.week = w and s.board = 'polls' and s.rank <= 50
      and p.deleted_at is null and not p.is_hidden;
  end if;

  select jsonb_build_object('username', u.username::text, 'avatar_url', u.avatar_url, 'score', s.score)
  into champ
  from public.leader_scores s
  join public.profiles u on u.id = s.subject
  where s.week = w - 7 and s.board = 'creators' and s.rank = 1;

  return jsonb_build_object(
    'week_start', w,
    'week_end', w + 6,
    'updated_at', (select a.at from public.app_state a where a.key = 'leaders'),
    'rows', list,
    'me', me,
    'last_champ', champ
  );
end;
$$;
grant execute on function public.get_leaderboard(text, text) to anon, authenticated;

select public.refresh_leaderboard(public.week_of(now()) - 7);
select public.refresh_leaderboard();
insert into public.app_state (key, at) values ('leaders_final', now())
on conflict (key) do update set at = excluded.at;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('docchi-leaders', '*/10 * * * *', 'select public.refresh_leaderboard()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); the leaderboard will refresh itself', sqlerrm;
end;
$$;

-- ─── Admin: schedule Poll of the Day ─────────────────────────────────────

-- Every day from yesterday to `days` ahead, with its Poll of the Day (or a gap).
create or replace function public.admin_schedule(days int default 21)
returns table (
  day date, poll_id uuid, kind text, question text, teaser text, options text[],
  vote_count int, open_days int, live boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_admin();
  return query
  select g.d::date, p.id, p.kind, p.question, p.teaser,
         (select array_agg(o.text order by o.position) from public.poll_options o where o.poll_id = p.id),
         p.vote_count,
         (extract(epoch from p.closes_at - p.created_at) / 86400)::int,
         p.created_at <= now()
  from generate_series(today - 1, today + least(greatest(coalesce(days, 21), 1), 90), interval '1 day') g(d)
  left join public.polls p on p.featured_on = g.d::date and p.deleted_at is null
  order by g.d;
end;
$$;
grant execute on function public.admin_schedule(int) to authenticated;

-- Creates (or, with `poll`, edits) a Poll of the Day for `day`. It goes live
-- at midnight India time that day (now, if `day` is today) and stays open
-- for `open_days`. A poll that's already live can't be edited or moved.
create or replace function public.admin_schedule_poll(
  day date,
  question text,
  answers text[] default null,
  kind text default 'classic',
  teaser text default null,
  open_days int default 3,
  poll uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  q text := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
  t text := nullif(regexp_replace(trim(coalesce(teaser, '')), '\s+', ' ', 'g'), '');
  k text := coalesce(kind, 'classic');
  clean text[] := '{}';
  a text;
  starts timestamptz;
  pid uuid := poll;
  existing record;
begin
  perform public.require_admin();
  if day is null or day < today then
    raise exception 'docchi:past_day' using errcode = '22023';
  end if;
  if k not in ('classic', 'hot_take', 'mystery') then
    raise exception 'docchi:bad_kind' using errcode = '22023';
  end if;
  if char_length(q) not between 3 and 140 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;
  if k = 'hot_take' then
    clean := array['Agree', 'Disagree'];
  else
    foreach a in array coalesce(answers, '{}') loop
      a := regexp_replace(trim(coalesce(a, '')), '\s+', ' ', 'g');
      continue when a = '';
      if char_length(a) > 60 then
        raise exception 'docchi:answer_length' using errcode = '22023';
      end if;
      if lower(a) = any (select lower(x) from unnest(clean) x) then
        raise exception 'docchi:duplicate_answers' using errcode = '22023';
      end if;
      clean := clean || a;
    end loop;
    if cardinality(clean) not between 2 and 4 then
      raise exception 'docchi:answer_count' using errcode = '22023';
    end if;
  end if;
  if k = 'mystery' and (t is null or char_length(t) not between 3 and 60) then
    raise exception 'docchi:teaser_length' using errcode = '22023';
  end if;
  if k <> 'mystery' then
    t := null;
  end if;
  if open_days is null or open_days not between 1 and 7 then
    raise exception 'docchi:bad_days' using errcode = '22023';
  end if;

  starts := case when day = today then now() else day::timestamp at time zone 'Asia/Kolkata' end;

  if exists (select 1 from public.polls x
             where x.featured_on = day and x.deleted_at is null and x.id is distinct from pid) then
    raise exception 'docchi:day_taken' using errcode = '23505';
  end if;

  if pid is not null then
    select x.id, x.created_at, x.is_system into existing from public.polls x where x.id = pid and x.deleted_at is null;
    if existing.id is null or not existing.is_system then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if existing.created_at <= now() then
      raise exception 'docchi:already_live' using errcode = '22023';
    end if;
    update public.polls x
    set question = q, kind = k, teaser = t, featured_on = day,
        created_at = starts, closes_at = starts + make_interval(days => open_days),
        hot_score = public.hot_score_for(0, starts)
    where x.id = pid;
    delete from public.poll_options o where o.poll_id = pid;
  else
    -- A deleted poll may still hold the date (featured_on is unique): free it.
    update public.polls x set featured_on = null where x.featured_on = day and x.deleted_at is not null;
    insert into public.polls (question, kind, teaser, is_system, featured_on, created_at, closes_at)
    values (q, k, t, true, day, starts, starts + make_interval(days => open_days))
    returning id into pid;
  end if;

  insert into public.poll_options (poll_id, position, text)
  select pid, i - 1, clean[i] from generate_subscripts(clean, 1) i;

  insert into public.mod_actions (admin_id, action, target_type, target_id)
  values (auth.uid(), case when poll is null then 'schedule' else 'reschedule' end, 'poll', pid);
  return pid;
end;
$$;
grant execute on function public.admin_schedule_poll(date, text, text[], text, text, int, uuid) to authenticated;

-- Removes a scheduled Poll of the Day that isn't live yet.
create or replace function public.admin_unschedule(poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
begin
  perform public.require_admin();
  select x.id, x.created_at, x.is_system into existing from public.polls x where x.id = poll and x.deleted_at is null;
  if existing.id is null or not existing.is_system then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if existing.created_at <= now() then
    raise exception 'docchi:already_live' using errcode = '22023';
  end if;
  delete from public.polls x where x.id = poll;
  insert into public.mod_actions (admin_id, action, target_type, target_id)
  values (auth.uid(), 'unschedule', 'poll', poll);
end;
$$;
grant execute on function public.admin_unschedule(uuid) to authenticated;
