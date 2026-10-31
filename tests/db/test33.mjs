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
await q(`insert into push_config(secret_hash) values (encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
for (const k of ['friend', 'f2', 'f3', 'f4']) { await as(U[k], () => q(`select request_circle($1)`, [name('owner')])); await as(U.owner, () => q(`select respond_request($1, true)`, [name(k)])); }
const [{ id: PP }] = await as(U.owner, () => q(`select create_poll('Public question here?', array['Yes','No'], 3) id`));
const [{ id: CP }] = await as(U.owner, () => q(`select create_poll('Secret plan for the trip?', array['Goa','Manali'], 3, null, 'classic', null, 'circle') id`));
const [{ id: P2 }] = await as(U.f2, () => q(`select create_poll('Another public one?', array['A','B'], 3) id`));
const views = async (id) => (await q(`select view_count from polls where id = $1`, [id]))[0].view_count;
const buffer = async () => (await q(`select count(*)::int n from view_buffer`))[0].n;
// Make rollups only happen when we say so.
const noAuto = () => q(`insert into app_state(key, at) values ('views_rollup', now() + interval '1 hour') on conflict (key) do update set at = excluded.at`);
const rollup = () => q(`select views_rollup()`);
await noAuto();

await as(U.friend, () => q(`select record_views($1)`, [[PP]]));
ok('buffered, not counted yet', (await views(PP)) === 0 && (await buffer()) === 1);
await rollup();
ok('counted after rollup', (await views(PP)) === 1);
ok('buffer emptied', (await buffer()) === 0);
await as(U.friend, () => q(`select record_views($1)`, [[PP, PP]]));
await rollup();
ok('same person again: still 1', (await views(PP)) === 1);
await as(U.owner, () => q(`select record_views($1)`, [[PP]]));
await rollup();
ok("creator's own view not counted", (await views(PP)) === 1);
await as(U.stranger, () => q(`select record_views($1)`, [[CP]]));
await as(U.friend, () => q(`select record_views($1)`, [[CP]]));
await rollup();
ok('friends-only poll: only the friend counts', (await views(CP)) === 1, String(await views(CP)));

// Signed out, through the server route's secret
await q(`select record_views_anon('s3cret', 'visitor-a', $1)`, [[PP]]);
await q(`select record_views_anon('s3cret', 'visitor-a', $1)`, [[PP]]);
await q(`select record_views_anon('s3cret', 'visitor-b', $1)`, [[PP, CP]]);
await rollup();
ok('signed-out visitors counted once each', (await views(PP)) === 3, String(await views(PP)));
ok('signed-out view of a friends-only poll ignored', (await views(CP)) === 1);
try { await as(null, () => q(`select record_views_anon('guess', 'x', $1)`, [[PP]])); ok('wrong secret refused', false); } catch (e) { ok('wrong secret refused', /forbidden/.test(e.message)); }
try { await as(null, () => q(`select record_views($1)`, [[PP]])); ok('signed-out direct call refused', false); } catch (e) { ok('signed-out direct call refused', /permission denied/.test(e.message)); }

// Batches are capped at 50
const many = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
await as(U.friend, () => q(`select record_views($1)`, [many]));
ok('a batch keeps at most 50', (await buffer()) === 50, String(await buffer()));
await rollup();
ok('unknown polls dropped by the rollup', (await buffer()) === 0 && (await q(`select count(*)::int n from poll_viewers where poll_id::text like '00000000-%'`))[0].n === 0);

// Never fewer views than votes, in what the app gets
const o = (await q(`select id from poll_options where poll_id=$1 and position=0`, [P2]))[0].id;
for (const k of ['friend', 'stranger', 'owner']) await as(U[k], () => q(`select cast_vote($1,$2)`, [P2, o]));
const card = (await as(U.f3, () => q(`select view_count, vote_count from get_poll($1)`, [P2])))[0];
ok('get_poll: views never below votes', card.view_count === 3 && card.vote_count === 3, JSON.stringify(card));
const feed = await as(U.f3, () => q(`select id, view_count from get_feed('new')`));
ok('get_feed has view_count', feed.length > 0 && feed.every((r) => typeof r.view_count === 'number'), JSON.stringify(feed));
const mineRows = await as(U.owner, () => q(`select id, view_count from my_polls('mine')`));
ok('my_polls has view_count', mineRows.some((r) => r.id === PP && r.view_count === 3), JSON.stringify(mineRows));
const prof = await as(null, () => q(`select id, view_count from profile_polls($1)`, [name('owner')]));
ok('profile_polls has view_count (signed out)', prof.some((r) => r.id === PP && r.view_count === 3), JSON.stringify(prof));

// Deleted polls and closed-long-ago polls don't take views
await q(`update polls set deleted_at = now() where id = $1`, [P2]);
await as(U.f4, () => q(`select record_views($1)`, [[P2]]));
await rollup();
ok('deleted poll ignored', (await q(`select count(*)::int n from poll_viewers where poll_id = $1 and viewer = hashtextextended($2::text, 0)`, [P2, U.f4]))[0].n === 0);

// Without pg_cron: the next viewer triggers the count once 10 seconds have passed
await q(`update app_state set at = now() - interval '11 seconds' where key = 'views_rollup'`);
await as(U.f3, () => q(`select record_views($1)`, [[PP]]));
ok('auto rollup when due', (await views(PP)) === 4 && (await buffer()) === 0, String(await views(PP)));
await as(U.f4, () => q(`select record_views($1)`, [[PP]]));
ok('no rollup again within 10 seconds', (await buffer()) === 1);
await rollup();

// Cleanup: viewers of polls closed over a day ago are forgotten; totals stay
await q(`update polls set created_at = now() - interval '5 days', closes_at = now() - interval '2 days' where id = $1`, [PP]);
await q(`delete from app_state where key = 'views_cleanup'`);
await rollup();
ok('old viewer rows deleted, total kept', (await q(`select count(*)::int n from poll_viewers where poll_id = $1`, [PP]))[0].n === 0 && (await views(PP)) === 5, String(await views(PP)));

// Load: 100k views in the buffer (2,000 people × 50 polls, with repeats) in one run
const ids = [];
for (let i = 0; i < 50; i++) ids.push((await q(`insert into polls (creator_id, question, closes_at) values ($1, $2, now() + interval '3 days') returning id`, [U.f3, `Load test poll number ${i}?`]))[0].id);
await q(`update profiles set created_at = now() - interval '3 days'`);
await q(`insert into view_buffer (poll_id, anon_key) select p, (g % 2000) from unnest($1::uuid[]) p, generate_series(1, 2000) g`, [ids]);
await q(`insert into view_buffer (poll_id, anon_key) select p, (g % 2000) from unnest($1::uuid[]) p, generate_series(1, 2000) g`, [ids]);
const t0 = Date.now();
await rollup();
const ms = Date.now() - t0;
const totals = await q(`select min(view_count) a, max(view_count) b from polls where id = any($1)`, [ids]);
ok(`200k buffered views (100k unique) counted in one run (${ms} ms in this in-memory test db)`, totals[0].a === 2000 && totals[0].b === 2000, JSON.stringify(totals));
console.log(`\n${pass} pass, ${fail} fail`);
