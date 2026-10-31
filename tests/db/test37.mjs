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
const files = fs.readdirSync(`${repo}/supabase/migrations`).sort(); for (const f of files) if (!/streaks|push_repair/.test(f)) await db.exec(fs.readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8'));
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
// Production as it is: every migration but the streaks one. Then the repair.
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const check = fs.readFileSync(`${repo}/supabase/checks/migration-check.sql`, 'utf8');
const fix = fs.readFileSync(`${repo}/supabase/migrations/20261125000000_push_repair.sql`, 'utf8');
await q(`insert into push_config(secret_hash) values (encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
for (const k of ['owner', 'friend']) await q(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values ('https://fcm.googleapis.com/fcm/send/'||$1, $2, 'k', 'a')`, [k, U[k]]);
// Today's Poll of the Day (the step that calls streak_of), and the rename notice from the runbook.
let potd = (await q(`select id from polls where featured_on = (now() at time zone 'Asia/Kolkata')::date`))[0]?.id;
if (!potd) { potd = (await q(`insert into polls (question, is_system, featured_on, created_at, closes_at) values ('Chai or coffee?', true, (now() at time zone 'Asia/Kolkata')::date, now() - interval '3 hours', now() + interval '1 day') returning id`))[0].id; await q(`insert into poll_options (poll_id, position, text) values ($1, 0, 'Chai'), ($1, 1, 'Coffee')`, [potd]); }
await q(`update polls set created_at = least(created_at, now() - interval '1 hour'), closes_at = greatest(closes_at, now() + interval '1 day'), deleted_at = null, is_hidden = false where id = $1`, [potd]);
await q(`insert into public.notifications (user_id, kind, title, body, url, tag, dedupe) select distinct s.user_id, 'daily', 'Docchi is now Eithr 👀', 'x', '/?move=1', 'rename', 'rename:' || s.user_id from public.push_subscriptions s on conflict (dedupe) do nothing`);
// The sender last worked 3 days ago; a friend request from 2 days ago and one from 1 hour ago.
await q(`insert into app_state (key, at) values ('push_scan', now() - interval '3 days') on conflict (key) do update set at = excluded.at`);
await q(`insert into circle_members (owner_id, member_id, status, initiator, created_at) values ($1, $2, 'pending', true, now() - interval '2 days'), ($3, $2, 'pending', true, now() - interval '1 hour')`, [U.owner, U.stranger, U.friend]).catch((e) => console.log('setup circle:', e.message));

const before = await q(check);
ok('check names the streaks migration (and the repair, not run yet)', before.map((r) => r.migration).join() === '20261113000000_streaks.sql,20261125000000_push_repair.sql', JSON.stringify(before.map((r) => r.migration)));
let err = null;
try { await q(`select * from push_collect('s3cret', 300)`); } catch (e) { err = e.message; }
ok('before: the sender fails like production', /streak_of/.test(err || ''), err);

await db.exec(fix);
// The repair makes functions the lockdown closes (open again, as new ones are): the check says to run it again.
const mid = await q(check);
ok('after the repair: the check names only the lockdown (my_streak open again)', mid.map((r) => r.migration).join() === '20261209000000_lockdown.sql' && /my_streak/.test(mid[0]?.details), JSON.stringify(mid));
await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261209000000_lockdown.sql`, 'utf8'));
ok('after: the check is clean', (await q(check)).length === 0, JSON.stringify(await q(check)));
const rows = await q(`select payload->>'title' t, payload->>'body' b from push_collect('s3cret', 300)`);
const titles = rows.map((r) => r.t);
ok('rename notice goes out to both', titles.filter((t) => /now Eithr/.test(t)).length === 2, JSON.stringify(titles));
ok('Poll of the Day goes out', titles.filter((t) => /Poll of the Day/.test(t)).length === 2, JSON.stringify(titles));
ok('the recent friend request goes out', rows.some((r) => r.t === 'Friend request'), JSON.stringify(rows));
ok('the 2-day-old one stays quiet (6h cap)', rows.filter((r) => r.t === 'Friend request').length === 1);
ok('no errors kept', (await q(`select count(*)::int n from push_errors`))[0].n === 0);
const streak = await as(U.owner, () => q(`select my_streak() s`));
ok('my_streak works again', streak[0]?.s && 'current' in streak[0].s, JSON.stringify(streak));

// A scan that breaks later doesn't stop queued notifications.
await q(`drop function public.streak_of(uuid) cascade`).catch(() => {});
await q(`update app_state set at = '-infinity' where key = 'push_daily'`);
await q(`insert into public.notifications (user_id, kind, title, body, url, tag, dedupe) values ($1, 'circle', 'Queued', 'x', '/', 'q', 'queued:1')`, [U.owner]);
let rows2 = null; err = null;
try { rows2 = await q(`select payload->>'title' t from push_collect('s3cret', 300)`); } catch (e) { err = e.message; }
ok('broken scan: queued ones still go out', !err && rows2.some((r) => r.t === 'Queued'), err || JSON.stringify(rows2));
const e = await q(`select step, message from push_errors order by at desc limit 1`);
ok('broken scan: the error is kept', e[0]?.step === 'push_scan' && /streak_of/.test(e[0].message), JSON.stringify(e));
ok('anon cannot read the errors', await as(null, () => q(`select * from push_errors`).then(() => false, () => true)));
console.log(`\n${pass} pass, ${fail} fail`);
