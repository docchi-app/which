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

// ── Admin phase 1: one admin, test accounts left out, admin events ──
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date d`))[0].d;
// One admin only.
ok('a second admin is refused', /profiles_one_admin|duplicate key/.test(await err(() => q(`update public.profiles set is_admin = true where id = $1`, [U.owner])) ?? ''));
ok('the admin is still the admin', (await q(`select count(*)::int n from public.profiles where is_admin`))[0].n === 1);
// Test accounts: admin only, not your own, must exist.
ok('not the admin: refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_set_test($1, true)`, [name('friend')]))) ?? ''));
ok('your own account: refused (always left out)', /own_account/.test(await err(() => as(U.admin, () => q(`select public.admin_set_test($1, true)`, [name('admin')]))) ?? ''));
ok('unknown username: not found', /not_found/.test(await err(() => as(U.admin, () => q(`select public.admin_set_test('nobody_here', true)`))) ?? ''));
await as(U.admin, () => q(`select public.admin_set_test($1, true)`, [name('friend').toUpperCase()]));
const tests = await as(U.admin, () => q(`select * from public.admin_test_accounts()`));
ok('marked as a test account (username in any case)', tests.length === 1 && tests[0].username === name('friend'), JSON.stringify(tests));
ok('the is_test column is not readable directly', /permission denied/.test(await err(() => as(U.owner, () => q(`select is_test from public.profiles`))) ?? ''));
// Votes today by: the admin, the test account, and two real people.
const [{ poll, opt }] = await q(`select p.id poll, o.id opt from public.polls p join public.poll_options o on o.poll_id = p.id where p.deleted_at is null and not p.is_hidden order by p.created_at limit 1`);
for (const k of ['admin', 'friend', 'stranger', 'f2']) await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [poll, opt, U[k]]);
// Visits today: the admin's phone (signed in), the same phone signed out, the test account's phone, and a real visitor.
await q(`insert into public.visits (visitor, day, user_id, sessions) values
  ('aaaaaaaa-0000-0000-0000-000000000001', $1, $2, 3),
  ('aaaaaaaa-0000-0000-0000-000000000002', $1, $3, 2),
  ('aaaaaaaa-0000-0000-0000-000000000003', $1, null, 1),
  ('aaaaaaaa-0000-0000-0000-000000000004', $1, $4, 1)`, [today, U.admin, U.friend, U.stranger]);
await q(`insert into public.visits (visitor, day, user_id, sessions) values ('aaaaaaaa-0000-0000-0000-000000000001', $1::date - 1, null, 1)`, [today]);
const m = (await as(U.admin, () => q(`select * from public.admin_metrics(7) where day = $1`, [today])))[0];
ok('Metrics: only the two real voters', m.voters === 2 && m.votes === 2, JSON.stringify({ voters: m.voters, votes: m.votes }));
ok('Metrics: visitors leave out the admin\'s and the test account\'s phones', m.visitors === 2 && m.signed_in === 1, JSON.stringify({ visitors: m.visitors, signed_in: m.signed_in }));
const yesterday = (await as(U.admin, () => q(`select * from public.admin_metrics(7) where day = $1::date - 1`, [today])))[0];
ok('Metrics: the admin\'s phone signed out (yesterday) is left out too', yesterday.visitors === 0, JSON.stringify(yesterday));
const vs = (await as(U.admin, () => q(`select * from public.admin_view_stats(7) where day = $1`, [today])))[0];
ok('Views stats: votes left out the same way', vs.votes === 2, JSON.stringify(vs));
ok('not the admin: Metrics refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select * from public.admin_metrics(7)`))) ?? ''));
// Sign-ups (the test users joined 3 days ago): the admin and the test account left out, 7 − 2 = 5.
const joined = (await q(`select (created_at at time zone 'Asia/Kolkata')::date d from public.profiles where id = $1`, [U.stranger]))[0].d;
const su = (await q(`select signups from public.day_counts($1, $1)`, [joined]))[0].signups;
ok('Sign-ups: test accounts and the admin left out', su === 5, String(su));
// Removing the test mark brings it back.
await as(U.admin, () => q(`select public.admin_set_test($1, false)`, [name('friend')]));
const m2 = (await as(U.admin, () => q(`select * from public.admin_metrics(7) where day = $1`, [today])))[0];
ok('unmarked: counted again', m2.voters === 3 && m2.visitors === 3, JSON.stringify({ voters: m2.voters, visitors: m2.visitors }));
// Admin log: words, props, test accounts.
await as(U.admin, () => q(`select public.admin_add_word('zhantu', 'word', 'mr')`));
await as(U.admin, () => q(`select public.admin_add_word('zhantu', 'root', 'mr')`));
await as(U.admin, () => q(`select public.admin_remove_word('zhantu')`));
await as(U.admin, () => q(`select public.admin_props_no_wait(true)`));
const ev = await as(U.admin, () => q(`select action, detail, admin from public.admin_events_list(20)`));
const acts = ev.map((e) => e.action).reverse();
ok('Admin log: test accounts, words (added, changed, removed), props', JSON.stringify(acts) === JSON.stringify(['test_added', 'test_removed', 'word_added', 'word_changed', 'word_removed', 'props_no_wait']), JSON.stringify(acts));
ok('...with who did it', ev.every((e) => e.admin === name('admin')));
await q(`select set_config('request.uid', '', false)`);
ok('migrations add words without logging (no user)', (await q(`insert into public.blocked_terms (term) values ('zzqq') returning term`)).length === 1 && (await q(`select count(*)::int n from public.admin_events`))[0].n === 6);
ok('not the admin: Admin log refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select * from public.admin_events_list(5)`))) ?? ''));
ok('admin_events not readable directly', /permission denied/.test(await err(() => as(U.admin, () => q(`select * from public.admin_events`))) ?? ''));
console.log(`\n${pass} pass, ${fail} fail`);
