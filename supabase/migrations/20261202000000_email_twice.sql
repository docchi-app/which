-- Email, take two: up to two a day, and no longer skipped for people who opened Eithr.
-- (No temporary tables and no SELECT … INTO in this file: the Supabase SQL editor takes
-- those for new tables.)
--
--   * Lunch, 12:30–2 pm India time: what came in since the last email (overnight, morning).
--   * Evening, 6:30–9 pm: what came in since then (the afternoon).
--   * Each email counts only what's new since the previous one, so nothing repeats; with
--     nothing new, no email.
--   * Still only for people push can't reach, and still off with one click or in Settings.
--   * The email names who commented and who asked to be friends (as the app does), plus
--     the answers of the top poll so it can tease the result. Props never say who.

-- One row per person per day per send.
alter table public.email_sends add column if not exists slot text not null default 'evening';
alter table public.email_sends drop constraint if exists email_sends_slot_check;
alter table public.email_sends add constraint email_sends_slot_check check (slot in ('lunch', 'evening'));
alter table public.email_sends drop constraint if exists email_sends_pkey;
alter table public.email_sends add constraint email_sends_pkey primary key (user_id, day, slot);

-- Which send is open now, India time: 'lunch', 'evening' or null.
create or replace function public.email_slot()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when t >= time '12:30' and t < time '14:00' then 'lunch'
    when t >= time '18:30' and t < time '21:00' then 'evening'
  end
  from (select (now() at time zone 'Asia/Kolkata')::time as t) n;
$$;
revoke execute on function public.email_slot() from public, anon, authenticated;

drop function if exists public.email_hour_ok();

-- Who's due an email now, and what's waiting for them; each one counts as sent once returned.
-- Needs the push job's secret.
drop function if exists public.email_summary_collect(text, int);
create function public.email_summary_collect(secret text, max_rows int default 50)
returns table (user_id uuid, email text, username text, slot text,
               votes int, comments int, props int, requests int,
               top_poll uuid, top_question text, top_votes int, top_answers text[],
               commenters text[], commenter_count int, requesters text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  this_slot text := public.email_slot();
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  if this_slot is null then
    return;
  end if;

  return query
  with people as (
    select p.id, u.email::text as email, p.username::text as username,
           -- Since the last email (at most two days back).
           greatest(now() - interval '48 hours',
                    coalesce((select max(e.sent_at) from public.email_sends e where e.user_id = p.id), '-infinity')) as since
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null and u.email <> '' and not coalesce(u.is_anonymous, false)
      and not p.email_off and not p.is_banned
      and p.username::text not like 'guest\_%'
      -- Push reaches them: no email.
      and not exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
      and not exists (select 1 from public.email_sends e where e.user_id = p.id and e.day = today and e.slot = this_slot)
  ),
  counted as (
    select pp.*,
      (select count(*)::int from public.votes v join public.polls q on q.id = v.poll_id
        where q.creator_id = pp.id and v.user_id <> pp.id and v.created_at > pp.since) as n_votes,
      (select count(*)::int from public.comments c join public.polls q on q.id = c.poll_id
        where q.creator_id = pp.id and c.user_id <> pp.id and not c.is_hidden and c.created_at > pp.since) as n_comments,
      (select count(*)::int from public.props x
        where x.picked_id = pp.id and x.notify_after > pp.since and x.notify_after <= now()) as n_props,
      (select count(*)::int from public.circle_members m
        where m.owner_id = pp.id and m.status = 'pending' and m.initiator and m.created_at > pp.since) as n_requests,
      (select q.id from public.polls q
        where q.creator_id = pp.id and q.deleted_at is null and not q.is_hidden
          and exists (select 1 from public.votes v where v.poll_id = q.id and v.user_id <> pp.id and v.created_at > pp.since)
        order by (select count(*) from public.votes v where v.poll_id = q.id and v.user_id <> pp.id and v.created_at > pp.since) desc, q.created_at desc
        limit 1) as poll
    from people pp
  ),
  due as (
    select c.* from counted c
    where c.n_votes + c.n_comments + c.n_props + c.n_requests > 0
    order by c.id
    limit least(greatest(coalesce(max_rows, 50), 1), 200)
  ),
  claimed as (
    insert into public.email_sends (user_id, day, slot, summary)
    select d.id, today, this_slot,
           jsonb_build_object('votes', d.n_votes, 'comments', d.n_comments, 'props', d.n_props, 'requests', d.n_requests)
    from due d
    on conflict on constraint email_sends_pkey do nothing
    returning email_sends.user_id
  )
  select d.id, d.email, d.username, this_slot, d.n_votes, d.n_comments, d.n_props, d.n_requests,
         d.poll,
         (select q.question from public.polls q where q.id = d.poll),
         (select count(*)::int from public.votes v where v.poll_id = d.poll and v.user_id <> d.id and v.created_at > d.since),
         array(select o.text from public.poll_options o where o.poll_id = d.poll order by o.position),
         -- Up to 3 people who commented, latest first.
         array(select w.username::text from public.comments c
                 join public.polls q on q.id = c.poll_id
                 join public.profiles w on w.id = c.user_id
               where q.creator_id = d.id and c.user_id <> d.id and not c.is_hidden and c.created_at > d.since
               group by w.username order by max(c.created_at) desc limit 3),
         (select count(distinct c.user_id)::int from public.comments c join public.polls q on q.id = c.poll_id
           where q.creator_id = d.id and c.user_id <> d.id and not c.is_hidden and c.created_at > d.since),
         -- Up to 3 people who asked to be friends, latest first.
         array(select w.username::text from public.circle_members m
                 join public.profiles w on w.id = m.member_id
               where m.owner_id = d.id and m.status = 'pending' and m.initiator and m.created_at > d.since
               order by m.created_at desc limit 3)
  from due d
  where d.id in (select c.user_id from claimed c);
end;
$$;
revoke execute on function public.email_summary_collect(text, int) from public;
grant execute on function public.email_summary_collect(text, int) to anon, authenticated;
