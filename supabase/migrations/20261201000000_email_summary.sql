-- Email: an evening summary for people push can't reach. (No temporary tables and no
-- SELECT … INTO in this file: the Supabase SQL editor takes those for new tables.)
--
-- On iPhone, notifications only work after Eithr is added to the Home Screen, so many
-- people can't get them at all. They signed in with Google, so we have their email: once
-- a day at most, in the evening (6–9 pm India time), anyone with no phone set up for push
-- who hasn't opened Eithr since yesterday and has something waiting (votes or comments on
-- their polls, props, friend requests) gets one short email. Sent by /api/push/run with
-- Resend; turned off with one click (the link in every email) or in Settings.
--
--   profiles.email_off     the person said no to these emails
--   email_sends            one row per person per day sent, so nobody gets two in a day

alter table public.profiles add column if not exists email_off boolean not null default false;

create table if not exists public.email_sends (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  sent_at  timestamptz not null default now(),
  summary  jsonb,
  primary key (user_id, day)
);
create index if not exists email_sends_sent_idx on public.email_sends (user_id, sent_at desc);
alter table public.email_sends enable row level security;
revoke all on table public.email_sends from public, anon, authenticated;

-- Emails go out in the evening, India time (6–9 pm).
create or replace function public.email_hour_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(hour from now() at time zone 'Asia/Kolkata') between 18 and 20;
$$;
revoke execute on function public.email_hour_ok() from public, anon, authenticated;

-- Who's due an email now, and what's waiting for them; each one counts as sent once returned.
-- Needs the push job's secret.
create or replace function public.email_summary_collect(secret text, max_rows int default 50)
returns table (user_id uuid, email text, username text, votes int, comments int, props int, requests int, top_poll uuid, top_question text)
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
  if not public.email_hour_ok() then
    return;
  end if;

  return query
  with people as (
    select p.id, u.email::text as email, p.username::text as username,
           greatest(now() - interval '48 hours',
                    coalesce((select max(e.sent_at) from public.email_sends e where e.user_id = p.id), '-infinity')) as since
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null and u.email <> '' and not coalesce(u.is_anonymous, false)
      and not p.email_off and not p.is_banned
      and p.username::text not like 'guest\_%'
      -- Push reaches them: no email.
      and not exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
      -- Opened Eithr since yesterday: they've seen it.
      and not exists (select 1 from public.visits v where v.user_id = p.id and v.last_at > now() - interval '20 hours')
      and not exists (select 1 from public.email_sends e where e.user_id = p.id and e.day = today)
  ),
  counted as (
    select pp.*,
      (select count(*)::int from public.votes v join public.polls q on q.id = v.poll_id
        where q.creator_id = pp.id and v.user_id <> pp.id and v.created_at > pp.since) as votes,
      (select count(*)::int from public.comments c join public.polls q on q.id = c.poll_id
        where q.creator_id = pp.id and c.user_id <> pp.id and not c.is_hidden and c.created_at > pp.since) as comments,
      (select count(*)::int from public.props x
        where x.picked_id = pp.id and x.notify_after > pp.since and x.notify_after <= now()) as props,
      (select count(*)::int from public.circle_members m
        where m.owner_id = pp.id and m.status = 'pending' and m.created_at > pp.since) as requests,
      (select q.id from public.polls q
        where q.creator_id = pp.id and q.deleted_at is null and not q.is_hidden
          and exists (select 1 from public.votes v where v.poll_id = q.id and v.user_id <> pp.id and v.created_at > pp.since)
        order by (select count(*) from public.votes v where v.poll_id = q.id and v.created_at > pp.since) desc
        limit 1) as top_poll
    from people pp
  ),
  due as (
    select c.* from counted c
    where c.votes + c.comments + c.props + c.requests > 0
    order by c.id
    limit least(greatest(coalesce(max_rows, 50), 1), 200)
  ),
  claimed as (
    insert into public.email_sends (user_id, day, summary)
    select d.id, today, jsonb_build_object('votes', d.votes, 'comments', d.comments, 'props', d.props, 'requests', d.requests)
    from due d
    on conflict on constraint email_sends_pkey do nothing
    returning email_sends.user_id
  )
  select d.id, d.email, d.username, d.votes, d.comments, d.props, d.requests, d.top_poll,
         (select q.question from public.polls q where q.id = d.top_poll)
  from due d
  where d.id in (select c.user_id from claimed c);
end;
$$;
revoke execute on function public.email_summary_collect(text, int) from public;
grant execute on function public.email_summary_collect(text, int) to anon, authenticated;

-- The one-click "Stop these emails" link (the route checks the link's signature first).
create or replace function public.email_unsubscribe(secret text, person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  update public.profiles p set email_off = true where p.id = person;
end;
$$;
revoke execute on function public.email_unsubscribe(text, uuid) from public;
grant execute on function public.email_unsubscribe(text, uuid) to anon, authenticated;

-- Settings → "Email me what I missed": read it (off = null) or set it, for yourself.
create or replace function public.my_email_summary(off boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '42501';
  end if;
  if off is not null then
    update public.profiles p set email_off = my_email_summary.off where p.id = uid;
  end if;
  return jsonb_build_object(
    'on', not (select p.email_off from public.profiles p where p.id = uid),
    'has_email', exists (select 1 from auth.users u where u.id = uid and u.email is not null and u.email <> ''));
end;
$$;
revoke execute on function public.my_email_summary(boolean) from public, anon;
grant execute on function public.my_email_summary(boolean) to authenticated;
