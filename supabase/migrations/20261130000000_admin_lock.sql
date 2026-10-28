-- Admin, phase 1: one owner, test accounts left out of the numbers, and a log of every
-- admin change. (No temporary tables and no SELECT … INTO in this file: the Supabase SQL
-- editor takes those for new tables.)
--
-- 1. Only one admin, ever: a unique index on profiles where is_admin, so setting it on a
--    second account fails. Nothing in the app can set is_admin (profiles has no table
--    grants); changing who it is happens only in the SQL editor:
--      update public.profiles set is_admin = false where is_admin;
--      update public.profiles set is_admin = true where username = 'new_owner';
--
-- 2. Test accounts (profiles.is_test, set in Admin → Test accounts) and the admin's own
--    account are left out of Metrics: their votes, shares, polls and sign-ups, and every
--    visit from a phone or browser they've signed in on. The stored daily numbers are
--    recounted. (Poll views are only kept as daily totals, so they can't be split.)
--
-- 3. admin_events: words added, changed or removed, test accounts, "props without the
--    wait". Admin → Admin log shows them next to the moderation actions.

-- ─── 1. One admin ──────────────────────────────────────────────────────────

do $$
declare
  admins text := (select string_agg(p.username::text, ', ' order by p.username) from public.profiles p where p.is_admin);
begin
  if (select count(*) from public.profiles p where p.is_admin) > 1 then
    raise exception 'More than one admin (%). Keep yours: update public.profiles set is_admin = false where is_admin and username <> ''your_name''; then run this file again.', admins;
  end if;
end;
$$;
create unique index if not exists profiles_one_admin on public.profiles ((true)) where is_admin;

-- ─── 2. Test accounts, left out of the numbers ─────────────────────────────

alter table public.profiles add column if not exists is_test boolean not null default false;
create index if not exists visits_user_idx on public.visits (user_id) where user_id is not null;

-- The admin and test accounts.
create or replace function public.metrics_left_out()
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.is_admin or p.is_test;
$$;
revoke execute on function public.metrics_left_out() from public, anon, authenticated;

-- Every phone or browser one of them has signed in on.
create or replace function public.metrics_left_out_visitors()
returns table (visitor uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct v.visitor from public.visits v where v.user_id in (select o.id from public.metrics_left_out() o);
$$;
revoke execute on function public.metrics_left_out_visitors() from public, anon, authenticated;

create or replace function public.day_counts(from_day date, to_day date)
returns table (day date, votes int, voters int, shares int, polls int, signups int)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select generate_series(from_day, to_day, interval '1 day')::date as day),
  lo as (select (from_day::timestamp at time zone 'Asia/Kolkata') as t0,
                ((to_day + 1)::timestamp at time zone 'Asia/Kolkata') as t1),
  left_out as (select o.id from public.metrics_left_out() o),
  vt as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as votes, count(distinct x.user_id)::int as voters
    from public.votes x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1
      and x.user_id not in (select left_out.id from left_out) group by 1
  ),
  sh as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as shares
    from public.shares x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1
      and x.user_id not in (select left_out.id from left_out) group by 1
  ),
  pl as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as polls
    from public.polls x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1 and not x.is_system
      and (x.creator_id is null or x.creator_id not in (select left_out.id from left_out)) group by 1
  ),
  su as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as signups
    from public.profiles x, lo where x.created_at >= lo.t0 and x.created_at < lo.t1
      and x.username::text not like 'guest\_%' and not x.is_test and not x.is_admin group by 1
  )
  select d.day, coalesce(vt.votes, 0), coalesce(vt.voters, 0), coalesce(sh.shares, 0),
         coalesce(pl.polls, 0), coalesce(su.signups, 0)
  from d
  left join vt on vt.day = d.day
  left join sh on sh.day = d.day
  left join pl on pl.day = d.day
  left join su on su.day = d.day;
$$;
revoke execute on function public.day_counts(date, date) from public, anon, authenticated;

create or replace function public.admin_metrics(days int default 14)
returns table (
  day date, visitors int, new_visitors int, signed_in int, sessions int, signed_sessions int, voters int, votes int,
  shares int, polls int, signups int,
  vote_pct numeric, votes_per_session numeric, share_rate numeric, d1 numeric, d7 numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int := least(greatest(coalesce(days, 14), 1), 90);
  since date := today - (n - 1);
  gap date;
begin
  perform public.require_admin();
  -- Count any finished day in the window that isn't stored yet.
  gap := (select min(g.day)::date
          from generate_series(since, today - 1, interval '1 day') g(day)
          where not exists (select 1 from public.metrics_daily m where m.day = g.day::date));
  if gap is not null then
    insert into public.metrics_daily (day, votes, voters, shares, polls, signups)
    select x.day, x.votes, x.voters, x.shares, x.polls, x.signups from public.day_counts(gap, today - 1) x
    on conflict on constraint metrics_daily_pkey do nothing;
  end if;

  return query
  with d as (
    select generate_series(since, today, interval '1 day')::date as day
  ),
  out_v as (select o.visitor from public.metrics_left_out_visitors() o),
  out_u as (select o.id from public.metrics_left_out() o),
  vis as (
    select v.day, count(*)::int as visitors,
           count(*) filter (where v.user_id is not null)::int as signed_in,
           coalesce(sum(v.sessions) filter (where v.user_id is not null), 0)::int as signed_sessions,
           sum(v.sessions)::int as sessions
    from public.visits v
    where v.day >= since
      and v.visitor not in (select out_v.visitor from out_v)
      and (v.user_id is null or v.user_id not in (select out_u.id from out_u))
    group by v.day
  ),
  back as (
    select f.first_day as day, count(*)::int as cohort,
           count(b1.visitor)::numeric as back1, count(b7.visitor)::numeric as back7
    from public.visitors f
    left join public.visits b1 on b1.visitor = f.visitor and b1.day = f.first_day + 1
    left join public.visits b7 on b7.visitor = f.visitor and b7.day = f.first_day + 7
    where f.first_day >= since and f.visitor not in (select out_v.visitor from out_v)
    group by f.first_day
  ),
  c as (
    select m.day, m.votes, m.voters, m.shares, m.polls, m.signups
    from public.metrics_daily m where m.day >= since and m.day < today
    union all
    select x.day, x.votes, x.voters, x.shares, x.polls, x.signups from public.day_counts(today, today) x
  )
  select d.day,
         coalesce(vis.visitors, 0), coalesce(back.cohort, 0), coalesce(vis.signed_in, 0), coalesce(vis.sessions, 0),
         coalesce(vis.signed_sessions, 0),
         coalesce(c.voters, 0), coalesce(c.votes, 0), coalesce(c.shares, 0), coalesce(c.polls, 0), coalesce(c.signups, 0),
         round(100.0 * c.voters / nullif(vis.visitors, 0), 1),
         round(c.votes::numeric / nullif(vis.signed_sessions, 0), 1),
         round(100.0 * c.shares / nullif(c.votes, 0), 1),
         case when d.day + 1 < today then round(100 * back.back1 / nullif(back.cohort, 0), 1) end,
         case when d.day + 7 < today then round(100 * back.back7 / nullif(back.cohort, 0), 1) end
  from d
  left join vis on vis.day = d.day
  left join back on back.day = d.day
  left join c on c.day = d.day
  order by d.day desc;
end;
$$;
revoke execute on function public.admin_metrics(int) from public, anon;
grant execute on function public.admin_metrics(int) to authenticated;

create or replace function public.admin_view_stats(days int default 14)
returns table (day date, views int, votes int, votes_per_100_views numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int := least(greatest(coalesce(days, 14), 1), 90);
begin
  perform public.require_admin();
  return query
  with d as (
    select generate_series(today - (n - 1), today, interval '1 day')::date as day
  ),
  v as (
    select (x.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as votes
    from public.votes x
    where x.created_at >= ((today - (n - 1))::timestamp at time zone 'Asia/Kolkata')
      and x.user_id not in (select o.id from public.metrics_left_out() o)
    group by 1
  )
  select d.day, coalesce(w.views, 0), coalesce(v.votes, 0),
         round(100.0 * v.votes / nullif(w.views, 0), 1)
  from d
  left join public.views_daily w on w.day = d.day
  left join v on v.day = d.day
  order by d.day desc;
end;
$$;
revoke execute on function public.admin_view_stats(int) from public, anon;
grant execute on function public.admin_view_stats(int) to authenticated;

-- The stored days were counted with everyone in; they're recounted the next time Metrics opens.
delete from public.metrics_daily where day is not null;

-- ─── 3. Admin log: other changes ───────────────────────────────────────────

create table if not exists public.admin_events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  admin_id  uuid references public.profiles (id) on delete set null,
  action    text not null,
  detail    text
);
create index if not exists admin_events_at_idx on public.admin_events (at desc);
alter table public.admin_events enable row level security;
revoke all on table public.admin_events from public, anon, authenticated;

create or replace function public.admin_event(action text, detail text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_events (admin_id, action, detail) values (auth.uid(), admin_event.action, left(admin_event.detail, 200));
$$;
revoke execute on function public.admin_event(text, text) from public, anon, authenticated;

-- Words: logged when an admin changes the list (not by migrations, which have no user).
create or replace function public.log_word_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.admin_event('word_added', new.term || ' (' || new.kind || ')');
  elsif tg_op = 'DELETE' then
    perform public.admin_event('word_removed', old.term);
  elsif old.kind is distinct from new.kind then
    perform public.admin_event('word_changed', new.term || ' → ' || new.kind);
  end if;
  return null;
end;
$$;
revoke execute on function public.log_word_change() from public, anon, authenticated;
drop trigger if exists blocked_terms_log on public.blocked_terms;
create trigger blocked_terms_log after insert or update or delete on public.blocked_terms
  for each row execute function public.log_word_change();

-- Other changes, newest first.
create or replace function public.admin_events_list(max_rows int default 50)
returns table (at timestamptz, action text, detail text, admin text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select e.at, e.action, e.detail, a.username::text
  from public.admin_events e
  left join public.profiles a on a.id = e.admin_id
  order by e.at desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;
revoke execute on function public.admin_events_list(int) from public, anon;
grant execute on function public.admin_events_list(int) to authenticated;

-- Test accounts: the list, and marking one.
create or replace function public.admin_test_accounts()
returns table (username text, avatar_url text, joined timestamptz, votes int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select p.username::text, p.avatar_url, p.created_at, (select count(*)::int from public.votes v where v.user_id = p.id)
  from public.profiles p
  where p.is_test
  order by p.username;
end;
$$;
revoke execute on function public.admin_test_accounts() from public, anon;
grant execute on function public.admin_test_accounts() to authenticated;

create or replace function public.admin_set_test(username text, on_now boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
  target uuid := (select p.id from public.profiles p where p.username = lower(admin_set_test.username));
begin
  if target is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if target = uid then
    raise exception 'docchi:own_account' using errcode = '22023'; -- yours is always left out
  end if;
  update public.profiles p set is_test = on_now where p.id = target;
  -- Recounted the next time Metrics opens.
  delete from public.metrics_daily where day is not null;
  perform public.admin_event(case when on_now then 'test_added' else 'test_removed' end, '@' || lower(admin_set_test.username));
end;
$$;
revoke execute on function public.admin_set_test(text, boolean) from public, anon;
grant execute on function public.admin_set_test(text, boolean) to authenticated;

-- "Props without the wait", now logged.
create or replace function public.admin_props_no_wait(on_now boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
begin
  if on_now is not null then
    update public.profiles p set props_no_wait = on_now where p.id = uid;
    if on_now then
      update public.props x set notify_after = now()
      where x.picked_id = uid and x.notified_at is null and x.notify_after > now();
    end if;
    perform public.admin_event('props_no_wait', case when on_now then 'on' else 'off' end);
  end if;
  return (select p.props_no_wait from public.profiles p where p.id = uid);
end;
$$;
revoke execute on function public.admin_props_no_wait(boolean) from public, anon;
grant execute on function public.admin_props_no_wait(boolean) to authenticated;
