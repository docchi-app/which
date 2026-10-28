-- Link-only snaps: "I just want to send this to one person."
--
-- 1. create_snap accepts visibility 'link'. A link-only snap is in nobody's feed; whoever
--    opens the link can see the photo and vote (can_view_poll already lets link polls
--    through, and opening it adds it to their feed, like link-only typed polls). The photo
--    check still runs first, at the Friends bar.
-- 2. set_poll_visibility no longer lets a snap be switched to Everyone afterwards: snaps
--    for Everyone get a stricter photo check and need a day-old account, both decided
--    when the snap is sent.

create or replace function public.create_snap(photo_path text, question text, answers text[],
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
  q text := regexp_replace(trim(coalesce(question, '')), '\s+', ' ', 'g');
  opts text[] := '{}';
  a text;
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

  if vis not in ('public', 'circle', 'link') then
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

  if char_length(q) not between 3 and 80 then
    raise exception 'docchi:question_length' using errcode = '22023';
  end if;
  foreach a in array coalesce(answers, '{}') loop
    a := regexp_replace(trim(coalesce(a, '')), '\s+', ' ', 'g');
    if char_length(a) not between 1 and 24 then
      raise exception 'docchi:answer_length' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(opts) o where lower(o) = lower(a)) then
      raise exception 'docchi:duplicate_answers' using errcode = '22023';
    end if;
    opts := opts || a;
  end loop;
  if cardinality(opts) not between 2 and 4 then
    raise exception 'docchi:answer_count' using errcode = '22023';
  end if;
  if public.has_blocked_term(q || ' ' || array_to_string(opts, ' ')) then
    raise exception 'docchi:blocked_words' using errcode = 'P0001';
  end if;

  if photo_path is null or split_part(photo_path, '/', 1) <> uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.polls p where p.photo_path = create_snap.photo_path) then
    raise exception 'docchi:no_photo' using errcode = 'P0002';
  end if;

  insert into public.polls (creator_id, kind, question, visibility, closes_at, photo_path, photo_status, photo_live)
  values (uid, 'snap', q, vis, now() + interval '24 hours', create_snap.photo_path, 'pending', coalesce(live, false))
  returning id into new_id;

  insert into public.poll_options (poll_id, position, text)
  select new_id, o.ord - 1, o.text from unnest(opts) with ordinality as o(text, ord);

  return new_id;
end;
$$;
revoke execute on function public.create_snap(text, text, text[], text, boolean) from public, anon;
grant execute on function public.create_snap(text, text, text[], text, boolean) to authenticated;

create or replace function public.set_poll_visibility(poll uuid, visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if set_poll_visibility.visibility not in ('public', 'link', 'circle') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  if set_poll_visibility.visibility = 'public' and exists (
       select 1 from public.polls p where p.id = poll and p.kind = 'snap' and p.visibility <> 'public') then
    raise exception 'docchi:visibility' using errcode = '22023';
  end if;
  update public.polls p
  set visibility = set_poll_visibility.visibility
  where p.id = poll and p.creator_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'docchi:not_yours' using errcode = '42501';
  end if;
  -- Switching to the circle later means the whole circle.
  delete from public.poll_audience a where a.poll_id = poll;
end;
$$;
revoke execute on function public.set_poll_visibility(uuid, text) from public, anon;
grant execute on function public.set_poll_visibility(uuid, text) to authenticated;
