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

// ── Fresh drafts: refresh runs, expiry, ages, model ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const J = async (sql, p) => (await anon(() => q(sql, p)))[0]?.r;
const A = async (sql, p) => (await as(U.admin, () => q(sql, p)))[0]?.r;
const code = async (fn) => { const e = await err(fn); return e ? (e.match(/docchi:(\w+)/)?.[1] ?? e) : 'ok'; };
const exists = async (sig) => (await q(`select to_regprocedure($1) is not null a`, ['public.' + sig]))[0].a;
await q(`update profiles set username = 'boss' where id = $1`, [U.admin]);
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/admin', $1, 'k', 'a')`, [U.admin]);

ok('old agent_save (5 args) gone, new one there', !(await exists('agent_save(text,bigint,jsonb,jsonb,text)')) && await exists('agent_save(text,bigint,jsonb,jsonb,text,text)'));
ok('old agent_start(text) gone, agent_start(text, timestamptz) there', !(await exists('agent_start(text)')) && await exists('agent_start(text,timestamptz)'));
ok('old admin_agent_settings (6 args) gone', !(await exists('admin_agent_settings(boolean,integer,integer,text,integer,text[])')));
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;
ok('agent_start / agent_save: open to the job only via the secret', await priv('anon', 'agent_start(text,timestamptz)') && await priv('anon', 'agent_save(text,bigint,jsonb,jsonb,text,text)'));
ok('admin_agent_settings: closed to anon', !(await priv('anon', 'admin_agent_settings(boolean,integer,integer,text,integer,text[],boolean,boolean,integer,integer,integer,integer,text[])')));
ok('agent_start with a time: wrong secret refused', (await code(() => J(`select public.agent_start('nope', now()) r`))) === 'bad_secret');

// Settings
let S0 = (await A(`select public.admin_drafts() r`)).settings;
ok('defaults: refresh 1 pm and 6 pm on, 3 a refresh, timely drafts 12 hours', S0.refresh_1pm === true && S0.refresh_6pm === true && S0.refresh_drafts === 3 && S0.timely_hours === 12, JSON.stringify(S0));
ok('refresh drafts 6: out of range', (await code(() => A(`select public.admin_agent_settings(refresh_drafts => 6) r`))) === 'out_of_range');
ok('timely 1 hour: out of range', (await code(() => A(`select public.admin_agent_settings(timely_hours => 1) r`))) === 'out_of_range');
ok('not the admin refused', (await code(() => as(U.owner, () => q(`select public.admin_agent_settings(refresh_1pm => false)`)))) === 'not_admin');
const set1 = await A(`select public.admin_agent_settings(timely_hours => 12) r`);
ok('saving logs the refresh settings', set1.timely_hours === 12 && /refresh 1 pm \+ 6 pm \(3\), timely 12h/.test((await q(`select detail from public.admin_events where action = 'agent' order by at desc limit 1`))[0].detail));

// Slots, at chosen India times
const at = (d, hm) => `${d}T${hm}:00+05:30`;
const start = (d, hm) => J(`select public.agent_start($1, $2::timestamptz) r`, [SECRET, at(d, hm)]);
const save = (ctx, drafts = [], trends = [], model = 'gpt-4.1') => J(`select public.agent_save($1, $2, $3, $4, null, $5) r`, [SECRET, ctx.run_id, JSON.stringify(drafts), JSON.stringify(trends), model]);
const D1 = '2026-11-02';
ok('6:00 am: nothing due', (await start(D1, '06:00')) === null);
let c = await start(D1, '06:40');
ok('6:40 am: the morning set (full, 8 drafts wanted)', c?.slot === 'morning' && c.kind === 'full' && c.drafts_wanted === 8, JSON.stringify(c && { slot: c.slot, kind: c.kind, n: c.drafts_wanted }));
const tr = (title, extra = {}) => ({ source: 'News', title, url: 'https://news.example/' + encodeURIComponent(title), idea_question: 'Idea for ' + title + '?', idea_answers: ['A', 'B'], topic: 'news', feel: 'debate', timely: true, lang: 'en', skip_reason: null, ...extra });
const future = new Date(Date.now() + 3 * 864e5).toISOString();
let r1 = await save(c, [{ question: 'Morning timely poll?', answers: ['Yes', 'No'], timely: true, slot: 'timely', source_at: new Date(Date.now() - 2 * 3600e3).toISOString() }, { question: 'Morning evergreen poll?', answers: ['Yes', 'No'], timely: false, slot: 'best' }],
  [tr('Diwali sweets recipe', { published_at: new Date(Date.now() - 3 * 3600e3).toISOString() }), tr('ജയിലര് 2', { region: 'Kerala', gloss: 'Jailer 2 trailer', published_at: future })]);
ok('morning push: "✍️ 2 drafts ready"', r1.alert?.title === '✍️ 2 drafts ready', JSON.stringify(r1.alert));
const md = await q(`select question, timely, expires_at, source_at, extract(epoch from expires_at - created_at) / 3600 as h from public.content_drafts order by question`);
const mt = md.find((x) => x.question === 'Morning timely poll?'), me = md.find((x) => x.question === 'Morning evergreen poll?');
ok('timely draft expires 12 hours after it was written; evergreen has no expiry', Math.round(Number(mt.h)) === 12 && me.expires_at === null, JSON.stringify(md));
ok('draft keeps its headline time', mt.source_at !== null);
const trs = await q(`select title, published_at, region, gloss, published_at <= now() as past from public.content_trends order by id`);
ok('trend: region and English gloss kept', trs[1].region === 'Kerala' && trs[1].gloss === 'Jailer 2 trailer');
ok('trend: a headline time in the future is capped at now', trs[1].past === true && trs[0].published_at !== null);
ok('run records the model', (await q(`select model, slot from public.agent_runs where id = $1`, [c.run_id]))[0].model === 'gpt-4.1');
ok('7:00 am: nothing more', (await start(D1, '07:00')) === null);
c = await start(D1, '13:10');
ok('1:10 pm: the 1 pm refresh, 3 drafts wanted, knows the morning headlines', c?.slot === '13' && c.kind === 'refresh' && c.drafts_wanted === 3 && c.seen_today.includes('diwali sweets recipe'), JSON.stringify(c && { slot: c.slot, n: c.drafts_wanted, seen: c.seen_today }));
let r2 = await save(c, [{ question: 'Fresh one?', answers: ['A', 'B'], timely: true, slot: 'timely' }, { question: 'Fresh two?', answers: ['A', 'B'], timely: true, slot: 'trend' }], [tr('Toss won by India')], 'sarvam-105b-conversations');
ok('refresh push: "🆕 2 fresh drafts"', r2.alert?.title === '🆕 2 fresh drafts', JSON.stringify(r2.alert));
ok('a refresh written by Sarvam says so', (await q(`select model from public.agent_runs where id = $1`, [c.run_id]))[0].model === 'sarvam-105b-conversations');
ok('2:00 pm: nothing more', (await start(D1, '14:00')) === null);
c = await start(D1, '18:05');
ok('6:05 pm: the 6 pm refresh', c?.slot === '18');
const r3 = await save(c, [], []);
ok('a refresh with nothing new: no push', r3.alert === null && r3.drafts === 0);
ok('7:00 pm: nothing more today', (await start(D1, '19:00')) === null);
// Next day, first run at 1:30 pm: the morning set first, then the 1 pm refresh
const D2 = '2026-11-03';
c = await start(D2, '13:30');
ok('next day, first look at 1:30 pm: the morning set comes first', c?.slot === 'morning');
await save(c);
c = await start(D2, '13:31');
ok('then the 1 pm refresh', c?.slot === '13');
await save(c);
// A day where the first look is 7 pm: morning, then only the 6 pm refresh (not 1 pm too)
const D3 = '2026-11-04';
c = await start(D3, '19:00'); await save(c);
c = await start(D3, '19:01');
ok('first look at 7 pm: morning, then only the 6 pm refresh', c?.slot === '18');
await save(c);
ok('and not the 1 pm one afterwards', (await start(D3, '19:30')) === null);
// 1 pm refresh off
const D4 = '2026-11-05';
await A(`select public.admin_agent_settings(refresh_1pm => false, refresh_drafts => 2) r`);
c = await start(D4, '07:00'); await save(c);
ok('1 pm refresh off: nothing at 1:10 pm', (await start(D4, '13:10')) === null);
c = await start(D4, '18:10');
ok('6 pm still on, now 2 drafts a refresh', c?.slot === '18' && c.drafts_wanted === 2);
await save(c);
// Paused: no automatic runs, "Write drafts now" still works
await A(`select public.admin_agent_settings(paused => true) r`);
ok('paused: no morning run', (await start('2026-11-06', '07:00')) === null);
await A(`select public.admin_agent_request() r`);
c = await start('2026-11-06', '07:00');
ok('paused, asked: a full manual run', c?.slot === 'manual' && c.kind === 'full');
await save(c);
await A(`select public.admin_agent_settings(paused => false, refresh_1pm => true) r`);
ok('after a manual run that day: no extra morning run', (await start('2026-11-06', '07:30')) === null);

// Expiry
await q(`update public.content_drafts set expires_at = now() - interval '1 minute' where question = 'Morning timely poll?'`);
await J(`select public.post_due_drafts($1) r`, [SECRET]);
ok('a timely draft past its time expires; others stay', (await q(`select status from public.content_drafts where question = 'Morning timely poll?'`))[0].status === 'expired' && (await q(`select status from public.content_drafts where question = 'Morning evergreen poll?'`))[0].status === 'new');
const AD = await A(`select public.admin_drafts() r`);
ok('Drafts shows today\'s expired one', AD.expired_today.some((x) => x.question === 'Morning timely poll?'), JSON.stringify(AD.expired_today));
const fr = AD.new.find((x) => x.question === 'Fresh one?');
ok('a draft says which run (1 pm) and model wrote it, and when it expires', fr?.run_slot === '13' && fr.run_model === 'sarvam-105b-conversations' && fr.expires_at, JSON.stringify(fr));
ok('last run: slot and model', AD.last_run.slot === 'manual' && AD.last_run.model === 'gpt-4.1');

// Trending now: every run that day
await q(`update public.agent_runs set day = '2026-11-02'::date + 10 where day = '2026-11-02'`); // leave the latest day alone
const T = await A(`select public.admin_trends() r`);
ok('trends: from the latest day with headlines', Array.isArray(T.items));
// Put trends on the latest day's runs and check both slots show
await q(`update public.agent_runs set day = '2026-11-02' where day = '2026-11-12'`);
const runs = (await q(`select id, slot from public.agent_runs where day = '2026-11-02' order by started_at`)).map((r) => r.id);
await q(`update public.agent_runs set started_at = now() + interval '1 hour' where id = $1`, [runs[runs.length - 1]]);
await q(`insert into public.content_trends (run_id, source, title) values ($1, 'News', 'A 6 pm story')`, [runs[runs.length - 1]]);
await q(`update public.agent_runs set trends = 1 where id = $1`, [runs[runs.length - 1]]);
const T2 = await A(`select public.admin_trends() r`);
const slots = new Set(T2.items.map((t) => t.run_slot));
ok('trends: morning and refresh headlines together, each with its run', slots.has('morning') && slots.has('13') && slots.has('18'), JSON.stringify([...slots]));
const kerala = T2.items.find((t) => t.gloss === 'Jailer 2 trailer');
ok('trends: age, region and gloss shown', kerala && kerala.region === 'Kerala' && kerala.published_at, JSON.stringify(kerala));
// The same story read by two runs that day: listed once, as first read
await q(`insert into public.content_trends (run_id, source, title) values ($1, 'News', 'Diwali sweets recipe')`, [runs[runs.length - 1]]);
const T3 = await A(`select public.admin_trends() r`);
const dup = T3.items.filter((t) => t.title === 'Diwali sweets recipe');
ok('a story read twice in a day is listed once, as first read (morning)', dup.length === 1 && dup[0].run_slot === 'morning', JSON.stringify(dup.map((d) => d.run_slot)));
// A trend drafted: timely → expires
const tid = T2.items.find((t) => t.title === 'Diwali sweets recipe').id;
const did = await A(`select public.admin_draft_from_trend($1) r`, [tid]);
const dd = (await q(`select expires_at is not null e, source_at is not null s from public.content_drafts where id = $1`, [did]))[0];
ok('a timely trend drafted by hand also expires and keeps its headline time', dd.e && dd.s);

await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261212000000_fresh_drafts.sql`, 'utf8'));
ok('migration runs twice; settings kept', (await q(`select refresh_drafts from public.agent_settings`))[0].refresh_drafts === 2);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
