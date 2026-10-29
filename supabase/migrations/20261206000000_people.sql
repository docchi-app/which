-- Admin → Users and Guests. (No temporary tables and no SELECT … INTO in this file: the
-- Supabase SQL editor takes those for new tables.)
--
--   visitor_info   one row per browser: where its first visit came from (a shared poll, an
--                  invite, Instagram…), phone and browser type, installed or not, and what
--                  it answered to notifications. Never the full address, the exact phone
--                  model or an IP address. Recorded from the next visit on.
--   profiles.was_guest / signed_up_at   a guest who linked Google: when they signed up, so
--                  "was a guest for 2 days" and the Guests numbers work (from now on; older
--                  accounts count as signed up when they were made).
--
-- The admin reads it through admin_users(), admin_user_detail(), admin_users_summary(),
-- admin_guests() and admin_guest_list(). Emails stay hidden: admin_user_email() shows one and
-- writes that in the admin log. admin_reset_username() gives someone a fresh name to change.

create table if not exists public.visitor_info (
  visitor      uuid primary key,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  source       text,
  source_by    text,
  source_poll  uuid,
  site         text,
  device       text,
  browser      text,
  in_app       text,
  installed    boolean,
  notif        text,
  user_id      uuid references public.profiles (id) on delete set null
);
create index if not exists visitor_info_user_idx on public.visitor_info (user_id, last_at desc);
alter table public.visitor_info enable row level security;
revoke all on table public.visitor_info from public, anon, authenticated;

alter table public.profiles add column if not exists was_guest boolean not null default false;
alter table public.profiles add column if not exists signed_up_at timestamptz;

-- A guest who links Google: note when, and that they were a guest.
create or replace function public.note_guest_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    update public.profiles p set was_guest = true, signed_up_at = now() where p.id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.note_guest_signup() from public, anon, authenticated;
drop trigger if exists note_guest_signup on auth.users;
create trigger note_guest_signup after update on auth.users
  for each row execute function public.note_guest_signup();

-- The app tells us about this browser: once on the first visit (where it came from), then
-- whenever the phone, the install or the notifications answer changes.
create or replace function public.record_visitor(
  visitor uuid, source text default null, source_by text default null, source_poll uuid default null,
  site text default null, device text default null, browser text default null, in_app text default null,
  installed boolean default null, notif text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  src text := case when record_visitor.source in ('poll', 'invite', 'email', 'notification', 'instagram', 'whatsapp',
                                                  'facebook', 'x', 'snapchat', 'old_address', 'search', 'other_site', 'direct')
                   then record_visitor.source else 'other_site' end;
begin
  if record_visitor.visitor is null then
    return;
  end if;
  -- A browser that visited before this was recorded: its first visit is unknown.
  if exists (select 1 from public.visits v where v.visitor = record_visitor.visitor and v.first_at < now() - interval '1 hour') then
    src := null;
  end if;
  insert into public.visitor_info as i (visitor, source, source_by, source_poll, site, device, browser, in_app, installed, notif, user_id)
  values (record_visitor.visitor, src, case when src is not null then left(record_visitor.source_by, 30) end,
          case when src is not null then record_visitor.source_poll end,
          case when src is not null then left(lower(record_visitor.site), 60) end, left(record_visitor.device, 30), left(record_visitor.browser, 30),
          left(record_visitor.in_app, 30), record_visitor.installed,
          case when record_visitor.notif in ('default', 'granted', 'denied', 'unsupported') then record_visitor.notif end,
          auth.uid())
  on conflict on constraint visitor_info_pkey do update
    set last_at = now(),
        device = coalesce(excluded.device, i.device),
        browser = coalesce(excluded.browser, i.browser),
        in_app = excluded.in_app,
        installed = coalesce(excluded.installed, i.installed),
        notif = coalesce(excluded.notif, i.notif),
        user_id = coalesce(auth.uid(), i.user_id);
end;
$$;
revoke execute on function public.record_visitor(uuid, text, text, uuid, text, text, text, text, boolean, text) from public;
grant execute on function public.record_visitor(uuid, text, text, uuid, text, text, text, text, boolean, text) to anon, authenticated;

-- Who made a poll (for "came from a poll by @…").
create or replace function public.poll_author(poll uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.username::text from public.polls q join public.profiles p on p.id = q.creator_id where q.id = poll;
$$;
revoke execute on function public.poll_author(uuid) from public, anon, authenticated;

-- Notifications for one person: on (a phone set up), blocked, off, never asked, or unknown.
create or replace function public.person_push(person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.push_subscriptions s where s.user_id = person) then 'on'
    else coalesce((select case i.notif when 'denied' then 'blocked' when 'granted' then 'off'
                                       when 'default' then 'never' when 'unsupported' then 'unsupported' end
                   from public.visitor_info i where i.user_id = person and i.notif is not null
                   order by i.last_at desc limit 1), 'unknown')
  end;
$$;
revoke execute on function public.person_push(uuid) from public, anon, authenticated;

-- One person's row for the Users list (internal).
create or replace function public.person_row(person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username::text,
    'name', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    'avatar_url', p.avatar_url,
    'joined', coalesce(p.signed_up_at, p.created_at),
    'was_guest', p.was_guest, 'guest_since', case when p.was_guest then p.created_at end,
    'source', f.source, 'source_by', coalesce(f.source_by, public.poll_author(f.source_poll)), 'site', f.site,
    'device', l.device, 'browser', l.browser, 'in_app', l.in_app, 'installed', l.installed,
    'last_active', (select max(v.last_at) from public.visits v where v.user_id = p.id),
    'votes', (select count(*) from public.votes v where v.user_id = p.id),
    'polls', (select count(*) from public.polls q where q.creator_id = p.id and q.kind <> 'snap'),
    'snaps', (select count(*) from public.polls q where q.creator_id = p.id and q.kind = 'snap'),
    'friends', (select count(*) from public.circle_members m where m.owner_id = p.id and m.status = 'accepted'),
    'push', public.person_push(p.id),
    'is_test', p.is_test, 'is_banned', p.is_banned, 'is_admin', p.is_admin)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (select i.* from public.visitor_info i where i.user_id = p.id order by i.first_at limit 1) f on true
  left join lateral (select i.* from public.visitor_info i where i.user_id = p.id order by i.last_at desc limit 1) l on true
  where p.id = person;
$$;
revoke execute on function public.person_row(uuid) from public, anon, authenticated;

-- Everyone who signed up (not guests). filter: all, week (joined this week), novote, push_off
-- (anything but on), banned, test. sort: new, active, votes, friends.
create or replace function public.admin_users(filter text default 'all', search text default null,
                                              sort text default 'new', max_rows int default 50, skip int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := nullif(trim(coalesce(search, '')), '');
begin
  perform public.require_admin();
  return (
    with people as (
      select p.id
      from public.profiles p
      join auth.users u on u.id = p.id
      where not coalesce(u.is_anonymous, false)
        and (q is null or p.username::text ilike '%' || q || '%'
             or coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') ilike '%' || q || '%')
        and case coalesce(filter, 'all')
              when 'week' then coalesce(p.signed_up_at, p.created_at) > now() - interval '7 days'
              when 'novote' then not exists (select 1 from public.votes v where v.user_id = p.id)
              when 'push_off' then public.person_push(p.id) <> 'on'
              when 'banned' then p.is_banned
              when 'test' then p.is_test or p.is_admin
              else true
            end
    ),
    rows as (select public.person_row(x.id) as r from people x)
    select jsonb_build_object(
      'total', (select count(*) from rows),
      'rows', coalesce((
        select jsonb_agg(s.r) from (
          select r.r from rows r
          order by
            case when sort = 'active' then (r.r ->> 'last_active')::timestamptz end desc nulls last,
            case when sort = 'votes' then (r.r ->> 'votes')::int end desc nulls last,
            case when sort = 'friends' then (r.r ->> 'friends')::int end desc nulls last,
            (r.r ->> 'joined')::timestamptz desc
          limit least(greatest(coalesce(max_rows, 50), 1), 200) offset greatest(coalesce(skip, 0), 0)
        ) s), '[]'::jsonb))
  );
end;
$$;
revoke execute on function public.admin_users(text, text, text, int, int) from public, anon;
grant execute on function public.admin_users(text, text, text, int, int) to authenticated;

-- The tiles above the list. Test accounts and the admin are left out.
create or replace function public.admin_users_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    with people as (
      select p.id, coalesce(p.signed_up_at, p.created_at) as joined
      from public.profiles p join auth.users u on u.id = p.id
      where not coalesce(u.is_anonymous, false) and p.id not in (select x.id from public.metrics_left_out() x)
    )
    select jsonb_build_object(
      'total', (select count(*) from people),
      'new_week', (select count(*) from people x where x.joined > now() - interval '7 days'),
      'active_week', (select count(distinct v.user_id) from public.visits v join people x on x.id = v.user_id
                      where v.last_at > now() - interval '7 days'),
      'push_on', (select count(*) from people x where public.person_push(x.id) = 'on'),
      'push_never', (select count(*) from people x where public.person_push(x.id) in ('never', 'unknown')),
      'no_vote', (select count(*) from people x where not exists (select 1 from public.votes v where v.user_id = x.id)))
  );
end;
$$;
revoke execute on function public.admin_users_summary() from public, anon;
grant execute on function public.admin_users_summary() to authenticated;

-- One person's page: facts, counts, what they've done (newest first) and every poll they made.
create or replace function public.admin_user_detail(person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base jsonb;
  addr text := (select u.email::text from auth.users u where u.id = person);
begin
  perform public.require_admin();
  base := public.person_row(person);
  if base is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  return base || jsonb_build_object(
    'email_hint', case when addr is null or addr = '' then null
                       else left(addr, 1) || '••••@' || split_part(addr, '@', 2) end,
    'comments', (select count(*) from public.comments c where c.user_id = person),
    'props_given', (select count(*) from public.props x where x.picker_id = person),
    'props_received', (select count(*) from public.props x where x.picked_id = person),
    'days_active', (select count(distinct v.day) from public.visits v where v.user_id = person),
    'streak', coalesce((select s.current_days from public.streak_of(person) s), 0),
    'reports', (select count(*) from public.reports r
                where (r.target_type = 'user' and r.target_id = person)
                   or (r.target_type = 'poll' and r.target_id in (select q.id from public.polls q where q.creator_id = person))
                   or (r.target_type = 'comment' and r.target_id in (select c.id from public.comments c where c.user_id = person))),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('at', t.at, 'kind', t.kind, 'text', t.text) order by t.at desc), '[]'::jsonb)
                 from (select * from (
                   select i.first_at as at, 'visit' as kind,
                          'First visit' || coalesce(' (' || case i.source
                            when 'poll' then 'a shared poll' || coalesce(' by @' || coalesce(i.source_by, public.poll_author(i.source_poll)), '')
                            when 'invite' then 'an invite' || coalesce(' from @' || i.source_by, '')
                            when 'old_address' then 'the old address'
                            when 'other_site' then coalesce(i.site, 'another site')
                            when 'direct' then 'typed or bookmarked'
                            else i.source end || ')', '') as text
                     from public.visitor_info i where i.user_id = person
                   union all
                   select p.created_at, 'guest', 'Started as a guest' from public.profiles p where p.id = person and p.was_guest
                   union all
                   select coalesce(p.signed_up_at, p.created_at), 'signup', 'Signed in with Google' from public.profiles p where p.id = person
                   union all
                   select min(v.created_at), 'vote', 'First vote' from public.votes v where v.user_id = person having count(*) > 0
                   union all
                   select q.created_at, 'poll', case when q.kind = 'snap' then 'Posted a snap “' else 'Posted “' end || q.question || '”'
                     from public.polls q where q.creator_id = person
                   union all
                   select m.accepted_at, 'friend', 'Became friends with @' || f.username::text
                     from public.circle_members m join public.profiles f on f.id = m.member_id
                     where m.owner_id = person and m.status = 'accepted' and m.accepted_at is not null
                   union all
                   select min(s.created_at), 'push', 'Turned on notifications' from public.push_subscriptions s where s.user_id = person having count(*) > 0
                   union all
                   select r.created_at, 'report', 'Reported: ' || left(r.reason, 60) from public.reports r
                     where (r.target_type = 'user' and r.target_id = person)
                        or (r.target_type = 'poll' and r.target_id in (select q.id from public.polls q where q.creator_id = person))
                        or (r.target_type = 'comment' and r.target_id in (select c.id from public.comments c where c.user_id = person))
                   union all
                   select a.created_at, 'mod', case a.action when 'ban' then 'Banned' when 'unban' then 'Unbanned'
                                                             when 'remove' then 'A ' || a.target_type || ' of theirs was removed'
                                                             when 'restore' then 'A ' || a.target_type || ' of theirs was restored'
                                                             else a.action end
                     from public.mod_actions a
                     where a.undone_at is null
                       and ((a.target_type = 'user' and a.target_id = person)
                         or (a.target_type = 'poll' and a.target_id in (select q.id from public.polls q where q.creator_id = person))
                         or (a.target_type = 'comment' and a.target_id in (select c.id from public.comments c where c.user_id = person)))
                 ) all_events where all_events.at is not null order by all_events.at desc limit 30) t),
    'poll_list', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', q.id, 'question', q.question, 'kind', q.kind, 'visibility', q.visibility,
                    'created_at', q.created_at, 'closes_at', q.closes_at, 'votes', q.vote_count,
                    'hidden', q.is_hidden, 'deleted', q.deleted_at is not null) order by q.created_at desc), '[]'::jsonb)
                  from (select * from public.polls q where q.creator_id = person order by q.created_at desc limit 50) q));
end;
$$;
revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- Show one person's email (written in the admin log).
create or replace function public.admin_user_email(person uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text;
  who text := (select p.username::text from public.profiles p where p.id = person);
begin
  perform public.require_admin();
  if who is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  addr := (select u.email::text from auth.users u where u.id = person);
  perform public.admin_event('email_viewed', '@' || who);
  return addr;
end;
$$;
revoke execute on function public.admin_user_email(uuid) from public, anon;
grant execute on function public.admin_user_email(uuid) to authenticated;

-- A fresh username they're asked to change the next time they open Eithr.
create or replace function public.admin_reset_username(person uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_name text := (select p.username::text from public.profiles p where p.id = person);
  new_name text := 'user_' || left(replace(person::text, '-', ''), 10);
begin
  perform public.require_admin();
  if old_name is null then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
  if person = auth.uid() then
    raise exception 'docchi:own_account' using errcode = 'P0001';
  end if;
  update public.profiles p set username = new_name, username_confirmed = false where p.id = person;
  perform public.admin_event('username_reset', '@' || old_name || ' → @' || new_name);
  return new_name;
end;
$$;
revoke execute on function public.admin_reset_username(uuid) from public, anon;
grant execute on function public.admin_reset_username(uuid) to authenticated;

-- Guests: visitors, guests who voted, and guests who then signed up, over the last `days`.
create or replace function public.admin_guests(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d int := greatest(least(coalesce(days, 7), 90), 1);
  since timestamptz := now() - make_interval(days => d);
begin
  perform public.require_admin();
  return (
    with guests as (
      select p.id, p.created_at, p.signed_up_at, p.was_guest,
             coalesce(u.is_anonymous, false) as still_guest,
             (select count(*) from public.votes v where v.user_id = p.id) as votes
      from public.profiles p join auth.users u on u.id = p.id
      where p.created_at > since and (coalesce(u.is_anonymous, false) or p.was_guest)
        and p.id not in (select x.id from public.metrics_left_out() x)
    ),
    voted as (select * from guests g where g.votes > 0),
    signed as (select * from voted g where not g.still_guest and g.signed_up_at is not null),
    range_votes as (
      select v.user_id, v.created_at from public.votes v
      where v.created_at > since and v.user_id not in (select x.id from public.metrics_left_out() x)
    )
    select jsonb_build_object(
      'opened', (select count(distinct v.visitor) from public.visits v
                 left join public.profiles p on p.id = v.user_id
                 left join auth.users u on u.id = v.user_id
                 where v.day > ((now() at time zone 'Asia/Kolkata')::date - d)
                   and v.visitor not in (select x.visitor from public.metrics_left_out_visitors() x)
                   and (v.user_id is null or coalesce(u.is_anonymous, false)
                        or coalesce(p.signed_up_at, p.created_at) > since)),
      'voted', (select count(*) from voted),
      'signed_up', (select count(*) from signed),
      'buckets', jsonb_build_object(
        'visit', (select count(*) from signed s where s.signed_up_at - s.created_at < interval '30 minutes'),
        'day', (select count(*) from signed s where s.signed_up_at - s.created_at >= interval '30 minutes' and s.signed_up_at - s.created_at < interval '1 day'),
        'days3', (select count(*) from signed s where s.signed_up_at - s.created_at >= interval '1 day' and s.signed_up_at - s.created_at < interval '3 days'),
        'later', (select count(*) from signed s where s.signed_up_at - s.created_at >= interval '3 days')),
      'median_minutes', (select round(extract(epoch from percentile_cont(0.5) within group (order by s.signed_up_at - s.created_at)) / 60)
                         from signed s),
      'votes', (select count(*) from range_votes),
      'guest_votes', (select count(*) from range_votes v
                      join public.profiles p on p.id = v.user_id join auth.users u on u.id = p.id
                      where coalesce(u.is_anonymous, false) or (p.was_guest and v.created_at < p.signed_up_at)),
      'one_vote', (select count(*) from voted g where g.still_guest and g.votes = 1),
      'avg_votes', (select round(avg(g.votes)::numeric, 1) from voted g),
      'median_votes', (select percentile_cont(0.5) within group (order by g.votes) from voted g))
  );
end;
$$;
revoke execute on function public.admin_guests(int) from public, anon;
grant execute on function public.admin_guests(int) to authenticated;

-- The guests themselves, by a short code (never a name). filter: still, signed, all.
create or replace function public.admin_guest_list(days int default 7, filter text default 'still')
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
    select coalesce(jsonb_agg(g.r order by (g.r ->> 'started')::timestamptz desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', p.id, 'code', left(md5(p.id::text), 4), 'started', p.created_at,
        'source', f.source, 'source_by', coalesce(f.source_by, public.poll_author(f.source_poll)), 'site', f.site,
        'device', l.device, 'browser', l.browser, 'in_app', l.in_app,
        'votes', (select count(*) from public.votes v where v.user_id = p.id),
        'last_seen', (select max(v.last_at) from public.visits v where v.user_id = p.id),
        'signed_up', not coalesce(u.is_anonymous, false),
        'username', case when coalesce(u.is_anonymous, false) then null else p.username::text end) as r
      from public.profiles p
      join auth.users u on u.id = p.id
      left join lateral (select i.* from public.visitor_info i where i.user_id = p.id order by i.first_at limit 1) f on true
      left join lateral (select i.* from public.visitor_info i where i.user_id = p.id order by i.last_at desc limit 1) l on true
      where p.created_at > since and (coalesce(u.is_anonymous, false) or p.was_guest)
        and p.id not in (select x.id from public.metrics_left_out() x)
        and case coalesce(filter, 'still')
              when 'still' then coalesce(u.is_anonymous, false)
              when 'signed' then not coalesce(u.is_anonymous, false)
              else true
            end
      order by p.created_at desc
      limit 200
    ) g
  );
end;
$$;
revoke execute on function public.admin_guest_list(int, text) from public, anon;
grant execute on function public.admin_guest_list(int, text) to authenticated;
