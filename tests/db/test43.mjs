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

// ── Email summary: who gets one, what's in it, once a day, off with one click ──
await q(`insert into public.push_config (id, secret_hash) values (1, encode(sha256(convert_to('s3cret', 'UTF8')), 'hex')) on conflict (id) do update set secret_hash = excluded.secret_hash`);
const collect = () => q(`select * from public.email_summary_collect('s3cret', 50)`);
const realSlot = (await q(`select pg_get_functiondef('public.email_slot()'::regprocedure) d`))[0].d;
const slotIs = (s) => q(`create or replace function public.email_slot() returns text language sql as $$ select ${s ? `'${s}'` : 'null::text'} $$`);
// Outside the lunch and evening windows: nothing (whatever the hour now, force the window shut first).
await slotIs(null);
ok('outside both windows: nothing', (await collect()).length === 0);
ok('email_hour_ok is gone', (await q(`select count(*)::int n from pg_proc where proname = 'email_hour_ok'`))[0].n === 0);
await slotIs('lunch');
ok('wrong secret: refused', /forbidden/.test(await err(() => q(`select * from public.email_summary_collect('nope', 50)`)) ?? ''));
// The owner's poll gets votes from friend and stranger; stranger also gets props, f2 has a request.
const [{ poll, opt }] = await q(`insert into public.polls (creator_id, question, kind) values ($1, 'Tea or coffee?', 'classic') returning id poll, (select null::uuid) opt`, [U.owner]).catch(async () => [{ poll: null }]);
let pollId = poll;
if (!pollId) pollId = (await as(U.owner, () => q(`select public.create_poll('Tea or coffee?', array['Tea','Coffee'], 'classic', null, 'public', 1) id`)))[0].id;
const o = (await q(`select id from public.poll_options where poll_id = $1 order by position limit 1`, [pollId]))[0];
if (!o) await q(`insert into public.poll_options (poll_id, text, position) values ($1, 'Tea', 0), ($1, 'Coffee', 1)`, [pollId]);
const optId = (await q(`select id from public.poll_options where poll_id = $1 order by position limit 1`, [pollId]))[0].id;
for (const k of ['friend', 'stranger', 'f2']) await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [pollId, optId, U[k]]);
await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [pollId, optId, U.owner]); // their own vote doesn't count
await q(`insert into public.props (question_id, picker_id, picked_id, notify_after) values (1, $1, $2, now() - interval '1 minute'), (2, $1, $2, now() + interval '20 minutes')`, [U.friend, U.stranger]);
await q(`insert into public.circle_members (owner_id, member_id, status) values ($1, $2, 'pending') on conflict do nothing`, [U.f2, U.f3]);
// friend has a push-enabled phone; f3 opened Eithr an hour ago; f4 turned emails off.
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/f', $1, 'k', 'a')`, [U.friend]);
await q(`insert into public.visits (visitor, day, user_id, sessions, last_at) values ('bbbbbbbb-0000-0000-0000-000000000003', (now() at time zone 'Asia/Kolkata')::date, $1, 1, now() - interval '1 hour')`, [U.f3]);
await q(`update public.profiles set email_off = true where id = $1`, [U.f4]);
// f3 opened Eithr an hour ago but has a friend request from f2: still gets the email now.
await q(`insert into public.circle_members (owner_id, member_id, status) values ($1, $2, 'pending') on conflict do nothing`, [U.f3, U.f2]);
// friend comments on owner's poll twice, f2 once (one hidden comment from f4 doesn't count).
for (const [k, h, ago] of [['friend', false, 4], ['friend', false, 3], ['f2', false, 2], ['f4', true, 1]]) await q(`insert into public.comments (poll_id, user_id, text, is_hidden, created_at) values ($1, $2, 'hi', $3, now() - make_interval(mins => $4))`, [pollId, U[k], h, ago]);
const rows = await collect();
const by = Object.fromEntries(rows.map((r) => [r.username, r]));
ok('owner: 3 votes from others (not their own), with the poll', by[name('owner')]?.votes === 3 && by[name('owner')]?.top_question === 'Tea or coffee?', JSON.stringify(by[name('owner')]));
ok('stranger: 1 prop (only the one that\'s due)', by[name('stranger')]?.props === 1 && by[name('stranger')]?.votes === 0, JSON.stringify(by[name('stranger')]));
ok('f2: 1 friend request', by[name('f2')]?.requests === 1, JSON.stringify(by[name('f2')]));
ok('email address included', by[name('owner')]?.email === 'owner@x.com');
ok('nobody with nothing waiting (admin)', !by[name('admin')]);
ok('push reaches them: no email (friend)', !by[name('friend')]);
ok('opened Eithr recently: still gets one (f3)', by[name('f3')]?.requests === 1 && JSON.stringify(by[name('f3')]?.requesters) === JSON.stringify([name('f2')]), JSON.stringify(by[name('f3')]));
ok('slot is lunch', rows.every((r) => r.slot === 'lunch'));
ok('owner: top poll answers and votes', by[name('owner')]?.top_votes === 3 && JSON.stringify(by[name('owner')]?.top_answers) === '["Tea","Coffee"]', JSON.stringify(by[name('owner')]));
ok('owner: 3 comments from 2 people, named latest first, hidden one left out', by[name('owner')]?.comments === 3 && by[name('owner')]?.commenter_count === 2 && JSON.stringify(by[name('owner')]?.commenters) === JSON.stringify([name('f2'), name('friend')]), JSON.stringify(by[name('owner')]));
ok('f2: requester named', JSON.stringify(by[name('f2')]?.requesters) === JSON.stringify([name('f3')]));
ok('stranger: props, no names anywhere', by[name('stranger')]?.commenters.length === 0 && by[name('stranger')]?.requesters.length === 0);
ok('emails turned off: none (f4)', !by[name('f4')]);
ok('one lunch email: a second run sends nothing', (await collect()).length === 0);
ok('sends are recorded', (await q(`select count(*)::int n from public.email_sends where slot = 'lunch'`))[0].n === rows.length && rows.length === 4, String(rows.length));
// Evening: only what's new since lunch.
await slotIs('evening');
ok('evening with nothing new: nothing', (await collect()).length === 0);
await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [pollId, optId, U.f3]);
const eve = await collect();
ok('evening: owner only, with just the new vote', eve.length === 1 && eve[0].username === name('owner') && eve[0].votes === 1 && eve[0].comments === 0 && eve[0].top_votes === 1 && eve[0].slot === 'evening', JSON.stringify(eve));
ok('one evening email: a second run sends nothing', (await collect()).length === 0);
ok('owner has two sends today', (await q(`select count(*)::int n from public.email_sends where user_id = $1`, [U.owner]))[0].n === 2);
await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [pollId, optId, U.f4]);
ok('a third window doesn\'t exist: still nothing tonight', (await collect()).length === 0);
await q(realSlot);
// The real windows, India time.
// The real function, with "now" pinned to a given India time (UTC+5:30).
const at = async (hhmm) => { await q(realSlot.replace(/public\.email_slot\(\)/, 'public.email_slot_at()').replace('now()', `(date '2026-10-29' + time '${hhmm}') at time zone 'Asia/Kolkata'`)); return (await q(`select public.email_slot_at() s`))[0].s; };
ok('real email_slot() is lunch, evening or null', ['lunch', 'evening', null].includes((await q(`select public.email_slot() s`))[0].s));
ok('windows: 12:29 none, 12:30 lunch, 13:59 lunch, 14:00 none, 18:30 evening, 20:59 evening, 21:00 none', (await at('12:29')) === null && (await at('12:30')) === 'lunch' && (await at('13:59')) === 'lunch' && (await at('14:00')) === null && (await at('18:30')) === 'evening' && (await at('20:59')) === 'evening' && (await at('21:00')) === null);
ok('email_slot not callable by the app', /permission denied/.test(await err(() => as(U.owner, () => q(`select public.email_slot()`))) ?? ''));
await slotIs('lunch');
// The race data and the rest of the new fields.
const lunchOwner = by[name('owner')];
const optCounts = (await q(`select array_agg(vote_count order by position) c from public.poll_options where poll_id = $1`, [pollId]))[0].c;
ok('lunch: top_before 0 (no earlier votes), counts as the app shows them', lunchOwner.top_before === 0 && JSON.stringify(lunchOwner.top_counts) === JSON.stringify(optCounts) && lunchOwner.top_counts.length === 2, JSON.stringify([lunchOwner.top_counts, optCounts]));
ok('lunch: comment_question, not closed, no lunch_sent', lunchOwner.comment_question === 'Tea or coffee?' && lunchOwner.top_closed === false && lunchOwner.lunch_sent === false);
ok('evening: top_before 3 (the lunch votes), lunch_sent true', eve[0].top_before === 3 && eve[0].lunch_sent === true, JSON.stringify(eve[0]));
// A poll that closed since the last email: due on its own, with no new votes.
await slotIs('evening');
const [{ id: cp }] = await q(`insert into public.polls (creator_id, question, kind) values ($1, 'Goa or Manali?', 'classic') returning id`, [U.admin]);
await q(`insert into public.poll_options (poll_id, text, position) values ($1, 'Goa', 0), ($1, 'Manali', 1)`, [cp]);
const goa = (await q(`select id from public.poll_options where poll_id = $1 and position = 0`, [cp]))[0].id;
await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [cp, goa, U.friend]);
await q(`update public.votes set created_at = now() - interval '3 days' where poll_id = $1`, [cp]);
await q(`update public.polls set created_at = now() - interval '4 days', closes_at = now() - interval '5 minutes' where id = $1`, [cp]);
const closed = await collect();
const ad = closed.find((r) => r.username === name('admin'));
ok('closed poll: admin gets an email with nothing else new', ad && ad.top_closed === true && ad.votes === 0 && ad.top_poll === cp && ad.top_question === 'Goa or Manali?' && ad.lunch_sent === false, JSON.stringify(closed));
ok('closed poll: only once', !(await collect()).some((r) => r.username === name('admin')));
await slotIs('lunch');
ok('email_sends not readable directly', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.email_sends`))) ?? ''));
ok('collect is useless without the secret, even signed in', /forbidden/.test(await err(() => as(U.owner, () => q(`select * from public.email_summary_collect('x', 5)`))) ?? ''));
// Settings: read and set your own.
const me = (await as(U.owner, () => q(`select public.my_email_summary() s`)))[0].s;
ok('Settings: on, has an email', me.on === true && me.has_email === true, JSON.stringify(me));
ok('Settings: turn off', (await as(U.owner, () => q(`select public.my_email_summary(true) s`)))[0].s.on === false);
ok('signed out: refused', /sign_in|permission denied/.test(await err(() => as(null, () => q(`select public.my_email_summary()`))) ?? ''));
ok('guest: refused', /sign_in/.test(await err(() => as(U.owner, () => q(`select public.my_email_summary()`), true)) ?? ''));
// One-click unsubscribe (the route checks the link's signature; the database the secret).
ok('unsubscribe: wrong secret refused', /forbidden/.test(await err(() => q(`select public.email_unsubscribe('nope', $1)`, [U.stranger])) ?? ''));
await q(`select public.email_unsubscribe('s3cret', $1)`, [U.stranger]);
ok('unsubscribe: emails off', (await q(`select email_off from public.profiles where id = $1`, [U.stranger]))[0].email_off === true);
// Next day, new votes: owner (now off) gets nothing; others need something new.
await q(`delete from public.email_sends where day is not null`);
ok('after turning off, no more emails (owner, stranger)', !(await collect()).some((r) => [name('owner'), name('stranger')].includes(r.username)));
console.log(`\n${pass} pass, ${fail} fail`);
