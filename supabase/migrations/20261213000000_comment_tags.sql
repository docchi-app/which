-- Tags in comments: "@username" in a comment tags a friend, who gets a push and sees it in
-- Activity.
--
-- 1. comment_mentions: who a comment tags. post_comment finds the @names in the text and keeps
--    up to 3 that are friends (accepted both ways) of the writer, can see the poll, aren't
--    blocked either way and aren't banned. Any other @name stays plain text.
-- 2. tag_notify (the 2-minute job): one push per tag, once the comment has passed the AI text
--    check (or after 5 minutes if the check can't run), never for a hidden comment or a removed
--    tag, only to people with "When a friend tags you" on, and at most 5 tag pushes a day per
--    person (India time).
-- 3. get_comments says which @names in each comment are live tags (tags) and whether one is you
--    (tagged_me); remove_my_tag turns your tag back into plain text; tag_candidates lists friends
--    who can see the poll, for the @ picker.
-- 4. Settings: push_settings.tags ("When a friend tags you", on). my_activity lists the last 7
--    days of tags.
--
-- post_comment, get_comments, get_push_settings, push_wanted and my_activity are the same as
-- before apart from those changes. Safe to run twice.

-- ─── 1. Who a comment tags ───────────────────────────────────────────────────

create table if not exists public.comment_mentions (
  comment_id   uuid not null references public.comments (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete cascade,
  poll_id      uuid not null references public.polls (id) on delete cascade,
  created_at   timestamptz not null default now(),
  removed_at   timestamptz,
  notified_at  timestamptz,
  primary key (comment_id, user_id)
);
create index if not exists comment_mentions_user_idx on public.comment_mentions (user_id, created_at desc);
create index if not exists comment_mentions_due_idx on public.comment_mentions (created_at) where notified_at is null;
alter table public.comment_mentions enable row level security;
revoke all on table public.comment_mentions from public, anon, authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('votes', 'circle', 'results', 'daily', 'comments', 'props', 'tag', 'test'));

alter table public.push_settings add column if not exists tags boolean not null default true;

-- Friends: accepted both ways. Internal.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.circle_members c where c.owner_id = a and c.member_id = b and c.status = 'accepted')
     and exists (select 1 from public.circle_members c where c.owner_id = b and c.member_id = a and c.status = 'accepted');
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- The @names in a text, lower case, each once, in the order written (an e-mail address like
-- a@b.com isn't one).
create or replace function public.tag_names(body text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.name order by x.first), '{}')
  from (select lower(m.v[1]) as name, min(m.ord) as first
        from regexp_matches(coalesce(body, ''), '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,20})(?![a-zA-Z0-9_])', 'g') with ordinality as m(v, ord)
        group by lower(m.v[1])) x;
$$;
revoke execute on function public.tag_names(text) from public, anon, authenticated;

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
  tagged text[];
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

  -- Tags: up to 3 friends who can see the poll, in the order they were written.
  with names as (
    select n.name, n.ord from unnest(public.tag_names(t)) with ordinality as n(name, ord)
  ), ok as (
    select pr.id, pr.username::text as username, min(names.ord) as ord
    from names join public.profiles pr on pr.username = names.name
    where pr.id <> uid and not pr.is_banned
      and public.are_friends(uid, pr.id)
      and public.can_view_poll(poll, pr.id)
      and not public.is_blocked_between(uid, pr.id)
    group by pr.id, pr.username
    order by min(names.ord)
    limit 3
  ), ins as (
    insert into public.comment_mentions (comment_id, user_id, author_id, poll_id)
    select new_id, ok.id, uid, poll from ok
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(ok.username order by ok.ord), '{}') into tagged from ok;

  return jsonb_build_object('id', new_id, 'tagged', to_jsonb(tagged));
end;
$$;
revoke execute on function public.post_comment(uuid, text) from public, anon;
grant execute on function public.post_comment(uuid, text) to authenticated;

-- ─── 2. The push for a tag (the 2-minute job) ────────────────────────────────

create or replace function public.tag_notify(secret text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  n int := 0;
  day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  for m in
    select cm.comment_id, cm.user_id, cm.poll_id, cm.removed_at, c.text, c.is_hidden, au.username::text as author,
           pl.question, pl.deleted_at, pl.is_hidden as poll_hidden
    from public.comment_mentions cm
    join public.comments c on c.id = cm.comment_id
    join public.polls pl on pl.id = cm.poll_id
    left join public.profiles au on au.id = cm.author_id
    where cm.notified_at is null
      -- After the AI text check has looked at it (or 5 minutes, if it can't run).
      and (c.text_checked_at is not null or c.created_at < now() - interval '5 minutes')
    order by cm.created_at
    limit 100
    for update of cm skip locked
  loop
    update public.comment_mentions x set notified_at = now() where x.comment_id = m.comment_id and x.user_id = m.user_id;
    continue when m.removed_at is not null or m.is_hidden or m.deleted_at is not null or m.poll_hidden or m.author is null;
    continue when not public.push_wanted(m.user_id, 'tags');
    continue when (select count(*) from public.notifications x
                   where x.user_id = m.user_id and x.kind = 'tag' and x.created_at >= day_start) >= 5;
    insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
    values (m.user_id, 'tag', '@' || m.author || ' tagged you', '“' || left(m.text, 100) || '”',
            '/p/' || m.poll_id || '?comments=1', 'tag:' || m.poll_id, 'tag:' || m.comment_id || ':' || m.user_id)
    on conflict (dedupe) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.tag_notify(text) from public;
grant execute on function public.tag_notify(text) to anon, authenticated;

-- ─── 3. Comments: live tags, removing yours, the @ picker ────────────────────

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
           'can_delete', c.user_id = uid or p.creator_id = uid,
           'tags', (select coalesce(jsonb_agg(tu.username::text), '[]'::jsonb)
                    from public.comment_mentions cm join public.profiles tu on tu.id = cm.user_id
                    where cm.comment_id = c.id and cm.removed_at is null),
           'tagged_me', exists (select 1 from public.comment_mentions cm
                                where cm.comment_id = c.id and cm.user_id = uid and cm.removed_at is null)) order by c.created_at), '[]')
  into list
  from (
    -- Newest first straight off comments_live_idx, then drop blocked people.
    select c.* from (
      select c.* from public.comments c
      where c.poll_id = poll and not c.is_hidden and c.created_at > now() - interval '24 hours'
      order by c.created_at desc
      limit 120
    ) c
    where uid is null or not public.is_blocked_between(c.user_id, uid)
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

-- Your @name in a comment back to plain text (and no push if it hasn't gone yet).
create or replace function public.remove_my_tag(comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  update public.comment_mentions m set removed_at = now()
  where m.comment_id = comment and m.user_id = auth.uid() and m.removed_at is null;
  if not found then
    raise exception 'docchi:not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.remove_my_tag(uuid) from public, anon;
grant execute on function public.remove_my_tag(uuid) to authenticated;

-- Friends who can see this poll, for the @ picker (names starting with q; up to 8).
create or replace function public.tag_candidates(poll uuid, q text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pre text := lower(regexp_replace(coalesce(q, ''), '[^a-zA-Z0-9_]', '', 'g'));
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return '[]'::jsonb;
  end if;
  if not public.can_read_comments(poll, uid) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('username', f.username, 'avatar_url', f.avatar_url) order by f.username), '[]'::jsonb)
    from (
      select pr.username::text as username, pr.avatar_url
      from public.circle_members c
      join public.profiles pr on pr.id = c.member_id
      where c.owner_id = uid and c.status = 'accepted'
        and pr.username::text not like 'guest\_%'
        and pr.username::text like pre || '%'
        and not pr.is_banned
        and public.are_friends(uid, pr.id)
        and public.can_view_poll(poll, pr.id)
        and not public.is_blocked_between(uid, pr.id)
      order by pr.username
      limit 8
    ) f
  );
end;
$$;
revoke execute on function public.tag_candidates(uuid, text) from public, anon;
grant execute on function public.tag_candidates(uuid, text) to authenticated;

-- ─── 4. Settings and Activity ────────────────────────────────────────────────

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
                                    when 'comments' then p.comments when 'props' then p.props
                                    when 'tags' then p.tags else true end
                   from public.push_settings p where p.user_id = person), true);
$$;

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
    'comments', coalesce(s.comments, true), 'props', coalesce(s.props, true),
    'tags', coalesce(s.tags, true))
  from (select 1) x
  left join public.push_settings s on s.user_id = auth.uid();
$$;

-- One more switch: the old six-switch version would stay alongside (and make calls ambiguous).
drop function if exists public.set_push_settings(boolean, boolean, boolean, boolean, boolean, boolean);
create or replace function public.set_push_settings(votes boolean, circle boolean, results boolean, daily boolean,
                                                    comments boolean default true, props boolean default true,
                                                    tags boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  insert into public.push_settings as p (user_id, votes, circle, results, daily, comments, props, tags)
  values (auth.uid(), set_push_settings.votes, set_push_settings.circle, set_push_settings.results,
          set_push_settings.daily, set_push_settings.comments, set_push_settings.props, set_push_settings.tags)
  on conflict on constraint push_settings_pkey do update
  set votes = excluded.votes, circle = excluded.circle, results = excluded.results,
      daily = excluded.daily, comments = excluded.comments, props = excluded.props, tags = excluded.tags;
end;
$$;
revoke execute on function public.set_push_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_push_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.my_activity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.id, p.question, p.teaser, p.vote_count, p.created_at, s.votes as seen_votes, s.seen_at
    from public.polls p
    left join public.seen_polls s on s.user_id = p.creator_id and s.poll_id = p.id
    where p.creator_id = auth.uid() and p.deleted_at is null and not p.is_hidden
      and p.created_at > now() - interval '30 days'
    order by p.created_at desc
    limit 100
  ),
  news as (
    select m.id, m.question, m.created_at,
           greatest(m.vote_count - coalesce(m.seen_votes, 0), 0) as new_votes,
           (select count(*)::int from public.comments c
             where c.poll_id = m.id and not c.is_hidden
               and c.created_at > greatest(coalesce(m.seen_at, m.created_at), now() - interval '24 hours')
               and c.user_id <> auth.uid()) as new_comments
    from mine m
  )
  select jsonb_build_object(
    'votes', coalesce(sum(n.new_votes), 0),
    'comments', coalesce(sum(n.new_comments), 0),
    'polls', coalesce(jsonb_agg(jsonb_build_object('poll_id', n.id, 'question', n.question,
                                                   'votes', n.new_votes, 'comments', n.new_comments)
                                order by n.created_at desc)
                      filter (where n.new_votes > 0 or n.new_comments > 0), '[]'),
    -- Tags in the last 7 days (live comments and tags, people you haven't blocked).
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('poll_id', t.poll_id, 'question', t.question,
                                                          'by', t.author, 'at', t.created_at) order by t.created_at desc), '[]'::jsonb)
             from (select cm.poll_id, pl.question, au.username::text as author, cm.created_at
                   from public.comment_mentions cm
                   join public.comments c on c.id = cm.comment_id
                   join public.polls pl on pl.id = cm.poll_id
                   join public.profiles au on au.id = cm.author_id
                   where cm.user_id = auth.uid() and cm.removed_at is null and not c.is_hidden
                     and pl.deleted_at is null and not pl.is_hidden
                     and cm.created_at > now() - interval '7 days'
                     and not public.is_blocked_between(auth.uid(), cm.author_id)
                   order by cm.created_at desc
                   limit 20) t))
  from news n;
$$;
