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


// ── Group links and friends' picks ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const As = async (who, sql, p, guest = false) => (await as(U[who], () => q(sql, p), guest))[0]?.r;
const code = async (fn) => { const e = await err(fn); return e ? (e.match(/docchi:(\w+)/)?.[1] ?? e) : 'ok'; };
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;
const mk = async (question, extra = {}) => {
  const row = { creator_id: U.stranger, question, ...extra }; const cols = Object.keys(row), vals = Object.values(row);
  const id = (await q(`insert into public.polls (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, vals))[0].id;
  await q(`insert into public.poll_options (poll_id, position, text) values ($1, 0, 'Goa'), ($1, 1, 'Manali')`, [id]);
  return id;
};
const opt = async (poll, i) => (await q(`select id from public.poll_options where poll_id = $1 and position = $2`, [poll, i]))[0].id;
const vote = async (who, poll, i, guest = false) => { const o = await opt(poll, i); return as(U[who], () => q(`select * from public.cast_vote($1, $2)`, [poll, o]), guest); };
const G = '00000009-0000-0000-0000-000000000000', G2 = '0000000a-0000-0000-0000-000000000000';
for (const g of [G, G2]) await q(`insert into auth.users(id, email, is_anonymous) values ($1, null, true)`, [g]);
U.guest = G; U.guest2 = G2;

// Access
ok('share_links: no direct access for anyone', !(await q(`select has_table_privilege('anon', 'public.share_links', 'select') a`))[0].a
  && !(await q(`select has_table_privilege('authenticated', 'public.share_links', 'select') a`))[0].a);
ok('link_poll open to signed-out visitors; make_share_link / link_vote / link_verdict signed in only',
  await priv('anon', 'link_poll(text)') && !(await priv('anon', 'make_share_link(uuid,text)')) && !(await priv('anon', 'link_vote(text)'))
  && !(await priv('anon', 'link_verdict(text)')) && await priv('authenticated', 'link_vote(text)'));
ok('friends\' picks functions: signed in only; helpers closed to everyone',
  !(await priv('anon', 'friend_picks(uuid)')) && !(await priv('anon', 'friend_match(text)')) && !(await priv('anon', 'my_matches()'))
  && !(await priv('anon', 'set_picks_to_friends(boolean)')) && !(await priv('authenticated', 'shared_picks(uuid,uuid)'))
  && !(await priv('authenticated', 'may_compare(uuid,uuid)')));

// ── 1. Group links ──
const P = await mk('Goa or Manali for the December trip?');
const L = await As('owner', `select public.make_share_link($1, 'quick') r`, [P]);
ok('make_share_link: a 10-letter code', /^[0-9a-f]{10}$/.test(L), L);
const L2 = await As('owner', `select public.make_share_link($1, 'link') r`, [P]);
ok('a new code each time', L2 !== L && /^[0-9a-f]{10}$/.test(L2));
ok('a guest can make one too', /^[0-9a-f]{10}$/.test(await As('guest', `select public.make_share_link($1) r`, [P], true)));
ok('signed out: no link', await code(() => anon(() => q(`select public.make_share_link($1)`, [P]))) !== 'ok');
ok('bad style refused', await code(() => as(U.owner, () => q(`select public.make_share_link($1, 'sms')`, [P]))) === 'bad_style');
const circleP = await mk('Friends only?', { visibility: 'circle' });
ok('friends-only poll: no group link', await code(() => as(U.owner, () => q(`select public.make_share_link($1)`, [circleP]))) === 'no_poll');
const hiddenP = await mk('Hidden?', { is_hidden: true });
ok('hidden poll: no group link', await code(() => as(U.owner, () => q(`select public.make_share_link($1)`, [hiddenP]))) === 'no_poll');

ok('link_poll: signed out sees which poll (upper case too)', (await anon(() => q(`select public.link_poll($1) r`, [L.toUpperCase()])))[0].r === P);
ok('link_poll: unknown code → nothing', (await anon(() => q(`select public.link_poll('0000000000') r`)))[0].r === null);

const before = await As('friend', `select public.link_verdict($1) r`, [L]);
ok('verdict before anyone voted: 0, no split for someone who hasn\'t voted', before.total === 0 && before.options === null && before.voted === false && before.asker === name('owner'));
ok('link_vote before voting tags nothing', (await As('friend', `select public.link_vote($1) r`, [L])).total === 0);

await vote('friend', P, 1);
const v1 = await As('friend', `select public.link_vote($1) r`, [L]);
ok('vote then link_vote: counted in this chat, split shown', v1.total === 1 && v1.voted && v1.options.find((o) => o.votes === 1)?.id === await opt(P, 1), JSON.stringify(v1));
ok('the asker is told at the 1st vote (votes notification, opens the link)', (await q(`select count(*)::int n from public.notifications where user_id = $1 and dedupe = $2 and url = $3 and kind = 'votes'`, [U.owner, `link:${L}:1`, `/v/${L}`]))[0].n === 1);
const body1 = (await q(`select body from public.notifications where dedupe = $1`, [`link:${L}:1`]))[0].body;
ok('push text: "1 person voted from your link · Manali leads 1–0"', body1 === '1 person voted from your link · Manali leads 1–0', body1);
const again = await As('friend', `select public.link_vote($1) r`, [L]);
ok('link_vote twice: still 1', again.total === 1 && (await q(`select vote_count n from public.share_links where code = $1`, [L]))[0].n === 1);
ok('a vote belongs to its first link only', (await As('friend', `select public.link_vote($1) r`, [L2])).total === 0);

const sv = await As('f2', `select public.link_verdict($1) r`, [L]);
ok('someone who hasn\'t voted sees the count, not the split', sv.total === 1 && sv.options === null);
ok('the asker sees the split without voting', (await As('owner', `select public.link_verdict($1) r`, [L])).options !== null);

await vote('guest', P, 0, true);
const gv = await As('guest', `select public.link_vote($1) r`, [L], true);
ok('a guest\'s vote counts in the chat\'s verdict (not in the poll\'s totals)', gv.total === 2 && (await q(`select vote_count n from public.polls where id = $1`, [P]))[0].n === 1, JSON.stringify(gv));
await vote('f2', P, 1);
await As('f2', `select public.link_vote($1) r`, [L]);
ok('3rd vote: told again, once', (await q(`select count(*)::int n from public.notifications where user_id = $1 and dedupe like $2`, [U.owner, `link:${L}:%`]))[0].n === 2);
const body3 = (await q(`select body from public.notifications where dedupe = $1`, [`link:${L}:3`]))[0].body;
ok('push text at 3: "3 people voted from your link · Manali leads 2–1"', body3 === '3 people voted from your link · Manali leads 2–1', body3);
await vote('owner', P, 0);
await As('owner', `select public.link_vote($1) r`, [L]);
ok('the asker\'s own vote shows in the verdict but doesn\'t count as "people voted"', (await As('owner', `select public.link_verdict($1) r`, [L])).total === 4
  && (await q(`select vote_count n from public.share_links where code = $1`, [L]))[0].n === 3);

// Votes notifications off; a guest's link: nobody to tell.
const P2 = await mk('Chai or coffee?');
await q(`insert into public.push_settings (user_id, votes) values ($1, false) on conflict (user_id) do update set votes = false`, [U.f3]);
const L3 = await As('f3', `select public.make_share_link($1) r`, [P2]);
await vote('friend', P2, 0); await As('friend', `select public.link_vote($1) r`, [L3]);
ok('votes notifications off: no push', (await q(`select count(*)::int n from public.notifications where dedupe like $1`, [`link:${L3}:%`]))[0].n === 0);
const LG = await As('guest2', `select public.make_share_link($1) r`, [P2], true);
await vote('f2', P2, 1); await As('f2', `select public.link_vote($1) r`, [LG]);
ok('a guest\'s link: no push (guests have no notifications)', (await q(`select count(*)::int n from public.notifications where dedupe like $1`, [`link:${LG}:%`]))[0].n === 0);

ok('removed poll: link_poll and link_verdict give nothing', await (async () => {
  await q(`update public.polls set deleted_at = now() where id = $1`, [P2]);
  const a = (await anon(() => q(`select public.link_poll($1) r`, [L3])))[0].r;
  const b = await As('friend', `select public.link_verdict($1) r`, [L3]);
  await q(`update public.polls set deleted_at = null where id = $1`, [P2]);
  return a === null && b === null;
})());
ok('circle poll a stranger can\'t see: verdict null', await (async () => {
  const cp = await mk('Owner friends?', { visibility: 'circle', creator_id: U.owner });
  await q(`insert into public.share_links (code, poll_id, created_by) values ('abcdefabcd', $1, $2)`, [cp, U.owner]);
  return (await As('f4', `select public.link_verdict('abcdefabcd') r`)) === null;
})());

ok('100 links a day, then slow_down', await (async () => {
  await q(`insert into public.share_links (code, poll_id, created_by) select substr(md5(g::text), 1, 10), $1, $2 from generate_series(1, 99) g`, [P, U.f4]);
  const a = await code(() => as(U.f4, () => q(`select public.make_share_link($1)`, [P])));
  const b = await code(() => as(U.f4, () => q(`select public.make_share_link($1)`, [P])));
  return a === 'ok' && b === 'slow_down';
})());

await As('f2', `select public.mark_link_shared($1) r`, [L]);
ok('mark_link_shared: only the link\'s own maker', (await q(`select shared_at from public.share_links where code = $1`, [L]))[0].shared_at === null);
await As('owner', `select public.mark_link_shared($1) r`, [L]); await As('owner', `select public.mark_link_shared($1) r`, [L2]);
ok('mark_link_shared: marked', (await q(`select shared_at from public.share_links where code = $1`, [L]))[0].shared_at !== null);
ok('admin_link_styles: admin only; counts shared quick vs link', await (async () => {
  const no = await code(() => as(U.owner, () => q(`select * from public.admin_link_styles(30)`)));
  const rows = await as(U.admin, () => q(`select * from public.admin_link_styles(30)`));
  const quick = rows.find((r) => r.style === 'quick');
  return no !== 'ok' && Number(quick.links) === 1 && Number(quick.votes) === 3 && rows.some((r) => r.style === 'link');
})());

// Undo (a mis-tap from a quick vote link)
const U1 = await mk('Undo me?');
const LU = await As('owner', `select public.make_share_link($1) r`, [U1]);
await vote('f2', U1, 0); await As('f2', `select public.link_vote($1) r`, [LU]);
ok('undo without the poll\'s group link: refused (undo is for quick vote links only)', await code(() => as(U.f2, () => q(`select public.undo_vote($1, $2)`, [U1, L]))) === 'not_from_link'
  && await code(() => as(U.f2, () => q(`select public.undo_vote($1, '0000000000')`, [U1]))) === 'not_from_link'
  && (await q(`select count(*)::int n from public.votes where poll_id = $1`, [U1]))[0].n === 1);
await as(U.f2, () => q(`select public.undo_vote($1, $2)`, [U1, LU]));
ok('undo_vote: vote gone, counts back to 0, link count back', (await q(`select count(*)::int n from public.votes where poll_id = $1`, [U1]))[0].n === 0
  && (await q(`select vote_count n from public.polls where id = $1`, [U1]))[0].n === 0
  && (await q(`select sum(vote_count)::int n from public.poll_options where poll_id = $1`, [U1]))[0].n === 0
  && (await q(`select vote_count n from public.share_links where code = $1`, [LU]))[0].n === 0);
await vote('f2', U1, 1);
ok('then pick again', (await q(`select option_id from public.votes where poll_id = $1`, [U1]))[0].option_id === await opt(U1, 1));
await q(`update public.votes set created_at = now() - interval '20 seconds' where poll_id = $1`, [U1]);
ok('undo after 15 seconds: too_late, vote stays', await code(() => as(U.f2, () => q(`select public.undo_vote($1, $2)`, [U1, LU]))) === 'too_late'
  && (await q(`select count(*)::int n from public.votes where poll_id = $1`, [U1]))[0].n === 1);
ok('undo someone else\'s vote: impossible (only your own is touched)', await (async () => { await as(U.friend, () => q(`select public.undo_vote($1, $2)`, [U1, LU])); return (await q(`select count(*)::int n from public.votes where poll_id = $1`, [U1]))[0].n === 1; })());
const BU = await mk('Brain undo?', { kind: 'brain' });
const LB = await As('owner', `select public.make_share_link($1) r`, [BU]);
await vote('f2', BU, 0);
ok('undo on a Brain break: too_late (the answer is already shown)', await code(() => as(U.f2, () => q(`select public.undo_vote($1, $2)`, [BU, LB]))) === 'too_late');
ok('undo_vote: signed in only', !(await priv('anon', 'undo_vote(uuid,text)')) && !(await priv('anon', 'mark_link_shared(text)')));

// ── 2. Friends' picks ──
const friends = async (a, b) => { await q(`insert into public.circle_members (owner_id, member_id, status, accepted_at) values ($1, $2, 'accepted', now()), ($2, $1, 'accepted', now()) on conflict do nothing`, [a, b]); };
await friends(U.owner, U.friend); await friends(U.owner, U.f2); await friends(U.owner, U.f3);
const F = await mk('Biryani with or without aloo?');
const picks = async (who, poll) => (await as(U[who], () => q(`select * from public.friend_picks($1)`, [poll]))).map((r) => r.username).sort().join(',');
const setShare = (who, on) => as(U[who], () => q(`select public.set_picks_to_friends($1)`, [on]));

ok('not asked yet: setting is null', (await As('owner', `select public.my_picks_setting() r`)) === null);
ok('a guest can\'t turn it on', await code(() => as(U.guest, () => q(`select public.set_picks_to_friends(true)`), true)) === 'sign_in');
await vote('friend', F, 1); await vote('f2', F, 0); await vote('stranger', F, 1);
ok('nobody shares yet: no picks shown', (await picks('owner', F)) === '');
await setShare('owner', true);
ok('I share, I haven\'t voted: nothing', (await picks('owner', F)) === '');
await vote('owner', F, 0);
ok('I share and voted, friends don\'t share: nothing', (await picks('owner', F)) === '');
await setShare('friend', true); await setShare('f2', true); await setShare('stranger', true);
ok('friends who share show with their pick; a stranger never does', (await picks('owner', F)) === [name('friend'), name('f2')].sort().join(','));
const fr = (await as(U.owner, () => q(`select * from public.friend_picks($1)`, [F]))).find((r) => r.username === name('friend'));
ok('the pick is the friend\'s real answer', fr.option_id === await opt(F, 1));
await setShare('owner', false);
ok('fair both ways: private me sees no picks', (await picks('owner', F)) === '');
await setShare('owner', true);
ok('a friend who hasn\'t voted sees nothing (results rule)', await (async () => { await setShare('f3', true); return (await picks('f3', F)) === ''; })());
await as(U.friend, () => q(`select public.hide_my_pick($1, true)`, [F]));
ok('a hidden pick disappears', (await picks('owner', F)) === name('f2'));
ok('my_hidden_picks lists it', (await as(U.friend, () => q(`select * from public.my_hidden_picks()`))).some((r) => r.poll_id === F));
await as(U.friend, () => q(`select public.hide_my_pick($1, false)`, [F]));
ok('shown again', (await picks('owner', F)).includes(name('friend')));
await q(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [U.f2, U.owner]);
ok('blocked: never shown', !(await picks('owner', F)).includes(name('f2')));
await q(`delete from public.blocks where blocker_id = $1`, [U.f2]);
ok('a guest gets nothing', await (async () => { await vote('guest', F, 0, true); return (await as(U.guest, () => q(`select * from public.friend_picks($1)`, [F]), true)).length === 0; })());
const B = await mk('Brain?', { kind: 'brain' });
await vote('owner', B, 0); await vote('friend', B, 1);
ok('Brain break: never shows picks', (await picks('owner', B)) === '');
ok('stranger\'s friends_voted still never reveals picks (unchanged)', !JSON.stringify((await As('owner', `select public.friends_voted($1) r`, [F]))).includes('option'));

// Match
for (let i = 0; i < 11; i++) {
  const p = await mk(`Match poll ${i}?`, { topic: i < 6 ? 'food' : 'work' });
  await vote('owner', p, 0);
  await vote('friend', p, i < 6 ? 0 : (i < 8 ? 0 : 1)); // food: all same; money: 2 same, 3 different
}
const m = await As('owner', `select public.friend_match($1) r`, [name('friend')]);
// shared: P and F (both different) + 11 match polls = 13; agree: 6 food + 2 work = 8
ok('friend_match: shared 13, agree 8', m.shared === 13 && m.agree === 8, JSON.stringify(m));
ok('friend_match: by topic (food 6/6)', m.topics.some((t) => t.topic === 'food' && t.shared === 6 && t.agree === 6));
ok('friend_match: biggest split is a poll we disagreed on', typeof m.split?.question === 'string');
ok('friend_match: a stranger → null', (await As('owner', `select public.friend_match($1) r`, [name('stranger')])) === null);
ok('friend_match: under 10 together → count only', JSON.stringify(await As('owner', `select public.friend_match($1) r`, [name('f2')])) === JSON.stringify({ shared: 2 }));
const mm = await as(U.owner, () => q(`select * from public.my_matches()`));
ok('my_matches: friends with 10+ polls together', mm.length === 1 && mm[0].username === name('friend') && Number(mm[0].shared) === 13);
await setShare('friend', false);
ok('friend turns it off: no match', (await As('owner', `select public.friend_match($1) r`, [name('friend')])) === null && (await as(U.owner, () => q(`select * from public.my_matches()`))).length === 0);
ok('hidden picks are left out of the match', await (async () => {
  await setShare('friend', true);
  await as(U.friend, () => q(`select public.hide_my_pick($1, true)`, [F]));
  const x = await As('owner', `select public.friend_match($1) r`, [name('friend')]);
  return x.shared === 12;
})());

await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261215000000_groups_friend_picks.sql`, 'utf8'));
ok('migration runs twice; links, votes and settings kept', (await q(`select count(*)::int n from public.share_links`))[0].n > 60
  && (await q(`select count(*)::int n from public.votes where link_code is not null`))[0].n >= 4
  && (await As('owner', `select public.my_picks_setting() r`)) === true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
