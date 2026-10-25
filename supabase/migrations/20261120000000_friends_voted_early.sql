-- "Friends voted" before you vote.
--
-- friends_voted(poll) used to answer only once I'd voted (or on my own poll,
-- or after it closed). Now it answers before too, so a card can say
-- "@priya +2 voted" under the creator's name. Still only who of my accepted
-- friends voted, never what they picked, and only on polls I can see.

create or replace function public.friends_voted(poll uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select pr.username::text as username, pr.avatar_url, v.created_at
    from public.polls p
    join public.votes v on v.poll_id = p.id and v.counted
    join public.circle_members c on c.owner_id = auth.uid() and c.member_id = v.user_id and c.status = 'accepted'
    join public.profiles pr on pr.id = v.user_id
    where p.id = poll and p.deleted_at is null
      and public.can_view_poll(p.id, auth.uid())
  )
  select jsonb_build_object(
    'count', (select count(*) from f),
    'people', coalesce((select jsonb_agg(jsonb_build_object('username', x.username, 'avatar_url', x.avatar_url))
                        from (select * from f order by f.created_at desc limit 5) x), '[]'::jsonb));
$$;
revoke execute on function public.friends_voted(uuid) from public, anon;
grant execute on function public.friends_voted(uuid) to authenticated;
