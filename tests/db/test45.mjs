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

// ── The admin's test email: admin only, own address, 10 a day, logged, not a real send ──
const call = (uid, v, anonymous = false) => as(uid, () => q(`select public.admin_test_email($1) r`, [v]), anonymous);
ok('signed out: refused', /not_admin|permission denied|sign/.test(await err(() => call(null, 'tie')) ?? ''));
ok('not the admin: refused', /not_admin/.test(await err(() => call(U.owner, 'tie')) ?? ''));
const r1 = (await call(U.admin, 'tie'))[0].r;
ok('admin: own address and username', r1.email === 'admin@x.com' && r1.user_id === U.admin && r1.username === name('admin'), JSON.stringify(r1));
ok('logged in the admin log', (await q(`select count(*)::int n from public.admin_events where action = 'email_test' and detail = 'tie' and admin_id = $1`, [U.admin]))[0].n === 1);
for (let i = 0; i < 9; i++) await call(U.admin, 'first');
ok('11th in a day: too_many', /too_many/.test(await err(() => call(U.admin, 'first')) ?? ''));
ok('refused one isn\'t logged', (await q(`select count(*)::int n from public.admin_events where action = 'email_test'`))[0].n === 10);
await q(`update public.admin_events set at = now() - interval '25 hours' where action = 'email_test'`);
ok('a day later: allowed again', (await call(U.admin, 'ahead'))[0].r.email === 'admin@x.com');
ok('never touches email_sends', (await q(`select count(*)::int n from public.email_sends`))[0].n === 0);
ok('long version text trimmed to 40', (await call(U.admin, 'x'.repeat(100))) && (await q(`select max(char_length(detail))::int n from public.admin_events where action = 'email_test'`))[0].n === 40);
await q(`update auth.users set email = null where id = $1`, [U.admin]);
ok('admin without an email: no_email', /no_email/.test(await err(() => call(U.admin, 'tie')) ?? ''));
ok('anon role cannot execute', /permission denied/.test(await err(() => as(null, () => q(`select public.admin_test_email('tie')`))) ?? '') || /not_admin/.test(await err(() => as(null, () => q(`select public.admin_test_email('tie')`))) ?? ''));
const anonGrant = (await q(`select has_function_privilege('anon', 'public.admin_test_email(text)', 'execute') a`))[0].a;
ok('anon has no execute grant', anonGrant === false);
console.log(`\n${pass} pass, ${fail} fail`);
