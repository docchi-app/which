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

// ── Props: 5–30 minute wait, and the admin's "without the wait" ──
const ins = async (picker, picked, qid) => (await q(`insert into public.props (question_id, picker_id, picked_id) values ($1, $2, $3) returning extract(epoch from notify_after - now()) / 60 as wait`, [qid, U[picker], U[picked]]))[0].wait;
const waits = [];
for (let i = 1; i <= 6; i++) waits.push(+(await ins('friend', 'owner', i)));
ok('new props wait 5–30 minutes', waits.every((w) => w >= 5 && w <= 30.01), JSON.stringify(waits.map((w) => Math.round(w))));
// Only admins, only for themselves.
ok('not an admin: refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_props_no_wait(true)`))) ?? ''));
ok('signed out: refused', !!(await err(() => as(null, () => q(`select public.admin_props_no_wait(true)`)))));
ok('the setting is not readable directly', /permission denied/.test(await err(() => as(U.owner, () => q(`select props_no_wait from public.profiles`))) ?? ''));
ok('admin reads it: off', (await as(U.admin, () => q(`select public.admin_props_no_wait() v`)))[0].v === false);
// A prop already waiting for the admin, then the switch goes on.
const w0 = +(await ins('friend', 'admin', 1));
ok('a prop for the admin waits like anyone\'s (switch off)', w0 >= 5);
ok('admin turns it on', (await as(U.admin, () => q(`select public.admin_props_no_wait(true) v`)))[0].v === true);
ok('...the waiting one is released', (await q(`select count(*)::int n from public.props where picked_id = $1 and notify_after > now()`, [U.admin]))[0].n === 0);
const w1 = +(await ins('f2', 'admin', 2));
ok('new props for the admin: no wait', w1 <= 0.01, String(w1));
ok('props for others still wait', +(await ins('f2', 'owner', 7)) >= 5);
// The admin sees them at once; the 2-minute scan makes one grouped push.
ok('admin: Activity shows them now', (await as(U.admin, () => q(`select public.props_news() n`)))[0].n === 2);
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/a', $1, 'k', 'a') on conflict do nothing`, [U.admin]);
await q(`select public.props_scan()`);
const notes = await q(`select title from public.notifications where user_id = $1 and kind = 'props'`, [U.admin]);
ok('one grouped push for the admin', notes.length === 1 && /2 new props/.test(notes[0].title), JSON.stringify(notes));
ok('owner\'s props not pushed yet (still waiting)', (await q(`select count(*)::int n from public.notifications where user_id = $1 and kind = 'props'`, [U.owner]))[0].n === 0);
// Off again: back to waiting.
ok('admin turns it off', (await as(U.admin, () => q(`select public.admin_props_no_wait(false) v`)))[0].v === false);
ok('...props wait again', +(await ins('f3', 'admin', 3)) >= 5);
console.log(`\n${pass} pass, ${fail} fail`);
