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
for (const f of fs.readdirSync(`${repo}/supabase/migrations`).sort()) await db.exec(fs.readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8').replace("local_hour int := extract(hour from now() at time zone 'Asia/Kolkata');", 'local_hour int := 12;'));
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
await q(`insert into push_config(secret_hash) values (encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
for (const k of Object.keys(U)) await q(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values ('https://fcm.googleapis.com/fcm/send/'||$1, $2, 'k', 'a')`, [k, U[k]]);
const rewind = () => q(`insert into app_state(key, at) values ('push_scan', now()) on conflict (key) do update set at = now()`);
const scan = () => q(`select push_scan()`);
const notes = (k, kind) => q(`select title, body from notifications where user_id = $1 and kind = $2 order by id`, [U[k], kind]);
await rewind();

// Milestones 3 and 5 (not 4)
const [{ id: P }] = await as(U.owner, () => q(`select create_poll('Chai or coffee at 4pm?', array['Chai','Coffee'], 3) id`));
const o1 = (await q(`select id from poll_options where poll_id=$1 and position=0`, [P]))[0].id;
for (const k of ['friend', 'stranger']) await as(U[k], () => q(`select cast_vote($1,$2)`, [P, o1]));
await scan();
ok('2 votes: no push', (await notes('owner', 'votes')).length === 0);
await as(U.admin, () => q(`select cast_vote($1,$2)`, [P, o1]));
await scan();
let v = await notes('owner', 'votes');
ok('3 votes: push', v.length === 1 && /3 votes/.test(v[0].body) && v[0].title === 'People are voting 👀', JSON.stringify(v));
await as(U.f2, () => q(`select cast_vote($1,$2)`, [P, o1]));
await scan();
ok('4 votes: nothing new', (await notes('owner', 'votes')).length === 1);
await as(U.f3, () => q(`select cast_vote($1,$2)`, [P, o1]));
await scan();
v = await notes('owner', 'votes');
ok('5 votes: push', v.length === 2 && /5 votes/.test(v[1].body), JSON.stringify(v.at(-1)));
await scan();
ok('no repeats on rescan', (await notes('owner', 'votes')).length === 2);
console.log('milestones:', (await q(`select array_agg(public.vote_milestone(n) order by n) a from unnest(array[1,2,3,4,5,9,10,24,25,99,100]) n`))[0].a);

// A request committed while a run was going (created before the last run's time) is still found.
await q(`update app_state set at = now() + interval '1 minute' where key = 'push_scan'`);
await as(U.f4, () => q(`select request_circle($1)`, [name('owner')]));
await scan();
ok('request in the overlap window is found', (await notes('owner', 'circle')).some((n) => /wants to be friends/.test(n.body)));

// No cap: owner already got 8 pushes today; a friend request and a comment push still go out.
await q(`update notifications set sent_at = now() where user_id = $1`, [U.owner]);
for (let i = 0; i < 8; i++) await q(`insert into notifications(user_id, kind, title, body, url, dedupe, sent_at) values ($1, 'votes', 't', 'b', '/', 'cap' || $2, now())`, [U.owner, i]);
await rewind();
await as(U.stranger, () => q(`select request_circle($1)`, [name('owner')]));
await as(U.friend, () => q(`select post_comment($1, 'chai always')`, [P]));
await scan();
const rows = await q(`select payload->>'title' t from push_collect('s3cret', 300)`);
console.log('sent:', JSON.stringify(rows));
ok('friend request sent after 8 today', rows.some((r) => r.t === 'Friend request'));
ok('comment also sent (no cap)', rows.some((r) => /comment/.test(r.t)));
// Comment pushes don't repeat across overlapping runs.
await q(`delete from notifications where kind = 'comments'`);
await rewind(); await q(`update app_state set at = now() - interval '30 seconds' where key = 'push_scan'`);
await scan(); await scan();
ok('comment push not repeated by the overlap', (await notes('owner', 'comments')).length === 1, JSON.stringify(await notes('owner', 'comments')));
console.log(`\n${pass} pass, ${fail} fail`);
