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

// ── Lockdown (20261209000000_lockdown.sql): what a signed-out visitor (the anon role) can run ──
const ALLOW = ["best_rank(text)", "brain_reveal(uuid,uuid)", "polls_to_tag(text,integer)", "tag_notify(text)", "agent_start(text,timestamp with time zone)", "agent_save(text,bigint,jsonb,jsonb,text,text)", "post_due_drafts(text)", "set_poll_tags(text,uuid,text,text,boolean,text)", "create_poll_status(text)", "email_opened(text)", "email_summary_collect(text,integer)", "email_unsubscribe(text,uuid)", "errors_tick(text,jsonb)", "get_comments(uuid)", "get_feed(text,integer,text)", "get_leaderboard(text,text)", "get_poll(uuid)", "get_profile(text)", "live_counts(uuid[])", "morning_summary(text,timestamp with time zone)", "profile_polls(text,integer,text)", "push_collect(text,integer)", "push_gone(text,text[])", "push_tally(text,integer,integer,integer)", "push_test_targets(text,uuid)", "record_open(uuid)", "record_share(uuid,text)", "record_views_anon(text,text,uuid[])", "record_visitor(uuid,text,text,uuid,text,text,text,text,boolean,text)", "report_error(text,text,text,text,text,text,text,text,text,boolean,text,text,text)", "report_server_error(text,text,text,text,text,text,text)", "set_text_verdict(text,uuid,text,jsonb,text,text)", "snap_info(uuid[])", "snap_photo_visible(text)", "texts_to_check(text,integer)", "track_visit(uuid,boolean)"];
const LOCKED = ["accept_invite(text,text)", "admin_act(text,uuid,text)", "admin_decide_snap(uuid,boolean)", "admin_log(integer)", "admin_reports(text)", "admin_schedule(integer)", "admin_schedule_poll(date,text,text[],text,text,integer,uuid)", "admin_snaps()", "admin_unschedule(uuid)", "block_user(text)", "check_username(text)", "circle_badge()", "circle_picks(uuid)", "create_group(text)", "delete_comment(uuid)", "delete_group(uuid)", "delete_poll(uuid)", "delete_push_subscription(text)", "expired_snap_photos(boolean)", "get_push_settings()", "give_prop(uuid,text)", "leave_circle(text)", "mark_activity_seen()", "mark_props_seen()", "mark_snap_photos_deleted(text[])", "my_activity()", "my_circle()", "my_invite_code()", "my_profile()", "my_props()", "my_streak()", "next_prop()", "note_blocked(text)", "props_news()", "props_state()", "recent_results()", "remove_from_circle(text)", "rename_group(uuid,text)", "request_circle(text)", "respond_request(text,boolean)", "save_push_subscription(text,text,text)", "search_people(text)", "set_group_member(uuid,text,boolean)", "set_props_off(boolean)", "set_push_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean)", "set_snap_verdict(uuid,text,jsonb,text)", "shuffle_prop(uuid)", "skip_prop(uuid)", "snap_for_check(uuid)", "suggest_friends()", "unblock_user(text)", "update_username(text)", "username_suggestions(text)", "cast_vote(uuid,uuid)", "create_poll(text,text[],integer,text,text,text,text,uuid[])", "post_comment(uuid,text)", "record_views(uuid[])", "admin_users(text,text,text,integer,integer)", "admin_limits(integer,integer)"];
const can = async (role, sig) => (await q(`select has_function_privilege($1, $2::regprocedure, 'execute') a`, [role, 'public.' + sig]))[0].a;
for (const f of ALLOW) ok(`signed out can run ${f.split('(')[0]}`, await can('anon', f));
for (const f of ALLOW) ok(`signed in can run ${f.split('(')[0]}`, await can('authenticated', f));
for (const f of LOCKED) ok(`signed out can't run ${f.split('(')[0]}`, !(await can('anon', f)));
for (const f of LOCKED) ok(`signed in still can run ${f.split('(')[0]}`, await can('authenticated', f));
// Every security-definer function open to anon (not triggers, not extensions'): exactly the allow-list.
const open = (await q(`select p.oid::regprocedure::text s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and pg_get_function_result(p.oid) <> 'trigger'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map((r) => r.s.replace(/^public\./, ''));
const extra = open.filter((s) => !ALLOW.includes(s)), missing = ALLOW.filter((s) => !open.includes(s));
ok(`open to anon = the allow-list (${ALLOW.length})`, !extra.length && !missing.length, JSON.stringify({ extra, missing }));
// Authenticated lost nothing: every function it could run before, it still can (checked against the list above, plus a count).
ok('no security-definer function closed to signed-in people by this', (await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and pg_get_function_result(p.oid) <> 'trigger'
    and has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')`))[0].n === 0);

// Really calling them: signed out still works, sign-in-only refuses with "permission denied".
const P = (await as(U.owner, () => q(`select public.create_poll('Tea or coffee?', array['Tea','Coffee'], 1) id`)))[0].id;
const anonQ = (sql, p) => as(null, () => q(sql, p));
ok('signed out: get_feed shows the poll', (await anonQ(`select id from public.get_feed('new', 30, null)`)).some((r) => r.id === P));
ok('signed out: get_poll', (await anonQ(`select id from public.get_poll($1)`, [P]))[0]?.id === P);
ok('signed out: get_profile', (await anonQ(`select public.get_profile($1) r`, [name('owner')]))[0].r?.username === name('owner'));
ok('signed out: profile_polls', (await anonQ(`select id from public.profile_polls($1, 30, null)`, [name('owner')])).some((r) => r.id === P));
ok('signed out: get_leaderboard runs', Array.isArray(await anonQ(`select * from public.get_leaderboard('creators', 'this')`)));
ok('signed out: live_counts', (await anonQ(`select * from public.live_counts(array[$1]::uuid[])`, [P])).length === 1);
ok('signed out: get_comments says sign in', (await anonQ(`select public.get_comments($1) r`, [P]))[0].r?.can_read === false);
ok('signed out: create_poll_status says signed_in false', (await anonQ(`select public.create_poll_status() r`))[0].r?.signed_in === false);
ok('signed out: best_rank runs', (await err(() => anonQ(`select public.best_rank($1)`, [name('owner')]))) === null);
ok('signed out: track_visit runs', (await err(() => anonQ(`select public.track_visit(gen_random_uuid(), true)`))) === null);
ok('signed out: record_open / record_share do nothing, without an error', (await err(() => anonQ(`select public.record_open($1), public.record_share($1, 'copy')`, [P]))) === null);
ok('signed out: push_collect still answers (refuses a wrong secret itself)', /forbidden|secret/i.test(await err(() => anonQ(`select * from public.push_collect('guess', 10)`)) ?? ''));
for (const [l, s] of [['admin_users', `select public.admin_users()`], ['my_profile', `select public.my_profile()`], ['delete_group', `select public.delete_group(gen_random_uuid())`], ['save_push_subscription', `select public.save_push_subscription('https://fcm.googleapis.com/x','k','a')`], ['give_prop', `select public.give_prop(gen_random_uuid(), 'x')`], ['update_username', `select public.update_username('hacker')`], ['delete_poll', `select public.delete_poll($1)`], ['request_circle', `select public.request_circle('x')`]])
  ok(`signed out: ${l} refused (permission denied)`, /permission denied for function/.test(await err(() => anonQ(s, s.includes('$1') ? [P] : undefined)) ?? ''));
ok('signed in: my_profile still works', (await as(U.owner, () => q(`select public.my_profile() r`)))[0].r?.username === name('owner'));
ok('guest (anonymous account): get_feed and cast_vote still work', await (async () => { const G = '00000009-0000-0000-0000-000000000000'; await q(`insert into auth.users(id, email, is_anonymous) values ($1, null, true)`, [G]); const [{ id: o }] = await q(`select id from poll_options where poll_id = $1 order by position limit 1`, [P]); const f = await as(G, () => q(`select id from public.get_feed('new', 30, null)`), true); await as(G, () => q(`select * from public.cast_vote($1, $2)`, [P, o]), true); return f.some((r) => r.id === P); })());
// Running the migration again changes nothing.
await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261209000000_lockdown.sql`, 'utf8'));
ok('runs twice', (await can('anon', 'admin_users(text,text,text,integer,integer)')) === false && (await can('anon', 'get_feed(text,integer,text)')) === true);
console.log(`\n${pass} pass, ${fail} fail`);
