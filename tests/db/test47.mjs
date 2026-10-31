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

// ── People: visitor info, guest → user, Users list/detail, email, reset, Guests ──
const asAnon = async (fn) => { await db.exec(`set role anon; select set_config('request.uid','',false), set_config('request.jwt','{}',false)`); try { return await fn(); } finally { await db.exec('reset role'); } };
const rv = (visitor, args = {}) => q(`select public.record_visitor($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [visitor, args.source ?? null, args.by ?? null, args.poll ?? null, args.site ?? null, args.device ?? null, args.browser ?? null, args.in_app ?? null, args.installed ?? null, args.notif ?? null]);
const V = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
// A visitor arrives from a poll owner shared, on an iPhone, then signs in as friend.
await asAnon(() => rv(V(1), { source: 'poll', by: name('owner'), site: null, device: 'iPhone', browser: 'Safari', notif: 'default' }));
ok('visitor recorded without an account', (await q(`select source, source_by, device, user_id from public.visitor_info where visitor = $1`, [V(1)]))[0]?.source === 'poll');
await as(U.friend, () => rv(V(1), { source: 'instagram', device: 'iPhone', browser: 'Safari', installed: true, notif: 'granted' }));
const vi = (await q(`select * from public.visitor_info where visitor = $1`, [V(1)]))[0];
ok('later visit: source kept from the first, device/install/notifications updated, linked to the person', vi.source === 'poll' && vi.source_by === name('owner') && vi.installed === true && vi.notif === 'granted' && vi.user_id === U.friend, JSON.stringify(vi));
await asAnon(() => rv(V(2), { source: 'hacker', site: 'X'.repeat(200) + '.COM', notif: 'weird' }));
const v2 = (await q(`select source, site, notif from public.visitor_info where visitor = $1`, [V(2)]))[0];
ok('unknown source → other_site, site cut and lower-cased, bad notif ignored', v2.source === 'other_site' && v2.site.length === 60 && v2.site === v2.site.toLowerCase() && v2.notif === null, JSON.stringify(v2));
// A shared poll's author comes from the poll itself.
const [{ id: pollS }] = await q(`insert into public.polls (creator_id, question, kind) values ($1, 'Shared one?', 'classic') returning id`, [U.f2]);
await asAnon(() => rv(V(4), { source: 'poll', poll: pollS, device: 'Android' }));
ok('poll source stores the poll', (await q(`select source_poll from public.visitor_info where visitor = $1`, [V(4)]))[0].source_poll === pollS);
// A browser that already visited before: first visit unknown.
await q(`insert into public.visits (visitor, day, sessions, first_at, last_at) values ($1, (now() at time zone 'Asia/Kolkata')::date - 3, 1, now() - interval '3 days', now() - interval '3 days')`, [V(5)]);
await asAnon(() => rv(V(5), { source: 'instagram', by: 'x', site: 'evil.com', device: 'iPhone' }));
const v5 = (await q(`select source, source_by, site, device from public.visitor_info where visitor = $1`, [V(5)]))[0];
ok('visited before this was recorded: source unknown (null), device still kept', v5.source === null && v5.source_by === null && v5.site === null && v5.device === 'iPhone', JSON.stringify(v5));
ok('visitor_info not readable by the app', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.visitor_info`))) ?? ''));
// A guest (anonymous) votes, then links Google.
const G = '0000000a-0000-0000-0000-000000000000';
await q(`insert into auth.users(id, email, is_anonymous) values ($1, null, true)`, [G]);
await q(`update public.profiles set username = 'guest_abc12345', created_at = now() - interval '2 hours' where id = $1`, [G]);
const [{ id: pollA }] = await q(`insert into public.polls (creator_id, question, kind) values ($1, 'Tea or coffee?', 'classic') returning id`, [U.owner]);
await q(`insert into public.poll_options (poll_id, text, position) values ($1, 'Tea', 0), ($1, 'Coffee', 1)`, [pollA]);
const optA = (await q(`select id from public.poll_options where poll_id = $1 order by position limit 1`, [pollA]))[0].id;
await q(`insert into public.votes (poll_id, option_id, user_id, created_at) values ($1, $2, $3, now() - interval '90 minutes')`, [pollA, optA, G]);
await as(G, () => rv(V(3), { source: 'invite', by: name('owner'), device: 'Android', browser: 'Chrome', notif: 'default' }), true);
let gl = (await as(U.admin, () => q(`select public.admin_guest_list(7, 'still') r`)))[0].r;
ok('guest list: the guest, by a short code, with source and phone, no name', gl.length === 1 && gl[0].code.length === 4 && gl[0].source === 'invite' && gl[0].device === 'Android' && gl[0].votes === 1 && gl[0].username === null && !gl[0].signed_up, JSON.stringify(gl));
await q(`update auth.users set is_anonymous = false, email = 'g@x.com' where id = $1`, [G]);
const gp = (await q(`select was_guest, signed_up_at from public.profiles where id = $1`, [G]))[0];
ok('linking Google: was_guest and signed_up_at set', gp.was_guest === true && gp.signed_up_at !== null);
gl = (await as(U.admin, () => q(`select public.admin_guest_list(7, 'signed') r`)))[0].r;
ok('guest list (signed up): shows their username', gl.length === 1 && gl[0].signed_up && gl[0].username !== null, JSON.stringify(gl));
const gs = (await as(U.admin, () => q(`select public.admin_guests(7) r`)))[0].r;
ok('guests: voted 1, signed up 1, signed up after ~2h (same day bucket)', gs.voted === 1 && gs.signed_up === 1 && gs.buckets.day === 1 && gs.median_minutes >= 110 && gs.median_minutes <= 130, JSON.stringify(gs));
ok('guests: their vote before signing up counts as a guest vote', gs.guest_votes === 1 && gs.votes >= 1, JSON.stringify(gs));
// A second guest, still a guest, one vote.
const G2 = '0000000b-0000-0000-0000-000000000000';
await q(`insert into auth.users(id, email, is_anonymous) values ($1, null, true)`, [G2]);
await q(`update public.profiles set username = 'guest_def67890' where id = $1`, [G2]);
await q(`insert into public.votes (poll_id, option_id, user_id) values ($1, $2, $3)`, [pollA, optA, G2]);
const gs2 = (await as(U.admin, () => q(`select public.admin_guests(7) r`)))[0].r;
ok('guests: 2 voted, 1 left after one vote', gs2.voted === 2 && gs2.one_vote === 1 && gs2.signed_up === 1, JSON.stringify(gs2));
// Users list.
await q(`update public.profiles set created_at = now() - interval '20 days', signed_up_at = null where id = $1`, [U.owner]);
await q(`insert into public.visits (visitor, day, user_id, sessions, last_at) values ($1, (now() at time zone 'Asia/Kolkata')::date, $2, 1, now() - interval '5 minutes')`, [V(1), U.friend]);
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/o', $1, 'k', 'a')`, [U.owner]);
await q(`insert into public.circle_members (owner_id, member_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [U.owner, U.friend]);
await q(`update public.profiles set is_test = true where id = $1`, [U.f4]);
let L = (await as(U.admin, () => q(`select public.admin_users() r`)))[0].r;
const byU = Object.fromEntries(L.rows.map((r) => [r.username, r]));
ok('users: signed-up people only (no guests still guests)', !L.rows.some((r) => r.username === 'guest_def67890') && L.total === L.rows.length, String(L.total));
ok('users: newest first', new Date(L.rows[0].joined) >= new Date(L.rows[L.rows.length - 1].joined));
ok('users: owner has 1 poll, notifications on, 1 friend', byU[name('owner')]?.polls === 1 && byU[name('owner')]?.push === 'on' && byU[name('owner')]?.friends === 1, JSON.stringify(byU[name('owner')]));
ok('users: friend came from owner\'s poll, iPhone installed, last active, notifications off (allowed, no phone set up)', byU[name('friend')]?.source === 'poll' && byU[name('friend')]?.source_by === name('owner') && byU[name('friend')]?.installed === true && byU[name('friend')]?.last_active && byU[name('friend')]?.push === 'off', JSON.stringify(byU[name('friend')]));
ok('users: the converted guest shows was_guest', L.rows.some((r) => r.was_guest && r.guest_since), '');
await q(`update public.visitor_info set user_id = $1 where visitor = $2`, [U.f3, V(4)]);
const L2 = (await as(U.admin, () => q(`select public.admin_users() r`)))[0].r;
ok('users: poll source names the poll\'s author', L2.rows.find((r) => r.username === name('f3'))?.source_by === name('f2'), JSON.stringify(L2.rows.find((r) => r.username === name('f3'))));
ok('users: never asked / unknown', byU[name('stranger')]?.push === 'unknown');
const search = (await as(U.admin, () => q(`select public.admin_users('all', $1) r`, [name('friend')])))[0].r;
ok('search by username', search.total === 1 && search.rows[0].username === name('friend'));
const search2 = (await as(U.admin, () => q(`select public.admin_users('all', 'OWNER') r`)))[0].r;
ok('search by name (case-insensitive)', search2.rows.some((r) => r.username === name('owner')), JSON.stringify(search2.rows.map((r) => r.username)));
ok('filter: test', (await as(U.admin, () => q(`select public.admin_users('test') r`)))[0].r.rows.every((r) => r.is_test || r.is_admin));
ok('filter: novote', (await as(U.admin, () => q(`select public.admin_users('novote') r`)))[0].r.rows.every((r) => r.votes === 0));
ok('filter: push_off excludes owner', !(await as(U.admin, () => q(`select public.admin_users('push_off') r`)))[0].r.rows.some((r) => r.username === name('owner')));
const page = (await as(U.admin, () => q(`select public.admin_users('all', null, 'new', 2, 2) r`)))[0].r;
ok('paging: 2 rows from the 3rd, total unchanged', page.rows.length === 2 && page.total === L.total && page.rows[0].username === L.rows[2].username);
const byVotes = (await as(U.admin, () => q(`select public.admin_users('all', null, 'votes') r`)))[0].r.rows;
ok('sort by votes', byVotes[0].votes >= byVotes[byVotes.length - 1].votes);
const sum = (await as(U.admin, () => q(`select public.admin_users_summary() r`)))[0].r;
ok('summary: test accounts and the admin left out, push on 1', sum.total === L.total - 2 && sum.push_on === 1 && sum.active_week === 1, JSON.stringify(sum));
// Person page.
await q(`insert into public.reports (target_type, target_id, reporter_id, reason) values ('poll', $1, $2, 'spam')`, [pollA, U.friend]);
const d = (await as(U.admin, () => q(`select public.admin_user_detail($1) r`, [U.owner])))[0].r;
ok('detail: email hidden as a hint only', d.email_hint === 'o••••@x.com' && !JSON.stringify(d).includes('owner@x.com'), d.email_hint);
ok('detail: counts (polls, friends, reports)', d.polls === 1 && d.friends === 1 && d.reports === 1 && typeof d.streak === 'number', JSON.stringify({ p: d.polls, f: d.friends, r: d.reports }));
ok('detail: timeline (signed in, poll, friend, notifications, report), newest first', ['signup', 'poll', 'friend', 'push', 'report'].every((k) => d.timeline.some((t) => t.kind === k)) && new Date(d.timeline[0].at) >= new Date(d.timeline[d.timeline.length - 1].at), JSON.stringify(d.timeline.map((t) => t.kind)));
ok('detail: poll list', d.poll_list.length === 1 && d.poll_list[0].question === 'Tea or coffee?');
const df = (await as(U.admin, () => q(`select public.admin_user_detail($1) r`, [U.friend])))[0].r;
ok('detail: first visit with where from', df.timeline.some((t) => t.kind === 'visit' && t.text === `First visit (a shared poll by @${name('owner')})`), JSON.stringify(df.timeline));
const dg = (await as(U.admin, () => q(`select public.admin_user_detail($1) r`, [G])))[0].r;
ok('detail: converted guest has "Started as a guest" and a vote', dg.timeline.some((t) => t.kind === 'guest') && dg.timeline.some((t) => t.kind === 'vote'));
ok('detail: unknown person', /not_found/.test(await err(() => as(U.admin, () => q(`select public.admin_user_detail('00000000-0000-4000-8000-000000000999')`))) ?? ''));
// Email, logged.
ok('email: the real address', (await as(U.admin, () => q(`select public.admin_user_email($1) r`, [U.owner])))[0].r === 'owner@x.com');
ok('email: written in the admin log', (await q(`select count(*)::int n from public.admin_events where action = 'email_viewed' and detail = $1`, ['@' + name('owner')]))[0].n === 1);
// Reset username.
const newName = (await as(U.admin, () => q(`select public.admin_reset_username($1) r`, [U.stranger])))[0].r;
const st = (await q(`select username::text u, username_confirmed c from public.profiles where id = $1`, [U.stranger]))[0];
ok('reset username: fresh name, asked to change', st.u === newName && /^user_[0-9a-f]{10}$/.test(newName) && st.c === false, JSON.stringify(st));
ok('reset username: logged', (await q(`select count(*)::int n from public.admin_events where action = 'username_reset'`))[0].n === 1);
ok('reset username: not your own', /own_account/.test(await err(() => as(U.admin, () => q(`select public.admin_reset_username($1)`, [U.admin]))) ?? ''));
// Admin only, every function.
for (const fn of [`admin_users()`, `admin_users_summary()`, `admin_user_detail('${U.owner}')`, `admin_user_email('${U.owner}')`, `admin_reset_username('${U.owner}')`, `admin_guests()`, `admin_guest_list()`])
  ok(`${fn.split('(')[0]}: not the admin, refused`, /not_admin|permission denied/.test(await err(() => as(U.owner, () => q(`select public.${fn}`))) ?? ''));
for (const fn of ['admin_users(text,text,text,int,int)', 'admin_user_email(uuid)', 'admin_guests(int)', 'person_row(uuid)', 'person_push(uuid)'])
  ok(`${fn}: anon can't execute`, (await q(`select has_function_privilege('anon', 'public.${fn}', 'execute') a`))[0].a === false);
console.log(`\n${pass} pass, ${fail} fail`);
