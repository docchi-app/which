-- Email: a "Send me a test email" button for the admin (Settings → Email), like the test
-- notification. (No temporary tables and no SELECT … INTO in this file: the Supabase SQL
-- editor takes those for new tables.)
--
-- The server route calls this as the signed-in admin. It returns the admin's own email
-- address (tests only ever go there), records the test in the admin log, and allows 10 a
-- day so testing can't use up Resend's daily limit. A test isn't one of the real lunch or
-- evening emails: nothing is written to email_sends.

create or replace function public.admin_test_email(version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
  address text := (select u.email::text from auth.users u where u.id = uid);
begin
  if address is null or address = '' then
    raise exception 'docchi:no_email' using errcode = 'P0001';
  end if;
  if (select count(*) from public.admin_events e
      where e.admin_id = uid and e.action = 'email_test' and e.at > now() - interval '24 hours') >= 10 then
    raise exception 'docchi:too_many' using errcode = 'P0001';
  end if;
  perform public.admin_event('email_test', left(coalesce(version, ''), 40));
  return jsonb_build_object(
    'user_id', uid,
    'email', address,
    'username', (select p.username::text from public.profiles p where p.id = uid));
end;
$$;
revoke execute on function public.admin_test_email(text) from public, anon;
grant execute on function public.admin_test_email(text) to authenticated;
