-- Comments.
-- Read a poll's comments once you've voted on it (or it has closed, or it's
-- yours), like results, so they can't spoil the vote or a mystery question.
-- Signed-in voters write (200 chars); each shows the writer's pick. Comments
-- leave the app after 24 hours (rows stay for moderation, then the purge).
-- Delete your own, or any on your poll. Report one: 3 reporters hide it until
-- an admin looks. Poll creators get a batched push ("3 new comments").

-- Comments were readable straight from the table (an RLS policy from the
-- first migration): that skipped the vote rule and circle privacy.
drop policy if exists "live comments are public" on public.comments;
revoke all on public.comments from anon, authenticated;

alter table public.comments add column hidden_at timestamptz;
-- 'deleted' by its writer or the poll's creator · 'reports' · 'admin' · 'ban'
alter table public.comments add column hidden_reason text
  check (hidden_reason in ('deleted', 'reports', 'admin', 'ban'));
create index comments_user_created_idx on public.comments (user_id, created_at);
create index comments_created_idx on public.comments (created_at);

-- Can this person read the comments on this poll?
create or replace function public.can_read_comments(poll uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.deleted_at is null and not p.is_hidden and p.created_at <= now()
       and public.can_view_poll(p.id, viewer)
       and (p.closes_at <= now() or p.creator_id = viewer
            or exists (select 1 from public.votes v where v.poll_id = p.id and v.user_id = viewer))
    from public.polls p where p.id = poll), false);
$$;
revoke execute on function public.can_read_comments(uuid, uuid) from public, anon, authenticated;

-- The conversation on a poll, oldest first (the latest 100).
--   can_read false → why: 'sign_in' | 'vote_first' | 'not_found'
create or replace function public.get_comments(poll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  guest boolean := uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  p record;
  list jsonb;
begin
  select x.id, x.creator_id, x.closes_at, x.deleted_at, x.is_hidden into p from public.polls x where x.id = poll;
  if p.id is null or p.deleted_at is not null or p.is_hidden or not public.can_view_poll(poll, uid) then
    return jsonb_build_object('can_read', false, 'why', 'not_found');
  end if;
  if not public.can_read_comments(poll, uid) then
    return jsonb_build_object('can_read', false, 'why', case when guest and p.closes_at > now() then 'sign_in' else 'vote_first' end);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'text', c.text, 'created_at', c.created_at,
           'username', u.username::text, 'avatar_url', u.avatar_url,
           'pick', o.text, 'pick_index', o.position,
           'is_mine', c.user_id = uid,
           'is_creator', c.user_id = p.creator_id,
           'can_delete', c.user_id = uid or p.creator_id = uid) order by c.created_at), '[]')
  into list
  from (
    select c.* from public.comments c
    where c.poll_id = poll and not c.is_hidden and c.expires_at > now()
      and not public.is_blocked_between(c.user_id, uid)
    order by c.created_at desc
    limit 100
  ) c
  join public.profiles u on u.id = c.user_id
  left join public.votes v on v.poll_id = c.poll_id and v.user_id = c.user_id
  left join public.poll_options o on o.id = v.option_id;

  return jsonb_build_object(
    'can_read', true,
    'can_post', not guest and p.closes_at > now()
                and not exists (select 1 from public.profiles b where b.id = uid and b.is_banned),
    'closed', p.closes_at <= now(),
    'comments', list);
end;
$$;
grant execute on function public.get_comments(uuid) to anon, authenticated;

create or replace function public.post_comment(poll uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t text := regexp_replace(trim(coalesce(body, '')), '\s+', ' ', 'g');
  p record;
  new_id uuid;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  select x.id, x.closes_at into p from public.polls x where x.id = poll;
  if p.id is null or not public.can_read_comments(poll, uid) then
    raise exception 'docchi:vote_first' using errcode = '42501';
  end if;
  if p.closes_at <= now() then
    raise exception 'docchi:closed' using errcode = '22023';
  end if;
  if char_length(t) not between 1 and 200 then
    raise exception 'docchi:comment_length' using errcode = '22023';
  end if;
  if public.has_blocked_term(t) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;
  -- Slow down: 5 on one poll per 10 minutes, 30 an hour overall.
  if (select count(*) from public.comments c where c.user_id = uid and c.poll_id = poll
        and c.created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.comments c where c.user_id = uid
        and c.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'docchi:slow_down' using errcode = '54000';
  end if;
  insert into public.comments (poll_id, user_id, text) values (poll, uid, t) returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;
revoke execute on function public.post_comment(uuid, text) from public, anon;
grant execute on function public.post_comment(uuid, text) to authenticated;

-- Your own comment, or any comment on your poll.
create or replace function public.delete_comment(comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.comments c
  set is_hidden = true, hidden_at = now(), hidden_reason = 'deleted'
  where c.id = comment and not c.is_hidden
    and (c.user_id = auth.uid()
         or exists (select 1 from public.polls p where p.id = c.poll_id and p.creator_id = auth.uid()));
  if not found then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
end;
$$;
grant execute on function public.delete_comment(uuid) to authenticated;

drop function if exists public.report(text, text, uuid, text);
create or replace function public.report(kind text, reason text, poll uuid default null, name text default null, comment uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  p record;
  cm record;
  poll_can_hide boolean := false;
  open_reports int;
  hidden boolean := false;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  if reason is null or reason not in ('hate', 'private_info', 'sexual', 'violence', 'self_harm', 'spam', 'illegal', 'other') then
    raise exception 'docchi:bad_reason' using errcode = '22023';
  end if;
  if (select count(*) from public.reports r where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'docchi:report_limit' using errcode = '54000';
  end if;

  if kind = 'poll' then
    select x.id, x.creator_id, x.is_system, x.is_hidden into p
    from public.polls x where x.id = poll and x.deleted_at is null;
    if not found or not public.can_view_poll(poll, uid) then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if p.creator_id = uid then
      raise exception 'docchi:own_poll' using errcode = '22023';
    end if;
    target := poll;
    poll_can_hide := not p.is_system and not p.is_hidden;
  elsif kind = 'user' then
    select u.id into target from public.profiles u where u.username = lower(name);
    if target is null then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if target = uid then
      raise exception 'docchi:own_poll' using errcode = '22023';
    end if;
  elsif kind = 'comment' then
    select c.id, c.user_id, c.poll_id into cm from public.comments c
    where c.id = comment and not c.is_hidden and c.expires_at > now();
    if cm.id is null or not public.can_read_comments(cm.poll_id, uid) then
      raise exception 'docchi:not_found' using errcode = 'P0002';
    end if;
    if cm.user_id = uid then
      raise exception 'docchi:own_poll' using errcode = '22023';
    end if;
    target := comment;
  else
    raise exception 'docchi:bad_kind' using errcode = '22023';
  end if;

  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (kind, target, uid, reason)
  on conflict (target_type, target_id, reporter_id) do nothing;

  if kind = 'poll' and poll_can_hide then
    select count(*) into open_reports from public.reports r
    where r.target_type = 'poll' and r.target_id = poll and r.resolved_at is null;
    if open_reports >= public.auto_hide_threshold() then
      update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'reports' where id = poll;
      hidden := true;
    end if;
  end if;

  if kind = 'comment' then
    select count(*) into open_reports from public.reports r
    where r.target_type = 'comment' and r.target_id = comment and r.resolved_at is null;
    if open_reports >= public.auto_hide_threshold() then
      update public.comments set is_hidden = true, hidden_at = now(), hidden_reason = 'reports' where id = comment;
      hidden := true;
    end if;
  end if;

  return jsonb_build_object('hidden', hidden);
end;
$$;
revoke execute on function public.report(text, text, uuid, text, uuid) from public, anon;
grant execute on function public.report(text, text, uuid, text, uuid) to authenticated;

drop function if exists public.admin_reports(text);
create or replace function public.admin_reports(status text default 'open')
returns table (
  target_type text, target_id uuid, reports int, reasons jsonb, last_at timestamptz,
  question text, teaser text, kind text, visibility text, options text[], created_at timestamptz,
  is_hidden boolean, hidden_reason text,
  username text, avatar_url text, is_banned boolean, user_polls int, user_reports int,
  comment_text text, comment_hidden_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  with grouped as (
    select r.target_type, r.target_id, count(*)::int as n,
           max(r.created_at) as last_at,
           (select jsonb_object_agg(x.reason, x.c) from (
              select r2.reason, count(*) as c from public.reports r2
              where r2.target_type = r.target_type and r2.target_id = r.target_id
                and (r2.resolved_at is null) = (status = 'open')
              group by r2.reason) x) as reasons
    from public.reports r
    where (r.resolved_at is null) = (status = 'open')
      and (status = 'open' or r.resolved_at > now() - interval '30 days')
    group by r.target_type, r.target_id
  )
  select g.target_type, g.target_id, g.n, g.reasons, g.last_at,
         p.question, p.teaser, p.kind, p.visibility,
         (select array_agg(o.text order by o.position) from public.poll_options o where o.poll_id = p.id),
         p.created_at, case when g.target_type = 'comment' then coalesce(cm.is_hidden, false) else coalesce(p.is_hidden, false) end,
         case when g.target_type = 'comment' then cm.hidden_reason else p.hidden_reason end,
         u.username::text, u.avatar_url, u.is_banned,
         (select count(*)::int from public.polls q where q.creator_id = u.id and q.deleted_at is null),
         (select count(*)::int from public.reports r3
            left join public.polls q on r3.target_type = 'poll' and q.id = r3.target_id
            where (r3.target_type = 'user' and r3.target_id = u.id) or q.creator_id = u.id
               or (r3.target_type = 'comment' and r3.target_id in (select c3.id from public.comments c3 where c3.user_id = u.id))),
         cm.text, cm.hidden_reason
  from grouped g
  left join public.comments cm on g.target_type = 'comment' and cm.id = g.target_id
  left join public.polls p on p.id = case when g.target_type = 'poll' then g.target_id else cm.poll_id end
  left join public.profiles u on u.id = case g.target_type when 'poll' then p.creator_id
                                                            when 'comment' then cm.user_id else g.target_id end
  order by (coalesce(cm.hidden_reason, p.hidden_reason) = 'reports') desc nulls last, g.n desc, g.last_at desc
  limit 100;
end;
$$;
grant execute on function public.admin_reports(text) to authenticated;

create or replace function public.admin_act(kind text, target uuid, act text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  person uuid;
begin
  if kind = 'poll' then
    select p.creator_id into person from public.polls p where p.id = target;
    if not found then raise exception 'docchi:not_found' using errcode = 'P0002'; end if;
  elsif kind = 'comment' then
    select c.user_id into person from public.comments c where c.id = target;
    if not found then raise exception 'docchi:not_found' using errcode = 'P0002'; end if;
  elsif kind = 'user' then
    person := target;
  else
    raise exception 'docchi:bad_kind' using errcode = '22023';
  end if;

  if kind = 'poll' and act = 'remove' then
    update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'admin' where id = target;
  elsif kind = 'comment' and act = 'remove' then
    update public.comments set is_hidden = true, hidden_at = now(), hidden_reason = 'admin' where id = target;
  elsif kind = 'comment' and act = 'restore' then
    update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null where id = target;
  elsif kind = 'poll' and act = 'restore' then
    update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null where id = target;
  elsif act = 'dismiss' then
    -- Reports were wrong: undo an automatic hide.
    if kind = 'poll' then
      update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null
      where id = target and hidden_reason = 'reports';
    elsif kind = 'comment' then
      update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null
      where id = target and hidden_reason = 'reports';
    end if;
  elsif act = 'ban' then
    if person is null then raise exception 'docchi:not_found' using errcode = 'P0002'; end if;
    if person = me then raise exception 'docchi:own_poll' using errcode = '22023'; end if;
    update public.profiles set is_banned = true where id = person;
    update public.polls set is_hidden = true, hidden_at = now(), hidden_reason = 'ban'
    where creator_id = person and (not is_hidden or hidden_reason = 'reports');
    update public.comments set is_hidden = true, hidden_at = now(), hidden_reason = 'ban'
    where user_id = person and (not is_hidden or hidden_reason = 'reports');
    update public.reports r set resolved_at = now()
    where r.resolved_at is null
      and ((r.target_type = 'user' and r.target_id = person)
           or (r.target_type = 'poll' and r.target_id in (select id from public.polls where creator_id = person))
           or (r.target_type = 'comment' and r.target_id in (select id from public.comments where user_id = person)));
  elsif kind = 'user' and act = 'unban' then
    update public.profiles set is_banned = false where id = person;
    update public.polls set is_hidden = false, hidden_at = null, hidden_reason = null
    where creator_id = person and hidden_reason = 'ban';
    update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null
    where user_id = person and hidden_reason = 'ban';
  else
    raise exception 'docchi:bad_action' using errcode = '22023';
  end if;

  if act in ('remove', 'dismiss') then
    update public.reports r set resolved_at = now()
    where r.resolved_at is null and r.target_type = kind and r.target_id = target;
  end if;

  if act in ('restore', 'unban') then
    -- Undoing: mark the latest matching action as undone.
    update public.mod_actions m set undone_at = now()
    where m.id = (select m2.id from public.mod_actions m2
                  where m2.undone_at is null
                    and m2.action = case act when 'restore' then 'remove' else 'ban' end
                    and (m2.target_id = target
                         or (act = 'unban' and m2.target_type = 'poll'
                             and m2.target_id in (select id from public.polls where creator_id = person))
                         or (act = 'unban' and m2.target_type = 'comment'
                             and m2.target_id in (select id from public.comments where user_id = person)))
                  order by m2.created_at desc limit 1);
  end if;

  insert into public.mod_actions (admin_id, action, target_type, target_id)
  values (me, act, kind, target);
end;
$$;
grant execute on function public.admin_act(text, uuid, text) to authenticated;


create or replace function public.admin_log(max_rows int default 50)
returns table (
  id uuid, action text, target_type text, target_id uuid, created_at timestamptz, undone boolean,
  admin text, question text, username text, user_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select m.id, m.action, m.target_type, m.target_id, m.created_at, m.undone_at is not null,
         a.username::text, coalesce(p.question, cm.text), u.username::text, u.id
  from public.mod_actions m
  left join public.profiles a on a.id = m.admin_id
  left join public.polls p on m.target_type = 'poll' and p.id = m.target_id
  left join public.comments cm on m.target_type = 'comment' and cm.id = m.target_id
  left join public.profiles u on u.id = case m.target_type when 'poll' then p.creator_id
                                                            when 'comment' then cm.user_id else m.target_id end
  order by m.created_at desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;


-- ─── Push: "new comments on your poll" ──────────────────────────────────────

alter table public.push_settings add column comments boolean not null default true;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('votes', 'circle', 'results', 'daily', 'comments', 'test'));

create or replace function public.get_push_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'votes', coalesce(s.votes, true), 'circle', coalesce(s.circle, true),
    'results', coalesce(s.results, true), 'daily', coalesce(s.daily, true),
    'comments', coalesce(s.comments, true))
  from (select 1) x
  left join public.push_settings s on s.user_id = auth.uid();
$$;

drop function if exists public.set_push_settings(boolean, boolean, boolean, boolean);
create function public.set_push_settings(votes boolean, circle boolean, results boolean, daily boolean, comments boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  insert into public.push_settings as p (user_id, votes, circle, results, daily, comments)
  values (auth.uid(), set_push_settings.votes, set_push_settings.circle, set_push_settings.results,
          set_push_settings.daily, set_push_settings.comments)
  on conflict on constraint push_settings_pkey do update
  set votes = excluded.votes, circle = excluded.circle, results = excluded.results,
      daily = excluded.daily, comments = excluded.comments;
end;
$$;
grant execute on function public.set_push_settings(boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.push_wanted(person uuid, what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = person)
     and coalesce((select case what when 'votes' then p.votes when 'circle' then p.circle
                                    when 'results' then p.results when 'daily' then p.daily
                                    when 'comments' then p.comments else true end
                   from public.push_settings p where p.user_id = person), true);
$$;

create or replace function public.push_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  since timestamptz := coalesce((select a.at from public.app_state a where a.key = 'push_scan'), now());
  upto timestamptz := now();
  today date := (upto at time zone 'Asia/Kolkata')::date;
  potd record;
begin
  -- Vote milestones (10, 25, 50, 100, …) on your polls.
  with hit as (
    update public.polls p
    set notified_votes = public.vote_milestone(p.vote_count)
    where p.vote_count >= 10
      and public.vote_milestone(p.vote_count) > p.notified_votes
      and p.closes_at > upto - interval '1 day'
    returning p.id, p.creator_id, p.question, p.is_system, p.is_hidden, p.deleted_at, p.notified_votes
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select h.creator_id, 'votes', 'Your poll is popping 🎉',
         public.quote_q(h.question) || ' just hit ' || to_char(h.notified_votes, 'FM999,999') || ' votes.',
         '/p/' || h.id, 'votes:' || h.id, 'votes:' || h.id || ':' || h.notified_votes
  from hit h
  where h.creator_id is not null and not h.is_system and not h.is_hidden and h.deleted_at is null
    and public.push_wanted(h.creator_id, 'votes')
  on conflict (dedupe) do nothing;

  -- Circle requests, to the circle's owner.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.owner_id, 'circle', 'Circle request', '@' || m.username || ' wants to join your circle.',
         '/profile?tab=circle', 'circle-requests',
         'req:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.created_at)::bigint
  from public.circle_members c
  join public.profiles m on m.id = c.member_id
  where c.status = 'pending' and c.created_at > since and c.created_at <= upto
    and public.push_wanted(c.owner_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Accepted requests, to the person who asked.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', 'You''re in! 🎉', '@' || o.username || ' let you into their circle.',
         '/u/' || o.username, 'circle-in:' || c.owner_id,
         'acc:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.accepted_at)::bigint
  from public.circle_members c
  join public.profiles o on o.id = c.owner_id
  where c.status = 'accepted' and c.accepted_at > since and c.accepted_at <= upto
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- New circle polls, to everyone in that circle (or the chosen groups).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', '@' || o.username || ' asked their circle',
         coalesce(p.teaser, p.question), '/p/' || p.id, 'cpoll:' || p.id, 'cpoll:' || p.id || ':' || c.member_id
  from public.polls p
  join public.profiles o on o.id = p.creator_id
  join public.circle_members c on c.owner_id = p.creator_id and c.status = 'accepted'
  where p.visibility = 'circle' and p.deleted_at is null and not p.is_hidden
    and p.created_at > since and p.created_at <= upto
    and public.can_view_poll(p.id, c.member_id)
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Results, when a poll with a few votes closes: its creator and its voters.
  with closed as (
    select p.id, p.creator_id, p.question, p.vote_count,
           (select o.text from public.poll_options o where o.poll_id = p.id order by o.vote_count desc, o.position limit 1) as top_text,
           (select max(o.vote_count) from public.poll_options o where o.poll_id = p.id) as top_votes,
           (select count(*) from public.poll_options o where o.poll_id = p.id
              and o.vote_count = (select max(o2.vote_count) from public.poll_options o2 where o2.poll_id = p.id)) as leaders
    from public.polls p
    where p.closes_at > since and p.closes_at <= upto
      and p.deleted_at is null and not p.is_hidden and p.vote_count >= 3
  ),
  who as (
    select c.*, v.user_id as person, false as is_creator
    from closed c join public.votes v on v.poll_id = c.id
    where v.user_id is distinct from c.creator_id
    union all
    select c.*, c.creator_id, true from closed c where c.creator_id is not null
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select w.person, 'results',
         case when w.is_creator then 'Your poll closed' else 'Results are in' end,
         public.quote_q(w.question) || ' → ' ||
           case when w.leaders > 1 then 'it''s a tie!'
                else w.top_text || ' won with ' || round(100.0 * w.top_votes / nullif(w.vote_count, 0)) || '%.' end,
         '/p/' || w.id, 'results:' || w.id, 'results:' || w.id || ':' || w.person
  from who w
  where public.push_wanted(w.person, 'results')
  on conflict (dedupe) do nothing;

  -- New comments on your poll: one push per poll per run.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select p.creator_id, 'comments',
         case when count(*) = 1 then '@' || min(u.username::text) || ' commented'
              else count(*) || ' new comments' end,
         public.quote_q(p.question) || ' · “' || left((array_agg(c.text order by c.created_at desc))[1], 80) || '”',
         '/p/' || p.id || '?comments=1', 'comments:' || p.id,
         'comments:' || p.id || ':' || extract(epoch from upto)::bigint
  from public.comments c
  join public.polls p on p.id = c.poll_id
  join public.profiles u on u.id = c.user_id
  where c.created_at > since and c.created_at <= upto and not c.is_hidden
    and p.creator_id is not null and c.user_id <> p.creator_id
    and public.push_wanted(p.creator_id, 'comments')
  group by p.id, p.creator_id, p.question
  on conflict (dedupe) do nothing;

  -- Poll of the Day, once a day from 9am India time.
  if (upto at time zone 'Asia/Kolkata')::time >= time '09:00'
     and coalesce((select a.at from public.app_state a where a.key = 'push_daily'), '-infinity')
         < (today::timestamp at time zone 'Asia/Kolkata') then
    select p.id, coalesce(p.teaser, p.question) as q into potd
    from public.polls p
    where p.featured_on = today and p.deleted_at is null and not p.is_hidden
      and p.created_at <= upto and p.closes_at > upto;
    if potd.id is not null then
      insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
      select s.user_id, 'daily', 'Poll of the Day ☀️', potd.q, '/?poll=' || potd.id, 'daily',
             'daily:' || today || ':' || s.user_id
      from (select distinct ps.user_id from public.push_subscriptions ps) s
      where public.push_wanted(s.user_id, 'daily')
        and not exists (select 1 from public.votes v where v.poll_id = potd.id and v.user_id = s.user_id)
      on conflict (dedupe) do nothing;
    end if;
    insert into public.app_state (key, at) values ('push_daily', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  insert into public.app_state (key, at) values ('push_scan', upto)
  on conflict (key) do update set at = excluded.at;

  -- Old outbox rows go after a week.
  delete from public.notifications n where n.created_at < upto - interval '7 days';
end;
$$;
