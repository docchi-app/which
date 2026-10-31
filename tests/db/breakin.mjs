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
const expectBlocked = async (label, uid, sql, p, ok = (rows) => rows.length === 0 || rows.every((r) => Object.values(r).every((v) => v === null || v === false || v === 0 || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v && Object.keys(v).length === 0)))) => {
  try { const rows = await as(uid, () => q(sql, p), uid === '00000009-0000-0000-0000-000000000000'); if (await ok(rows)) { pass++; console.log('PASS', label, '(no data)'); } else { fail++; console.log('FAIL', label, '→', JSON.stringify(rows).slice(0, 200)); } }
  catch (e) { pass++; console.log('PASS', label, '→', e.message.slice(0, 70)); }
};
const expectOk = async (label, uid, sql, p) => { try { const r = await as(uid, () => q(sql, p), uid === '00000009-0000-0000-0000-000000000000'); console.log('ok  ', label, JSON.stringify(r).slice(0, 120)); return r; } catch (e) { fail++; console.log('FAIL(setup)', label, e.message); } };
// setup: owner <-> friend (+f2..f4) friends
for (const k of ['friend', 'f2', 'f3', 'f4']) { await as(U[k], () => q(`select request_circle($1)`, [name('owner')])); await as(U.owner, () => q(`select respond_request($1, true)`, [name(k)])); }
const [{ id: CP }] = await as(U.owner, () => q(`select create_poll('Secret plan for the trip?', array['Goa','Manali'], 3, null, 'classic', null, 'circle') id`));
const [{ id: PP }] = await as(U.owner, () => q(`select create_poll('Public question here?', array['Yes','No'], 3) id`));
const [{ id: LP }] = await as(U.owner, () => q(`select create_poll('Link only question?', array['A','B'], 3, null, 'classic', null, 'link') id`));
const opt = async (p, i) => (await q(`select id from poll_options where poll_id=$1 and position=$2`, [p, i]))[0].id;
const cpo = await opt(CP, 0), ppo = await opt(PP, 0);
await as(U.friend, () => q(`select cast_vote($1,$2)`, [CP, cpo]));
await as(U.friend, () => q(`select post_comment($1,'see you there')`, [CP]));
const [{ id: CMT }] = await q(`select id from comments limit 1`);
const [{ grp }] = await as(U.owner, () => q(`select create_group('Family') grp`));
await q(`insert into storage.objects(bucket_id,name,owner) values ('snaps',$1,$2)`, [`${U.owner}/s.webp`, U.owner]);
const [{ id: SNAP }] = await as(U.owner, () => q(`select create_snap($1,'Rate my fit',array['🔥','😍'],'circle',true) id`, [`${U.owner}/s.webp`]));
const code = (await as(U.owner, () => q(`select my_invite_code() c`)))[0].c;

console.log('\n== Direct table reads (REST /rest/v1/<table>)');
for (const t of ['profiles', 'polls', 'poll_options', 'votes', 'comments', 'circle_members', 'props', 'prop_offers', 'push_subscriptions', 'notifications', 'reports', 'visits', 'blocks']) {
  await expectBlocked(`anon reads ${t}`, null, `select * from public.${t} limit 5`);
  await expectBlocked(`stranger reads ${t}`, U.stranger, `select * from public.${t} limit 5`);
}
await expectBlocked('stranger reads invite codes', U.stranger, `select username, invite_code from public.profiles where invite_code is not null`);

console.log('\n== Friends-only poll, as a stranger / signed-out');
await expectBlocked('get_poll question (stranger)', U.stranger, `select question, options from get_poll($1) where not locked`, [CP]);
await expectBlocked('get_poll question (anon)', null, `select question, options from get_poll($1) where not locked`, [CP]);
await expectBlocked('feed shows it (stranger)', U.stranger, `select question from get_feed('new') where id=$1 and not locked`, [CP]);
// get_comments answers with can_read false (and no comments) rather than an error.
await expectBlocked('comments (stranger)', U.stranger, `select get_comments($1) c`, [CP], (rows) => rows.every((r) => r.c?.can_read === false && !(r.c.comments ?? []).length));
await expectBlocked('who picked what (stranger)', U.stranger, `select * from circle_picks($1)`, [CP]);
await expectBlocked('friends voted (stranger)', U.stranger, `select friends_voted($1)->'people'`, [CP]);
await expectBlocked('vote (stranger)', U.stranger, `select * from cast_vote($1,$2)`, [CP, cpo]);
await expectBlocked('comment (stranger)', U.stranger, `select post_comment($1,'hi')`, [CP]);
await expectBlocked('profile_polls shows it', U.stranger, `select * from profile_polls($1) where id=$2`, [name('owner'), CP]);

console.log('\n== Voting tricks');
await expectBlocked('vote with an option from another poll', U.stranger, `select * from cast_vote($1,$2)`, [PP, cpo]);
await expectOk('vote once', U.stranger, `select vote_count from cast_vote($1,$2)`, [PP, ppo]);
await expectBlocked('vote twice', U.stranger, `select vote_count from cast_vote($1,$2) where vote_count > 1`, [PP, ppo]);
await expectBlocked('signed-out vote', null, `select * from cast_vote($1,$2)`, [PP, ppo]);

console.log("\n== Changing other people's things");
await expectBlocked('delete their poll', U.stranger, `select delete_poll($1)`, [PP]);
await expectBlocked('make their poll public', U.stranger, `select set_poll_visibility($1,'public')`, [CP]);
await expectBlocked("delete friend's comment (stranger)", U.stranger, `select delete_comment($1)`, [CMT]);
await expectBlocked('rename their list', U.stranger, `select rename_group($1,'hacked')`, [grp]);
await expectBlocked('add self to their list', U.stranger, `select set_group_member($1,$2,true)`, [grp, name('stranger')]);
// delete_group deletes nothing that isn't yours, without an error: blocked if the list is still there.
await expectBlocked('delete their list', U.stranger, `select delete_group($1)`, [grp], async () => (await q(`select 1 from circle_groups where id=$1 and name='Family'`, [grp])).length === 1);
await expectBlocked('remove their friend', U.stranger, `select remove_from_circle($1)`, [name('friend')]);
console.log('  (lists still intact:', (await q(`select name from circle_groups where id=$1`, [grp]))[0]?.name, ')');

console.log('\n== Invites');
await expectBlocked('accept invite with wrong code', U.stranger, `select accept_invite($1,'000000000000')`, [name('owner')]);

console.log('\n== Snaps');
await expectBlocked('stranger sees friends-only snap info', U.stranger, `select photo_path from snap_info(array[$1]::uuid[]) where photo_path is not null and photo_status = 'live'`, [SNAP]);
await expectBlocked('stranger can load the photo', U.stranger, `select snap_photo_visible($1) v`, [`${U.owner}/s.webp`]);
await expectBlocked('snap_for_check of someone else', U.stranger, `select * from snap_for_check($1)`, [SNAP]);
await expectBlocked('set verdict without secret', U.stranger, `select set_snap_verdict($1,'live','{}','guess')`, [SNAP]);
await expectBlocked('upload into their folder (storage policy check)', U.stranger, `select (storage.foldername($1))[1] = auth.uid()::text v`, [`${U.owner}/x.webp`]);

console.log('\n== Admin');
for (const [l, s, p] of [['admin_reports', `select * from admin_reports('open')`], ['admin_metrics', `select admin_metrics(7)`], ['admin_snaps', `select * from admin_snaps()`], ['admin_act ban', `select admin_act('user',$1,'ban')`, [U.owner]], ['admin_decide_snap', `select admin_decide_snap($1,true)`, [SNAP]], ['admin_schedule_poll', `select admin_schedule_poll(current_date + 9,'x?',array['a','b'],'classic',null,1,null)`], ['admin_log', `select * from admin_log(10)`]]) {
  await expectBlocked(`${l} as user`, U.stranger, s, p);
  await expectBlocked(`${l} signed-out`, null, s, p);
}
await expectBlocked('is_admin_user probe (anon)', null, `select is_admin_user($1) v`, [U.admin]);

console.log('\n== Push & secrets');
await expectBlocked('push_collect without secret', null, `select * from push_collect('guess', 10)`);
await expectBlocked('push_test_targets without secret', null, `select * from push_test_targets('guess',$1)`, [U.owner]);
await expectBlocked('register non-push endpoint', U.stranger, `select save_push_subscription('https://evil.example.com/hook','k','a') v`, [], (rows) => false);

console.log('\n== Guests (signed in anonymously)');
const G = '00000009-0000-0000-0000-000000000000';
await q(`insert into auth.users(id, email, is_anonymous) values ($1, null, true)`, [G]);
await expectBlocked('guest creates poll', G, `select create_poll('Guest poll?', array['a','b'], 1)`, [], undefined);
await expectBlocked('guest comments', G, `select post_comment($1,'hi')`, [PP]);
await expectBlocked('guest sends friend request', G, `select request_circle($1)`, [name('owner')]);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
