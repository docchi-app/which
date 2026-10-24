-- "What's new on my polls since I last looked" (Profile dot + highlights).
-- seen_polls remembers each poll's vote count when its creator last opened
-- My polls, so new votes are a subtraction, not a count over votes. New
-- comments are counted from the live-comments index since that moment.

create table public.seen_polls (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  poll_id  uuid not null references public.polls (id) on delete cascade,
  votes    int not null,
  seen_at  timestamptz not null default now(),
  primary key (user_id, poll_id)
);
alter table public.seen_polls enable row level security;
revoke all on public.seen_polls from anon, authenticated;

-- Start everyone at "seen everything", so nobody gets a pile of old news.
insert into public.seen_polls (user_id, poll_id, votes)
select p.creator_id, p.id, p.vote_count
from public.polls p
where p.creator_id is not null and p.deleted_at is null and not p.is_system
on conflict do nothing;

-- New votes and comments (from other people) on my polls of the last 30 days.
-- A poll I haven't opened since it was created counts everything as new.
create or replace function public.my_activity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.id, p.vote_count, p.created_at, s.votes as seen_votes, s.seen_at
    from public.polls p
    left join public.seen_polls s on s.user_id = p.creator_id and s.poll_id = p.id
    where p.creator_id = auth.uid() and p.deleted_at is null and not p.is_hidden
      and p.created_at > now() - interval '30 days'
    order by p.created_at desc
    limit 100
  ),
  news as (
    select m.id,
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
    'polls', coalesce(jsonb_agg(jsonb_build_object('poll_id', n.id, 'votes', n.new_votes, 'comments', n.new_comments))
                      filter (where n.new_votes > 0 or n.new_comments > 0), '[]'))
  from news n;
$$;
grant execute on function public.my_activity() to authenticated;

-- "I've seen it": snapshot my polls' current counts.
create or replace function public.mark_activity_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.seen_polls as s (user_id, poll_id, votes, seen_at)
  select p.creator_id, p.id, p.vote_count, now()
  from public.polls p
  where p.creator_id = auth.uid() and p.deleted_at is null
    and p.created_at > now() - interval '30 days'
  on conflict on constraint seen_polls_pkey do update
  set votes = excluded.votes, seen_at = excluded.seen_at;
$$;
grant execute on function public.mark_activity_seen() to authenticated;
