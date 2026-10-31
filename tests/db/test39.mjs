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
const upload = async (uid, file) => { const path = `${uid}/${file}`; await q(`insert into storage.objects(bucket_id, name, owner) values ('snaps', $1, $2)`, [path, uid]); return path; };

// No friends needed, and a brand-new account can send one.
await q(`update profiles set created_at = now() where id = $1`, [U.owner]);
let path = await upload(U.owner, 'a.webp');
const [{ id: S }] = await as(U.owner, () => q(`select create_snap($1, 'Goa or Manali?', array['Goa','Manali'], 'link') id`, [path]));
ok('link-only snap created (no friends, new account)', !!S);
ok('saved as link', (await q(`select visibility from polls where id = $1`, [S]))[0].visibility === 'link');
// The other audiences keep their rules.
path = await upload(U.owner, 'b.webp');
ok('Friends with no friends: still refused', /empty_circle/.test(await err(() => as(U.owner, () => q(`select create_snap($1, 'Goa or Manali?', array['Goa','Manali'], 'circle')`, [path]))) ?? ''));
ok('Everyone on a new account: still refused', /snap_too_new/.test(await err(() => as(U.owner, () => q(`select create_snap($1, 'Goa or Manali?', array['Goa','Manali'], 'public')`, [path]))) ?? ''));
ok('unknown audience refused', /visibility/.test(await err(() => as(U.owner, () => q(`select create_snap($1, 'Goa or Manali?', array['Goa','Manali'], 'secret')`, [path]))) ?? ''));
ok('the photo check sees it as link', (await as(U.owner, () => q(`select visibility from snap_for_check($1)`, [S])))[0]?.visibility === 'link');

// Before the check passes: only the owner sees the photo.
const sees = async (uid) => (await as(uid, () => q(`select snap_photo_visible($1) v`, [`${U.owner}/a.webp`])))[0].v;
ok('pending: stranger cannot see the photo', !(await sees(U.stranger)));
ok('pending: owner can', await sees(U.owner));
await q(`update polls set photo_status = 'live' where id = $1`, [S]);
ok('live: someone with the link can see the photo', await sees(U.stranger));
ok('live: a guest with the link can too', await sees(null));
// Not in anyone's feed until they've opened it.
const inFeed = async (uid) => (await q(`select in_feed(p, $2) v from polls p where id = $1`, [S, uid]))[0].v;
ok('not in a stranger\'s feed', !(await inFeed(U.stranger)));
ok('in the owner\'s feed', await inFeed(U.owner));
await q(`insert into poll_access(user_id, poll_id) values ($1, $2)`, [U.stranger, S]);
ok('in the feed of someone who opened the link', await inFeed(U.stranger));
const opts = (await q(`select id from poll_options where poll_id = $1 order by position`, [S])).map((r) => r.id);
ok('someone with the link can vote', !(await err(() => as(U.f2, () => q(`select cast_vote($1,$2)`, [S, opts[0]])))));

// A snap can't be switched to Everyone later (that would skip the stricter check).
ok('snap: switching to Everyone refused', /visibility/.test(await err(() => as(U.owner, () => q(`select set_poll_visibility($1, 'public')`, [S]))) ?? ''));
ok('snap: still link', (await q(`select visibility from polls where id = $1`, [S]))[0].visibility === 'link');
ok('snap: switching to Friends allowed', !(await err(() => as(U.owner, () => q(`select set_poll_visibility($1, 'circle')`, [S])))));
const [{ id: P }] = await as(U.owner, () => q(`select create_poll('Chai or coffee?', array['Chai','Coffee'], 3, null, 'classic', null, 'link') id`));
ok('typed poll: link → Everyone still allowed', !(await err(() => as(U.owner, () => q(`select set_poll_visibility($1, 'public')`, [P])))));
ok('not your poll: still refused', /not_yours/.test(await err(() => as(U.stranger, () => q(`select set_poll_visibility($1, 'link')`, [P]))) ?? ''));
ok('guests cannot call set_poll_visibility', !!(await err(() => as(null, () => q(`select set_poll_visibility($1, 'link')`, [P])))));

console.log(`\n${pass} pass, ${fail} fail`);
