-- Guests can vote before signing in.
--
-- A guest (Supabase anonymous account) votes and sees results straight away,
-- but the vote is stored with counted = false and left out of every total.
-- When the guest links Google, the account keeps its id (is_anonymous flips
-- to false) and its votes join the totals then. So one Google account is
-- still one vote; opening a private window only makes votes that never count.
--
-- Needs Authentication → Sign In / Providers → "Allow anonymous sign-ins" and
-- "Allow manual linking" switched on in Supabase. Without them the app falls
-- back to asking for Google before the first vote, as before.

alter table public.votes add column counted boolean not null default true;

-- ─── Voting ────────────────────────────────────────────────────────────────

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
      and p.closes_at > now() and p.created_at <= now();
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

-- ─── A guest signs in: their votes join the totals ─────────────────────────

create or replace function public.count_guest_votes(person uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with c as (
    update public.votes v set counted = true
    where v.user_id = person and not v.counted
    returning v.poll_id, v.option_id
  ), o as (
    update public.poll_options o set vote_count = o.vote_count + x.n
    from (select c.option_id, count(*)::int as n from c group by c.option_id) x
    where o.id = x.option_id
  )
  update public.polls p set vote_count = p.vote_count + x.n
  from (select c.poll_id, count(*)::int as n from c group by c.poll_id) x
  where p.id = x.poll_id;
$$;
revoke execute on function public.count_guest_votes(uuid) from public, anon, authenticated;

create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seed text := public.name_seed(new.raw_user_meta_data, new.email);
begin
  -- An automatic name, not one the person chose: leave it unconfirmed.
  perform set_config('docchi.auto_name', 'on', true);
  update public.profiles p
  set avatar_url = coalesce(
        p.avatar_url,
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'),
      -- A guest who just linked Google gets a starting username too.
      username = case
        when p.username::text like 'guest\_%' and not coalesce(new.is_anonymous, false) and seed is not null
          then public.pick_username(seed, new.id)
        else p.username
      end
  where p.id = new.id;
  perform set_config('docchi.auto_name', 'off', true);

  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    perform public.count_guest_votes(new.id);
  end if;
  return new;
end;
$$;

-- ─── Leaderboard: only counted votes ───────────────────────────────────────

create or replace function public.counted_votes(week date)
returns table (poll_id uuid, creator_id uuid, voter uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select v.poll_id, p.creator_id, v.user_id
  from public.votes v
  join public.polls p on p.id = v.poll_id
  join public.profiles voter on voter.id = v.user_id
  join public.profiles maker on maker.id = p.creator_id
  where v.created_at >= public.week_start_ts(week)
    and v.created_at < public.week_start_ts(week + 7)
    and v.counted
    and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden and not p.is_system
    and v.user_id <> p.creator_id
    and not voter.is_banned and not maker.is_banned
    and voter.created_at < v.created_at - interval '1 day';
$$;
revoke execute on function public.counted_votes(date) from public, anon, authenticated;

create or replace function public.my_week_score(person uuid, week date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.polls p
  join public.votes v on v.poll_id = p.id
  join public.profiles voter on voter.id = v.user_id
  where p.creator_id = person
    and p.visibility = 'public' and p.deleted_at is null and not p.is_hidden and not p.is_system
    and p.closes_at > public.week_start_ts(week)
    and v.created_at >= public.week_start_ts(week)
    and v.created_at < public.week_start_ts(week + 7)
    and v.counted
    and v.user_id <> person
    and not voter.is_banned
    and voter.created_at < v.created_at - interval '1 day';
$$;
revoke execute on function public.my_week_score(uuid, date) from public, anon, authenticated;
