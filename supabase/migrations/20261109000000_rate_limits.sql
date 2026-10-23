-- Rate limits + faster comments.
--
-- Rate limits: triggers on the tables, so every way in is covered, and
-- only for requests from the app (auth.uid() set); the SQL Editor and seed
-- scripts aren't limited. Over the limit → 'docchi:slow_down'.
--   votes                 120 per 10 minutes, 1,500 a day
--   circle requests        20 per 10 minutes (plus the existing 50 a day)
--   shares                 60 an hour
--   blocks                 30 an hour
--   circle groups          20 an hour (plus the existing 10 at once)
--   group members         300 an hour
-- Already limited elsewhere: polls (5 a day), comments, reports, usernames.
--
-- Comments, the Phase A way: a live-comments index that counts read without
-- touching the table, and get_comments takes the newest ~120 from the index
-- before filtering, instead of filtering every comment on a busy poll.

-- ─── Faster comments ───────────────────────────────────────────────────────

-- Comments live for 24 hours from created_at (expires_at is always
-- created_at + 24h), so "live" is a created_at range on this index.
create index comments_live_idx on public.comments (poll_id, created_at desc) where not is_hidden;
drop index if exists public.comments_poll_idx;

create or replace function public.live_comment_count(poll uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.comments c
  where c.poll_id = poll and not c.is_hidden and c.created_at > now() - interval '24 hours';
$$;

create or replace function public.poll_cards(ids uuid[])
returns table (
  ord            bigint,
  id             uuid,
  kind           text,
  visibility     text,
  is_mine        boolean,
  locked         boolean,
  audience       text,
  question       text,
  teaser         text,
  creator        text,
  is_system      boolean,
  featured_today boolean,
  vote_count     integer,
  share_count    integer,
  comment_count  integer,
  created_at     timestamptz,
  closes_at      timestamptz,
  my_option_id   uuid,
  options        jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      x.ord,
      p.*,
      v.option_id as my_option_id,
      coalesce(p.creator_id = auth.uid(), false) as mine,
      case when p.visibility = 'circle' then not coalesce(public.can_view_poll(p.id, auth.uid()), false) else false end as is_locked,
      (v.option_id is not null or p.closes_at <= now() or coalesce(p.creator_id = auth.uid(), false)) as can_see
    from unnest(ids) with ordinality as x(id, ord)
    join public.polls p on p.id = x.id
    left join public.votes v on v.poll_id = p.id and v.user_id = auth.uid()
  )
  select
    b.ord,
    b.id,
    b.kind,
    b.visibility,
    b.mine,
    b.is_locked,
    case when b.mine and b.visibility = 'circle' then
      coalesce((select string_agg(g.name, ', ' order by g.name) from public.poll_audience a
                join public.circle_groups g on g.id = a.group_id where a.poll_id = b.id), 'Whole circle')
    end,
    case when b.is_locked or (b.kind = 'mystery' and not b.can_see) then null else b.question end,
    case when b.is_locked then null else b.teaser end,
    case when b.is_system then 'docchi' else pr.username::text end,
    b.is_system,
    coalesce(b.featured_on = (now() at time zone 'Asia/Kolkata')::date, false),
    b.vote_count,
    b.share_count,
    public.live_comment_count(b.id),
    b.created_at,
    b.closes_at,
    b.my_option_id,
    case when b.is_locked then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object(
                'id', o.id,
                'text', o.text,
                'votes', case when b.can_see then o.vote_count end)
              order by o.position)
         from public.poll_options o where o.poll_id = b.id)
    end
  from base b
  left join public.profiles pr on pr.id = b.creator_id;
$$;

create or replace function public.get_comments(poll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  guest boolean := uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  p record;
  list jsonb;
begin
  select x.id, x.creator_id, x.closes_at, x.deleted_at, x.is_hidden into p from public.polls x where x.id = poll;
  if p.id is null or p.deleted_at is not null or p.is_hidden or not public.can_view_poll(poll, uid) then
    return jsonb_build_object('can_read', false, 'why', 'not_found');
  end if;
  if not public.can_read_comments(poll, uid) then
    return jsonb_build_object('can_read', false, 'why', case when guest and p.closes_at > now() then 'sign_in' else 'vote_first' end);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'text', c.text, 'created_at', c.created_at,
           'username', u.username::text, 'avatar_url', u.avatar_url,
           'pick', o.text, 'pick_index', o.position,
           'is_mine', c.user_id = uid,
           'is_creator', c.user_id = p.creator_id,
           'can_delete', c.user_id = uid or p.creator_id = uid) order by c.created_at), '[]')
  into list
  from (
    -- Newest first straight off comments_live_idx, then drop blocked people.
    select c.* from (
      select c.* from public.comments c
      where c.poll_id = poll and not c.is_hidden and c.created_at > now() - interval '24 hours'
      order by c.created_at desc
      limit 120
    ) c
    where uid is null or not public.is_blocked_between(c.user_id, uid)
    order by c.created_at desc
    limit 100
  ) c
  join public.profiles u on u.id = c.user_id
  left join public.votes v on v.poll_id = c.poll_id and v.user_id = c.user_id
  left join public.poll_options o on o.id = v.option_id;

  return jsonb_build_object(
    'can_read', true,
    'can_post', not guest and p.closes_at > now()
                and not exists (select 1 from public.profiles b where b.id = uid and b.is_banned),
    'closed', p.closes_at <= now(),
    'comments', list);
end;
$$;


-- ─── Rate limits ───────────────────────────────────────────────────────────

create or replace function public.slow_down()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'docchi:slow_down' using errcode = '54000';
end;
$$;

create or replace function public.limit_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
       (select count(*) from public.votes v
        where v.user_id = new.user_id and v.created_at > now() - interval '10 minutes') >= 120
    or (select count(*) from public.votes v
        where v.user_id = new.user_id and v.created_at > now() - interval '24 hours') >= 1500) then
    perform public.slow_down();
  end if;
  return new;
end;
$$;
create trigger votes_rate_limit before insert on public.votes
  for each row execute function public.limit_votes();

create or replace function public.limit_circle_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (select count(*) from public.circle_members c
      where c.member_id = new.member_id and c.created_at > now() - interval '10 minutes') >= 20 then
    perform public.slow_down();
  end if;
  return new;
end;
$$;
create trigger circle_requests_rate_limit before insert on public.circle_members
  for each row execute function public.limit_circle_requests();

create index shares_user_created_idx on public.shares (user_id, created_at);
create or replace function public.limit_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (select count(*) from public.shares s
      where s.user_id = new.user_id and s.created_at > now() - interval '1 hour') >= 60 then
    perform public.slow_down();
  end if;
  return new;
end;
$$;
create trigger shares_rate_limit before insert on public.shares
  for each row execute function public.limit_shares();

create index blocks_blocker_created_idx on public.blocks (blocker_id, created_at);
create or replace function public.limit_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (select count(*) from public.blocks b
      where b.blocker_id = new.blocker_id and b.created_at > now() - interval '1 hour') >= 30 then
    perform public.slow_down();
  end if;
  return new;
end;
$$;
create trigger blocks_rate_limit before insert on public.blocks
  for each row execute function public.limit_blocks();

-- Groups and group members have no created_at, so their hits are counted here.
create table public.rate_hits (
  user_id  uuid not null,
  action   text not null,
  at       timestamptz not null default now()
);
create index rate_hits_idx on public.rate_hits (user_id, action, at);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- Counts one hit; slows down past `max` in `per`.
create or replace function public.rate_hit(person uuid, what text, max int, per interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if person is null then
    return;
  end if;
  if (select count(*) from public.rate_hits h
      where h.user_id = person and h.action = what and h.at > now() - per) >= max then
    perform public.slow_down();
  end if;
  insert into public.rate_hits (user_id, action) values (person, what);
end;
$$;
revoke execute on function public.rate_hit(uuid, text, int, interval) from public, anon, authenticated;

create or replace function public.limit_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'circle_groups' then
    perform public.rate_hit(auth.uid(), 'group', 20, interval '1 hour');
  else
    perform public.rate_hit(auth.uid(), 'group_member', 300, interval '1 hour');
  end if;
  return new;
end;
$$;
create trigger circle_groups_rate_limit before insert on public.circle_groups
  for each row execute function public.limit_groups();
create trigger circle_group_members_rate_limit before insert on public.circle_group_members
  for each row execute function public.limit_groups();

-- Old hits go with the daily clean-up.
create or replace function public.purge_old_rate_hits()
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.rate_hits where at < now() - interval '1 day' $$;
revoke execute on function public.purge_old_rate_hits() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('docchi-rate-hits', '23 3 * * *', 'select public.purge_old_rate_hits()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%)', sqlerrm;
end;
$$;
