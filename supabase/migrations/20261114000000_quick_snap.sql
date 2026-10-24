-- Quick snap: a photo poll that disappears after 24 hours.
--
--   * kind 'snap': one photo (taken in the app or picked from the gallery),
--     a ready-made question (Rate my fit / Buy or skip / Should I go / your
--     own) with emoji answers, for Friends ('circle') or Everyone ('public').
--   * The photo goes to the private Storage bucket "snaps" as <user id>/<file>.
--     The poll stays hidden (photo_status 'pending') until /api/snap/check
--     runs the safety check and calls set_snap_verdict():
--       live: everyone it's for can see it · review: waits for an admin
--       (rejected after 12 hours) · rejected: never shown.
--   * Only people who can see a live snap can load its photo (Storage policy).
--   * 3 snaps a day; accounts under a day old can only send to Friends.
--   * Snaps stay off profiles (yours and others'), and don't count toward the
--     5-polls-a-day limit or the one hot take / mystery a day.
--   * Photos are deleted after the snap closes: the owner's app removes its
--     own expired photos, and admins can sweep everyone's from /admin.

alter table public.polls drop constraint if exists polls_kind_check;
alter table public.polls add constraint polls_kind_check check (kind in ('classic', 'hot_take', 'mystery', 'snap'));

alter table public.polls
  add column photo_path text,
  add column photo_status text check (photo_status in ('pending', 'live', 'review', 'rejected')),
  add column photo_live boolean not null default false,
  add column photo_scores jsonb,
  add column photo_deleted_at timestamptz;
create index polls_snap_status_idx on public.polls (photo_status, created_at) where kind = 'snap';

-- ─── Storage ───────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('snaps', 'snaps', false, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_admin_user(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = person and is_admin and not is_banned) $$;
revoke execute on function public.is_admin_user(uuid) from public;
grant execute on function public.is_admin_user(uuid) to anon, authenticated;

-- May the caller load this photo? The owner and admins always (while it
-- exists); anyone else only while the snap is live, open, and theirs to see.
create or replace function public.snap_photo_visible(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.polls p
    where p.photo_path = path and p.kind = 'snap' and p.deleted_at is null
      and (p.creator_id = auth.uid()
           or public.is_admin_user(auth.uid())
           or (p.photo_status = 'live' and not p.is_hidden and p.closes_at > now()
               and public.can_view_poll(p.id, auth.uid())))
  );
$$;
revoke execute on function public.snap_photo_visible(text) from public;
grant execute on function public.snap_photo_visible(text) to anon, authenticated;

drop policy if exists "snaps: upload own" on storage.objects;
create policy "snaps: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'snaps' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "snaps: view" on storage.objects;
create policy "snaps: view" on storage.objects for select to anon, authenticated
  using (bucket_id = 'snaps' and ((storage.foldername(name))[1] = auth.uid()::text or public.snap_photo_visible(name)));

drop policy if exists "snaps: delete own or admin" on storage.objects;
create policy "snaps: delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'snaps' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_user(auth.uid())));

-- ─── Posting ───────────────────────────────────────────────────────────────

-- template: 'rate' | 'buy' | 'go' | 'own' (own needs `question`).
-- live: taken with the camera just now (shows a 📸 Live badge).
create or replace function public.create_snap(photo_path text, template text, question text default null,
                                              visibility text default 'circle', live boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  vis text := coalesce(visibility, 'circle');
  q text;
  opts text[];
  new_id uuid;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  select * into me from public.profiles where id = uid;
  if me.is_banned then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  if me.username::text like 'guest\_%' then
    raise exception 'docchi:need_username' using errcode = 'P0001';
  end if;

  if vis not in ('public', 'circle') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  if vis = 'public' and me.created_at > now() - interval '1 day' then
    raise exception 'docchi:snap_too_new' using errcode = 'P0001';
  end if;
  if vis = 'circle' and not exists (select 1 from public.circle_members c where c.owner_id = uid and c.status = 'accepted') then
    raise exception 'docchi:empty_circle' using errcode = 'P0001';
  end if;

  if (select count(*) from public.polls p
      where p.creator_id = uid and p.kind = 'snap' and p.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'docchi:snap_limit' using errcode = 'P0001';
  end if;

  if photo_path is null or split_part(photo_path, '/', 1) <> uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.polls p where p.photo_path = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;

  case template
    when 'rate' then q := 'Rate my fit'; opts := array['🔥', '😍', '😐', '🙅'];
    when 'buy' then q := 'Buy it or skip it?'; opts := array['🛒 Buy', '🙅 Skip'];
    when 'go' then q := 'Should I go?'; opts := array['🙌 Go', '🛋️ Stay home'];
    when 'own' then
      q := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
      if char_length(q) not between 3 and 80 then
        raise exception 'docchi:question_length' using errcode = '22023';
      end if;
      if public.has_blocked_term(q) then
        raise exception 'docchi:blocked_words' using errcode = 'P0001';
      end if;
      opts := array['👍 Yes', '👎 No'];
    else
      raise exception 'docchi:template' using errcode = '22023';
  end case;

  insert into public.polls (creator_id, kind, question, visibility, closes_at, photo_path, photo_status, photo_live)
  values (uid, 'snap', q, vis, now() + interval '24 hours', create_snap.photo_path, 'pending', coalesce(live, false))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text from unnest(opts) with ordinality as o(text, ord);

  return new_id;
end;
$$;
revoke execute on function public.create_snap(text, text, text, text, boolean) from public, anon;
grant execute on function public.create_snap(text, text, text, text, boolean) to authenticated;

-- For the check: my own snap that's still waiting.
create or replace function public.snap_for_check(poll uuid)
returns table (photo_path text, visibility text, question text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.photo_path, p.visibility, p.question from public.polls p
  where p.id = poll and p.kind = 'snap' and p.creator_id = auth.uid() and p.photo_status = 'pending';
$$;
grant execute on function public.snap_for_check(uuid) to authenticated;

-- The check's result, from /api/snap/check (signed with PUSH_CRON_SECRET).
create or replace function public.set_snap_verdict(poll uuid, verdict text, scores jsonb, secret text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  if verdict not in ('live', 'review', 'rejected') then
    raise exception 'docchi:verdict' using errcode = '22023';
  end if;
  update public.polls p set photo_status = verdict, photo_scores = scores
  where p.id = poll and p.kind = 'snap' and p.photo_status = 'pending';
  return (select p.photo_status from public.polls p where p.id = poll);
end;
$$;
revoke execute on function public.set_snap_verdict(uuid, text, jsonb, text) from public;
grant execute on function public.set_snap_verdict(uuid, text, jsonb, text) to anon, authenticated;

-- Photos and status for snaps in a list of polls (the feed asks for these).
create or replace function public.snap_info(ids uuid[])
returns table (poll_id uuid, photo_path text, photo_status text, photo_live boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         case when p.closes_at > now() and p.photo_deleted_at is null then p.photo_path end,
         case when p.photo_status = 'review' and p.created_at < now() - interval '12 hours' then 'rejected' else p.photo_status end,
         p.photo_live
  from public.polls p
  where p.id = any(ids) and p.kind = 'snap' and p.deleted_at is null
    and (p.creator_id = auth.uid() or (p.photo_status = 'live' and public.can_view_poll(p.id, auth.uid())));
$$;
grant execute on function public.snap_info(uuid[]) to anon, authenticated;

-- ─── Admin review ──────────────────────────────────────────────────────────

-- Snaps waiting for a person (and ones whose check never ran), newest first.
create or replace function public.admin_snaps()
returns table (poll_id uuid, photo_path text, question text, visibility text, creator text, created_at timestamptz,
               photo_status text, photo_scores jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'docchi:not_admin' using errcode = '42501';
  end if;
  return query
  select p.id, p.photo_path, p.question, p.visibility, pr.username::text, p.created_at, p.photo_status, p.photo_scores
  from public.polls p join public.profiles pr on pr.id = p.creator_id
  where p.kind = 'snap' and p.deleted_at is null and p.closes_at > now()
    and (p.photo_status = 'review' and p.created_at > now() - interval '12 hours'
         or p.photo_status = 'pending' and p.created_at < now() - interval '2 minutes')
  order by p.created_at desc
  limit 50;
end;
$$;
grant execute on function public.admin_snaps() to authenticated;

create or replace function public.admin_decide_snap(poll uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'docchi:not_admin' using errcode = '42501';
  end if;
  update public.polls p set photo_status = case when approve then 'live' else 'rejected' end
  where p.id = poll and p.kind = 'snap' and p.photo_status in ('review', 'pending');
end;
$$;
grant execute on function public.admin_decide_snap(uuid, boolean) to authenticated;

-- ─── Cleanup: photos of closed or rejected snaps ───────────────────────────

-- Expired photos to remove: mine, or (admins, everyone=true) everyone's.
create or replace function public.expired_snap_photos(everyone boolean default false)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.photo_path from public.polls p
  where p.kind = 'snap' and p.photo_path is not null and p.photo_deleted_at is null
    and (p.closes_at <= now() or p.photo_status = 'rejected' or p.deleted_at is not null
         or (p.photo_status = 'review' and p.created_at < now() - interval '12 hours'))
    and (p.creator_id = auth.uid() or (everyone and public.is_admin_user(auth.uid())))
  limit 200;
$$;
grant execute on function public.expired_snap_photos(boolean) to authenticated;

create or replace function public.mark_snap_photos_deleted(paths text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.polls p set photo_deleted_at = now()
  where p.photo_path = any(paths) and p.kind = 'snap' and p.photo_deleted_at is null
    and (p.creator_id = auth.uid() or public.is_admin_user(auth.uid()))
    and not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = p.photo_path);
$$;
grant execute on function public.mark_snap_photos_deleted(text[]) to authenticated;

-- ─── Existing functions: snaps hidden until live, kept off profiles, own limits ─

create or replace function public.create_poll(
  question text,
  answers text[],
  days int,
  username text default null,
  kind text default 'classic',
  teaser text default null,
  visibility text default 'public',
  groups uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  q text := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
  t text := nullif(regexp_replace(trim(coalesce(teaser, '')), '\s+', ' ', 'g'), '');
  k text := coalesce(kind, 'classic');
  vis text := coalesce(visibility, 'public');
  clean text[];
  a text;
  new_id uuid;
  problem text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;

  select * into me from public.profiles where id = uid for update;
  if me.is_banned then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;

  if k not in ('classic', 'hot_take', 'mystery') then
    raise exception 'docchi:kind' using errcode = '22023';
  end if;

  if vis not in ('public', 'link', 'circle') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;

  if vis = 'circle' then
    if exists (select 1 from unnest(coalesce(groups, '{}')) g
               where not exists (select 1 from public.circle_groups cg where cg.id = g and cg.owner_id = uid)) then
      raise exception 'docchi:not_yours' using errcode = '42501';
    end if;
    -- Someone has to be able to see it.
    if not exists (
        select 1 from public.circle_members c
        where c.owner_id = uid and c.status = 'accepted'
          and (cardinality(coalesce(groups, '{}')) = 0
               or exists (select 1 from public.circle_group_members m
                          where m.member_id = c.member_id and m.group_id = any(groups)))) then
      raise exception 'docchi:empty_circle' using errcode = 'P0001';
    end if;
  end if;

  if (select count(*) from public.polls x
      where x.creator_id = uid and x.kind <> 'snap' and x.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'docchi:daily_limit' using errcode = 'P0001';
  end if;

  if k <> 'classic' and exists (
      select 1 from public.polls p
      where p.creator_id = uid and p.kind in ('hot_take', 'mystery') and p.created_at > now() - interval '24 hours') then
    raise exception 'docchi:special_limit' using errcode = 'P0001';
  end if;

  -- First poll: pick a username.
  if me.username::text like 'guest\_%' then
    problem := public.username_problem(lower(coalesce(username, '')), uid);
    if problem <> 'ok' then
      raise exception 'docchi:username_%', problem using errcode = 'P0001';
    end if;
    begin
      update public.profiles set username = lower(create_poll.username) where id = uid;
    exception when unique_violation then
      raise exception 'docchi:username_taken' using errcode = 'P0001';
    end;
  end if;

  if char_length(q) < 3 or char_length(q) > 140 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;

  if k = 'hot_take' then
    clean := array['Agree', 'Disagree'];
    t := null;
  else
    clean := '{}';
    foreach a in array coalesce(answers, '{}') loop
      a := regexp_replace(trim(a), '\s+', ' ', 'g');
      if a = '' then continue; end if;
      if char_length(a) > 40 then
        raise exception 'docchi:answer_length' using errcode = '22023';
      end if;
      if exists (select 1 from unnest(clean) x where lower(x) = lower(a)) then
        raise exception 'docchi:duplicate_answers' using errcode = '22023';
      end if;
      clean := clean || a;
    end loop;
    if cardinality(clean) not between 2 and 4 then
      raise exception 'docchi:answer_count' using errcode = '22023';
    end if;
  end if;

  if k = 'mystery' then
    if t is null or char_length(t) not between 3 and 60 then
      raise exception 'docchi:teaser_length' using errcode = '22023';
    end if;
  else
    t := null;
  end if;

  if days not in (1, 3, 7) then
    raise exception 'docchi:duration' using errcode = '22023';
  end if;

  if public.has_blocked_term(q || ' ' || coalesce(t, '') || ' ' || array_to_string(clean, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;

  insert into public.polls (creator_id, kind, question, teaser, visibility, closes_at)
  values (uid, k, q, t, vis, now() + make_interval(days => days))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text
  from unnest(clean) with ordinality as o(text, ord);

  if vis = 'circle' then
    insert into public.poll_audience (poll_id, group_id)
    select new_id, g from unnest(coalesce(groups, '{}')) g on conflict do nothing;
  end if;

  return new_id;
end;
$$;

create or replace function public.create_poll_status(name_seed text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  posted int;
  special int;
  suggestions text[];
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into me from public.profiles where id = uid;
  select count(*) filter (where kind <> 'snap'), count(*) filter (where kind in ('hot_take', 'mystery')) into posted, special
    from public.polls
    where creator_id = uid and created_at > now() - interval '24 hours';
  if me.username::text like 'guest\_%' then
    suggestions := public.suggest_usernames(name_seed);
  end if;
  return jsonb_build_object(
    'signed_in', true,
    'username', case when me.username::text like 'guest\_%' then null else me.username::text end,
    'suggestions', to_jsonb(coalesce(suggestions, '{}')),
    'polls_left', greatest(5 - posted, 0),
    'special_left', greatest(1 - special, 0)
  );
end;
$$;

create or replace function public.poll_cards(ids uuid[])
returns table (
  ord            bigint,
  id             uuid,
  kind           text,
  visibility     text,
  is_mine        boolean,
  locked         boolean,
  audience       text,
  question       text,
  teaser         text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
  share_count    integer,
  comment_count  integer,
  created_at     timestamptz,
  closes_at      timestamptz,
  my_option_id   uuid,
  options        jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      x.ord,
      p.*,
      v.option_id as my_option_id,
      coalesce(p.creator_id = auth.uid(), false) as mine,
      case when p.visibility = 'circle' then not coalesce(public.can_view_poll(p.id, auth.uid()), false) else false end as is_locked,
      (v.option_id is not null or p.closes_at <= now() or coalesce(p.creator_id = auth.uid(), false)) as can_see
    from unnest(ids) with ordinality as x(id, ord)
    join public.polls p on p.id = x.id
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
    -- A snap shows once its photo passed the check (its creator sees it while it's checked).
    where p.kind <> 'snap' or p.photo_status = 'live' or p.creator_id = auth.uid()
  )
  select
    b.ord,
    b.id,
    b.kind,
    b.visibility,
    b.mine,
    b.is_locked,
    case when b.mine and b.visibility = 'circle' then
      coalesce((select string_agg(g.name, ', ' order by g.name) from public.poll_audience a
                join public.circle_groups g on g.id = a.group_id where a.poll_id = b.id), 'Whole circle')
    end,
    case when b.is_locked or (b.kind = 'mystery' and not b.can_see) then null else b.question end,
    case when b.is_locked then null else b.teaser end,
    case when b.is_system then 'docchi' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_on = (now() at time zone 'Asia/Kolkata')::date, false),
    b.vote_count,
    b.share_count,
    public.live_comment_count(b.id),
    b.created_at,
    b.closes_at,
    b.my_option_id,
    case when b.is_locked then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object(
                'id', o.id,
                'text', o.text,
                'votes', case when b.can_see then o.vote_count end)
              order by o.position)
         from public.poll_options o where o.poll_id = b.id)
    end
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;

create or replace function public.cast_vote(target_poll uuid, target_option uuid)
returns table (my_option_id uuid, vote_count integer, options jsonb, question text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  guest boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  inserted int;
begin
  if uid is null then
    raise exception 'sign in to vote' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'account is banned' using errcode = '42501';
  end if;

  perform 1 from public.polls p
    where p.id = target_poll and not p.is_hidden and p.deleted_at is null
      and p.closes_at > now() and p.created_at <= now()
      and (p.kind <> 'snap' or p.photo_status = 'live');
  if not found then
    raise exception 'poll is closed or missing' using errcode = 'P0002';
  end if;

  if not public.can_view_poll(target_poll, uid) then
    raise exception 'docchi:circle_only' using errcode = '42501';
  end if;

  perform 1 from public.poll_options o where o.id = target_option and o.poll_id = target_poll;
  if not found then
    raise exception 'option does not belong to poll' using errcode = '22023';
  end if;

  insert into public.votes (poll_id, user_id, option_id, counted)
  values (target_poll, uid, target_option, not guest)
  on conflict (poll_id, user_id) do nothing;
  get diagnostics inserted = row_count;

  -- A guest's vote waits for sign-in before it moves any number.
  if inserted = 1 and not guest then
    update public.poll_options o set vote_count = o.vote_count + 1 where o.id = target_option;
    update public.polls p set vote_count = p.vote_count + 1 where p.id = target_poll;
  end if;

  return query
    select
      v.option_id,
      p.vote_count,
      (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'votes', o.vote_count)
                        order by o.position)
         from public.poll_options o where o.poll_id = target_poll),
      p.question
    from public.polls p
    join public.votes v on v.poll_id = p.id and v.user_id = uid
    where p.id = target_poll;
end;
$$;

create or replace function public.my_polls(which text default 'mine', max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb, cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(max_rows, 30), 1), 100);
  av double precision := public.cursor_value(after);
  aid uuid := public.cursor_id(after);
  picked_ids uuid[];
  picked_cur text[];
begin
  if which = 'voted' then
    -- Newest vote first, straight off the (user_id, created_at) index.
    select coalesce(array_agg(q.poll_id order by q.created_at desc, q.poll_id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.poll_id order by q.created_at desc, q.poll_id desc), '{}')
    into picked_ids, picked_cur
    from (
      select v.poll_id, v.created_at
      from public.votes v
      join public.polls p on p.id = v.poll_id
      where v.user_id = uid
        and (av is null or (extract(epoch from v.created_at), v.poll_id) < (av, aid))
        and p.deleted_at is null and not p.is_hidden and p.kind <> 'snap'
        and (p.visibility <> 'circle' or public.can_view_poll(p.id, uid))
      order by v.created_at desc, v.poll_id desc
      limit lim
    ) q;
  else
    select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
           coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
    into picked_ids, picked_cur
    from (
      select p.id, p.created_at
      from public.polls p
      where p.creator_id = uid and p.deleted_at is null and not p.is_hidden and p.kind <> 'snap'
        and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
      order by p.created_at desc, p.id desc
      limit lim
    ) q;
  end if;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

create or replace function public.profile_polls(name text, max_rows int default 30, after text default null)
returns table (
  id uuid, kind text, visibility text, is_mine boolean, locked boolean, audience text, question text, teaser text,
  creator text, is_system boolean, featured_today boolean, vote_count integer, share_count integer, comment_count integer,
  created_at timestamptz, closes_at timestamptz, my_option_id uuid, options jsonb, cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim int := least(greatest(coalesce(max_rows, 30), 1), 100);
  av double precision := public.cursor_value(after);
  aid uuid := public.cursor_id(after);
  owner uuid;
  picked_ids uuid[];
  picked_cur text[];
begin
  select u.id into owner from public.profiles u where u.username = lower(name);
  select coalesce(array_agg(q.id order by q.created_at desc, q.id desc), '{}'),
         coalesce(array_agg(extract(epoch from q.created_at)::text || '|' || q.id order by q.created_at desc, q.id desc), '{}')
  into picked_ids, picked_cur
  from (
    select p.id, p.created_at
    from public.polls p
    where p.creator_id = owner and p.deleted_at is null and not p.is_hidden
      and p.visibility = 'public' and not p.is_system and p.kind <> 'snap' and p.created_at <= now()
      and (av is null or (extract(epoch from p.created_at), p.id) < (av, aid))
    order by p.created_at desc, p.id desc
    limit lim
  ) q;

  return query
    select c.id, c.kind, c.visibility, c.is_mine, c.locked, c.audience, c.question, c.teaser, c.creator,
           c.is_system, c.featured_today, c.vote_count, c.share_count, c.comment_count, c.created_at,
           c.closes_at, c.my_option_id, c.options, picked_cur[c.ord]
    from public.poll_cards(picked_ids) c
    order by c.ord;
end;
$$;

create or replace function public.in_feed(p public.polls, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p.kind <> 'snap' or p.photo_status = 'live') and (p.visibility = 'public'
    or (viewer is not null and (
          p.creator_id = viewer
          or (p.visibility = 'circle' and public.can_view_poll(p.id, viewer))
          or (p.visibility = 'link' and exists (
                select 1 from public.poll_access a where a.user_id = viewer and a.poll_id = p.id)))));
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

  -- Friend requests, to the person asked.
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.owner_id, 'circle', 'Friend request', '@' || m.username || ' wants to be friends.',
         '/friends', 'circle-requests',
         'req:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.created_at)::bigint
  from public.circle_members c
  join public.profiles m on m.id = c.member_id
  where c.status = 'pending' and c.initiator and c.created_at > since and c.created_at <= upto
    and public.push_wanted(c.owner_id, 'circle')
  on conflict (dedupe) do nothing;

  -- Accepted requests, to the person who asked (not the reverse row made on accepting).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', 'New friend 🎉', 'You and @' || o.username || ' are friends now.',
         '/u/' || o.username, 'circle-in:' || c.owner_id,
         'acc:' || c.owner_id || ':' || c.member_id || ':' || extract(epoch from c.accepted_at)::bigint
  from public.circle_members c
  join public.profiles o on o.id = c.owner_id
  where c.status = 'accepted' and c.initiator and c.accepted_at > since and c.accepted_at <= upto
    and public.push_wanted(c.member_id, 'circle')
  on conflict (dedupe) do nothing;

  -- New friends-only polls, to their friends (or the chosen lists).
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select c.member_id, 'circle', '@' || o.username || ' asked their friends',
         coalesce(p.teaser, p.question), '/p/' || p.id, 'cpoll:' || p.id, 'cpoll:' || p.id || ':' || c.member_id
  from public.polls p
  join public.profiles o on o.id = p.creator_id
  join public.circle_members c on c.owner_id = p.creator_id and c.status = 'accepted'
  where p.visibility = 'circle' and p.deleted_at is null and not p.is_hidden
    and (p.kind <> 'snap' or p.photo_status = 'live')
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
      select s.user_id, 'daily', 'Poll of the Day ☀️',
             potd.q || case when st.current_days >= 2
                            then ' · Keep your 🔥 ' || st.current_days || '-day streak going' else '' end,
             '/?poll=' || potd.id, 'daily',
             'daily:' || today || ':' || s.user_id
      from (select distinct ps.user_id from public.push_subscriptions ps) s
      cross join lateral public.streak_of(s.user_id) st
      where public.push_wanted(s.user_id, 'daily')
        and not exists (select 1 from public.votes v where v.poll_id = potd.id and v.user_id = s.user_id)
      on conflict (dedupe) do nothing;
    end if;
    insert into public.app_state (key, at) values ('push_daily', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  -- Streak saver, once a day from 8pm India time: a streak of 3+ days that ends at midnight.
  if (upto at time zone 'Asia/Kolkata')::time >= time '20:00'
     and coalesce((select a.at from public.app_state a where a.key = 'push_streak'), '-infinity')
         < (today::timestamp at time zone 'Asia/Kolkata') then
    insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
    select s.user_id, 'daily', 'Your 🔥 ' || st.current_days || '-day streak ends at midnight',
           'One vote keeps it going.', '/', 'streak', 'streak:' || today || ':' || s.user_id
    from (select distinct ps.user_id from public.push_subscriptions ps) s
    cross join lateral public.streak_of(s.user_id) st
    where public.push_wanted(s.user_id, 'daily')
      and st.current_days >= 3 and not st.voted_today
    on conflict (dedupe) do nothing;
    insert into public.app_state (key, at) values ('push_streak', upto)
    on conflict (key) do update set at = excluded.at;
  end if;

  insert into public.app_state (key, at) values ('push_scan', upto)
  on conflict (key) do update set at = excluded.at;

  -- Old outbox rows go after a week.
  delete from public.notifications n where n.created_at < upto - interval '7 days';
end;
$$;
