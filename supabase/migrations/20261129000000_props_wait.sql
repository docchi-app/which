-- Props: a shorter wait, and a way for admins to test without it.
--
-- 1. "You got props" now waits a random 5–30 minutes (was 10–60) before it shows in
--    Activity and goes out as a push. Long enough that several friends will have used the
--    app in that time, so the timing doesn't point at who picked you; props that come due
--    close together still go out as one push. Props already waiting keep their time.
--
-- 2. Settings → "Props without the wait" (admins only, their own account): props picked
--    for you are due at once, so testing doesn't mean waiting. Turning it on also releases
--    the ones already waiting. The push still goes out with the next 2-minute run, and
--    not between 11 pm and 8 am (India time), like every push.

alter table public.props alter column notify_after
  set default now() + make_interval(mins => 5 + floor(random() * 26)::int);

alter table public.profiles add column if not exists props_no_wait boolean not null default false;

-- Props for an account that has "without the wait" on are due straight away.
create or replace function public.props_no_wait_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.picked_id and p.props_no_wait) then
    new.notify_after := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.props_no_wait_due() from public, anon, authenticated;
drop trigger if exists props_no_wait_due on public.props;
create trigger props_no_wait_due before insert on public.props
  for each row execute function public.props_no_wait_due();

-- Reads the switch (on = null) or sets it. Admins only, and only for their own account.
create or replace function public.admin_props_no_wait(on_now boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
begin
  if on_now is not null then
    update public.profiles p set props_no_wait = on_now where p.id = uid;
    if on_now then
      update public.props x set notify_after = now()
      where x.picked_id = uid and x.notified_at is null and x.notify_after > now();
    end if;
  end if;
  return (select p.props_no_wait from public.profiles p where p.id = uid);
end;
$$;
revoke execute on function public.admin_props_no_wait(boolean) from public, anon;
grant execute on function public.admin_props_no_wait(boolean) to authenticated;
