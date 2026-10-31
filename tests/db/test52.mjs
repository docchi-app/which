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

// ── The content agent: drafts, trends, calendar, posting ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const J = async (sql, p) => (await anon(() => q(sql, p)))[0]?.r;
const A = async (sql, p) => (await as(U.admin, () => q(sql, p)))[0]?.r;
const code = async (fn) => ((await err(fn)) ?? 'ok').match(/docchi:(\w+)/)?.[1] ?? (await err(fn)) ?? 'ok';
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;
await q(`update profiles set username = 'boss' where id = $1`, [U.admin]);
await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/admin', $1, 'k', 'a')`, [U.admin]);

// Grants
for (const f of ['agent_start(text,timestamptz)', 'agent_save(text,bigint,jsonb,jsonb,text,text)', 'post_due_drafts(text)'])
  ok(`${f}: open to the job (secret checked inside)`, await priv('anon', f));
for (const f of ['admin_drafts()', 'admin_draft_save(uuid,text,text[],text,text,boolean,text,text,timestamptz,integer,boolean,boolean,integer,text)', 'admin_drafts_approve(uuid[])',
  'admin_drafts_skip(uuid[])', 'admin_draft_unschedule(uuid)', 'admin_agent_settings(boolean,integer,integer,text,integer,text[],boolean,boolean,integer,integer,integer,integer,text[])', 'admin_agent_request()',
  'admin_trends()', 'admin_draft_from_trend(bigint)', 'admin_calendar_add(date,text)', 'admin_calendar_remove(bigint)'])
  ok(`${f.split('(')[0]}: closed to anon`, !(await priv('anon', f)));
for (const f of ['agent_make_poll(content_drafts,date)', 'agent_clean_answers(text[])', 'agent_posts_on(date,uuid)', 'agent_draft_json(content_drafts)', 'skip_quiet_poll_notice()', 'agent_clean_text(text)', 'agent_text_array(jsonb)'])
  ok(`${f}: internal`, !(await priv('authenticated', f)) && !(await priv('anon', f)));
for (const t of ['agent_settings', 'agent_runs', 'content_trends', 'content_calendar', 'content_drafts'])
  ok(`${t}: not readable by people`, /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.${t}`))) ?? ''));
ok('agent_start: wrong secret refused', (await code(() => J(`select public.agent_start('nope') r`))) === 'bad_secret');
ok('agent_save: wrong secret refused', (await code(() => J(`select public.agent_save('nope', 1, '[]', '[]') r`))) === 'bad_secret');
ok('post_due_drafts: wrong secret refused', (await code(() => J(`select public.post_due_drafts('nope') r`))) === 'bad_secret');
for (const [label, sql] of [['admin_drafts', `select public.admin_drafts() r`], ['admin_agent_request', `select public.admin_agent_request() r`], ['admin_trends', `select public.admin_trends() r`],
  ['admin_drafts_approve', `select public.admin_drafts_approve(array[gen_random_uuid()]) r`], ['admin_agent_settings', `select public.admin_agent_settings(true) r`]])
  ok(`${label}: not the admin refused`, (await code(() => as(U.owner, () => q(sql)))) === 'not_admin');

// Settings and calendar defaults
let S0 = (await A(`select public.admin_drafts() r`)).settings;
ok('settings: 8 drafts, 4 posts a day, as Eithr, Hinglish 50%, not paused', S0.drafts_per_day === 8 && S0.posts_per_day === 4 && S0.post_as === 'eithr' && S0.hinglish === 50 && !S0.paused, JSON.stringify(S0));
ok('calendar: seeded fixed days (Christmas, Republic Day)', (await q(`select count(*)::int n from public.content_calendar where label in ('Christmas', 'Republic Day')`))[0].n === 2);

// agent_start: due at 6:30 am India time once a day; or when asked
const istMin = (() => { const d = new Date(Date.now() + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
let ctx = await J(`select public.agent_start($1) r`, [SECRET]);
if (istMin < 390) ok('before 6:30 am India time: not due', ctx === null);
else { ok('after 6:30 am India time: due (automatic run)', ctx?.run_id > 0); await J(`select public.agent_save($1, $2, '[]', '[]', 'test run') r`, [SECRET, ctx.run_id]); ctx = null; }
// After 1 pm / 6 pm India time a refresh is also due (20261212000000_fresh_drafts.sql): run it out.
for (let x = await J(`select public.agent_start($1) r`, [SECRET]), i = 0; x && i < 3; x = await J(`select public.agent_start($1) r`, [SECRET]), i++)
  await J(`select public.agent_save($1, $2, '[]', '[]', 'test run') r`, [SECRET, x.run_id]);
ok('not asked, already ran or too early: not due', (await J(`select public.agent_start($1) r`, [SECRET])) === null);
await A(`select public.admin_agent_request() r`);
ctx = await J(`select public.agent_start($1) r`, [SECRET]);
ok('"Write drafts now": a run starts, with what it needs', ctx?.run_id > 0 && ctx.settings?.drafts_per_day === 8 && Array.isArray(ctx.topics) && Array.isArray(ctx.recent) && Array.isArray(ctx.calendar) && Array.isArray(ctx.open_slots), JSON.stringify(ctx).slice(0, 300));
ok('recent questions include Eithr\'s polls (no repeats)', ctx.recent.includes('Tea or coffee to start the day?'), JSON.stringify(ctx.recent).slice(0, 200));
// Private polls never go to the model
await J(`select public.agent_save($1, $2, '[]', '[]', 'check') r`, [SECRET, ctx.run_id]);
await q(`insert into public.polls (creator_id, question, visibility, view_count, vote_count) values ($1, 'Secret friends question?', 'circle', 50, 40), ($1, 'Admin link-only question?', 'link', 50, 40)`, [U.admin]);
await q(`insert into public.polls (creator_id, question, visibility, view_count, vote_count) values ($1, 'Friend private best?', 'circle', 50, 45)`, [U.owner]);
await A(`select public.admin_agent_request() r`);
ctx = await J(`select public.agent_start($1) r`, [SECRET]);
ok('the model never gets friends-only or link poll questions', !JSON.stringify(ctx).includes('Secret friends question') && !JSON.stringify(ctx).includes('Admin link-only') && !JSON.stringify(ctx).includes('Friend private best'), JSON.stringify(ctx.best) + JSON.stringify(ctx.recent).slice(0, 200));
ok('while a run is going: not due again', (await J(`select public.agent_start($1) r`, [SECRET])) === null);
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const drafts = [
  { question: 'Kaju katli or gulab jamun?', answers: ['Kaju katli', 'Gulab jamun'], topic: 'food', feel: 'debate', timely: true, lang: 'en', slot: 'timely', why: 'Diwali soon', source: 'Google Trends', post_as: 'eithr', publish_at: inHours(3), open_days: 1 },
  { question: 'Mummy ki daant ya papa ki chuppi?', answers: ['Daant', 'Chuppi'], topic: 'family', feel: 'emotional', timely: false, lang: 'hinglish', slot: 'emotional', why: 'Emotional polls do well', post_as: 'you', publish_at: inHours(5), open_days: 3 },
  { question: 'Test cricket or T20?', answers: ['Test', 'T20'], topic: 'cricket', feel: 'debate', slot: 'best', post_as: 'eithr', publish_at: inHours(26), open_days: 7 },
  { question: 'Gym or extra sleep?', answers: ['Gym', 'Sleep'], topic: 'daily', feel: 'relatable', slot: 'experiment', post_as: 'eithr', publish_at: inHours(-2), open_days: 9 },
  { question: 'One answer only?', answers: ['Yes'], slot: 'best' },
  { question: 'Same twice?', answers: ['A', 'a'], slot: 'best' },
  { question: 'This has badword in it', answers: ['Yes', 'No'], slot: 'best' },
  { question: 'x'.repeat(150), answers: ['Yes', 'No'], slot: 'best' },
  { question: 'Bad tags still saved?', answers: ['Yes', 'No'], topic: 'politics', feel: 'angry', lang: 'fr', slot: 'weird', post_as: 'someone', open_days: 2 },
];
await q(`insert into public.blocked_terms (term) values ('badword') on conflict do nothing`);
const trends = [
  { source: 'Google Trends', title: 'Diwali sweets recipe', url: 'https://trends.google.com/x', idea_question: 'Kaju katli or gulab jamun?', idea_answers: ['Kaju katli', 'Gulab jamun'], topic: 'food', feel: 'debate', timely: true, lang: 'en', skip_reason: null },
  { source: 'News', title: 'Bus accident on a highway', url: 'https://news.example/a', idea_question: 'Who is to blame?', idea_answers: ['Driver', 'Roads'], topic: 'news', feel: 'debate', skip_reason: 'Accident: not for polls' },
  { source: 'News', title: 'Plain link only', url: 'javascript:alert(1)', idea_question: null, idea_answers: null },
  { source: 'News', title: 'Blocked idea', url: 'https://news.example/b', idea_question: 'badword or not?', idea_answers: ['Yes', 'No'], topic: 'fun', feel: 'funny' },
];
let saved = await J(`select public.agent_save($1, $2, $3, $4) r`, [SECRET, ctx.run_id, JSON.stringify(drafts), JSON.stringify(trends)]);
ok('save: 5 drafts kept (one answer, repeat answers, blocked word, too long left out)', saved.drafts === 5, JSON.stringify(saved));
ok('save: 4 trends kept', saved.trends === 4);
ok('save: push to the admin "✍️ 5 drafts ready", opens Drafts', saved.alert?.title === '✍️ 5 drafts ready' && saved.alert.url === '/admin#drafts' && /Kaju katli/.test(saved.alert.body) && saved.targets?.length === 1, JSON.stringify(saved.alert));
const bad = (await q(`select topic, feel, lang, slot, post_as, open_days from public.content_drafts where question = 'Bad tags still saved?'`))[0];
ok('save: bad tags, slot, post_as, days cleaned (null, best, eithr, 1)', bad.topic === null && bad.feel === null && bad.lang === null && bad.slot === 'best' && bad.post_as === 'eithr' && bad.open_days === 1, JSON.stringify(bad));
const past = (await q(`select publish_at > now() f from public.content_drafts where question = 'Gym or extra sleep?'`))[0];
ok('save: a time in the past moves to just ahead', past.f === true);
const tr = await q(`select title, url, idea_question, skip_reason from public.content_trends order by id`);
ok('trends: skipped story keeps no idea', tr.find((t) => t.title.startsWith('Bus'))?.idea_question === null);
ok('trends: non-https link dropped', tr.find((t) => t.title === 'Plain link only')?.url === null);
ok('trends: idea with blocked words dropped', tr.find((t) => t.title === 'Blocked idea')?.idea_question === null);
ok('run done with counts', (await q(`select status, drafts, trends from public.agent_runs where id = $1`, [ctx.run_id]))[0].status === 'done');
ok('save twice refused (run not running)', (await code(() => J(`select public.agent_save($1, $2, '[]', '[]') r`, [SECRET, ctx.run_id]))) === 'not_found');

// The admin's list
let D = await A(`select public.admin_drafts() r`);
ok('admin: 5 new drafts, oldest time first', D.new.length === 5 && D.new.every((x, i, a) => i === 0 || a[i - 1].publish_at <= x.publish_at), String(D.new.length));
ok('admin: last run shown, admin username shown', D.last_run?.status === 'done' && D.last_run.drafts === 5 && D.admin_username === 'boss');
const D0 = D.new; const id = (qq) => D0.find((x) => x.question.startsWith(qq)).id;

// Editing
const save = (did, o = {}) => A(`select public.admin_draft_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r`,
  [did, o.q ?? 'Kaju katli or gulab jamun?', o.a ?? ['Kaju katli', 'Gulab jamun'], o.topic ?? 'food', o.feel ?? 'debate', o.timely ?? true, o.lang ?? 'en', o.as ?? 'eithr', o.at ?? inHours(3), o.days ?? 1, o.potd ?? false, o.notify ?? false]);
ok('edit: question too short', (await code(() => save(id('Kaju'), { q: 'Hi' }))) === 'question_length');
ok('edit: one answer', (await code(() => save(id('Kaju'), { a: ['Only'] }))) === 'answers');
ok('edit: answer over 40 characters', (await code(() => save(id('Kaju'), { a: ['x'.repeat(41), 'y'] }))) === 'answers');
ok('edit: blocked word', (await code(() => save(id('Kaju'), { q: 'badword question?' }))) === 'blocked_words');
ok('edit: bad duration', (await code(() => save(id('Kaju'), { days: 2 }))) === 'duration');
ok('edit: more than 14 days ahead', (await code(() => save(id('Kaju'), { at: inHours(24 * 15) }))) === 'when');
ok('edit: bad post as', (await code(() => save(id('Kaju'), { as: 'someone' }))) === 'post_as');
ok('edit: bad topic refused by the table', /check/.test((await err(() => save(id('Kaju'), { topic: 'politics' }))) ?? ''));
let e = await save(id('Kaju'), { q: 'Kaju katli ya gulab jamun?', lang: 'hinglish', notify: true });
ok('edit: saved (question, language, push to everyone)', e.question === 'Kaju katli ya gulab jamun?' && e.lang === 'hinglish' && e.notify === true);
e = await save(id('Kaju'), { q: 'Kaju katli ya gulab jamun?', as: 'you', notify: true, potd: true });
ok('edit: as you → no push to everyone, no Poll of the Day', e.post_as === 'you' && e.notify === false && e.poll_of_day === false, JSON.stringify(e));
await save(id('Kaju'), { q: 'Kaju katli ya gulab jamun?', notify: true });

// Approving, with most posts a day = 2
await A(`select public.admin_agent_settings(posts_per_day => 2) r`);
ok('settings: out of range refused', (await code(() => A(`select public.admin_agent_settings(posts_per_day => 9) r`))) === 'out_of_range' && (await code(() => A(`select public.admin_agent_settings(topics_off => array['politics']) r`))) === 'out_of_range');
ok('settings change logged', (await q(`select count(*)::int n from public.admin_events where action = 'agent'`))[0].n >= 1);
// The 3 drafts for today (3h, 5h, and the one moved to just ahead) and one for tomorrow
const today3 = [id('Kaju'), id('Mummy'), id('Gym')];
const istDay = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);
const sameDay = D0.filter((x) => today3.includes(x.id)).every((x) => istDay(x.publish_at) === istDay(new Date().toISOString()));
let ap = await A(`select public.admin_drafts_approve($1) r`, [today3]);
if (sameDay) ok('approve 3 for today with a cap of 2: 2 approved, 1 day_full', ap.approved === 2 && ap.problems.length === 1 && ap.problems[0].error === 'day_full', JSON.stringify(ap));
else ok('approve (drafts span midnight): some approved', ap.approved >= 2, JSON.stringify(ap));
ok('approval logged', (await q(`select detail from public.admin_events where action = 'drafts' order by at desc limit 1`))[0]?.detail === `Approved ${ap.approved} drafts`);
await A(`select public.admin_agent_settings(posts_per_day => 4) r`);
ap = await A(`select public.admin_drafts_approve($1) r`, [today3]);
D = await A(`select public.admin_drafts() r`);
ok('raise the cap: the rest approved; 3 scheduled', D.scheduled.length === 3, JSON.stringify(ap));
ok('approving again does nothing', (await A(`select public.admin_drafts_approve($1) r`, [today3])).approved === 0);
// Unschedule and skip
await A(`select public.admin_draft_unschedule($1) r`, [id('Gym')]);
ok('unschedule: back to new', (await A(`select public.admin_drafts() r`)).new.some((x) => x.id === id('Gym')));
ok('unschedule a new draft: not_found', (await code(() => A(`select public.admin_draft_unschedule($1) r`, [id('Gym')]))) === 'not_found');
ok('skip: 1 skipped', (await A(`select public.admin_drafts_skip($1) r`, [[id('Gym'), id('Kaju')]])) === 1);

// Posting when the time comes
await q(`update public.content_drafts set publish_at = now() - interval '1 minute' where status = 'scheduled'`);
const posted = await J(`select public.post_due_drafts($1) r`, [SECRET]);
ok('post: the 2 scheduled drafts go live', posted === 2, String(posted));
const pk = (await q(`select p.question, p.is_system, p.quiet, p.creator_id, p.topic, p.feel, p.lang, p.tag_source, p.featured_on,
  round(extract(epoch from p.closes_at - p.created_at) / 86400) as days, (select array_agg(o.text order by o.position) from poll_options o where o.poll_id = p.id) as opts
  from public.content_drafts d join public.polls p on p.id = d.poll_id where d.status = 'posted'`));
const kk = pk.find((x) => x.question === 'Kaju katli ya gulab jamun?');
const mm = pk.find((x) => x.question.startsWith('Mummy'));
ok('post as Eithr: system poll, push to everyone on (not quiet), tagged, 1 day, answers', kk && kk.is_system && kk.quiet === false && kk.topic === 'food' && kk.tag_source === 'ai' && Number(kk.days) === 1 && JSON.stringify(kk.opts) === '["Kaju katli","Gulab jamun"]', JSON.stringify(kk));
ok('post as you: the admin\'s own public poll, 3 days, Hinglish', mm && !mm.is_system && mm.creator_id === U.admin && mm.lang === 'hinglish' && Number(mm.days) === 3, JSON.stringify(mm));
ok('posted drafts show votes', (await A(`select public.admin_drafts() r`)).posted.length === 2);
ok('posting again: nothing due', (await J(`select public.post_due_drafts($1) r`, [SECRET])) === 0);

// Quiet polls: no "New on Eithr" notification
const qp = (await q(`insert into public.polls (question, is_system, quiet) values ('Quiet one?', true, true) returning id`))[0].id;
const lp = (await q(`insert into public.polls (question, is_system) values ('Loud one?', true) returning id`))[0].id;
await q(`insert into public.notifications (user_id, kind, title, body, url, dedupe) values ($1::uuid, 'daily', 'New on Eithr', 'x', '/', 'docpoll:' || $2::text || ':' || $1::text)`, [U.owner, qp]);
await q(`insert into public.notifications (user_id, kind, title, body, url, dedupe) values ($1::uuid, 'daily', 'New on Eithr', 'x', '/', 'docpoll:' || $2::text || ':' || $1::text)`, [U.owner, lp]);
await q(`insert into public.notifications (user_id, kind, title, body, url, dedupe) values ($1::uuid, 'votes', 'Votes', 'x', '/', 'votes:' || $2::text)`, [U.owner, qp]);
const nn = (await q(`select dedupe from public.notifications where user_id = $1`, [U.owner])).map((r) => r.dedupe);
ok('quiet Eithr poll: no "New on Eithr"; a normal one still gets it; other kinds untouched', !nn.some((d) => d.includes(qp) && d.startsWith('docpoll')) && nn.some((d) => d.includes(lp)) && nn.some((d) => d.startsWith('votes:')), nn.join(','));
// The default for a draft: quiet
const dq = (await q(`insert into public.content_drafts (question, answers, publish_at, status) values ('Default quiet?', array['A','B'], now() - interval '1 minute', 'scheduled') returning id`))[0].id;
await J(`select public.post_due_drafts($1) r`, [SECRET]);
ok('a draft posted as Eithr is quiet by default', (await q(`select p.quiet from public.content_drafts d join public.polls p on p.id = d.poll_id where d.id = $1`, [dq]))[0]?.quiet === true);

// Failures while posting: blocked word added after approval; admin without a username
await q(`insert into public.content_drafts (question, answers, publish_at, status, post_as) values ('Fine words?', array['A','B'], now() - interval '1 minute', 'scheduled', 'you'), ('Now has badword?', array['A','B'], now() - interval '1 minute', 'scheduled', 'eithr')`);
await q(`update profiles set username = 'guest_abc' where id = $1`, [U.admin]);
await J(`select public.post_due_drafts($1) r`, [SECRET]);
const fl = await q(`select question, status, error from public.content_drafts where question in ('Fine words?', 'Now has badword?') order by question`);
ok('post fails safely: no username → failed (no_username); blocked word → failed (blocked_words)', fl[0].status === 'failed' && fl[0].error === 'no_username' && fl[1].status === 'failed' && fl[1].error === 'blocked_words', JSON.stringify(fl));
await q(`update profiles set username = 'boss' where id = $1`, [U.admin]);

// Poll of the Day from a draft
const tomorrow = new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10);
const potd = (await q(`insert into public.content_drafts (question, answers, publish_at, poll_of_day) values ('Rangoli or diyas?', array['Rangoli','Diyas'], ($1::date + time '09:00') at time zone 'Asia/Kolkata', true) returning id`, [tomorrow]))[0].id;
ap = await A(`select public.admin_drafts_approve($1) r`, [[potd]]);
const pp = (await q(`select p.featured_on::text f, p.is_system, p.created_at > now() future from public.content_drafts d join public.polls p on p.id = d.poll_id where d.id = $1`, [potd]))[0];
ok('Poll of the Day: made at once for that day (future start), draft posted', ap.approved === 1 && pp?.f === tomorrow && pp.is_system && pp.future, JSON.stringify({ ap, pp }));
const potd2 = (await q(`insert into public.content_drafts (question, answers, publish_at, poll_of_day) values ('Another for the same day?', array['A','B'], ($1::date + time '09:00') at time zone 'Asia/Kolkata', true) returning id`, [tomorrow]))[0].id;
ap = await A(`select public.admin_drafts_approve($1) r`, [[potd2]]);
ok('Poll of the Day: day already taken → day_taken, stays new', ap.approved === 0 && ap.problems[0]?.error === 'day_taken' && (await q(`select status from public.content_drafts where id = $1`, [potd2]))[0].status === 'new');

// Trends → drafts; calendar
let T = await A(`select public.admin_trends() r`);
ok('trends: listed, skipped last, calendar shown', T.items.length === 4 && T.items[T.items.length - 1].skip_reason !== null || T.items.some((t) => t.skip_reason) && Array.isArray(T.calendar), JSON.stringify(T.items.map((t) => t.title)));
const tid = T.items.find((t) => t.title === 'Diwali sweets recipe').id;
const did = await A(`select public.admin_draft_from_trend($1) r`, [tid]);
ok('trend → draft (slot trend, why says where from)', (await q(`select slot, why from public.content_drafts where id = $1`, [did]))[0]?.slot === 'trend');
ok('the same trend twice → already_drafted', (await code(() => A(`select public.admin_draft_from_trend($1) r`, [tid]))) === 'already_drafted');
ok('a skipped trend → not_found', (await code(() => A(`select public.admin_draft_from_trend($1) r`, [T.items.find((t) => t.title.startsWith('Bus')).id]))) === 'not_found');
const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const cid = await A(`select public.admin_calendar_add($1::date + 3, 'Bhai Dooj') r`, [todayIst]);
ok('calendar add', cid > 0 && (await A(`select public.admin_trends() r`)).calendar.some((c) => c.label === 'Bhai Dooj'));
ok('calendar: past day refused', (await code(() => A(`select public.admin_calendar_add($1::date - 1, 'Old') r`, [todayIst]))) === 'bad_day');
ok('calendar: label too short', (await code(() => A(`select public.admin_calendar_add($1::date + 1, 'x') r`, [todayIst]))) === 'label_length');
await A(`select public.admin_calendar_remove($1) r`, [cid]);
ok('calendar remove', !(await A(`select public.admin_trends() r`)).calendar.some((c) => c.label === 'Bhai Dooj'));

// Expiry, pause
await q(`update public.content_drafts set created_at = now() - interval '4 days' where status = 'new'`);
await J(`select public.post_due_drafts($1) r`, [SECRET]);
ok('new drafts older than 3 days expire', (await A(`select public.admin_drafts() r`)).new.length === 0);
await A(`select public.admin_agent_settings(paused => true) r`);
ok('paused: no automatic run', (await J(`select public.agent_start($1) r`, [SECRET])) === null);
await A(`select public.admin_agent_request() r`);
const c2 = await J(`select public.agent_start($1) r`, [SECRET]);
ok('paused, but "Write drafts now" still runs', c2?.run_id > 0);
await J(`select public.agent_save($1, $2, '[]', '[]', 'OpenAI down') r`, [SECRET, c2.run_id]);
ok('a failed run is recorded with its error, no push', (await A(`select public.admin_drafts() r`)).last_run.error === 'OpenAI down');
// A run that was cut off
await A(`select public.admin_agent_request() r`);
const c3 = await J(`select public.agent_start($1) r`, [SECRET]);
await q(`update public.agent_runs set started_at = now() - interval '11 minutes' where id = $1`, [c3.run_id]);
await A(`select public.admin_agent_request() r`);
const c4 = await J(`select public.agent_start($1) r`, [SECRET]);
ok('a run cut off over 10 minutes ago counts as failed; a new one can start', c4?.run_id > c3.run_id && (await q(`select status from public.agent_runs where id = $1`, [c3.run_id]))[0].status === 'failed');

// Nothing else changed: create_poll still works and isn't quiet
const own = (await as(U.owner, () => q(`select public.create_poll('Normal poll still fine?', array['Yes','No'], 1) r`)))[0].r;
ok('people\'s polls: not quiet, not tagged by the agent', (await q(`select quiet, tag_source from public.polls where id = $1`, [own]))[0].quiet === false);
await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261211000000_content_agent.sql`, 'utf8'));
ok('migration runs twice; drafts and settings kept', (await q(`select count(*)::int n from public.content_drafts`))[0].n > 5 && (await q(`select paused from public.agent_settings`))[0].paused === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
