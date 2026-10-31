import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
const repo = process.argv[2];
const db = new PGlite({ extensions: { citext, pg_trgm } });
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt', true), ''), '{}')::jsonb $$;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase's defaults for the public schema:
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant execute on function storage.foldername(text) to anon, authenticated;`);
for (const f of fs.readdirSync(`${repo}/supabase/migrations`).sort()) await db.exec(fs.readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8'));
await db.exec(fs.readFileSync(`${repo}/supabase/seed.sql`, 'utf8'));
if (process.argv[3]) await db.exec(fs.readFileSync(process.argv[3], 'utf8')); // the fix, when testing it
const q = async (s, p) => (await db.query(s, p)).rows;
const U = {}; let n = 1;
for (const name of ['owner', 'friend', 'stranger', 'admin', 'f2', 'f3', 'f4']) { const id = `0000000${n++}-0000-0000-0000-000000000000`; U[name] = id; await db.exec(`insert into auth.users(id, email, raw_user_meta_data) values ('${id}','${name}@x.com','{"full_name":"${name}"}')`); }
await q(`update profiles set username = 'u_' || substr(id::text,8,1)`); // u_1..u_7
const name = (k) => 'u_' + U[k].slice(7, 8);
await q(`update profiles set created_at = now() - interval '3 days'`);
await q(`update profiles set is_admin = true where id = $1`, [U.admin]);
const as = async (uid, fn, anonymous = false) => { await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.uid','${uid ?? ''}',false), set_config('request.jwt','{"is_anonymous":${anonymous}}',false)`); try { return await fn(); } finally { await db.exec('reset role'); } };
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

// ── What people like: tags, Spark, admin_likes ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;

// Grants
ok('polls_to_tag: open to the job (anon key + secret)', await priv('anon', 'polls_to_tag(text,int)'));
ok('set_poll_tags: open to the job', await priv('anon', 'set_poll_tags(text,uuid,text,text,boolean,text)'));
ok('admin_likes: closed to anon', !(await priv('anon', 'admin_likes(int)')));
ok('admin_set_poll_tags: closed to anon', !(await priv('anon', 'admin_set_poll_tags(uuid,text,text,boolean,text)')));
for (const fn of ['poll_spark(int,int,int,int,int,int)', 'likes_polls(timestamptz,timestamptz)'])
  ok(`${fn}: internal`, !(await priv('authenticated', fn)) && !(await priv('anon', fn)));
ok('polls_to_tag: wrong secret refused', /bad_secret/.test(await err(() => anon(() => q(`select * from public.polls_to_tag('nope-nope-nope-nope-nope-nope', 5)`))) ?? ''));
ok('set_poll_tags: wrong secret refused', /bad_secret/.test(await err(() => anon(() => q(`select public.set_poll_tags('nope', gen_random_uuid(), 'food', 'debate', false, 'en')`))) ?? ''));
ok('admin_likes: not the admin refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_likes(14)`))) ?? ''));
ok('admin_set_poll_tags: not the admin refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_set_poll_tags(gen_random_uuid(), 'food', 'debate', false, 'en')`))) ?? ''));

// Spark
const spark = async (...a) => (await q(`select public.poll_spark($1,$2,$3,$4,$5,$6)::float8 s`, a))[0].s;
ok('Spark: under 5 seen → none', (await spark(4, 2, 0, 0, 2, 2)) === null);
ok('Spark: everything at the top → 100', (await spark(10, 10, 1, 2, 5, 2)) === 100, String(await spark(10, 10, 1, 2, 5, 2)));
ok('Spark: seen by 20, 6 voted, no shares, no comments, 3/3 split → 20 + 15 = 35', (await spark(20, 6, 0, 0, 3, 2)) === 35, String(await spark(20, 6, 0, 0, 3, 2)));
ok('Spark: one answer takes all → split part 0', (await spark(10, 6, 0, 0, 6, 2)) === 40, String(await spark(10, 6, 0, 0, 6, 2)));
ok('Spark: fewer than 5 votes → split half (7.5)', (await spark(10, 3, 0, 0, 3, 2)) === Math.round(3 / 10 / 0.6 * 40 + 7.5), String(await spark(10, 3, 0, 0, 3, 2)));
ok('Spark: votes counted above views (view lag) → treated as seen', (await spark(0, 6, 0, 0, 3, 2)) === 55, String(await spark(0, 6, 0, 0, 3, 2)));

// Polls: people's, the admin's, Eithr's, a test account's, a deleted one, a hidden one
await q(`update profiles set is_test = true where id = $1`, [U.f4]);
const mk = async (creator, question, opts = {}) => {
  const r = await q(`insert into public.polls (creator_id, question, is_system, created_at, view_count, vote_count, share_count, visibility, deleted_at, is_hidden)
                     values ($1, $2, $3, now() - ($4 || ' hours')::interval, $5, $6, $7, $8, $9, $10) returning id`,
    [creator, question, opts.system ?? false, String(opts.ago ?? 1), opts.views ?? 20, opts.votes ?? 10, opts.shares ?? 0, opts.vis ?? 'public', opts.deleted ? new Date().toISOString() : null, opts.hidden ?? false]);
  const id = r[0].id;
  const v = opts.votes ?? 10, a = Math.ceil(v * (opts.lead ?? 0.5));
  await q(`insert into public.poll_options (poll_id, position, text, vote_count) values ($1, 0, 'A', $2), ($1, 1, 'B', $3)`, [id, a, v - a]);
  return id;
};
const P = {};
P.food = await mk(U.owner, 'Maggi at 2 am or chai at 6 am?', { views: 20, votes: 12, shares: 2 });
P.cricket = await mk(U.friend, 'Who wins tonight?', { views: 30, votes: 9, lead: 0.9 });
P.eithr = await mk(null, 'Kaju katli or gulab jamun?', { system: true, views: 40, votes: 25, shares: 1 });
P.mine = await mk(U.admin, 'Theatre or OTT?', { views: 12, votes: 8 });
P.friends = await mk(U.stranger, 'Secret friends poll', { vis: 'circle', views: 10, votes: 5 });
P.test = await mk(U.f4, 'Test account poll', { views: 50, votes: 50 });
P.deleted = await mk(U.owner, 'Deleted poll', { deleted: true });
P.hidden = await mk(U.owner, 'Hidden poll', { hidden: true });
P.old = await mk(U.owner, 'Last fortnight poll', { ago: 24 * 20 });
P.fresh = await mk(U.friend, 'Nobody saw this yet', { views: 2, votes: 1 });
await q(`insert into public.comments (poll_id, user_id, text) values ($1, $2, 'haha'), ($1, $3, 'same'), ($1, $3, 'hidden one')`, [P.food, U.friend, U.stranger]);
await q(`update public.comments set is_hidden = true where text = 'hidden one'`);

// The tagging job
let todo = await anon(() => q(`select * from public.polls_to_tag($1, 50)`, [SECRET]));
// Newest first: each one no newer than the one before (polls made in the same instant may come in either order).
const made = Object.fromEntries((await q(`select id, created_at from public.polls where id = any($1)`, [todo.map((t) => t.id)])).map((r) => [r.id, new Date(r.created_at).getTime()]));
const newestFirst = todo.every((t, i) => i === 0 || made[todo[i - 1].id] >= made[t.id]);
ok('to tag: newest first, deleted and hidden left out', newestFirst && !todo.some((t) => t.id === P.deleted || t.id === P.hidden) && todo.some((t) => t.id === P.old), todo.map((t) => t.question).join(' | '));
ok('to tag: answers come with the question', JSON.stringify(todo.find((t) => t.id === P.food).options) === '["A","B"]');
ok('to tag: max_rows is kept to 1–50', (await anon(() => q(`select * from public.polls_to_tag($1, 2)`, [SECRET]))).length === 2);
const tag = (id, topic, feel, timely = false, lang = 'en') => anon(() => q(`select public.set_poll_tags($1, $2, $3, $4, $5, $6)`, [SECRET, id, topic, feel, timely, lang]));
await tag(P.food, 'food', 'relatable');
await tag(P.cricket, 'cricket', 'predict', true);
await tag(P.eithr, 'food', 'debate', true, 'hinglish');
await tag(P.mine, 'movies', 'debate');
await tag(P.friends, 'family', 'emotional', false, 'hinglish');
await tag(P.old, 'food', 'relatable');
ok('a bad topic is refused by the table', /polls_topic_check/.test(await err(() => tag(P.test, 'politics', 'debate')) ?? ''));
ok('a bad feel is refused', /polls_feel_check/.test(await err(() => tag(P.test, 'food', 'angry')) ?? ''));
ok('a bad language is refused', /polls_lang_check/.test(await err(() => tag(P.test, 'food', 'funny', false, 'fr')) ?? ''));
let row = (await q(`select topic, feel, timely, lang, tag_source, tagged_at is not null t from public.polls where id = $1`, [P.eithr]))[0];
ok('tags saved, source ai', row.topic === 'food' && row.feel === 'debate' && row.timely === true && row.lang === 'hinglish' && row.tag_source === 'ai' && row.t, JSON.stringify(row));
// Couldn't tag: 3 tries, then it stops coming back
for (let i = 0; i < 3; i++) await anon(() => q(`select public.set_poll_tags($1, $2, null, null, null, null)`, [SECRET, P.fresh]));
todo = await anon(() => q(`select * from public.polls_to_tag($1, 50)`, [SECRET]));
ok('a poll the AI failed 3 times stops coming back', !todo.some((t) => t.id === P.fresh) && todo.some((t) => t.id === P.test), todo.map((t) => t.question).join(' | '));
ok('tagged polls don\'t come back', !todo.some((t) => t.id === P.food));

// The admin changes tags; the AI leaves them alone afterwards
await as(U.admin, () => q(`select public.admin_set_poll_tags($1, 'family', 'emotional', false, 'hinglish')`, [P.mine]));
row = (await q(`select topic, feel, tag_source from public.polls where id = $1`, [P.mine]))[0];
ok('admin tags saved, source admin', row.topic === 'family' && row.tag_source === 'admin', JSON.stringify(row));
await tag(P.mine, 'tech', 'funny');
row = (await q(`select topic, tag_source from public.polls where id = $1`, [P.mine]))[0];
ok('the AI can\'t overwrite the admin\'s tags', row.topic === 'family' && row.tag_source === 'admin');
ok('admin tag change is in the admin log', (await q(`select detail from public.admin_events where action = 'tags'`))[0]?.detail === 'Theatre or OTT? → family · emotional');
ok('admin: bad topic refused', /polls_topic_check/.test(await err(() => as(U.admin, () => q(`select public.admin_set_poll_tags($1, 'politics', 'debate', false, 'en')`, [P.mine]))) ?? ''));
ok('admin: unknown poll → not_found', /not_found/.test(await err(() => as(U.admin, () => q(`select public.admin_set_poll_tags(gen_random_uuid(), 'food', 'debate', false, 'en')`))) ?? ''));

// admin_likes
const L = (await as(U.admin, () => q(`select public.admin_likes(14) r`)))[0].r;
const ids = (arr) => arr.map((x) => x.id);
const allIds = [...ids(L.best), ...ids(L.recent)];
ok('likes: test account, deleted and hidden polls left out', !allIds.includes(P.test) && !allIds.includes(P.deleted) && !allIds.includes(P.hidden));
ok('likes: polls from before the 14 days left out of now', !ids(L.recent).includes(P.old));
ok('likes: counts (6 of ours + the seed polls; scored 5 — one seen by 2 and seed polls unseen; tagged 5)', L.polls >= 6 && L.scored === 5 && L.tagged === 5, JSON.stringify({ p: L.polls, s: L.scored, t: L.tagged }));
const topic = (k) => L.topics.find((t) => t.key === k);
ok('likes: food = 2 polls (people\'s + Eithr\'s)', topic('food')?.n === 2, JSON.stringify(L.topics));
ok('likes: food has last fortnight\'s poll as "prev"', topic('food')?.prev_n === 1 && topic('food')?.prev !== null);
ok('likes: topics sorted best first', L.topics.every((t, i, a) => i === 0 || a[i - 1].spark >= t.spark));
ok('likes: grid has food × relatable', L.grid.some((g) => g.topic === 'food' && g.feel === 'relatable' && g.n === 1));
const who = Object.fromEntries(L.who.map((w) => [w.key, w.n]));
ok('likes: who posted — eithr 1, you 1, people 3', who.eithr === 1 && who.you === 1 && who.people === 3, JSON.stringify(L.who));
ok('likes: languages en and hinglish', L.langs.some((x) => x.key === 'en') && L.langs.some((x) => x.key === 'hinglish'));
ok('likes: timing timely/evergreen', L.timing.some((x) => x.key === 'timely') && L.timing.some((x) => x.key === 'evergreen'));
ok('likes: times of day present', L.times.length >= 1 && L.times.every((t) => ['morning', 'afternoon', 'evening', 'night', 'late'].includes(t.key)));
const bf = L.best.find((b) => b.id === P.food);
ok('likes: best has comments (hidden one not counted) and split', bf?.comments === 2 && bf?.split === '50/50', JSON.stringify(bf));
const bfr = L.best.find((b) => b.id === P.friends);
ok('likes: a friends-only poll shows no author', bfr && bfr.author === null, JSON.stringify(bfr));
ok('likes: Eithr\'s poll author is eithr', L.best.find((b) => b.id === P.eithr)?.author === 'eithr');
ok('likes: a public poll shows its author', L.best.find((b) => b.id === P.cricket)?.author === name('friend'));
ok('likes: best sorted by Spark', L.best.every((b, i, a) => i === 0 || a[i - 1].spark >= b.spark));
ok('likes: recent shows tag source', L.recent.find((r) => r.id === P.mine)?.source === 'admin');
ok('likes: untagged count for the job', typeof L.untagged_all === 'number' && L.untagged_all >= 1, String(L.untagged_all));
ok('likes: voters counted (no votes rows here → 0)', L.voters === 0);
// Days kept in range
const L1 = (await as(U.admin, () => q(`select public.admin_likes(0) r`)))[0].r;
ok('likes: days 0 → 1', L1.days === 1);
const L2 = (await as(U.admin, () => q(`select public.admin_likes(500) r`)))[0].r;
ok('likes: days 500 → 90', L2.days === 90);
// The tag columns can't be written by people directly
await err(() => as(U.owner, () => q(`update public.polls set topic = 'tech', tag_source = 'admin' where id = $1`, [P.food])));
row = (await q(`select topic, tag_source from public.polls where id = $1`, [P.food]))[0];
ok('people can\'t set tags on their own poll directly', row.topic === 'food' && row.tag_source === 'ai', JSON.stringify(row));
// Running the migration again is safe
await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261210000000_likes.sql`, 'utf8'));
ok('migration runs twice; tags kept', (await q(`select topic from public.polls where id = $1`, [P.food]))[0].topic === 'food');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
