-- Delete my account (Settings → Delete account), and "best rank" on profiles.
--
-- Deleting removes the person for good: their profile, polls (with every vote
-- and comment on them), their votes and comments elsewhere, friends, lists,
-- notifications and sign-in. Their votes on other people's polls leave those
-- totals. Snap photos live in Storage, which SQL can't delete, so the app
-- removes them first (my_storage_files lists them) and deleting refuses
-- while any are left, so no photo is ever orphaned.

-- My files in the snaps bucket (all of them, live or not).
create or replace function public.my_storage_files()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'snaps' and (storage.foldername(o.name))[1] = auth.uid()::text;
$$;
revoke execute on function public.my_storage_files() from public, anon;
grant execute on function public.my_storage_files() to authenticated;

-- confirm: the word DELETE, typed by the person.
create or replace function public.delete_my_account(confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  mine uuid[];
  my_comments uuid[];
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if upper(trim(coalesce(confirm, ''))) <> 'DELETE' then
    raise exception 'docchi:confirm' using errcode = '22023';
  end if;
  if exists (select 1 from storage.objects o
             where o.bucket_id = 'snaps' and (storage.foldername(o.name))[1] = uid::text) then
    raise exception 'docchi:photos_left' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(p.id), '{}') into mine from public.polls p where p.creator_id = uid;
  select coalesce(array_agg(c.id), '{}') into my_comments from public.comments c where c.user_id = uid;

  -- My votes and shares on other people's polls leave their totals.
  update public.poll_options o set vote_count = greatest(0, o.vote_count - x.n)
  from (select v.option_id, count(*)::int as n from public.votes v
        where v.user_id = uid and v.counted and not (v.poll_id = any(mine))
        group by v.option_id) x
  where o.id = x.option_id;
  update public.polls p set vote_count = greatest(0, p.vote_count - x.n)
  from (select v.poll_id, count(*)::int as n from public.votes v
        where v.user_id = uid and v.counted and not (v.poll_id = any(mine))
        group by v.poll_id) x
  where p.id = x.poll_id;
  update public.polls p set share_count = greatest(0, p.share_count - x.n)
  from (select s.poll_id, count(*)::int as n from public.shares s
        where s.user_id = uid and not (s.poll_id = any(mine))
        group by s.poll_id) x
  where p.id = x.poll_id;

  -- Leaderboard rows and open reports about me or my things.
  delete from public.leader_scores s
  where (s.board = 'creators' and s.subject = uid) or (s.board = 'polls' and s.subject = any(mine));
  update public.reports r set resolved_at = now()
  where r.resolved_at is null
    and ((r.target_type = 'user' and r.target_id = uid)
         or (r.target_type = 'poll' and r.target_id = any(mine))
         or (r.target_type = 'comment' and r.target_id = any(my_comments)));
  delete from public.rate_hits h where h.user_id = uid;

  -- My polls (their options, votes, comments and audiences go with them),
  -- then the account: everything else that's mine cascades from it.
  delete from public.polls p where p.creator_id = uid;
  delete from auth.users u where u.id = uid;
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- Best weekly rank on the creators board (top 100 are kept for every week).
-- name: whose (null = mine). Returns {rank, week} or null if never ranked.
create or replace function public.best_rank(name text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('rank', s.rank, 'week', s.week)
  from public.leader_scores s
  join public.profiles u on u.id = s.subject
  where s.board = 'creators'
    and u.id = coalesce((select x.id from public.profiles x where x.username = best_rank.name), case when best_rank.name is null then auth.uid() end)
    and not u.is_banned
  order by s.rank, s.week
  limit 1;
$$;
grant execute on function public.best_rank(text) to anon, authenticated;
