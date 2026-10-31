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

// ── Limits: polls a day and snaps a day, set by the admin ──
const A = (sql, p) => as(U.admin, () => q(sql, p)).then((x) => x[0]?.r);
const poll = (uid, question, kind = 'classic') => as(uid, () => q(`select public.create_poll($1, array['Yes','No'], 1, null, $2) r`, [question, kind]));
const tryPoll = async (uid, question, kind) => { try { await poll(uid, question, kind); return 'ok'; } catch (e) { return (e.message.match(/docchi:(\w+)/) ?? [])[1] ?? e.message; } };
let L = await A(`select public.admin_limits() r`);
ok('defaults: 10 polls, 3 snaps', L.polls === 10 && L.snaps === 3 && Array.isArray(L.changes), JSON.stringify(L));
ok('not the admin: refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_limits(50, 20)`))) ?? ''));
ok('anon can\'t execute', (await q(`select has_function_privilege('anon', 'public.admin_limits(int,int)', 'execute') a`))[0].a === false);
ok('settings table not readable by the app', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.app_settings`))) ?? ''));
for (const fn of ['limit_of(text)', 'ist_day_start()']) ok(`${fn}: internal`, (await q(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') a`))[0].a === false);
ok('out of range: polls 0', /out_of_range/.test(await err(() => A(`select public.admin_limits(0, null) r`)) ?? ''));
ok('out of range: polls 51', /out_of_range/.test(await err(() => A(`select public.admin_limits(51, null) r`)) ?? ''));
ok('out of range: snaps 21', /out_of_range/.test(await err(() => A(`select public.admin_limits(null, 21) r`)) ?? ''));
L = await A(`select public.admin_limits(2, null) r`);
ok('change polls to 2: saved, snaps unchanged, logged "Polls a day: 10 → 2"', L.polls === 2 && L.snaps === 3 && L.changes[0]?.detail === 'Polls a day: 10 → 2', JSON.stringify(L));
await A(`select public.admin_limits(2, 3) r`);
ok('saving the same numbers: nothing new logged', (await q(`select count(*)::int n from public.admin_events where action = 'limits'`))[0].n === 1);
// Yesterday's polls (before midnight India time) don't count.
await q(`insert into public.polls (creator_id, question, kind, created_at) values ($1, 'Old one', 'classic', public.ist_day_start() - interval '1 minute'), ($1, 'Old two', 'classic', public.ist_day_start() - interval '2 minutes')`, [U.owner]);
let st = (await as(U.owner, () => q(`select public.create_poll_status() r`)))[0].r;
ok('status: limit 2, 2 left (yesterday doesn\'t count), snaps 3 left', st.poll_limit === 2 && st.polls_left === 2 && st.snap_limit === 3 && st.snaps_left === 3, JSON.stringify(st));
ok('poll 1 of 2', (await tryPoll(U.owner, 'Tea or coffee?')) === 'ok');
ok('hot take counts inside it', (await tryPoll(U.owner, 'Pineapple on pizza is fine', 'hot_take')) === 'ok');
ok('poll 3 of 2: daily_limit', (await tryPoll(U.owner, 'Cats or dogs?')) === 'daily_limit');
st = (await as(U.owner, () => q(`select public.create_poll_status() r`)))[0].r;
ok('status: 0 left, special 0 left', st.polls_left === 0 && st.special_left === 0, JSON.stringify(st));
await A(`select public.admin_limits(10, null) r`);
ok('raised back to 10: can post again at once', (await tryPoll(U.owner, 'Cats or dogs?')) === 'ok');
ok('second hot take today: special_limit', (await tryPoll(U.owner, 'Mondays are good', 'hot_take')) === 'special_limit');
// The admin isn't limited.
await A(`select public.admin_limits(1, null) r`);
let adminOk = true;
for (let i = 0; i < 3; i++) adminOk = adminOk && (await tryPoll(U.admin, `Admin poll ${i}?`)) === 'ok';
ok('the admin isn\'t limited (3 polls with the limit at 1, and 2 hot takes)', adminOk && (await tryPoll(U.admin, 'Hot one', 'hot_take')) === 'ok' && (await tryPoll(U.admin, 'Hot two', 'hot_take')) === 'ok');
ok('someone else at limit 1: one, then daily_limit', (await tryPoll(U.friend, 'Beach or hills?')) === 'ok' && (await tryPoll(U.friend, 'Rain or sun?')) === 'daily_limit');
// Snaps.
await A(`select public.admin_limits(null, 1) r`);
const snap = async (uid, n) => {
  const path = `${uid}/s${n}.jpg`;
  await q(`insert into storage.objects (bucket_id, name, owner) values ('snaps', $1, $2)`, [path, uid]);
  try { await as(uid, () => q(`select public.create_snap($1, 'Fit check?', array['🔥','🧊'], 'link') r`, [path])); return 'ok'; } catch (e) { return (e.message.match(/docchi:(\w+)/) ?? [])[1] ?? e.message; }
};
ok('snaps at 1: first ok', (await snap(U.f2, 1)) === 'ok');
ok('snaps at 1: second → snap_limit', (await snap(U.f2, 2)) === 'snap_limit');
st = (await as(U.f2, () => q(`select public.create_poll_status() r`)))[0].r;
ok('status: snap limit 1, 0 left', st.snap_limit === 1 && st.snaps_left === 0, JSON.stringify(st));
ok('snaps don\'t use up polls', st.polls_left === 1, JSON.stringify(st));
ok('admin snaps not limited', (await snap(U.admin, 1)) === 'ok' && (await snap(U.admin, 2)) === 'ok');
L = await A(`select public.admin_limits() r`);
ok('change list newest first, with times', L.changes.length >= 4 && L.changes[0].detail === 'Snaps a day: 3 → 1' && new Date(L.changes[0].at) >= new Date(L.changes[1].at), JSON.stringify(L.changes));
console.log(`\n${pass} pass, ${fail} fail`);
