-- Props: compliment polls about your friends.
--
--   * Docchi writes every question (prop_questions); people can't write their own.
--   * The server picks the 4 friends you choose from (prop_offers), so nobody
--     can be targeted who isn't your friend, has blocked you, or opted out.
--   * Who picked whom (props.picker_id) never leaves the database: no function
--     returns it. It's kept only for limits and safety.
--   * 10 questions a day (India time, skips count), the same question doesn't
--     come back for 7 days, and you can't pick the same friend for the same
--     question twice. You need 4 friends who can be picked.
--   * "You got props" pushes wait a random 10–60 minutes and are grouped, so
--     timing doesn't give the picker away.
--   * profiles.props_off: "Include me in Props" switched off. You're never an
--     answer and get no props pushes (you can still give props).

-- ─── Tables ────────────────────────────────────────────────────────────────

create table public.prop_questions (
  id        smallint primary key,
  emoji     text not null,
  label     text not null,      -- "Best laugh"
  question  text not null,      -- "Who has the best laugh?"
  active    boolean not null default true
);
alter table public.prop_questions enable row level security;
revoke all on public.prop_questions from anon, authenticated;

alter table public.profiles add column props_off boolean not null default false;

create table public.prop_offers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  question_id  smallint not null references public.prop_questions (id),
  options      uuid[] not null,
  shuffles     smallint not null default 0,
  status       text not null default 'open' check (status in ('open', 'given', 'skipped')),
  day          date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_at   timestamptz not null default now()
);
create unique index prop_offers_one_open on public.prop_offers (user_id) where status = 'open';
create index prop_offers_user_day on public.prop_offers (user_id, day);
create index prop_offers_user_question on public.prop_offers (user_id, question_id, created_at desc);
alter table public.prop_offers enable row level security;
revoke all on public.prop_offers from anon, authenticated;

create table public.props (
  id            bigint generated always as identity primary key,
  question_id   smallint not null references public.prop_questions (id),
  picker_id     uuid not null references public.profiles (id) on delete cascade,
  picked_id     uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  notify_after  timestamptz not null default now() + make_interval(mins => 10 + floor(random() * 51)::int),
  notified_at   timestamptz,
  seen_at       timestamptz,
  unique (picker_id, picked_id, question_id),
  check (picker_id <> picked_id)
);
create index props_picked_idx on public.props (picked_id, created_at desc);
create index props_notify_idx on public.props (notify_after) where notified_at is null;
alter table public.props enable row level security;
revoke all on public.props from anon, authenticated;

-- ─── The question bank (all compliments) ───────────────────────────────────

insert into public.prop_questions (id, emoji, label, question) values
  (1, '😂', 'Best laugh', 'Who has the best laugh?'),
  (2, '🧠', 'Best advice', 'Who gives the best advice?'),
  (3, '🍕', 'Best food recommendations', 'Who always knows the best place to eat?'),
  (4, '🎤', 'Best singer', 'Who should be a singer?'),
  (5, '🕺', 'Best dancer', 'Who owns the dance floor at every wedding?'),
  (6, '👗', 'Best style', 'Who has the best style?'),
  (7, '🤗', 'Best hugs', 'Who gives the best hugs?'),
  (8, '📚', 'Smartest in the group', 'Who is secretly a genius?'),
  (9, '🎬', 'Best movie taste', 'Whose movie recommendations never miss?'),
  (10, '🎧', 'Best music taste', 'Who has the best playlist?'),
  (11, '☀️', 'Brightens every room', 'Who makes every room brighter?'),
  (12, '🧘', 'Calmest in a crisis', 'Who stays calm when everything goes wrong?'),
  (13, '🗺️', 'Best travel buddy', 'Who would be the best travel buddy?'),
  (14, '🍳', 'Best cook', 'Who cooks the best food?'),
  (15, '📸', 'Best photographer', 'Who takes the best photos of everyone?'),
  (16, '💬', 'Best texter', 'Who sends the best texts?'),
  (17, '🎁', 'Best gift giver', 'Who gives the most thoughtful gifts?'),
  (18, '🦸', 'Always shows up', 'Who always shows up when it matters?'),
  (19, '🤣', 'Funniest', 'Who is the funniest person you know?'),
  (20, '🧩', 'Best problem solver', 'Who can fix any problem?'),
  (21, '💪', 'Most motivated', 'Who inspires you to work harder?'),
  (22, '🌱', 'Kindest', 'Who is the kindest person here?'),
  (23, '👂', 'Best listener', 'Who is the best listener?'),
  (24, '🎨', 'Most creative', 'Who is the most creative?'),
  (25, '🏏', 'Sports legend', 'Who would win any sports day?'),
  (26, '📖', 'Best storyteller', 'Who tells the best stories?'),
  (27, '😎', 'Coolest', 'Who is effortlessly cool?'),
  (28, '🧭', 'Natural leader', 'Who would you follow anywhere?'),
  (29, '🎉', 'Life of the party', 'Who is the life of every party?'),
  (30, '☕', 'Best chai partner', 'Who is your favourite chai break partner?'),
  (31, '🌙', 'Best late-night talks', 'Who has the best 2am conversations?'),
  (32, '💼', 'Future CEO', 'Who will be a CEO one day?'),
  (33, '🧳', 'Most organised', 'Who always has everything sorted?'),
  (34, '🍰', 'Sweetest', 'Who is the sweetest person here?'),
  (35, '🔥', 'Most hardworking', 'Who works the hardest?'),
  (36, '💡', 'Best ideas', 'Who comes up with the best ideas?'),
  (37, '🎮', 'Gaming champ', 'Who would win any game night?'),
  (38, '🐶', 'Pets love them', 'Who would every pet love?'),
  (39, '🌟', 'Most likely to be famous', 'Who is most likely to be famous?'),
  (40, '🙌', 'Best hype person', 'Who hypes everyone up the most?'),
  (41, '😇', 'Most honest', 'Who always tells it like it is, kindly?'),
  (42, '🧁', 'Best baker', 'Who would win a baking show?'),
  (43, '🏔️', 'Most adventurous', 'Who is up for any adventure?'),
  (44, '📅', 'Never forgets a birthday', 'Who never forgets your birthday?'),
  (45, '🗣️', 'Best debater', 'Who wins every argument (nicely)?'),
  (46, '🪴', 'Most chill', 'Who is the most chill person here?'),
  (47, '🎭', 'Best actor', 'Who could win an award for acting?'),
  (48, '💃', 'Best wedding energy', 'Who has the best energy at weddings?'),
  (49, '🧠', 'Quiz champion', 'Who would win any quiz?'),
  (50, '🍿', 'Best binge-watch buddy', 'Who is the best binge-watch buddy?'),
  (51, '🫶', 'Most loyal', 'Who is the most loyal friend?'),
  (52, '✨', 'Best glow-up', 'Who has had the best glow-up?'),
  (53, '🛵', 'Best road trip DJ', 'Who should always control the music on road trips?'),
  (54, '🤝', 'Best team player', 'Who makes every team better?'),
  (55, '😁', 'Best smile', 'Who has the best smile?'),
  (56, '🧑‍🏫', 'Best teacher', 'Who explains things the best?'),
  (57, '🏃', 'Most energetic', 'Who never runs out of energy?'),
  (58, '🎯', 'Most focused', 'Who gets things done, always?'),
  (59, '🌈', 'Most positive', 'Who always sees the bright side?'),
  (60, '🍜', 'Street food expert', 'Who knows the best street food spots?'),
  (61, '🖋️', 'Best writer', 'Who writes the best captions?'),
  (62, '🎂', 'Best party planner', 'Who throws the best parties?'),
  (63, '🛍️', 'Best shopping buddy', 'Who is the best shopping buddy?'),
  (64, '🧑‍🍳', 'Best maggi maker', 'Who makes the best 2am maggi?'),
  (65, '🦉', 'Wisest', 'Who is wise beyond their years?'),
  (66, '😌', 'Most comforting', 'Who do you go to on a bad day?'),
  (67, '🎸', 'Most talented', 'Who has a hidden talent?'),
  (68, '🏆', 'Most competitive (in a good way)', 'Who plays to win, every time?'),
  (69, '💌', 'Best at keeping in touch', 'Who always checks in on you?'),
  (70, '🌻', 'Warmest', 'Who makes new people feel welcome?'),
  (71, '🧃', 'Best snack stash', 'Who always has snacks?'),
  (72, '🕶️', 'Main character energy', 'Who has main character energy?'),
  (73, '📝', 'Best notes', 'Whose notes saved everyone before exams?'),
  (74, '🤓', 'Fun fact machine', 'Who knows a fun fact about everything?'),
  (75, '🚀', 'Most ambitious', 'Who is going to go the furthest?'),
  (76, '🎈', 'Best surprise planner', 'Who plans the best surprises?'),
  (77, '🧸', 'Most wholesome', 'Who is the most wholesome?'),
  (78, '🍫', 'Most generous', 'Who always shares?'),
  (79, '🌊', 'Best vibes', 'Who has the best vibes?'),
  (80, '🎙️', 'Best voice notes', 'Who sends the best voice notes?'),
  (81, '🧗', 'Bravest', 'Who is the bravest?'),
  (82, '🪄', 'Makes anything fun', 'Who can make anything fun?'),
  (83, '🫡', 'Most reliable', 'Who can you always count on?'),
  (84, '🥇', 'Best at everything', 'Who is annoyingly good at everything?'),
  (85, '🐣', 'Most adorable', 'Who is the most adorable?'),
  (86, '🎲', 'Most spontaneous', 'Who is up for anything, last minute?'),
  (87, '💫', 'Most inspiring', 'Who inspires you the most?'),
  (88, '🍵', 'Best host', 'Who is the best host?'),
  (89, '🧑‍💻', 'Tech wizard', 'Who fixes everyone''s phone?'),
  (90, '🏡', 'Feels like home', 'Who feels like home?'),
  (91, '😆', 'Best memes', 'Who sends the best memes?'),
  (92, '🎊', 'Best at celebrating others', 'Who celebrates your wins the loudest?'),
  (93, '🦋', 'Most fun to meet', 'Who is the most fun to meet for the first time?'),
  (94, '📣', 'Best cheerleader', 'Who would cheer the loudest for you?'),
  (95, '🌸', 'Most thoughtful', 'Who remembers the little things?'),
  (96, '🥳', 'Best birthday wishes', 'Who sends the best birthday wishes?'),
  (97, '🧑‍🤝‍🧑', 'Glue of the group', 'Who keeps the group together?'),
  (98, '🏅', 'Most improved', 'Who has grown the most this year?'),
  (99, '😴', 'Best nap buddy', 'Who could nap anywhere, anytime?'),
  (100, '💛', 'Best friend energy', 'Who has the best friend energy?');

-- ─── Helpers ───────────────────────────────────────────────────────────────

-- Friends `me` can give props to for question q (or any question, q null).
create or replace function public.prop_candidates(me uuid, q smallint default null)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.member_id
  from public.circle_members c
  join public.profiles u on u.id = c.member_id
  where c.owner_id = me and c.status = 'accepted'
    and not u.is_banned and not u.props_off and u.username::text not like 'guest\_%'
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = me and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = me))
    and (q is null or not exists (select 1 from public.props p
                                  where p.picker_id = me and p.picked_id = u.id and p.question_id = q));
$$;
revoke execute on function public.prop_candidates(uuid, smallint) from public, anon, authenticated;

create or replace function public.prop_me()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then
    raise exception 'docchi:banned' using errcode = '42501';
  end if;
  return uid;
end;
$$;
revoke execute on function public.prop_me() from public, anon, authenticated;

-- The offer as the app sees it.
create or replace function public.prop_offer_json(o public.prop_offers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', 'ready',
    'offer', o.id,
    'emoji', q.emoji,
    'label', q.label,
    'question', q.question,
    'shuffles_left', greatest(0, 2 - o.shuffles),
    'left', greatest(0, 10 - (select count(*) from public.prop_offers x
                              where x.user_id = o.user_id and x.day = (now() at time zone 'Asia/Kolkata')::date
                                and x.status <> 'open')),
    'options', (select coalesce(jsonb_agg(jsonb_build_object('username', u.username::text, 'avatar_url', u.avatar_url)
                                          order by o2.ord), '[]')
                from unnest(o.options) with ordinality as o2(id, ord)
                join public.profiles u on u.id = o2.id))
  from public.prop_questions q
  where q.id = o.question_id;
$$;
revoke execute on function public.prop_offer_json(public.prop_offers) from public, anon, authenticated;

-- ─── What the app calls ────────────────────────────────────────────────────

-- {state: 'ready' | 'locked' | 'done', left, friends, off}
create or replace function public.props_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  friends int;
  used int;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('state', 'sign_in');
  end if;
  select count(*) into friends from public.prop_candidates(uid);
  select count(*) into used from public.prop_offers o
  where o.user_id = uid and o.day = (now() at time zone 'Asia/Kolkata')::date and o.status <> 'open';
  return jsonb_build_object(
    'state', case when friends < 4 then 'locked' when used >= 10 then 'done' else 'ready' end,
    'left', greatest(0, 10 - used),
    'friends', friends,
    'off', (select p.props_off from public.profiles p where p.id = uid));
end;
$$;
grant execute on function public.props_state() to authenticated;

-- The open question (or a new one).
create or replace function public.next_prop()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.prop_me();
  o public.prop_offers;
  st jsonb := public.props_state();
  q smallint;
  picks uuid[];
begin
  select * into o from public.prop_offers x where x.user_id = uid and x.status = 'open';
  if found then
    -- Still four people who can be picked? Otherwise drop it and start a new one.
    if (select count(*) from unnest(o.options) id where id in (select public.prop_candidates(uid, o.question_id))) = 4 then
      return public.prop_offer_json(o);
    end if;
    delete from public.prop_offers x where x.id = o.id;
  end if;
  if st ->> 'state' <> 'ready' then
    return st;
  end if;

  for q in
    select pq.id from public.prop_questions pq
    where pq.active
      and not exists (select 1 from public.prop_offers x
                      where x.user_id = uid and x.question_id = pq.id and x.created_at > now() - interval '7 days')
    order by random()
  loop
    select array_agg(c) into picks from (select c from public.prop_candidates(uid, q) c order by random() limit 4) s;
    if coalesce(cardinality(picks), 0) = 4 then
      insert into public.prop_offers (user_id, question_id, options) values (uid, q, picks) returning * into o;
      return public.prop_offer_json(o);
    end if;
  end loop;
  -- Every question has been asked this week.
  return jsonb_build_object('state', 'done', 'left', st -> 'left', 'friends', st -> 'friends');
end;
$$;
grant execute on function public.next_prop() to authenticated;

create or replace function public.shuffle_prop(offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.prop_me();
  o public.prop_offers;
  picks uuid[];
begin
  select * into o from public.prop_offers x where x.id = offer and x.user_id = uid and x.status = 'open' for update;
  if not found then
    raise exception 'docchi:no_offer' using errcode = 'P0002';
  end if;
  if o.shuffles >= 2 then
    raise exception 'docchi:no_shuffles' using errcode = 'P0001';
  end if;
  -- New faces first, then anyone.
  select array_agg(c) into picks from (
    select c from public.prop_candidates(uid, o.question_id) c
    order by (c = any(o.options)), random() limit 4) s;
  update public.prop_offers x set options = picks, shuffles = x.shuffles + 1 where x.id = o.id returning * into o;
  return public.prop_offer_json(o);
end;
$$;
grant execute on function public.shuffle_prop(uuid) to authenticated;

create or replace function public.give_prop(offer uuid, username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.prop_me();
  o public.prop_offers;
  target uuid;
begin
  select * into o from public.prop_offers x where x.id = offer and x.user_id = uid and x.status = 'open' for update;
  if not found then
    raise exception 'docchi:no_offer' using errcode = 'P0002';
  end if;
  select p.id into target from public.profiles p where p.username = lower(give_prop.username);
  if target is null or not (target = any(o.options))
     or not exists (select 1 from public.prop_candidates(uid, o.question_id) c where c = target) then
    raise exception 'docchi:not_an_option' using errcode = '22023';
  end if;
  insert into public.props (question_id, picker_id, picked_id) values (o.question_id, uid, target);
  update public.prop_offers x set status = 'given' where x.id = o.id;
  return public.props_state();
end;
$$;
grant execute on function public.give_prop(uuid, text) to authenticated;

create or replace function public.skip_prop(offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.prop_me();
begin
  update public.prop_offers x set status = 'skipped' where x.id = offer and x.user_id = uid and x.status = 'open';
  return public.props_state();
end;
$$;
grant execute on function public.skip_prop(uuid) to authenticated;

-- What friends say about me: counts per question (never who).
create or replace function public.my_props()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', coalesce(sum(g.n), 0),
    'new', coalesce(sum(g.fresh), 0),
    'items', coalesce(jsonb_agg(jsonb_build_object('emoji', g.emoji, 'label', g.label, 'count', g.n, 'new', g.fresh)
                                order by g.n desc, g.last desc), '[]'))
  from (
    select q.emoji, q.label, count(*)::int as n, count(*) filter (where p.seen_at is null)::int as fresh,
           max(p.created_at) as last
    from public.props p
    join public.prop_questions q on q.id = p.question_id
    -- Only once its notification time has come, so the timing can't give the picker away.
    where p.picked_id = auth.uid() and p.notify_after <= now()
    group by q.emoji, q.label
  ) g;
$$;
grant execute on function public.my_props() to authenticated;

create or replace function public.props_news()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.props p
  where p.picked_id = auth.uid() and p.seen_at is null and p.notify_after <= now();
$$;
grant execute on function public.props_news() to authenticated;

create or replace function public.mark_props_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.props p set seen_at = now()
  where p.picked_id = auth.uid() and p.seen_at is null and p.notify_after <= now();
$$;
grant execute on function public.mark_props_seen() to authenticated;

create or replace function public.set_props_off(off boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.prop_me();
begin
  update public.profiles p set props_off = coalesce(set_props_off.off, false) where p.id = uid;
  -- Leave nobody with an offer that includes me.
  if coalesce(set_props_off.off, false) then
    delete from public.prop_offers o where o.status = 'open' and uid = any(o.options);
  end if;
end;
$$;
grant execute on function public.set_props_off(boolean) to authenticated;

-- ─── Pushes: "You got props" (delayed and grouped) ─────────────────────────

alter table public.push_settings add column props boolean not null default true;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('votes', 'circle', 'results', 'daily', 'comments', 'props', 'test'));

create or replace function public.get_push_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'votes', coalesce(s.votes, true), 'circle', coalesce(s.circle, true),
    'results', coalesce(s.results, true), 'daily', coalesce(s.daily, true),
    'comments', coalesce(s.comments, true), 'props', coalesce(s.props, true))
  from (select 1) x
  left join public.push_settings s on s.user_id = auth.uid();
$$;

drop function if exists public.set_push_settings(boolean, boolean, boolean, boolean, boolean);
create function public.set_push_settings(votes boolean, circle boolean, results boolean, daily boolean,
                                         comments boolean default true, props boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'docchi:sign_in' using errcode = '28000';
  end if;
  insert into public.push_settings as p (user_id, votes, circle, results, daily, comments, props)
  values (auth.uid(), set_push_settings.votes, set_push_settings.circle, set_push_settings.results,
          set_push_settings.daily, set_push_settings.comments, set_push_settings.props)
  on conflict on constraint push_settings_pkey do update
  set votes = excluded.votes, circle = excluded.circle, results = excluded.results,
      daily = excluded.daily, comments = excluded.comments, props = excluded.props;
end;
$$;
grant execute on function public.set_push_settings(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.push_wanted(person uuid, what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = person)
     and coalesce((select case what when 'votes' then p.votes when 'circle' then p.circle
                                    when 'results' then p.results when 'daily' then p.daily
                                    when 'comments' then p.comments when 'props' then p.props else true end
                   from public.push_settings p where p.user_id = person), true);
$$;

create or replace function public.props_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with due as (
    update public.props p set notified_at = now()
    where p.notified_at is null and p.notify_after <= now()
    returning p.id, p.picked_id, p.question_id
  ),
  grouped as (
    select d.picked_id, count(*)::int as n, max(d.id) as last_id,
           (array_agg(q.label order by d.id desc))[1] as label
    from due d join public.prop_questions q on q.id = d.question_id
    group by d.picked_id
  )
  insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
  select g.picked_id, 'props',
         case when g.n = 1 then '💜 You got props!' else '💜 You got ' || g.n || ' new props!' end,
         case when g.n = 1 then 'A friend picked you for “' || g.label || '”.'
              else 'Your friends picked you for “' || g.label || '” and more.' end,
         '/activity', 'props', 'props:' || g.picked_id || ':' || g.last_id
  from grouped g
  join public.profiles u on u.id = g.picked_id
  where not u.props_off and public.push_wanted(g.picked_id, 'props')
  on conflict (dedupe) do nothing;
end;
$$;
revoke execute on function public.props_scan() from public, anon, authenticated;

-- push_collect runs every 2 minutes; it now also turns due props into pushes.
create or replace function public.push_collect(secret text, max_rows int default 300)
returns table (id bigint, endpoint text, p256dh text, auth text, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
  day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:forbidden' using errcode = '42501';
  end if;
  -- Only one sender at a time.
  if not pg_try_advisory_xact_lock(hashtext('docchi.push')) then
    return;
  end if;

  perform public.push_scan();
  perform public.props_scan();
  if local_hour >= 23 or local_hour < 8 then
    return;
  end if;

  return query
  with pending as (
    select n.id, n.user_id,
           row_number() over (partition by n.user_id
                              order by case n.kind when 'test' then 0 when 'circle' then 1 when 'props' then 2
                                                   when 'results' then 3 when 'votes' then 4 else 5 end, n.created_at) as rn
    from public.notifications n
    where n.sent_at is null and n.created_at > now() - interval '12 hours'
  ),
  picked as (
    select pe.id from pending pe
    where pe.rn <= 8 - (select count(*) from public.notifications x
                        where x.user_id = pe.user_id and x.sent_at >= day_start and x.kind <> 'test')
    order by pe.id
    limit greatest(coalesce(max_rows, 300), 1)
  ),
  claimed as (
    update public.notifications n set sent_at = now()
    where n.id in (select pk.id from picked pk)
    returning n.id, n.user_id, n.title, n.body, n.url, n.tag
  )
  select c.id, s.endpoint, s.p256dh, s.auth,
         jsonb_build_object('title', c.title, 'body', c.body, 'url', c.url, 'tag', c.tag)
  from claimed c
  join public.push_subscriptions s on s.user_id = c.user_id;
end;
$$;
revoke execute on function public.push_collect(text, int) from public;
grant execute on function public.push_collect(text, int) to anon, authenticated;
