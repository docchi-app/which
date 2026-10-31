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
for (const f of fs.readdirSync(`${repo}/supabase/migrations`).sort()) await db.exec(fs.readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8').replaceAll("(upto at time zone 'Asia/Kolkata')::time >= time '09:00'", 'true'));
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
for (const k of Object.keys(U)) await q(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values ('https://fcm.googleapis.com/fcm/send/'||$1, $2, 'k', 'a')`, [k, U[k]]);
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date d`))[0].d;
await q(`update polls set deleted_at = now(), featured_on = null where featured_on = $1`, [today]);
const sys = async (question, opts) => {
  const [{ id }] = await q(`insert into polls (question, is_system, featured_on, created_at, closes_at) values ($1, true, $2, $3, now() + interval '3 days') returning id`, [question, opts.featured ? today : null, opts.at ?? new Date(Date.now() - 3600e3)]);
  await q(`insert into poll_options (poll_id, position, text) values ($1, 0, 'Chai'), ($1, 1, 'Coffee')`, [id]);
  return id;
};
const notes = async (k, kind = 'daily') => q(`select title, body from notifications where user_id = $1 and kind = $2 order by id`, [U[k], kind]);
const potdNotes = async (k) => (await notes(k)).filter((n) => n.title === 'Poll of the Day ☀️');
const rewind = (sec = 60) => q(`insert into app_state(key, at) values ('push_scan', now() - make_interval(secs => $1)) on conflict (key) do update set at = excluded.at`, [sec]);

// Poll of the Day: 3 people voted (2 Chai, 1 Coffee); owner hasn't.
const POTD = await sys('Chai or coffee at 4pm?', { featured: true, at: new Date(Date.now() - 6 * 3600e3) });
const opt = async (i) => (await q(`select id from poll_options where poll_id=$1 and position=$2`, [POTD, i]))[0].id;
const chai = await opt(0), coffee = await opt(1);
await as(U.friend, () => q(`select cast_vote($1,$2)`, [POTD, chai]));
await as(U.stranger, () => q(`select cast_vote($1,$2)`, [POTD, chai]));
await as(U.f2, () => q(`select cast_vote($1,$2)`, [POTD, coffee]));
await q(`delete from notifications`);
await rewind();
await q(`select push_scan()`);
const o = await potdNotes('owner'), f = await potdNotes('friend');
ok("didn't vote: the invitation", o.length === 1 && o[0].body.startsWith('Chai or coffee at 4pm?'), JSON.stringify(o));
ok('voted: how it is going', f.length === 1 && /Chai leads with 67% so far/.test(f[0].body), JSON.stringify(f));
await rewind(); await q(`delete from app_state where key = 'push_daily'`); await q(`select push_scan()`);
ok('still one Poll of the Day push each (same day)', (await potdNotes('owner')).length === 1 && (await potdNotes('friend')).length === 1);

// A new Docchi poll going live: everyone who hasn't voted, once.
await rewind(120);
const NEW = await sys('Best monsoon snack?', { at: new Date(Date.now() - 30e3) });
const newOpt = (await q(`select id from poll_options where poll_id=$1 and position=0`, [NEW]))[0].id;
await as(U.f3, () => q(`select cast_vote($1,$2)`, [NEW, newOpt]));
await q(`select push_scan()`);
const n1 = await notes('owner');
ok('new Docchi poll notifies', n1.some((n) => n.title === 'New on Eithr 🗳️' && n.body === 'Best monsoon snack?'), JSON.stringify(n1));
ok('not to someone who already voted on it', !(await notes('f3')).some((n) => n.title === 'New on Eithr 🗳️'));
await rewind(120); await q(`select push_scan()`);
ok('no repeat on the next run', (await notes('owner')).filter((n) => n.title === 'New on Eithr 🗳️').length === 1);
// Scheduled for later: nothing until it goes live.
const LATER = await sys('Rain or sun?', { at: new Date(Date.now() + 3600e3) });
await rewind(); await q(`select push_scan()`);
ok('a poll scheduled for later waits', !(await q(`select 1 from notifications where dedupe like 'docpoll:' || $1 || '%'`, [LATER])).length);
// The Poll of the Day itself doesn't also get a go-live push.
ok('Poll of the Day: no separate go-live push', !(await q(`select 1 from notifications where dedupe like 'docpoll:' || $1 || '%'`, [POTD])).length);
// Switch off: nothing.
await q(`insert into push_settings(user_id, daily) values ($1, false)`, [U.f4]);
await rewind(120);
const NEW2 = await sys('Pani puri or bhel?', { at: new Date(Date.now() - 10e3) });
await q(`select push_scan()`);
ok("switch off: no Docchi poll pushes", !(await notes('f4')).some((n) => /Pani puri/.test(n.body)) && (await notes('owner')).some((n) => /Pani puri/.test(n.body)));
console.log(`\n${pass} pass, ${fail} fail`);
