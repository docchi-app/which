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

// ── Snaps: 3 a day by India calendar day; deleted ones count; the admin isn't limited ──
const upload = async (uid, file) => { const path = `${uid}/${file}`; await q(`insert into storage.objects(bucket_id, name, owner) values ('snaps', $1, $2)`, [path, uid]); return path; };
let k = 0;
const post = async (uid) => { const path = await upload(uid, `p${++k}.jpg`); return (await as(uid, () => q(`select public.create_snap($1, 'Goa or Manali?', array['Goa','Manali'], 'link') id`, [path])))[0].id; };
const tryPost = async (uid) => { try { await post(uid); return 'ok'; } catch (e) { return e.message; } };
const midnight = `((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata'`;
// Three yesterday evening (an hour before midnight India time): they don't count today.
const y = [await post(U.owner), await post(U.owner), await post(U.owner)];
await q(`update public.polls set created_at = ${midnight} - interval '1 hour' where id = any($1)`, [y]);
ok('3 snaps yesterday evening: can still snap today', (await tryPost(U.owner)) === 'ok');
ok('second today', (await tryPost(U.owner)) === 'ok');
const third = await post(U.owner);
const r4 = await tryPost(U.owner);
ok('fourth today: refused with snap_limit', /snap_limit/.test(r4), r4);
await q(`update public.polls set deleted_at = now() where id = $1`, [third]);
ok('deleting one doesn\'t free a slot', /snap_limit/.test(await tryPost(U.owner)));
// The boundary: a snap at exactly midnight counts, one a second before doesn't.
await q(`update public.polls set created_at = ${midnight} - interval '1 second' where id = $1`, [third]);
ok('a snap one second before midnight doesn\'t count', (await tryPost(U.owner)) === 'ok');
const extra = (await q(`select id from public.polls where creator_id = $1 and kind = 'snap' order by created_at desc limit 1`, [U.owner]))[0].id;
await q(`update public.polls set created_at = ${midnight} where id = $1`, [extra]);
ok('one at exactly midnight counts', /snap_limit/.test(await tryPost(U.owner)));
const todayCount = (await q(`select count(*)::int n from public.polls where creator_id = $1 and kind = 'snap' and created_at >= ${midnight}`, [U.owner]))[0].n;
ok('owner has exactly 3 snaps today (one deleted)', todayCount === 3, String(todayCount));
// The admin: no limit.
const adminRes = []; for (let i = 0; i < 5; i++) adminRes.push(await tryPost(U.admin));
ok('admin: 5 snaps today, all allowed', adminRes.every((r) => r === 'ok'), adminRes.join(','));
// Another person isn't affected by the owner's snaps.
ok('someone else can still snap', (await tryPost(U.friend)) === 'ok');
console.log(`\n${pass} pass, ${fail} fail`);
