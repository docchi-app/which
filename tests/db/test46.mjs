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

// ── Errors: report (app, server, job), group, limits, admin list/detail/status, alerts, cleanup ──
await q(`insert into public.push_config (id, secret_hash) values (1, encode(sha256(convert_to('s3cret', 'UTF8')), 'hex')) on conflict (id) do update set secret_hash = excluded.secret_hash`);
const rep = (uid, args, anonymous = false) => as(uid, () => q(`select public.report_error($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, null)`,
  [args.message, args.kind ?? 'TypeError', args.place ?? 'Feed (/)', args.stack ?? 'at fetchFeed (polls.ts:88)', args.visitor ?? null, args.device ?? 'iPhone', args.browser ?? 'Safari', args.in_app ?? null, args.installed ?? false, args.version ?? 'abc1234', args.path ?? '/']), anonymous);
// A visitor (signed out), a guest and two signed-in people hit the same error; numbers in the message differ.
await rep(null, { message: 'Failed to fetch', visitor: 'v-1' });
await rep(null, { message: 'Failed to fetch', visitor: 'v-1' });
await rep(U.friend, { message: 'Failed to fetch', visitor: 'v-2', device: 'Android', browser: 'Chrome' });
await rep(U.owner, { message: 'Failed to fetch', visitor: 'v-3', in_app: 'Instagram' });
await q(`update public.profiles set username = 'guest_abc123' where id = $1`, [U.stranger]);
await rep(U.stranger, { message: 'Failed to fetch', visitor: 'v-4' });
await rep(U.f2, { message: 'Cannot read properties of undefined (reading 12)', kind: 'TypeError', place: 'Poll page (/p/:id)', visitor: 'v-5' });
await rep(U.f3, { message: 'Cannot read properties of undefined (reading 345)', kind: 'TypeError', place: 'Poll page (/p/:id)', visitor: 'v-6' });
const groups = await q(`select id, message, status, source from public.app_errors order by id`);
ok('grouped: 2 kinds (numbers in the message don\'t split a group)', groups.length === 2, JSON.stringify(groups));
const ev = await q(`select who, count(*)::int n from public.app_error_events group by who order by who`);
ok('who: visitor, guest, user', JSON.stringify(ev) === JSON.stringify([{ who: 'guest', n: 1 }, { who: 'user', n: 4 }, { who: 'visitor', n: 2 }]), JSON.stringify(ev));
ok('nobody can read the tables directly', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.app_errors`))) ?? '') && /permission denied/.test(await err(() => as(null, () => q(`select * from public.app_error_events`))) ?? ''));
ok('empty message ignored', (await rep(null, { message: '  ', visitor: 'v-9' })) && (await q(`select count(*)::int n from public.app_error_events`))[0].n === 7);
ok('no visitor code and signed out: ignored', (await rep(null, { message: 'x', visitor: null })) && (await q(`select count(*)::int n from public.app_error_events`))[0].n === 7);
// 20 an hour per browser.
for (let i = 0; i < 25; i++) await rep(null, { message: 'Loop error ' + i, visitor: 'v-spam' });
ok('20 an hour from one browser', (await q(`select count(*)::int n from public.app_error_events where visitor = 'v-spam'`))[0].n === 20);
for (let i = 0; i < 25; i++) await rep(U.f4, { message: 'Loop error', visitor: 'v-' + i });
ok('20 an hour from one signed-in person, even with new browser codes', (await q(`select count(*)::int n from public.app_error_events where user_id = $1`, [U.f4]))[0].n === 20);
// Long values cut.
await rep(null, { message: 'x'.repeat(1000), stack: 'y'.repeat(5000), visitor: 'v-long', device: 'd'.repeat(300) });
const long = (await q(`select char_length(g.message) m, char_length(e.stack) s, char_length(e.device) d from public.app_error_events e join public.app_errors g on g.id = e.error_id where e.visitor = 'v-long'`))[0];
ok('long values cut (300 / 800 / 40)', long.m === 300 && long.s === 800 && long.d === 40, JSON.stringify(long));
// Server and job errors need the secret.
ok('server error without the secret: refused', /forbidden/.test(await err(() => q(`select public.report_server_error('nope', 'server', 'Error', 'boom', '/api/snap/check')`)) ?? ''));
ok('server error: source must be server or job', /source/.test(await err(() => q(`select public.report_server_error('s3cret', 'app', 'Error', 'boom', '/api/snap/check')`)) ?? ''));
await q(`select public.report_server_error('s3cret', 'server', 'Error', 'Snap check timed out', '/api/snap/check', null, 'at check (route.ts:40)')`);
ok('server error recorded as server', (await q(`select count(*)::int n from public.app_errors where source = 'server' and message = 'Snap check timed out'`))[0].n === 1);
await q(`insert into public.push_errors (step, message) values ('push_scan', 'division by zero')`);
ok('push_errors show up as job errors', (await q(`select place from public.app_errors where source = 'job'`))[0]?.place === 'Background job · push_scan');
// Admin only.
for (const fn of [`admin_errors()`, `admin_errors_summary()`, `admin_error_detail(1)`, `admin_error_status(1, 'fixed')`])
  ok(`${fn}: not the admin, refused`, /not_admin/.test(await err(() => as(U.owner, () => q(`select public.${fn}`))) ?? ''));
const fetchId = groups.find((g) => g.message === 'Failed to fetch').id;
const list = await as(U.admin, () => q(`select * from public.admin_errors(1, 'look', null)`));
const ff = list.find((r) => r.id === fetchId);
ok('list: Failed to fetch, 5 times, 4 people (a visitor twice counts once)', ff?.times === 5 && ff?.people === 4 && ff?.status === 'new', JSON.stringify(ff));
ok('list: source filter', (await as(U.admin, () => q(`select * from public.admin_errors(1, 'all', 'server')`))).every((r) => r.source === 'server'));
const sum = (await as(U.admin, () => q(`select public.admin_errors_summary(1) s`)))[0].s;
ok('summary: new count, people, kinds', sum.new >= 4 && sum.kinds >= 4 && sum.people >= 5 && sum.times >= 40, JSON.stringify(sum));
const det = (await as(U.admin, () => q(`select public.admin_error_detail($1, 1) d`, [fetchId])))[0].d;
ok('detail: 24 hourly buckets, total in the last one', det.buckets.length === 24 && det.buckets[23] === 5, JSON.stringify(det.buckets));
ok('detail: who 2 users, 1 guest, 1 visitor; names', det.who.user === 2 && det.who.guest === 1 && det.who.visitor === 1 && det.who.names.length === 2, JSON.stringify(det.who));
ok('detail: devices', det.devices.some((x) => x.label === 'iPhone · Safari') && det.devices.some((x) => x.label === 'iPhone · Instagram') && det.devices.some((x) => x.label === 'Android · Chrome'), JSON.stringify(det.devices));
ok('detail: latest 5 with stack and version', det.latest.length === 5 && det.latest[0].stack && det.latest[0].app_version === 'abc1234');
const det7 = (await as(U.admin, () => q(`select public.admin_error_detail($1, 7) d`, [fetchId])))[0].d;
ok('detail over 7 days: 7 daily buckets', det7.buckets.length === 7 && det7.buckets[6] === 5, JSON.stringify(det7.buckets));
// Status: fixed, then it comes back.
ok('bad status refused', /status/.test(await err(() => as(U.admin, () => q(`select public.admin_error_status($1, 'new')`, [fetchId]))) ?? ''));
await as(U.admin, () => q(`select public.admin_error_status($1, 'fixed')`, [fetchId]));
ok('fixed: logged in admin log', (await q(`select count(*)::int n from public.admin_events where action = 'error_fixed'`))[0].n === 1);
ok('fixed: out of "needs a look"', !(await as(U.admin, () => q(`select * from public.admin_errors(1, 'look', null)`))).some((r) => r.id === fetchId));
await rep(U.friend, { message: 'Failed to fetch', visitor: 'v-2' });
const back = (await q(`select status, came_back from public.app_errors where id = $1`, [fetchId]))[0];
ok('it happens again: open, came back', back.status === 'open' && back.came_back === true, JSON.stringify(back));
await as(U.admin, () => q(`select public.admin_error_status($1, 'ignored')`, [fetchId]));
await rep(U.friend, { message: 'Failed to fetch', visitor: 'v-2' });
ok('ignored stays ignored', (await q(`select status from public.app_errors where id = $1`, [fetchId]))[0].status === 'ignored');
await as(U.admin, () => q(`select public.admin_error_status($1, 'open')`, [fetchId]));
// Alerts: the job picks at most one an hour.
ok('tick without the secret: refused', /forbidden/.test(await err(() => q(`select public.errors_tick('nope')`)) ?? ''));
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/admin', $1, 'k', 'a')`, [U.admin]);
await q(`update public.app_errors set alerted_at = null`);
const ist = Number((await q(`select extract(hour from now() at time zone 'Asia/Kolkata')::int h`))[0].h);
const day = ist >= 8 && ist <= 22;
const t0 = (await q(`select public.errors_tick('s3cret', '{"sent":3}'::jsonb) r`))[0].r;
ok('tick: no alert for errors hitting fewer than 3 people (one broken phone looping)', t0.alert === null, JSON.stringify(t0));
ok('job status recorded', (await q(`select result from public.job_status where id = 1`))[0].result.sent === 3);
for (const [k, uid] of [['c1', U.owner], ['c2', U.friend], ['c3', null]]) await rep(uid, { message: 'Camera didn\'t start', kind: 'NotAllowedError', place: 'Snap (/snap)', visitor: 'cam-' + k });
const cam = (await q(`select id from public.app_errors where message = 'Camera didn''t start'`))[0].id;
const t1 = (await q(`select public.errors_tick('s3cret') r`))[0].r;
if (day) {
  ok('tick: new error hitting 3 people, alert for the admin\'s phone', t1.alert?.title === "⚠️ New error: Camera didn't start" && t1.alert.body === '3 people · Snap (/snap) in the last 2 hours. Tap to see it.' && t1.alert.url === '/admin#errors/' + cam && t1.targets.length === 1 && t1.targets[0].endpoint === 'https://push.example/admin', JSON.stringify(t1));
  ok('tick: then none for an hour', (await q(`select public.errors_tick('s3cret') r`))[0].r.alert === null);
  await q(`update public.app_errors set alerted_at = now() - interval '2 hours'`);
  ok('an hour later: the same new error isn\'t sent again', (await q(`select public.errors_tick('s3cret') r`))[0].r.alert === null);
  await as(U.admin, () => q(`select public.admin_error_status($1, 'fixed')`, [cam]));
  await rep(U.f2, { message: 'Camera didn\'t start', kind: 'NotAllowedError', place: 'Snap (/snap)', visitor: 'cam-4' });
  const t2 = (await q(`select public.errors_tick('s3cret') r`))[0].r;
  ok('back after a fix: alerted', t2.alert?.title === "⚠️ Back after fix: Camera didn't start", JSON.stringify(t2));
  await q(`update public.app_errors set alerted_at = now() - interval '2 hours'`);
  const t2b = (await q(`select public.errors_tick('s3cret') r`))[0].r;
  ok('back after a fix: sent once only', t2b.alert === null, JSON.stringify(t2b.alert));
  await q(`update public.app_errors set alerted_at = now() - interval '7 hours'`);
  for (let i = 0; i < 12; i++) await rep(null, { message: 'Spiky', place: 'Feed (/)', visitor: 'sp-' + i });
  await q(`update public.app_errors set status = 'open' where message = 'Spiky'`);
  const t3 = (await q(`select public.errors_tick('s3cret') r`))[0].r;
  ok('spike: 12 in an hour, alerted', t3.alert?.title === '⚠️ Error spike: Spiky' && /12 people/.test(t3.alert.body), JSON.stringify(t3));
  await q(`update public.app_errors set alerted_at = now() - interval '2 hours'`);
  const spiky = (await q(`select id from public.app_errors where message = 'Spiky'`))[0].id;
  await as(U.admin, () => q(`select public.admin_error_status($1, 'ignored')`, [spiky]));
  const t4 = (await q(`select public.errors_tick('s3cret') r`))[0].r; ok('ignored: no alerts', t4.alert === null, JSON.stringify(t4.alert));
} else {
  ok('tick at night: no alert unless 25+ people', t1.alert === null, JSON.stringify(t1));
}
const js = (await as(U.admin, () => q(`select public.admin_errors_summary(1) s`)))[0].s;
ok('summary: job last run', js.job_last_run !== null);
// 30 days.
await q(`update public.app_error_events set at = now() - interval '31 days' where error_id = $1`, [fetchId]);
await q(`update public.app_errors set last_seen = now() - interval '31 days' where id = $1`, [fetchId]);
await q(`select public.errors_tick('s3cret')`);
ok('over 30 days: deleted', (await q(`select count(*)::int n from public.app_errors where id = $1`, [fetchId]))[0].n === 0 && (await q(`select count(*)::int n from public.app_error_events where error_id = $1`, [fetchId]))[0].n === 0);
ok('anon cannot call admin functions', /permission denied|not_admin/.test(await err(() => as(null, () => q(`select * from public.admin_errors()`))) ?? ''));
console.log(`\n${pass} pass, ${fail} fail`);
