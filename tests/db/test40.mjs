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
const blocked = async (t) => (await q(`select public.has_blocked_term($1) b`, [t]))[0].b;

// ── Must be blocked ──
const bad = ['fuck', 'Fuck you', 'fucked', 'fuckin', 'fuuuuck', 'f*ck', 'f u c k', 'f.u.c.k', 'fck', 'phuck', 'motherfucker', 'MOTHERFUCKERS', 'fück',
  'sh1t', 'shitty', 'b!tch', 'bitches', 'biiiitch', 'a$$hole', 'kys', 'kill yourself', 'Kill urself',
  'mc', 'BC yaar', 'bsdk', 'mkc', 'bhosdiwale', 'bhosdike', 'bhadwa', 'gaand', 'gaandu', 'chinal', 'madarchod', 'MaDaRcHoD', 'maadarchod', 'chutiyapa', 'chu+iya', 'chutiyaaa',
  'behenchod', 'bhenchodd', 'teri maa ki', 'tmkc',
  'चूतिया', 'मादरचोद', 'भोसड़ीके', 'भोसडीके', 'रंडी', 'गाँड', 'गांडू', 'हरामज़ादा',
  'zavadya', 'aai zavli', 'aaizavadya', 'lavdya', 'bhikarchot', 'gandu', 'zhavnya', 'bhadvya', 'yedzava',
  'जवाड्या', 'झवाड्या', 'आईझवाड्या', 'भडव्या', 'लवड्या', 'रांडेच्या', 'nigger', 'faggots'];
const missed = [];
for (const w of bad) if (!(await blocked(w))) missed.push(w);
ok(`all ${bad.length} bad spellings blocked`, missed.length === 0, JSON.stringify(missed));

// ── Must stay allowed (ordinary words, names, places) ──
const fine = ['chod do yaar', 'Chhod do', 'scunthorpe', 'dickens', 'rapeseed oil', 'assess the class', 'as soon as', 'Bob', 'bobs burgers',
  'passing grade', 'Cocktail or mocktail?', 'cockroach', 'shiitake', 'Tate modern', 'Hello world', 'kutta or billi?', 'Gandhi ji',
  'gandi baat', 'Goa or Manali?', 'Mumbai vs Pune', 'Chai or coffee?', 'Who will win the match?', 'bhai sahab', 'kamal hai',
  'मां की ममता', 'पुणे की बारिश', 'झरना', 'जवान', 'लवकर ये', 'आई बाबा', 'something happened', 'Hancock',
  'top 5 movies', '100 rs ka khana', 'class of 2024', 'Is this ok?', 'Raja or Rani?', 'snack', 'grape juice', 'therapist',
  'pacific', 'title', 'butter chicken', 'Ass-essment', 'retardant', 'shiitake risotto', 'fire retardants'];
const wrong = [];
for (const w of fine) if (await blocked(w)) wrong.push(w + ' → ' + (await q(`select public.blocked_matches($1) m`, [w]))[0].m);
ok(`${fine.length} ordinary texts allowed`, wrong.length === 0, JSON.stringify(wrong));
console.log('   (allowed-but-blocked, if any):', JSON.stringify(wrong));

// ── Used everywhere it was: polls, comments, usernames ──
const [{ id: P }] = await as(U.owner, () => q(`select create_poll('Chai or coffee at 4pm?', array['Chai','Coffee'], 3) id`));
ok('poll with a disguised word refused', /blocked_words/.test(await err(() => as(U.owner, () => q(`select create_poll('Who is the bigg3st chut!ya?', array['A','B'], 3)`))) ?? ''));
ok('poll: Hinglish answer refused', /blocked_words/.test(await err(() => as(U.owner, () => q(`select create_poll('Best friend?', array['Ravi','bsdk'], 3)`))) ?? ''));
const opts = (await q(`select id from poll_options where poll_id = $1 order by position`, [P])).map((r) => r.id);
await as(U.friend, () => q(`select cast_vote($1,$2)`, [P, opts[0]]));
ok('comment in Devanagari refused', /blocked_words/.test(await err(() => as(U.friend, () => q(`select post_comment($1, 'तू चूतिया है')`, [P]))) ?? ''));
ok('ordinary comment allowed', !(await err(() => as(U.friend, () => q(`select post_comment($1, 'Chai, always!')`, [P])))));
ok('username with a hidden word refused', (await q(`select public.username_problem('b_s_d_k', null) p`))[0].p === 'blocked');

// ── Admin → Words ──
ok('not an admin: no word list', !!(await err(() => as(U.owner, () => q(`select * from admin_words()`)))));
ok('guest: no word list', !!(await err(() => as(null, () => q(`select * from admin_words()`)))));
const n0 = (await as(U.admin, () => q(`select count(*)::int n from admin_words()`)))[0].n;
ok('admin: the list is there (~300)', n0 > 250, String(n0));
const added = (await as(U.admin, () => q(`select admin_add_word('  Zh@ntu  ', 'word', 'mr') w`)))[0].w;
ok('admin adds a word (stored cleaned)', added === 'zhantu', added);
ok('...and it blocks at once', await blocked('kay zhantu ahe'));
{ const m = (await as(U.admin, () => q(`select admin_test_words('f*ck this bsdk') m`)))[0].m; ok('admin test: shows the matching words', m.includes('bsdk') && m.includes('fck'), JSON.stringify(m)); }
ok('admin can allow a word (false positive fix)', await (async () => { await as(U.admin, () => q(`select admin_add_word('gandmasti', 'word')`)); const before = await blocked('kya gandmasti hai'); await as(U.admin, () => q(`select admin_add_word('gandmasti', 'allow')`)); return before && !(await blocked('kya gandmasti hai')); })());
await as(U.admin, () => q(`select admin_remove_word('zhantu')`));
ok('admin removes it: allowed again', !(await blocked('kay zhantu ahe')));
ok('not an admin: can\'t add', !!(await err(() => as(U.owner, () => q(`select admin_add_word('hello')`)))));
ok('bad kind refused', /word_kind/.test(await err(() => as(U.admin, () => q(`select admin_add_word('abcd', 'regex')`))) ?? ''));
ok('too short refused', /word_length/.test(await err(() => as(U.admin, () => q(`select admin_add_word('a')`))) ?? ''));
ok('blocked_matches is not callable by users', !!(await err(() => as(U.owner, () => q(`select blocked_matches('x')`)))));

// ── AI check plumbing ──
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to('s3cret','UTF8')),'hex'))`).catch(async (e) => { console.log('push_config:', e.message); });
const [{ id: P2 }] = await as(U.owner, () => q(`select create_poll('Is Rahul the dumbest guy in class?', array['Yes','No'], 3) id`));
let rows = await as(U.owner, () => q(`select * from my_unchecked_texts($1)`, [P2]));
ok('new poll: waiting for its check (author sees it)', rows.length === 1 && rows[0].target_type === 'poll' && /Rahul/.test(rows[0].body), JSON.stringify(rows));
ok('someone else can\'t see it', (await as(U.friend, () => q(`select * from my_unchecked_texts($1)`, [P2]))).length === 0);
ok('guests can\'t call it', !!(await err(() => as(null, () => q(`select * from my_unchecked_texts($1)`, [P2])))));
const sweep = await as(null, () => q(`select * from texts_to_check('s3cret', 20)`));
ok('the job: nothing under a minute old', !sweep.some((r) => r.target_id === P2));
await q(`update polls set created_at = now() - interval '5 minutes' where id = $1`, [P2]);
ok('the job: picks up an unsent one after a minute', (await as(null, () => q(`select * from texts_to_check('s3cret', 20)`))).some((r) => r.target_id === P2));
ok('the job: needs the secret', /bad_secret/.test(await err(() => as(null, () => q(`select * from texts_to_check('nope', 20)`))) ?? ''));
ok('old posts count as checked', !(await as(null, () => q(`select * from texts_to_check('s3cret', 50)`))).some((r) => r.target_id === P));
ok('verdict needs the secret', /bad_secret/.test(await err(() => as(U.owner, () => q(`select set_text_verdict('poll', $1, 'ok', '{}', null, 'nope')`, [P2]))) ?? ''));
await as(null, () => q(`select set_text_verdict('poll', $1, 'hide', '{"harassment":0.93}', 'harassment', 's3cret')`, [P2]));
let p2 = (await q(`select is_hidden, hidden_reason, text_checked_at is not null c from polls where id = $1`, [P2]))[0];
ok('hide: poll hidden (like 3 reports), checked', p2.is_hidden && p2.hidden_reason === 'reports' && p2.c, JSON.stringify(p2));
const rep = await as(U.admin, () => q(`select * from admin_reports('open')`));
const r2 = rep.find((r) => r.target_id === P2);
ok('...and it\'s in the Admin queue as an auto check', !!r2 && JSON.stringify(r2.reasons).includes('auto:harassment'), JSON.stringify(r2?.reasons));
await as(null, () => q(`select set_text_verdict('poll', $1, 'hide', '{}', 'harassment', 's3cret')`, [P2]));
ok('a second verdict changes nothing (one report)', (await q(`select count(*)::int n from reports where target_id = $1`, [P2]))[0].n === 1);
ok('not in the job any more', !(await as(null, () => q(`select * from texts_to_check('s3cret', 50)`))).some((r) => r.target_id === P2));
// Admin dismisses: it's back.
await as(U.admin, () => q(`select admin_act('poll', $1, 'dismiss')`, [P2])).catch(async () => as(U.admin, () => q(`select moderate('poll', $1, 'dismiss')`, [P2])).catch((e) => console.log('dismiss:', e.message)));
p2 = (await q(`select is_hidden from polls where id = $1`, [P2]))[0];
ok('admin dismisses: the poll is back', !p2.is_hidden);
// A comment: review (stays up, queued).
await as(U.friend, () => q(`select post_comment($1, 'you are so ugly lol')`, [P]));
const cm = (await as(U.friend, () => q(`select * from my_unchecked_texts($1)`, [P]))).find((r) => /ugly/.test(r.body));
ok('new comment: waiting for its check', cm?.target_type === 'comment' && /ugly/.test(cm.body), JSON.stringify(cm));
await as(null, () => q(`select set_text_verdict('comment', $1, 'review', '{"harassment":0.6}', 'harassment', 's3cret')`, [cm.target_id]));
const c2 = (await q(`select is_hidden, text_checked_at is not null c from comments where id = $1`, [cm.target_id]))[0];
ok('review: comment stays up, checked', !c2.is_hidden && c2.c);
ok('...and is in the Admin queue', (await as(U.admin, () => q(`select * from admin_reports('open')`))).some((r) => r.target_id === cm.target_id));
ok('ok verdict: nothing filed', await (async () => { const [{ id: P3 }] = await as(U.owner, () => q(`select create_poll('Tea or coffee?', array['Tea','Coffee'], 3) id`)); await as(null, () => q(`select set_text_verdict('poll', $1, 'ok', '{}', null, 's3cret')`, [P3])); return (await q(`select count(*)::int n from reports where target_id = $1`, [P3]))[0].n === 0; })());
ok('snaps are not in the text job (checked with the photo)', !(await as(null, () => q(`select * from texts_to_check('s3cret', 50)`))).some((r) => r.target_type === 'poll' && false));

console.log(`\n${pass} pass, ${fail} fail`);
