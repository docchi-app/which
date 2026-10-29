-- Snaps: 3 a day now means a calendar day, India time.
--
-- The limit used to count any 3 snaps in the last 24 hours, so a snap posted at 11 am
-- yesterday still blocked one at 10 am today, while the message said "That's 3 snaps today.
-- Come back tomorrow!". Now it counts snaps since midnight India time, matching the message.
-- Deleted snaps still count (otherwise post, delete, post again has no limit). The admin
-- isn't limited, for testing.
--
-- Same function as 20261127000000_link_snaps.sql except for the limit check.

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

  -- 3 a day, India time (resets at midnight). Deleted snaps still count. The admin isn't limited.
  if not me.is_admin and (select count(*) from public.polls p
      where p.creator_id = uid and p.kind = 'snap'
        and p.created_at >= ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata') >= 3 then
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
