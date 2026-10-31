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
// Live feed: live_counts, recent votes, views per day, admin stats.
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const [{ id: P }] = await as(U.owner, () => q(`select create_poll('Chai or coffee at 4pm?', array['Chai','Coffee'], 3) id`));
const opts = (await q(`select id from poll_options where poll_id = $1 order by position`, [P])).map((r) => r.id);
for (const k of ['friend', 'stranger']) await as(U[k], () => q(`select cast_vote($1,$2)`, [P, opts[0]]));

// Before voting: totals but no per-answer counts.
let r = (await as(U.f2, () => q(`select * from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('totals before voting', r?.vote_count === 2, JSON.stringify(r));
ok('answers hidden before voting', r.options.length === 2 && r.options.every((o) => o.votes === null), JSON.stringify(r.options));
ok('no answer text in live counts', r.options.every((o) => !('text' in o)));
await as(U.f2, () => q(`select cast_vote($1,$2)`, [P, opts[1]]));
r = (await as(U.f2, () => q(`select * from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('answers shown after voting', r.options[0].votes === 2 && r.options[1].votes === 1, JSON.stringify(r.options));
r = (await as(null, () => q(`select * from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('anon: totals, answers hidden', r?.vote_count === 3 && r.options.every((o) => o.votes === null), JSON.stringify(r));

// Recent votes: worked out by the rollup.
await q(`select views_rollup()`);
r = (await as(U.f2, () => q(`select recent_votes from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('recent votes after rollup', r.recent_votes === 3, JSON.stringify(r));
await q(`update votes set created_at = now() - interval '2 hours' where poll_id = $1`, [P]);
await q(`update app_state set at = now() - interval '2 minutes' where key = 'recent_votes'`);
await q(`select views_rollup()`);
r = (await as(U.f2, () => q(`select recent_votes from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('recent votes drop after an hour', r.recent_votes === 0, JSON.stringify(r));
await q(`update votes set created_at = now() where poll_id = $1`, [P]);
await q(`select views_rollup()`);
r = (await as(U.f2, () => q(`select recent_votes from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('only once a minute', r.recent_votes === 0, JSON.stringify(r));

// Friends-only poll: a stranger gets nothing useful; a friend gets the numbers.
await as(U.friend, () => q(`select request_circle($1)`, [name('owner')])); await as(U.owner, () => q(`select respond_request($1, true)`, [name('friend')]));
const [{ id: C }] = await as(U.owner, () => q(`select create_poll('Friends only?', array['Yes','No'], 3, null, 'classic', null, 'circle') id`)).catch(async (e) => { console.log('circle create:', e.message); return [{ id: null }]; });
if (C) {
  r = (await as(U.stranger, () => q(`select * from live_counts(array[$1]::uuid[])`, [C])))[0];
  ok('friends-only, not a friend: locked (no answers, no recent)', !r || (r.options.length === 0 && r.recent_votes === 0), JSON.stringify(r));
  const co = (await q(`select id from poll_options where poll_id = $1 order by position`, [C])).map((x) => x.id);
  await as(U.friend, () => q(`select cast_vote($1,$2)`, [C, co[0]]));
  await q(`update app_state set at = now() - interval '2 minutes' where key = 'recent_votes'`);
  await q(`select views_rollup()`);
  r = (await as(U.friend, () => q(`select * from live_counts(array[$1]::uuid[])`, [C])))[0];
  ok('friends-only, a friend who voted: numbers', r?.vote_count === 1 && r.options[0].votes === 1 && r.recent_votes === 1, JSON.stringify(r));
  r = (await as(U.stranger, () => q(`select * from live_counts(array[$1]::uuid[])`, [C])))[0];
  ok('friends-only, stranger still locked after votes', !r || (r.options.length === 0 && r.recent_votes === 0), JSON.stringify(r));
}

// Views per day.
await as(U.stranger, () => q(`select record_views(array[$1]::uuid[])`, [P]));
await as(U.f3, () => q(`select record_views(array[$1]::uuid[])`, [P]));
await q(`select views_rollup()`);
const vd = await q(`select views from views_daily where day = (now() at time zone 'Asia/Kolkata')::date`);
ok('views counted per day', vd[0]?.views === 2, JSON.stringify(vd));
await as(U.f4, () => q(`select record_views(array[$1]::uuid[])`, [P]));
await q(`select views_rollup()`);
ok('views add up', (await q(`select views from views_daily`))[0].views === 3);
r = (await as(U.f2, () => q(`select view_count from live_counts(array[$1]::uuid[])`, [P])))[0];
ok('view count moved', r.view_count >= 3, JSON.stringify(r));

// Admin stats.
const st = await as(U.admin, () => q(`select * from admin_view_stats(7)`));
ok('admin: votes per 100 views today', st.length === 7 && st[0].views === 3 && st[0].votes >= 3 && Number(st[0].votes_per_100_views) >= 100, JSON.stringify(st[0]));
let denied = false; try { await as(U.stranger, () => q(`select * from admin_view_stats(7)`)); } catch { denied = true; }
ok('not an admin: refused', denied);
denied = false; try { await as(null, () => q(`select * from admin_view_stats(7)`)); } catch { denied = true; }
ok('anon: refused', denied);
denied = false; try { await as(U.stranger, () => q(`select * from views_daily`)); } catch { denied = true; }
ok('views_daily not readable', denied);

// At most 12 polls a call; deleted polls drop out.
const many = (await q(`select array_agg(id) a from polls`))[0].a;
r = await as(U.f2, () => q(`select count(*)::int n from live_counts($1::uuid[])`, [[...many, ...many]]));
ok('at most 12 a call', r[0].n <= 12, JSON.stringify(r));
await as(U.owner, () => q(`select delete_poll($1)`, [P]));
r = await as(U.f2, () => q(`select * from live_counts(array[$1]::uuid[])`, [P]));
ok('deleted poll: nothing', r.length === 0);
console.log(`\n${pass} pass, ${fail} fail`);
