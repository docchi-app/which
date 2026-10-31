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

// ── Growth: tracking, Overview, Funnel, Sources, Content, Notifications, morning push ──
const asAnon = async (fn) => { await db.exec(`set role anon; select set_config('request.uid','',false), set_config('request.jwt','{}',false)`); try { return await fn(); } finally { await db.exec('reset role'); } };
const V = (n) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]).catch((e) => console.log('cfg', e.message));
const secretOk = (await q(`select public.push_secret_ok($1) a`, [SECRET]).catch(() => [{ a: false }]))[0].a;
console.log('secret ok?', secretOk);
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date::text d`))[0].d;
const A = (fn) => as(U.admin, () => q(`select public.${fn} r`)).then((x) => x[0].r);

// Data: owner, friend signed up 20 days ago; f2 yesterday. Visits: V1 (friend) came back next day.
await q(`update public.profiles set created_at = now() - interval '20 days' where id in ($1, $2)`, [U.owner, U.friend]);
await q(`update public.profiles set created_at = now() - interval '30 hours' where id = $1`, [U.f2]);
await q(`update public.profiles set created_at = now() - interval '2 hours' where id = $1`, [U.f3]);
await q(`update public.profiles set is_test = true where id = $1`, [U.f4]);
const vis = async (v, dayOff, uid = null) => {
  await q(`insert into public.visits (visitor, day, user_id, first_at, last_at) values ($1, $2::date - $3::int, $4, now() - make_interval(days => $3::int), now() - make_interval(days => $3::int)) on conflict do nothing`, [v, today, dayOff, uid]);
  await q(`insert into public.visitors (visitor, first_day) values ($1, $2::date - $3::int) on conflict (visitor) do update set first_day = least(public.visitors.first_day, excluded.first_day)`, [v, today, dayOff]);
};
await vis(V(1), 5, U.friend); await vis(V(1), 4, U.friend);
await vis(V(2), 5); // never came back
await vis(V(3), 0, U.f3);
await vis(V(4), 1, U.f2);
await vis(V(5), 0, U.f4); // test account, left out
await q(`insert into public.visitor_info (visitor, source, source_by, device, browser, installed, first_at, last_at, user_id) values
  ($1, 'invite', $2, 'iPhone', 'Safari', true, now() - interval '5 days', now() - interval '4 days', $3),
  ($4, 'instagram', null, 'Android', 'Chrome', false, now() - interval '5 days', now() - interval '5 days', null),
  ($5, 'poll', $2, 'iPhone', 'Safari', false, now() - interval '1 hour', now(), $6)`, [V(1), name('owner'), U.friend, V(2), V(3), U.f3]);
const [{ id: poll1 }] = await q(`insert into public.polls (creator_id, question, kind) values ($1, 'Tea or coffee?', 'classic') returning id`, [U.owner]);
await q(`insert into public.poll_options (poll_id, text, position) values ($1, 'Tea', 0), ($1, 'Coffee', 1)`, [poll1]);
const opt = (await q(`select id from public.poll_options where poll_id = $1 order by position limit 1`, [poll1]))[0].id;
await q(`insert into public.votes (poll_id, option_id, user_id, created_at) values ($1, $2, $3, now() - interval '5 days'), ($1, $2, $4, now())`, [poll1, opt, U.friend, U.f3]);
await q(`insert into public.shares (poll_id, user_id, channel) values ($1, $2, 'whatsapp')`, [poll1, U.owner]);
await q(`update public.polls set vote_count = 2 where id = $1`, [poll1]);
await q(`update public.visitor_info set source_poll = $1 where visitor = $2`, [poll1, V(3)]);

// ── Tracking ──
const [{ id: nid }] = await q(`insert into public.notifications (user_id, kind, title, body, url, dedupe, sent_at) values ($1, 'votes', 't', 'b', '/', 'd1', now()) returning id`, [U.owner]);
await as(U.friend, () => q(`select public.push_opened($1)`, [nid]));
ok('push_opened: someone else\'s notification is not marked', (await q(`select opened_at from public.notifications where id = $1`, [nid]))[0].opened_at === null);
await as(U.owner, () => q(`select public.push_opened($1)`, [nid]));
await as(U.owner, () => q(`select public.push_opened($1)`, [nid]));
ok('push_opened: marked by its owner, counted once', (await q(`select opened_at from public.notifications where id = $1`, [nid]))[0].opened_at !== null && (await q(`select count(*)::int n from public.app_opens where kind = 'push'`))[0].n === 1);
ok('push_opened: anon can\'t execute', (await q(`select has_function_privilege('anon', 'public.push_opened(bigint)', 'execute') a`))[0].a === false);
await asAnon(() => q(`select public.email_opened('summary-lunch')`));
await asAnon(() => q(`select public.email_opened('<script>')`));
ok('email_opened: known campaign kept, anything else is "other"', JSON.stringify((await q(`select ref from public.app_opens where kind = 'email' order by id`)).map((r) => r.ref)) === '["summary-lunch","other"]');
await as(U.owner, () => q(`select public.note_push_off()`));
await as(U.owner, () => q(`select public.note_push_off()`));
ok('note_push_off: once an hour', (await q(`select count(*)::int n from public.push_offs`))[0].n === 1);
ok('note_push_off: anon can\'t execute', (await q(`select has_function_privilege('anon', 'public.note_push_off()', 'execute') a`))[0].a === false);
await as(U.owner, () => q(`select public.note_blocked($1)`, ['comment' + 'x'.repeat(100)])); // signed in: only a post can be blocked
ok('note_blocked: place cut to 40', (await q(`select length(place) n from public.blocked_hits`))[0].n === 40);
ok('tracking tables not readable by the app', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.app_opens`))) ?? '') && /permission denied/.test(await err(() => asAnon(() => q(`select * from public.blocked_hits`))) ?? ''));
ok('push_tally: wrong secret refused', /forbidden/.test(await err(() => asAnon(() => q(`select public.push_tally('nope', 1, 0, 0)`))) ?? ''));
if (secretOk) {
  await asAnon(() => q(`select public.push_tally($1, 3, 1, 0)`, [SECRET]));
  await asAnon(() => q(`select public.push_tally($1, 2, 0, 1)`, [SECRET]));
  const pd = (await q(`select * from public.push_daily`))[0];
  ok('push_tally: adds up per day', pd.runs === 2 && pd.sent === 5 && pd.expired === 1 && pd.failed === 1, JSON.stringify(pd));
}

// ── Overview ──
const ov = await A('admin_overview()');
ok('overview: today/yesterday/last_week', ov.today && ov.yesterday && ov.last_week, Object.keys(ov).join(','));
ok('overview: today 1 visitor (test account left out), 1 vote, 1 signup (f3)', ov.today.visitors === 1 && ov.today.votes === 1 && ov.today.signups === 1, JSON.stringify(ov.today));
ok('overview: 14-day series', ov.series.length === 14, String(ov.series.length));
ok('overview: back next day — of V1 (back) and V2 (not), 50%', Number(ov.back_rate) === 50, String(ov.back_rate));
ok('overview: shares per poll', Number(ov.shares_per_poll) === 1, String(ov.shares_per_poll));
ok('overview: signups in 24h = 1', ov.signups_24h === 1, String(ov.signups_24h));
ok('overview: morning off by default', ov.morning === false);

// ── Funnel ──
const fu = await A('admin_funnel(7)');
ok('funnel: visited 4 (test account left out)', fu.visited === 4, JSON.stringify(fu));
ok('funnel: voted 2 (friend, f3), signed 3', fu.voted === 2 && fu.signed === 3, JSON.stringify({ v: fu.voted, s: fu.signed }));
ok('funnel: dau/wau/mau', fu.wau === 4 && fu.mau === 4, JSON.stringify({ d: fu.dau, w: fu.wau, m: fu.mau }));
ok('funnel: cohorts are a list with d1 null when too soon', Array.isArray(fu.cohorts), JSON.stringify(fu.cohorts));

// ── Sources ──
const so = await A('admin_sources(7)');
ok('sources: 3 with a known source', so.total === 3, JSON.stringify(so.sources));
ok('sources: owner brought 2 (invite + poll), 2 signed', so.bringers[0]?.username === name('owner') && so.bringers[0].visitors === 2 && so.bringers[0].signed === 2, JSON.stringify(so.bringers));
ok('sources: top poll', so.top_polls[0]?.question === 'Tea or coffee?' && so.top_polls[0].visitors === 1);
ok('sources: phones', so.phones.some((p) => p.label === 'iPhone · installed app'), JSON.stringify(so.phones));

// ── Content ──
const co = await A('admin_content(7)');
ok('content: 1 poll, 2 votes median, blocked 1', co.polls === 1 && Number(co.median_votes) === 2 && co.blocked === 1, JSON.stringify({ p: co.polls, m: co.median_votes, b: co.blocked }));
ok('content: by_day 7 days', co.by_day.length === 7);
ok('content: top', co.top[0]?.question === 'Tea or coffee?');

// ── Notifications ──
const no = await A('admin_notifications(7)');
ok('notifications: votes made 1, sent 1, opened 1', no.kinds[0]?.kind === 'votes' && no.kinds[0].sent === 1 && no.kinds[0].opened === 1, JSON.stringify(no.kinds));
ok('notifications: turned off 1, email opens 2', no.turned_off === 1 && no.email_opens === 2, JSON.stringify({ t: no.turned_off, e: no.email_opens }));
if (secretOk) ok('notifications: expired/failed from the job', no.expired === 1 && no.failed === 1 && no.runs_today === 2);

// ── Morning summary ──
ok('morning: off', (await A('admin_morning()')) === false);
ok('morning: turn on', (await A('admin_morning(true)')) === true);
ok('morning: logged', (await q(`select count(*)::int n from public.admin_events where action = 'morning_summary' and detail = 'on'`))[0].n === 1);
ok('morning: not the admin, refused', /not_admin/.test(await err(() => as(U.owner, () => q(`select public.admin_morning(true)`))) ?? ''));
ok('morning_summary: wrong secret refused', /forbidden/.test(await err(() => asAnon(() => q(`select public.morning_summary('nope')`))) ?? ''));
if (secretOk) {
  await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/a', $1, 'k', 'a')`, [U.admin]);
  const at = (h) => `${today} ${h}+05:30`;
  const MS = async (h) => (await asAnon(() => q(`select public.morning_summary($1, $2::timestamptz) r`, [SECRET, at(h)])))[0].r;
  ok('morning_summary at 8:58: nothing', (await MS('08:58')).alert === null);
  const ms = await MS('09:02');
  ok('morning_summary at 9:02: alert to the admin phone', ms.alert?.title === '☀️ Yesterday on Eithr' && ms.alert.url === '/admin#overview' && ms.targets.length === 1, JSON.stringify(ms));
  ok('morning_summary body: visitors · signed up · votes', /^\d+ visitors · \d+ signed up · \d+ votes/.test(ms.alert?.body ?? ''), ms.alert?.body);
  ok('morning_summary: once a day', (await MS('09:30')).alert === null);
  ok('morning_summary at 10: nothing', (await MS('10:00')).alert === null);
  await A('admin_morning(false)');
  await q(`delete from public.app_state where key = 'morning_summary'`);
  ok('morning_summary: switched off → nothing', (await MS('09:05')).alert === null);
}
await A('admin_morning(false)');

// Admin only, every function.
for (const fn of ['admin_overview()', 'admin_funnel()', 'admin_sources()', 'admin_content()', 'admin_notifications()'])
  ok(`${fn.split('(')[0]}: not the admin, refused`, /not_admin|permission denied/.test(await err(() => as(U.owner, () => q(`select public.${fn}`))) ?? ''));
for (const fn of ['admin_overview()', 'admin_funnel(int)', 'admin_sources(int)', 'admin_content(int)', 'admin_notifications(int)', 'admin_morning(boolean)', 'day_snapshot(date)', 'counted_people()', 'visitor_user(uuid)'])
  ok(`${fn}: anon can't execute`, (await q(`select has_function_privilege('anon', 'public.${fn}', 'execute') a`))[0].a === false);
for (const fn of ['day_snapshot(date)', 'counted_people()', 'visitor_user(uuid)'])
  ok(`${fn}: signed-in can't execute`, (await q(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') a`))[0].a === false);
console.log(`\n${pass} pass, ${fail} fail`);
