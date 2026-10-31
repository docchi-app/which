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


// ── Brain breaks ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const J = async (sql, p) => (await anon(() => q(sql, p)))[0]?.r;
const A = async (sql, p) => (await as(U.admin, () => q(sql, p)))[0]?.r;
const As = async (who, sql, p) => (await as(U[who], () => q(sql, p)))[0]?.r;
const code = async (fn) => { const e = await err(fn); return e ? (e.match(/docchi:(\w+)/)?.[1] ?? e) : 'ok'; };
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;
const exists = async (sig) => (await q(`select to_regprocedure($1) is not null a`, ['public.' + sig]))[0].a;
await q(`update profiles set username = 'boss' where id = $1`, [U.admin]);
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/admin', $1, 'k', 'a')`, [U.admin]);

// Access
ok('brain_answers / brain_flags: no direct access for anyone', !(await q(`select has_table_privilege('anon', 'public.brain_answers', 'select') a`))[0].a
  && !(await q(`select has_table_privilege('authenticated', 'public.brain_answers', 'select') a`))[0].a
  && !(await q(`select has_table_privilege('authenticated', 'public.brain_flags', 'insert') a`))[0].a);
ok('brain_reveal open to guests and people; brain_flag / my_brain_score only signed in', await priv('anon', 'brain_reveal(uuid,uuid)') && await priv('authenticated', 'brain_reveal(uuid,uuid)')
  && !(await priv('anon', 'brain_flag(uuid)')) && await priv('authenticated', 'brain_flag(uuid)') && !(await priv('anon', 'my_brain_score()')));
ok('helpers closed: brain_right_pct, brain_day', !(await priv('authenticated', 'brain_right_pct(uuid)')) && !(await priv('anon', 'brain_day(date,integer)')));
ok('old admin_agent_settings (10 args) and admin_draft_save (12 args) gone', !(await exists('admin_agent_settings(boolean,integer,integer,text,integer,text[],boolean,boolean,integer,integer)'))
  && !(await exists('admin_draft_save(uuid,text,text[],text,text,boolean,text,text,timestamptz,integer,boolean,boolean)')));
ok('new ones closed to anon', !(await priv('anon', 'admin_agent_settings(boolean,integer,integer,text,integer,text[],boolean,boolean,integer,integer,integer,integer,text[])'))
  && !(await priv('anon', 'admin_draft_save(uuid,text,text[],text,text,boolean,text,text,timestamptz,integer,boolean,boolean,integer,text)')));

// Days
const days = async (n) => (await q(`select array_agg(extract(isodow from d)::int order by d) a from generate_series('2026-11-02'::date, '2026-11-08'::date, '1 day') d where public.brain_day(d::date, $1)`, [n]))[0].a ?? [];
ok('3 a week: Mon, Wed, Fri', JSON.stringify(await days(3)) === '[1,3,5]');
ok('7 a week: every day; 0: none; 1: Wed', (await days(7)).length === 7 && (await days(0)).length === 0 && JSON.stringify(await days(1)) === '[3]');

// Settings
let S0 = (await A(`select public.admin_drafts() r`)).settings;
ok('defaults: 3 a week at 1 pm, all kinds on', S0.brain_per_week === 3 && S0.brain_hour === 13 && S0.brain_sorts_off.length === 0, JSON.stringify(S0));
ok('8 a week: out of range', (await code(() => A(`select public.admin_agent_settings(brain_per_week => 8) r`))) === 'out_of_range');
ok('hour 23: out of range', (await code(() => A(`select public.admin_agent_settings(brain_hour => 23) r`))) === 'out_of_range');
ok('unknown kind: out of range', (await code(() => A(`select public.admin_agent_settings(brain_sorts_off => array['riddle']) r`))) === 'out_of_range');
ok('not the admin refused', (await code(() => As('owner', `select public.admin_agent_settings(brain_per_week => 7) r`))) === 'not_admin');
const set1 = await A(`select public.admin_agent_settings(brain_sorts_off => array['guess']) r`);
ok('saved and logged', set1.brain_sorts_off[0] === 'guess' && /Brain breaks 3\/week at 13:00 \(off: guess\)/.test((await q(`select detail from public.admin_events where action = 'agent' order by at desc limit 1`))[0].detail));

// The agent asks on its days
const at = (d, hm) => `${d}T${hm}:00+05:30`;
const start = (d, hm) => J(`select public.agent_start($1, $2::timestamptz) r`, [SECRET, at(d, hm)]);
const save = (ctx, drafts = []) => J(`select public.agent_save($1, $2, $3, '[]'::jsonb, null, 'gpt-4.1') r`, [SECRET, ctx.run_id, JSON.stringify(drafts)]);
let c = await start('2026-11-03', '06:40');
ok('Tuesday morning: no Brain break wanted', c?.brain?.wanted === 0, JSON.stringify(c?.brain));
await save(c, []);
c = await start('2026-11-02', '06:40');
ok('Monday morning: one wanted, at 1 pm, kinds without the one turned off', c?.brain?.wanted === 1 && c.brain.hour === 13 && c.brain.sorts.length === 7 && !c.brain.sorts.includes('guess'), JSON.stringify(c?.brain));
const pub = new Date(Date.now() + 3 * 3600e3).toISOString();
const bd = (extra) => ({ question: 'Kitne months mein 28 days hote hain? 🤔', answers: ['Sirf 1 (Feb)', 'All 12'], topic: 'fun', feel: 'quiz', timely: false, lang: 'hinglish', slot: 'brain',
  brain_sort: 'twister', correct: 1, explain: 'Every month has at least 28 days. Feb just stops there.', checked: true, publish_at: pub, post_as: 'eithr', ...extra });
const r1 = await save(c, [
  bd(),
  bd({ question: 'India ka sabse purana zinda shehar?', answers: ['Varanasi', 'Madurai'], brain_sort: 'gk', correct: 0, checked: false, drop_reason: 'The two checks disagreed' }),
  bd({ question: 'Bad right answer?', correct: 3 }),
  bd({ question: 'No why?', explain: '' }),
  bd({ question: 'Bad kind?', brain_sort: 'riddle' }),
  bd({ question: 'Checked as text?', checked: 'yes' }),
  { question: 'A normal poll?', answers: ['Yes', 'No'], slot: 'best', publish_at: pub },
]);
const ds = await q(`select question, status, slot, brain_sort, correct, answer_why, checked, error, expires_at - publish_at as gap from public.content_drafts where run_id = $1 order by question`, [c.run_id]);
const dq = (s) => ds.find((d) => d.question.startsWith(s));
ok('a checked Brain break saved as new, with its answer and why', dq('Kitne')?.status === 'new' && dq('Kitne').correct === 1 && dq('Kitne').checked === true && /Feb just stops/.test(dq('Kitne').answer_why), JSON.stringify(dq('Kitne')));
ok('a Brain break the checks disagreed on: kept as skipped with the reason', dq('India')?.status === 'skipped' && dq('India').error === 'The two checks disagreed');
ok('a right answer that is not one of the answers, no why, or an unknown kind: dropped', !dq('Bad right') && !dq('No why') && !dq('Bad kind'));
ok('"checked" that is not true: not counted as checked', dq('Checked as text')?.status === 'skipped');
ok('a normal draft alongside still saved', dq('A normal')?.status === 'new' && dq('A normal').slot === 'best');
ok('the push counts only drafts to look at (2)', r1.alert?.title === '✍️ 2 drafts ready', JSON.stringify(r1.alert));
ok('an unapproved Brain break expires 5 hours after its time', dq('Kitne').gap?.hours === 5 || String(dq('Kitne').gap).includes('05:00'), JSON.stringify(dq('Kitne').gap));
c = await start('2026-11-02', '06:50');
ok('a second run that Monday: not wanted again (one is waiting)', c === null || c.brain?.wanted === 0);
if (c) await save(c, []);
const admin = await A(`select public.admin_drafts() r`);
const card = admin.new.find((d) => d.slot === 'brain');
ok('Admin sees the Brain break with kind, right answer, why and checked', card?.brain_sort === 'twister' && card.correct === 1 && /Feb/.test(card.explain) && card.checked === true, JSON.stringify(card));
ok('Admin sees today\'s dropped one with why', admin.brain_dropped.some((d) => /purana/.test(d.question) && d.error === 'The two checks disagreed'), JSON.stringify(admin.brain_dropped));

// Editing
const save2 = (correct, why) => A(`select public.admin_draft_save($1, $2, $3, 'fun', 'quiz', false, 'hinglish', 'eithr', $4::timestamptz, 1, false, false, $5, $6) r`,
  [card.id, card.question, ['Sirf 1 (Feb)', 'All 12'], pub, correct, why]);
ok('editing a Brain break: a right answer out of range refused', (await code(() => save2(2, 'Every month has 28 days.'))) === 'brain_answer');
ok('editing a Brain break: an empty why refused', (await code(() => save2(1, ''))) === 'brain_answer');
const e1 = await save2(1, 'Every month has at least 28 days 😅');
ok('editing a Brain break: saved', e1.correct === 1 && /😅/.test(e1.explain));
const normal = admin.new.find((d) => d.slot === 'best');
const e2 = await A(`select public.admin_draft_save($1, 'A normal poll?', array['Yes','No'], null, null, false, 'en', 'eithr', $2::timestamptz, 1, false, false, 0, 'ignored') r`, [normal.id, pub]);
ok('a normal draft never gets an answer', e2.correct === null && e2.explain === null);
const e3 = await A(`select public.admin_draft_save($1, 'A normal poll?', array['Yes','No'], null, null, false, 'en', 'eithr', $2::timestamptz, 1, false, false) r`, [normal.id, pub]);
ok('a normal draft saves without the new arguments', e3.question === 'A normal poll?');

// Posting
await A(`select public.admin_drafts_approve($1) r`, [[card.id]]);
await q(`update public.content_drafts set publish_at = now() - interval '1 minute' where id = $1`, [card.id]);
await J(`select public.post_due_drafts($1) r`, [SECRET]);
const posted = (await q(`select status, poll_id from public.content_drafts where id = $1`, [card.id]))[0];
const bp = (await q(`select id, kind, is_system from public.polls where id = $1`, [posted.poll_id]))[0];
ok('posted as a Brain break poll by Eithr', posted.status === 'posted' && bp?.kind === 'brain' && bp.is_system === true, JSON.stringify(posted));
const opts = await q(`select id, position from public.poll_options where poll_id = $1 order by position`, [bp.id]);
const ans = (await q(`select option_id, sort from public.brain_answers where poll_id = $1`, [bp.id]))[0];
ok('its answer stored: the second option ("All 12")', ans?.option_id === opts[1].id && ans.sort === 'twister');
ok('anon cannot read brain_answers directly', (await code(() => anon(() => q(`select * from public.brain_answers`)))) !== 'ok');

// Reveal
const reveal = (who, pick = null) => (who ? As(who, `select public.brain_reveal($1, $2) r`, [bp.id, pick]) : J(`select public.brain_reveal($1, $2) r`, [bp.id, pick]));
ok('before voting: no answer (signed in)', (await reveal('friend')) === null);
ok('before voting: no answer (guest)', (await reveal(null)) === null);
ok('a guest with a pick from another poll: no answer', (await reveal(null, '00000000-0000-4000-8000-00000000abcd')) === null);
const g = await reveal(null, opts[0].id);
ok('a guest with their pick: answer, why, and they got it wrong', g?.option_id === opts[1].id && g.right === false && /28 days/.test(g.why), JSON.stringify(g));
await q(`insert into public.votes (poll_id, user_id, option_id) values ($1, $2, $3), ($1, $4, $5), ($1, $6, $5)`, [bp.id, U.friend, opts[1].id, U.f2, opts[0].id, U.f3]);
const f = await reveal('friend');
ok('after voting right: right, 33% got it', f?.right === true && f.right_pct === 33 && f.flagged === false, JSON.stringify(f));
ok('after voting wrong: not right', (await reveal('f2'))?.right === false);
ok('the admin sees it without voting', (await reveal('admin'))?.option_id === opts[1].id);

// Flags and score
ok('flag before voting: refused', (await code(() => As('stranger', `select public.brain_flag($1) r`, [bp.id]))) === 'not_found');
await As('f2', `select public.brain_flag($1) r`, [bp.id]);
await As('f2', `select public.brain_flag($1) r`, [bp.id]);
ok('flag once per person', (await q(`select count(*)::int n from public.brain_flags where poll_id = $1`, [bp.id]))[0].n === 1);
ok('reveal shows I flagged it', (await reveal('f2'))?.flagged === true);
const normalPoll = (await q(`insert into public.polls (creator_id, question) values ($1, 'Plain?') returning id`, [U.stranger]))[0].id;
ok('flag on a normal poll: refused', (await code(() => As('f2', `select public.brain_flag($1) r`, [normalPoll]))) === 'not_found');
ok('reveal on a normal poll: null', (await As('f2', `select public.brain_reveal($1) r`, [normalPoll])) === null);
ok('my score: friend 1 right of 1, f2 0 of 1', JSON.stringify(await As('friend', `select public.my_brain_score() r`)) === '{"right":1,"tried":1}' && (await As('f2', `select public.my_brain_score() r`)).right === 0);
const a2 = await A(`select public.admin_drafts() r`);
ok('Admin: the last ones out with % right and flags', a2.brain_out[0]?.right_pct === 33 && a2.brain_out[0].flags === 1 && a2.brain_out[0].sort === 'twister', JSON.stringify(a2.brain_out));
ok('Admin: the posted draft shows % right', a2.posted.find((d) => d.id === card.id)?.right_pct === 33);
c = await start('2026-11-04', '06:40');
ok('Wednesday: the next one gets the last results to learn from', c?.brain?.wanted === 1 && c.brain.results[0]?.right_pct === 33 && c.brain.recent.length >= 1, JSON.stringify(c?.brain?.results));
await save(c, []);
c = await J(`select public.agent_start($1, $2::timestamptz) r`, [SECRET, at('2026-11-06', '12:30')]);
ok('Friday after 12 pm (1 pm is under an hour away): not wanted', !c || c.brain.wanted === 0);
if (c) await save(c, []);
await A(`select public.admin_agent_settings(brain_per_week => 0) r`);
await q(`delete from public.agent_runs`);
c = await start('2026-11-09', '06:40');
ok('0 a week: never wanted', c?.brain?.wanted === 0);
await save(c, []);

// Hiding the poll hides the answer
await q(`update public.polls set is_hidden = true where id = $1`, [bp.id]);
ok('a hidden poll: no answer', (await reveal('friend')) === null);

await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261214000000_brain_breaks.sql`, 'utf8'));
ok('migration runs twice; settings and answers kept', (await q(`select brain_per_week from public.agent_settings`))[0].brain_per_week === 0 && (await q(`select count(*)::int n from public.brain_answers`))[0].n === 1);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
