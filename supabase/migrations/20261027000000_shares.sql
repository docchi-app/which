-- Shares: which signed-in people shared which poll, and where.
-- polls.share_count counts unique sharers, so tapping Share again and again
-- can't pump the leaderboard. Signed-out shares aren't counted.

create table public.shares (
  poll_id     uuid not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  channel     text not null check (channel in ('native', 'whatsapp', 'x', 'copy')),
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id, channel)
);

alter table public.shares enable row level security;
revoke all on public.shares from anon, authenticated;

create or replace function public.record_share(poll uuid, channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  first_share boolean;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return;
  end if;
  if not exists (select 1 from public.polls p where p.id = poll and not p.is_hidden) then
    return;
  end if;

  first_share := not exists (select 1 from public.shares s where s.poll_id = poll and s.user_id = uid);

  insert into public.shares (poll_id, user_id, channel)
  values (poll, uid, record_share.channel)
  on conflict do nothing;

  if first_share and found then
    update public.polls p set share_count = p.share_count + 1 where p.id = poll;
  end if;
end;
$$;

grant execute on function public.record_share(uuid, text) to anon, authenticated;
