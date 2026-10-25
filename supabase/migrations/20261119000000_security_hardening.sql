-- Security hardening (from the security review).
--
-- 1. No direct table access for the app's roles. The app only talks to the
--    database through functions (each checks who's asking), but Supabase
--    grants every table to anon/authenticated by default, so tables were
--    readable through the REST API wherever a policy allowed it. profiles was
--    readable in full by anyone, including invite codes (which make you
--    friends with their owner instantly). Now: no table grants at all, for
--    existing and future tables.
-- 2. Invite codes were exposed, so everyone gets a new one. Old invite links
--    stop working; the Friends tab shows the new link.
-- 3. is_admin_user() is no longer callable by signed-out visitors (it said
--    whether any user id is an admin). Signed-in users keep it: the snaps
--    Storage policy uses it.
-- 4. Push subscriptions must point at a real push service (Google, Mozilla,
--    Apple, Microsoft), so the push sender can't be aimed at other servers.

-- 1 ──────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 2 ──────────────────────────────────────────────────────────────────────────
update public.profiles set invite_code = null where invite_code is not null;

-- 3 ──────────────────────────────────────────────────────────────────────────
revoke execute on function public.is_admin_user(uuid) from public, anon;
grant execute on function public.is_admin_user(uuid) to authenticated;

-- 4 ──────────────────────────────────────────────────────────────────────────
create or replace function public.push_endpoint_ok(endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(endpoint) <= 1000
     and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/';
$$;
revoke execute on function public.push_endpoint_ok(text) from public, anon, authenticated;

create or replace function public.save_push_subscription(endpoint text, p256dh text, auth_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if not public.push_endpoint_ok(endpoint) or char_length(p256dh) > 200 or char_length(auth_key) > 100 then
    raise exception 'docchi:bad_subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth)
  values (save_push_subscription.endpoint, uid, save_push_subscription.p256dh, auth_key)
  on conflict on constraint push_subscriptions_pkey do update
  set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  -- Ten devices is plenty; drop the oldest beyond that.
  delete from public.push_subscriptions s
  where s.user_id = uid
    and s.endpoint not in (select s2.endpoint from public.push_subscriptions s2
                           where s2.user_id = uid order by s2.created_at desc limit 10);
end;
$$;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

delete from public.push_subscriptions s where not public.push_endpoint_ok(s.endpoint);
