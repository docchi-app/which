-- Admin, last phase: Overview (the admin home), Funnel & retention, Sources, Polls & snaps and
-- Notifications, plus a 9 am summary push for the admin. (No temporary tables and no
-- SELECT … INTO in this file: the Supabase SQL editor takes those for new tables.)
--
-- New tracking, all counts (nothing typed, no addresses):
--   notifications.opened_at   a push was tapped (the app reports it, only for its owner)
--   app_opens                 a push or an email link was opened (email: which send)
--   push_daily                per day: how many times the 2-minute job ran, pushes sent,
--                             expired (phone unsubscribed) and failed
--   push_offs                 someone turned notifications off in Settings
--   blocked_hits              the word filter stopped a post (where, never the words)
-- Kept 90 days (push_daily a year). Test accounts and the admin are left out of the numbers.

alter table public.notifications add column if not exists opened_at timestamptz;

create table if not exists public.app_opens (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  kind  text not null check (kind in ('push', 'email')),
  ref   text
);
create index if not exists app_opens_at_idx on public.app_opens (at);

create table if not exists public.push_daily (
  day      date primary key,
  runs     int not null default 0,
  sent     int not null default 0,
  expired  int not null default 0,
  failed   int not null default 0
);

create table if not exists public.push_offs (
  id       bigint generated always as identity primary key,
  user_id  uuid references public.profiles (id) on delete cascade,
  at       timestamptz not null default now()
);
create index if not exists push_offs_at_idx on public.push_offs (at);

create table if not exists public.blocked_hits (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  place  text
);
create index if not exists blocked_hits_at_idx on public.blocked_hits (at);

alter table public.app_opens enable row level security;
alter table public.push_daily enable row level security;
alter table public.push_offs enable row level security;
alter table public.blocked_hits enable row level security;
revoke all on table public.app_opens, public.push_daily, public.push_offs, public.blocked_hits from public, anon, authenticated;

alter table public.profiles add column if not exists admin_morning boolean not null default false;

-- ─── Tracking ────────────────────────────────────────────────────────────────

-- A push was tapped: the app opens with ?n=<id>. Counted once, and only by its owner.
create or replace function public.push_opened(n bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if auth.uid() is null then
    return;
  end if;
  update public.notifications x set opened_at = now()
  where x.id = n and x.user_id = auth.uid() and x.opened_at is null and x.sent_at is not null
  returning x.kind into k;
  if k is not null then
    insert into public.app_opens (kind, ref) values ('push', k);
  end if;
end;
$$;
revoke execute on function public.push_opened(bigint) from public, anon;
grant execute on function public.push_opened(bigint) to authenticated;

-- An email link was opened (?utm_source=email&utm_campaign=summary-lunch).
create or replace function public.email_opened(campaign text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.app_opens o where o.at > now() - interval '10 minutes') >= 500 then
    return;
  end if;
  insert into public.app_opens (kind, ref)
  values ('email', case when campaign in ('summary-lunch', 'summary-evening', 'summary') then campaign else 'other' end);
end;
$$;
revoke execute on function public.email_opened(text) from public;
grant execute on function public.email_opened(text) to anon, authenticated;

-- Someone turned notifications off in Settings.
create or replace function public.note_push_off()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if exists (select 1 from public.push_offs o where o.user_id = auth.uid() and o.at > now() - interval '1 hour') then
    return;
  end if;
  insert into public.push_offs (user_id) values (auth.uid());
end;
$$;
revoke execute on function public.note_push_off() from public, anon;
grant execute on function public.note_push_off() to authenticated;

-- The word filter stopped a post (the app reports where; never the words).
create or replace function public.note_blocked(place text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.blocked_hits h where h.at > now() - interval '10 minutes') >= 500 then
    return;
  end if;
  insert into public.blocked_hits (place) values (left(note_blocked.place, 40));
end;
$$;
revoke execute on function public.note_blocked(text) from public;
grant execute on function public.note_blocked(text) to anon, authenticated;

-- The 2-minute job adds what it did (needs its secret) and clears what's past keeping.
create or replace function public.push_tally(secret text, sent int, expired int, failed int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  insert into public.push_daily as d (day, runs, sent, expired, failed)
  values (today, 1, greatest(coalesce(push_tally.sent, 0), 0), greatest(coalesce(push_tally.expired, 0), 0), greatest(coalesce(push_tally.failed, 0), 0))
  on conflict on constraint push_daily_pkey do update
    set runs = d.runs + 1, sent = d.sent + excluded.sent, expired = d.expired + excluded.expired, failed = d.failed + excluded.failed;
  delete from public.app_opens o where o.at < now() - interval '90 days';
  delete from public.push_offs o where o.at < now() - interval '90 days';
  delete from public.blocked_hits h where h.at < now() - interval '90 days';
  delete from public.push_daily d where d.day < today - 366;
end;
$$;
revoke execute on function public.push_tally(text, int, int, int) from public;
grant execute on function public.push_tally(text, int, int, int) to anon, authenticated;

-- ─── Shared pieces ───────────────────────────────────────────────────────────

-- Signed-up people counted in the numbers (not guests, test accounts or the admin).
create or replace function public.counted_people()
returns table (id uuid, joined timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.signed_up_at, p.created_at)
  from public.profiles p join auth.users u on u.id = p.id
  where not coalesce(u.is_anonymous, false) and p.id not in (select x.id from public.metrics_left_out() x);
$$;
revoke execute on function public.counted_people() from public, anon, authenticated;

-- The person behind a browser (signed in or a guest), if any.
create or replace function public.visitor_user(v uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select i.user_id from public.visitor_info i where i.visitor = v),
                  (select x.user_id from public.visits x where x.visitor = v and x.user_id is not null order by x.day desc limit 1));
$$;
revoke execute on function public.visitor_user(uuid) from public, anon, authenticated;

-- One day's numbers, India time (internal).
create or replace function public.day_snapshot(d date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s timestamptz := d::timestamp at time zone 'Asia/Kolkata';
  e timestamptz := (d + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  return jsonb_build_object(
    'visitors', (select count(distinct v.visitor) from public.visits v
                 where v.day = d and v.visitor not in (select x.visitor from public.metrics_left_out_visitors() x)),
    'signups', (select count(*) from public.counted_people() p where p.joined >= s and p.joined < e),
    'guests', (select count(*) from public.profiles p join auth.users u on u.id = p.id
               where (coalesce(u.is_anonymous, false) or p.was_guest) and p.created_at >= s and p.created_at < e),
    'votes', (select count(*) from public.votes v where v.created_at >= s and v.created_at < e
              and v.user_id not in (select x.id from public.metrics_left_out() x)),
    'polls', (select count(*) from public.polls q where q.kind <> 'snap' and not q.is_system and q.created_at >= s and q.created_at < e
              and q.creator_id not in (select x.id from public.metrics_left_out() x)),
    'snaps', (select count(*) from public.polls q where q.kind = 'snap' and q.created_at >= s and q.created_at < e
              and q.creator_id not in (select x.id from public.metrics_left_out() x)),
    'shares', (select count(*) from public.shares x where x.created_at >= s and x.created_at < e
               and x.user_id not in (select o.id from public.metrics_left_out() o)));
end;
$$;
revoke execute on function public.day_snapshot(date) from public, anon, authenticated;

-- ─── Overview (the admin home) ───────────────────────────────────────────────

create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  js public.job_status := (select j from public.job_status j where j.id = 1);
begin
  perform public.require_admin();
  return (
    with m as (select * from public.admin_metrics(14)),
    lv as (select x.visitor from public.metrics_left_out_visitors() x),
    cohort as (
      select f.first_day, (exists (select 1 from public.visits b where b.visitor = f.visitor and b.day = f.first_day + 1)) as back
      from public.visitors f where f.visitor not in (select lv.visitor from lv) and f.first_day between today - 15 and today - 2
    )
    select jsonb_build_object(
      'today', public.day_snapshot(today),
      'yesterday', public.day_snapshot(today - 1),
      'last_week', public.day_snapshot(today - 7),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('day', m.day, 'visitors', m.visitors, 'voters', m.voters) order by m.day), '[]'::jsonb) from m),
      'vote_rate', (select round(100.0 * sum(m.voters) / nullif(sum(m.visitors), 0), 1) from m where m.day > today - 7),
      'vote_rate_before', (select round(100.0 * sum(m.voters) / nullif(sum(m.visitors), 0), 1) from m where m.day <= today - 7),
      'back_rate', (select round(100.0 * count(*) filter (where c.back) / nullif(count(*), 0), 1) from cohort c where c.first_day > today - 9),
      'back_rate_before', (select round(100.0 * count(*) filter (where c.back) / nullif(count(*), 0), 1) from cohort c where c.first_day <= today - 9),
      'shares_per_poll', (select round(sum(m.shares)::numeric / nullif(sum(m.polls), 0), 1) from m where m.day > today - 7),
      'push_on', (select round(100.0 * count(*) filter (where public.person_push(p.id) = 'on') / nullif(count(*), 0), 1) from public.counted_people() p),
      'signups_24h', (select count(*) from public.counted_people() p where p.joined > now() - interval '24 hours'),
      'signups_week_avg', (select round(count(*)::numeric / 7, 1) from public.counted_people() p
                           where p.joined > now() - interval '8 days' and p.joined <= now() - interval '24 hours'),
      'visitors_24h', (select count(distinct v.visitor) from public.visits v where v.last_at > now() - interval '24 hours'
                       and v.visitor not in (select lv.visitor from lv)),
      'reports_waiting', (select count(*) from (select distinct r.target_type, r.target_id from public.reports r where r.resolved_at is null) x),
      'reports_oldest', (select min(r.created_at) from public.reports r where r.resolved_at is null),
      'errors_new', (select count(*) from public.app_errors g where g.status = 'new'),
      'errors_newest', (select jsonb_build_object('id', g.id, 'message', g.message, 'place', g.place, 'since', g.first_seen,
                          'people', (select count(distinct coalesce(e.user_id::text, e.visitor, e.id::text)) from public.app_error_events e where e.error_id = g.id))
                        from public.app_errors g where g.status = 'new' order by g.first_seen desc limit 1),
      'job_last_run', js.last_run,
      'job_result', js.result,
      'email_last', (select jsonb_build_object('at', max(e.sent_at), 'count', count(*)) from public.email_sends e
                     where e.sent_at > now() - interval '24 hours'),
      'morning', (select p.admin_morning from public.profiles p where p.id = auth.uid()))
  );
end;
$$;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ─── Funnel & retention ──────────────────────────────────────────────────────

create or replace function public.admin_funnel(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 7), 90), 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_admin();
  return (
    with lv as (select x.visitor from public.metrics_left_out_visitors() x),
    lo as (select x.id from public.metrics_left_out() x),
    firsts as (
      select f.visitor, f.first_day, public.visitor_user(f.visitor) as uid,
             ((f.first_day + 8)::timestamp at time zone 'Asia/Kolkata') as until
      from public.visitors f
      where f.first_day > today - d and f.visitor not in (select lv.visitor from lv)
    ),
    steps as (
      select f.*,
        (f.uid is not null and exists (select 1 from public.votes v where v.user_id = f.uid and v.created_at < f.until)) as voted,
        (f.uid is not null and exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                                       where p.id = f.uid and not coalesce(u.is_anonymous, false)
                                         and coalesce(p.signed_up_at, p.created_at) < f.until)) as signed,
        (f.uid is not null and exists (select 1 from public.polls q where q.creator_id = f.uid and q.created_at < f.until)) as polled,
        (f.uid is not null and exists (select 1 from public.shares x where x.user_id = f.uid and x.created_at < f.until)) as shared,
        (f.uid is not null and exists (select 1 from public.circle_members m where m.owner_id = f.uid and m.status = 'accepted' and m.accepted_at < f.until)) as friended
      from firsts f
      where f.uid is null or f.uid not in (select lo.id from lo)
    ),
    act as (
      select v.day, count(distinct v.visitor) as n from public.visits v
      where v.day > today - 30 and v.visitor not in (select lv.visitor from lv) group by v.day
    ),
    people as (select p.id, (p.joined at time zone 'Asia/Kolkata')::date as jd from public.counted_people() p),
    visits_u as (select distinct v.user_id, v.day from public.visits v where v.user_id is not null),
    ret as (
      select p.id, p.jd, (date_trunc('week', p.jd::timestamp))::date as wk,
        case when p.jd + 1 < today then exists (select 1 from visits_u x where x.user_id = p.id and x.day = p.jd + 1) end as d1,
        case when p.jd + 7 < today then exists (select 1 from visits_u x where x.user_id = p.id and x.day between p.jd + 7 and p.jd + 13) end as d7,
        case when p.jd + 30 < today then exists (select 1 from visits_u x where x.user_id = p.id and x.day between p.jd + 30 and p.jd + 36) end as d30
      from people p where p.jd > today - 56
    ),
    recent as (
      select r.*, public.person_push(r.id) = 'on' as push_on,
             (select i.source from public.visitor_info i where i.user_id = r.id order by i.first_at limit 1) in ('invite', 'poll') as invited
      from ret r where r.jd > today - 31 and r.d1 is not null
    ),
    guests as (
      select p.id, (p.created_at at time zone 'Asia/Kolkata')::date as gd from public.profiles p join auth.users u on u.id = p.id
      where coalesce(u.is_anonymous, false) and p.created_at > now() - interval '31 days' and p.created_at < now() - interval '2 days'
    )
    select jsonb_build_object(
      'visited', (select count(*) from steps),
      'voted', (select count(*) from steps where voted),
      'signed', (select count(*) from steps where signed),
      'polled', (select count(*) from steps where polled),
      'shared', (select count(*) from steps where shared),
      'friended', (select count(*) from steps where friended),
      'dau', (select round(avg(a.n)) from act a where a.day > today - 7),
      'wau', (select count(distinct v.visitor) from public.visits v where v.day > today - 7 and v.visitor not in (select lv.visitor from lv)),
      'mau', (select count(distinct v.visitor) from public.visits v where v.day > today - 30 and v.visitor not in (select lv.visitor from lv)),
      'cohorts', (select coalesce(jsonb_agg(c order by c ->> 'week' desc), '[]'::jsonb) from (
                   select jsonb_build_object('week', r.wk, 'n', count(*),
                     'd1', round(100.0 * count(*) filter (where r.d1) / nullif(count(r.d1), 0)),
                     'd7', round(100.0 * count(*) filter (where r.d7) / nullif(count(r.d7), 0)),
                     'd30', round(100.0 * count(*) filter (where r.d30) / nullif(count(r.d30), 0))) as c
                   from ret r group by r.wk) cs),
      'd1_push_on', (select round(100.0 * count(*) filter (where r.d1) / nullif(count(*), 0)) from recent r where r.push_on),
      'd1_push_off', (select round(100.0 * count(*) filter (where r.d1) / nullif(count(*), 0)) from recent r where not r.push_on),
      'd1_invited', (select round(100.0 * count(*) filter (where r.d1) / nullif(count(*), 0)) from recent r where r.invited),
      'd1_found', (select round(100.0 * count(*) filter (where r.d1) / nullif(count(*), 0)) from recent r where r.invited is not true),
      'd1_signed', (select round(100.0 * count(*) filter (where r.d1) / nullif(count(*), 0)) from recent r),
      'd1_guest', (select round(100.0 * count(*) filter (where exists (select 1 from visits_u x where x.user_id = g.id and x.day = g.gd + 1)) / nullif(count(*), 0)) from guests g))
  );
end;
$$;
revoke execute on function public.admin_funnel(int) from public, anon;
grant execute on function public.admin_funnel(int) to authenticated;

-- ─── Sources ─────────────────────────────────────────────────────────────────

create or replace function public.admin_sources(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(least(coalesce(days, 7), 90), 1));
begin
  perform public.require_admin();
  return (
    with lv as (select x.visitor from public.metrics_left_out_visitors() x),
    firsts as (
      select i.*, public.visitor_user(i.visitor) as uid,
             coalesce(i.source_by, public.poll_author(i.source_poll)) as by_name
      from public.visitor_info i
      where i.first_at > since and i.source is not null and i.visitor not in (select lv.visitor from lv)
    ),
    seen as (
      select i.*, public.visitor_user(i.visitor) as uid,
             coalesce(i.device, 'Unknown') || ' · ' || case when i.installed then 'installed app' when i.in_app is not null then 'inside ' || i.in_app
                                                           when i.device in ('Mac', 'Windows', 'Linux') then 'computer' else coalesce(i.browser, 'Unknown') end as label
      from public.visitor_info i
      where i.last_at > since and i.visitor not in (select lv.visitor from lv)
    )
    select jsonb_build_object(
      'total', (select count(*) from firsts),
      'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'n', s.n) order by s.n desc), '[]'::jsonb)
                  from (select f.source, count(*) as n from firsts f group by f.source) s),
      'bringers', (select coalesce(jsonb_agg(b order by (b ->> 'signed')::int desc, (b ->> 'visitors')::int desc), '[]'::jsonb) from (
                    select jsonb_build_object('username', f.by_name, 'visitors', count(*),
                      'voted', count(*) filter (where f.uid is not null and exists (select 1 from public.votes v where v.user_id = f.uid)),
                      'signed', count(*) filter (where f.uid is not null and exists (select 1 from auth.users u where u.id = f.uid and not coalesce(u.is_anonymous, false))),
                      'polls', count(distinct f.source_poll), 'invites', count(*) filter (where f.source = 'invite')) as b
                    from firsts f where f.by_name is not null group by f.by_name
                    order by count(*) desc limit 8) bs),
      'top_polls', (select coalesce(jsonb_agg(t order by (t ->> 'visitors')::int desc), '[]'::jsonb) from (
                     select jsonb_build_object('id', q.id, 'question', q.question, 'kind', q.kind, 'visibility', q.visibility,
                                               'author', public.poll_author(q.id), 'visitors', count(*)) as t
                     from firsts f join public.polls q on q.id = f.source_poll
                     group by q.id order by count(*) desc limit 5) ts),
      'phones', (select coalesce(jsonb_agg(ph order by (ph ->> 'visitors')::int desc), '[]'::jsonb) from (
                  select jsonb_build_object('label', s.label, 'visitors', count(*),
                    'voted', count(*) filter (where s.uid is not null and exists (select 1 from public.votes v where v.user_id = s.uid and v.created_at > since)),
                    'signed', count(*) filter (where s.uid is not null and exists (select 1 from auth.users u where u.id = s.uid and not coalesce(u.is_anonymous, false))),
                    'errors', count(*) filter (where exists (select 1 from public.app_error_events e where e.visitor = s.visitor::text and e.at > since))) as ph
                  from seen s group by s.label order by count(*) desc limit 8) ps))
  );
end;
$$;
revoke execute on function public.admin_sources(int) from public, anon;
grant execute on function public.admin_sources(int) to authenticated;

-- ─── Polls & snaps ───────────────────────────────────────────────────────────

create or replace function public.admin_content(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 7), 90), 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
  since timestamptz := ((today - (d - 1))::timestamp at time zone 'Asia/Kolkata');
begin
  perform public.require_admin();
  return (
    with lo as (select x.id from public.metrics_left_out() x),
    ps as (
      select q.* from public.polls q
      where q.created_at >= since and not q.is_system and q.creator_id not in (select lo.id from lo)
    )
    select jsonb_build_object(
      'polls', (select count(*) from ps where ps.kind <> 'snap'),
      'snaps', (select count(*) from ps where ps.kind = 'snap'),
      'median_votes', (select percentile_cont(0.5) within group (order by ps.vote_count) from ps),
      'p90_votes', (select percentile_cont(0.9) within group (order by ps.vote_count) from ps),
      'no_votes', (select count(*) from ps where ps.vote_count = 0),
      'no_votes_open', (select count(*) from ps where ps.vote_count = 0 and ps.closes_at > now()),
      'comments', (select count(*) from public.comments c where c.created_at >= since and c.user_id not in (select lo.id from lo)),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day,
                   'classic', (select count(*) from ps where ps.kind = 'classic' and (ps.created_at at time zone 'Asia/Kolkata')::date = g.day),
                   'snap', (select count(*) from ps where ps.kind = 'snap' and (ps.created_at at time zone 'Asia/Kolkata')::date = g.day),
                   'hot_take', (select count(*) from ps where ps.kind = 'hot_take' and (ps.created_at at time zone 'Asia/Kolkata')::date = g.day),
                   'mystery', (select count(*) from ps where ps.kind = 'mystery' and (ps.created_at at time zone 'Asia/Kolkata')::date = g.day))
                   order by g.day), '[]'::jsonb)
                 from (select generate_series(today - (d - 1), today, interval '1 day')::date as day) g),
      'top', (select coalesce(jsonb_agg(t order by (t ->> 'votes')::int desc), '[]'::jsonb) from (
               select jsonb_build_object('id', q.id, 'question', q.question, 'kind', q.kind, 'visibility', q.visibility,
                                         'author', public.poll_author(q.id), 'votes', q.vote_count,
                                         'comments', (select count(*) from public.comments c where c.poll_id = q.id)) as t
               from public.polls q
               where q.created_at >= since and q.deleted_at is null and not q.is_hidden and not q.is_system
               order by q.vote_count desc limit 5) ts),
      'snap_live', (select count(*) from ps where ps.kind = 'snap' and ps.photo_status = 'live'),
      'snap_review', (select count(*) from ps where ps.kind = 'snap' and ps.photo_status = 'review'),
      'snap_rejected', (select count(*) from ps where ps.kind = 'snap' and ps.photo_status = 'rejected'),
      'ai_flags', (select count(*) from public.reports r where r.created_at >= since and r.reason like 'auto:%'),
      'reports', (select count(*) from public.reports r where r.created_at >= since and r.reason not like 'auto:%'),
      'blocked', (select count(*) from public.blocked_hits h where h.at >= since),
      'props', (select coalesce(jsonb_agg(x order by (x ->> 'n')::int desc), '[]'::jsonb) from (
                 select jsonb_build_object('label', pq.label, 'emoji', pq.emoji, 'n', count(*)) as x
                 from public.props p join public.prop_questions pq on pq.id = p.question_id
                 where p.created_at >= since and p.picker_id not in (select lo.id from lo)
                 group by pq.id order by count(*) desc limit 5) xs))
  );
end;
$$;
revoke execute on function public.admin_content(int) from public, anon;
grant execute on function public.admin_content(int) to authenticated;

-- ─── Notifications ───────────────────────────────────────────────────────────

create or replace function public.admin_notifications(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 7), 90), 1);
  today date := (now() at time zone 'Asia/Kolkata')::date;
  since timestamptz := ((today - (d - 1))::timestamp at time zone 'Asia/Kolkata');
begin
  perform public.require_admin();
  return (
    with lo as (select x.id from public.metrics_left_out() x),
    n as (select * from public.notifications x where x.created_at >= since and x.kind <> 'test' and x.user_id not in (select lo.id from lo)),
    phones as (
      select p.id, public.person_push(p.id) as push,
             (select case when i.device in ('iPhone', 'iPad') and i.installed then 'iPhone · installed'
                          when i.device in ('iPhone', 'iPad') then 'iPhone · browser'
                          when i.device = 'Android' then 'Android'
                          when i.device in ('Mac', 'Windows', 'Linux') then 'Computer' end
              from public.visitor_info i where i.user_id = p.id order by i.last_at desc limit 1) as label
      from public.counted_people() p
    )
    select jsonb_build_object(
      'kinds', (select coalesce(jsonb_agg(k order by (k ->> 'made')::int desc), '[]'::jsonb) from (
                 select jsonb_build_object('kind', n.kind, 'made', count(*), 'sent', count(n.sent_at), 'opened', count(n.opened_at)) as k
                 from n group by n.kind) ks),
      'sent', (select count(n.sent_at) from n),
      'opened', (select count(n.opened_at) from n),
      'expired', (select coalesce(sum(p.expired), 0) from public.push_daily p where p.day > today - d),
      'failed', (select coalesce(sum(p.failed), 0) from public.push_daily p where p.day > today - d),
      'runs_today', (select p.runs from public.push_daily p where p.day = today),
      'emails', (select count(*) from public.email_sends e where e.sent_at >= since),
      'emails_lunch', (select count(*) from public.email_sends e where e.sent_at >= since and e.slot = 'lunch'),
      'emails_evening', (select count(*) from public.email_sends e where e.sent_at >= since and e.slot = 'evening'),
      'email_opens', (select count(*) from public.app_opens o where o.kind = 'email' and o.at >= since),
      'turned_off', (select count(distinct o.user_id) from public.push_offs o where o.at >= since),
      'phones', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('label', ph.label, 'people', count(*), 'on', count(*) filter (where ph.push = 'on'),
                                            'cant', count(*) filter (where ph.push = 'unsupported')) as x
                  from phones ph where ph.label is not null group by ph.label) xs),
      'job_last_run', (select j.last_run from public.job_status j where j.id = 1),
      'job_problem', (select jsonb_build_object('message', g.message, 'place', g.place, 'at', g.last_seen, 'status', g.status)
                      from public.app_errors g where g.source = 'job' order by g.last_seen desc limit 1))
  );
end;
$$;
revoke execute on function public.admin_notifications(int) from public, anon;
grant execute on function public.admin_notifications(int) to authenticated;

-- ─── The admin's 9 am summary push ───────────────────────────────────────────

-- Settings switch: read it (on_now null) or set it. Admin only.
create or replace function public.admin_morning(on_now boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
begin
  if on_now is not null then
    update public.profiles p set admin_morning = on_now where p.id = uid;
    perform public.admin_event('morning_summary', case when on_now then 'on' else 'off' end);
  end if;
  return (select p.admin_morning from public.profiles p where p.id = uid);
end;
$$;
revoke execute on function public.admin_morning(boolean) from public, anon;
grant execute on function public.admin_morning(boolean) to authenticated;

-- For the 2-minute job: between 9 and 10 am India time, once a day, yesterday in one push.
-- (at_time is for tests; the job leaves it out.)
create or replace function public.morning_summary(secret text, at_time timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t timestamptz := coalesce(at_time, now());
  ist timestamp := t at time zone 'Asia/Kolkata';
  today date := ist::date;
  admin uuid := (select p.id from public.profiles p where p.is_admin and p.admin_morning limit 1);
  y jsonb;
  waiting int;
  errs int;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  if admin is null or extract(hour from ist) <> 9 then
    return jsonb_build_object('alert', null);
  end if;
  if exists (select 1 from public.app_state s where s.key = 'morning_summary' and (s.at at time zone 'Asia/Kolkata')::date = today) then
    return jsonb_build_object('alert', null);
  end if;
  insert into public.app_state (key, at) values ('morning_summary', t)
  on conflict (key) do update set at = excluded.at;
  y := public.day_snapshot(today - 1);
  waiting := (select count(*) from (select distinct r.target_type, r.target_id from public.reports r where r.resolved_at is null) x);
  errs := (select count(*) from public.app_errors g where g.status = 'new');
  return jsonb_build_object(
    'alert', jsonb_build_object(
      'title', '☀️ Yesterday on Eithr',
      'body', (y ->> 'visitors') || ' visitors · ' || (y ->> 'signups') || ' signed up · ' || (y ->> 'votes') || ' votes'
              || case when waiting > 0 then ' · ' || waiting || ' report' || case when waiting = 1 then '' else 's' end || ' waiting' else '' end
              || case when errs > 0 then ' · ' || errs || ' new error' || case when errs = 1 then '' else 's' end else '' end,
      'url', '/admin#overview',
      'tag', 'admin-morning'),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                from public.push_subscriptions s where s.user_id = admin));
end;
$$;
revoke execute on function public.morning_summary(text, timestamptz) from public;
grant execute on function public.morning_summary(text, timestamptz) to anon, authenticated;
