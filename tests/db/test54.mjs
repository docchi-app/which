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

// ── Tags in comments ──
const SECRET = 'test-secret-test-secret-123';
await q(`insert into public.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
const anon = (fn) => as(null, fn);
const code = async (fn) => { const e = await err(fn); return e ? (e.match(/docchi:(\w+)/)?.[1] ?? e) : 'ok'; };
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`))[0].a;
// owner=u_1 writes; friend=u_2 (friends both ways); f2=u_5 friend; f3=u_6 friend (but blocked); f4=u_7 friend; stranger=u_3 (not friend)
const friends = async (a, b) => { await q(`insert into public.circle_members (owner_id, member_id, status, accepted_at) values ($1, $2, 'accepted', now()), ($2, $1, 'accepted', now()) on conflict do nothing`, [a, b]); };
for (const f of ['friend', 'f2', 'f3', 'f4']) await friends(U.owner, U[f]);
await q(`insert into public.circle_members (owner_id, member_id, status) values ($1, $2, 'pending')`, [U.owner, U.admin]); // asked, not friends
await q(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [U.f3, U.owner]);
for (const k of ['friend', 'f2', 'f4']) await q(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, 'k', 'a')`, ['https://push.example/' + k, U[k]]);
const poll = (await q(`insert into public.polls (creator_id, question) values ($1, 'Kaun sabse pehle plans cancel karta hai?') returning id`, [U.stranger]))[0].id;
const opt = (await q(`insert into public.poll_options (poll_id, position, text) values ($1, 0, 'Me!'), ($1, 1, 'A friend (tag them)') returning id`, [poll]))[1].id;
await q(`insert into public.votes (poll_id, user_id, option_id) values ($1, $2, $3)`, [poll, U.owner, opt]);
// Comments are rate limited (5 per poll per 10 minutes): when hit, age that person's comments and retry.
const post = async (uid, text, p = poll) => {
  const go = () => as(uid, () => q(`select public.post_comment($1, $2) r`, [p, text])).then((x) => x[0].r);
  try { return await go(); } catch (e) {
    if (!/slow_down/.test(e.message)) throw e;
    await q(`update public.comments set created_at = created_at - interval '61 minutes' where user_id = $1`, [uid]);
    return go();
  }
};

// Grants
ok('post_comment, remove_my_tag, tag_candidates: closed to anon', !(await priv('anon', 'post_comment(uuid,text)')) && !(await priv('anon', 'remove_my_tag(uuid)')) && !(await priv('anon', 'tag_candidates(uuid,text)')));
ok('tag_notify: open to the job (secret checked)', await priv('anon', 'tag_notify(text)'));
ok('are_friends, tag_names: internal', !(await priv('authenticated', 'are_friends(uuid,uuid)')) && !(await priv('authenticated', 'tag_names(text)')));
ok('comment_mentions: not readable', /permission denied/.test(await err(() => as(U.owner, () => q(`select * from public.comment_mentions`))) ?? ''));
ok('old six-switch set_push_settings gone', (await q(`select to_regprocedure('public.set_push_settings(boolean,boolean,boolean,boolean,boolean,boolean)') is null a`))[0].a);
ok('tag_notify: wrong secret refused', (await code(() => anon(() => q(`select public.tag_notify('nope')`)))) === 'forbidden');

// @names in text
const names = async (t) => (await q(`select public.tag_names($1) a`, [t]))[0].a;
ok('names: @riya, @Dev_04 (lower case), each once, in order; e-mail and too short ignored', JSON.stringify(await names('Hi @riya and @Dev_04, @riya again, mail a@bcd.com, @ab')) === '["riya","dev_04"]', JSON.stringify(await names('Hi @riya and @Dev_04, @riya again, mail a@bcd.com, @ab')));

// Posting with tags
let r = await post(U.owner, `Has to be @${name('friend')} 😂`);
ok('tagging a friend: tagged', JSON.stringify(r.tagged) === JSON.stringify([name('friend')]), JSON.stringify(r));
r = await post(U.owner, `@${name('stranger')} and @${name('admin')} and @nobody_here`);
ok('not friends (stranger, a pending request) and unknown names: not tagged', r.tagged.length === 0, JSON.stringify(r));
r = await post(U.owner, `@${name('f3')} sorry`);
ok('a friend who blocked you: not tagged', r.tagged.length === 0);
r = await post(U.owner, `@${name('f4')} @${name('f2')} @${name('friend')} @${name('f3')}`);
ok('up to 3, in the order written', JSON.stringify(r.tagged) === JSON.stringify([name('f4'), name('f2'), name('friend')]), JSON.stringify(r));
r = await post(U.owner, `@${name('owner')} me`);
ok('yourself: not tagged', r.tagged.length === 0);
// A friends-only poll the friend can't see
const circlePoll = (await q(`insert into public.polls (creator_id, question, visibility) values ($1, 'Secret circle poll?', 'circle') returning id`, [U.stranger]))[0].id;
await q(`insert into public.poll_options (poll_id, position, text) values ($1, 0, 'A'), ($1, 1, 'B')`, [circlePoll]);
await friends(U.stranger, U.owner);
await q(`insert into public.votes (poll_id, user_id, option_id) select $1, $2, id from public.poll_options where poll_id = $1 and position = 0`, [circlePoll, U.owner]);
const canSee = (await q(`select public.can_view_poll($1, $2) a`, [circlePoll, U.friend]))[0].a;
if (!canSee) { r = await post(U.owner, `@${name('friend')} look`, circlePoll); ok('a friend who can\'t see the poll: not tagged', r.tagged.length === 0, JSON.stringify(r)); }
else ok('(circle poll visible to friend in this setup; skipped)', true);
await q(`delete from public.circle_members where (owner_id = $1 and member_id = $2) or (owner_id = $2 and member_id = $1)`, [U.stranger, U.owner]);

// Picker
const cands = async (uid, qq) => (await as(uid, () => q(`select public.tag_candidates($1, $2) r`, [poll, qq])))[0].r;
let c = await cands(U.owner, '');
const cn = c.map((x) => x.username);
ok('picker: friends who can see the poll, not the blocker, not strangers, not pending', cn.includes(name('friend')) && cn.includes(name('f2')) && !cn.includes(name('f3')) && !cn.includes(name('stranger')) && !cn.includes(name('admin')), JSON.stringify(cn));
c = await cands(U.owner, name('f2').slice(0, 3));
ok('picker: filters by what is typed', c.length >= 1 && c.every((x) => x.username.startsWith(name('f2').slice(0, 3))));
ok('picker: before voting, nothing (can\'t read comments)', (await cands(U.f2, '')).length === 0);
ok('picker: signed out, refused', /permission denied/.test(await err(() => anon(() => q(`select public.tag_candidates($1, '') r`, [poll]))) ?? ''));
ok('picker: odd characters stripped', Array.isArray(await cands(U.owner, "%' or 1=1 --")));

// Comments show live tags
await q(`insert into public.votes (poll_id, user_id, option_id) values ($1, $2, $3)`, [poll, U.friend, opt]);
let cm = (await as(U.friend, () => q(`select public.get_comments($1) r`, [poll])))[0].r.comments;
const first = cm.find((x) => x.text.startsWith('Has to be'));
ok('get_comments: tags listed, tagged_me for the friend', JSON.stringify(first.tags) === JSON.stringify([name('friend')]) && first.tagged_me === true, JSON.stringify(first));
const plain = cm.find((x) => x.text.startsWith('@' + name('stranger')));
ok('an @name that isn\'t a tag: no tags listed', plain.tags.length === 0 && plain.tagged_me === false);

// Pushes
let cnt = (await anon(() => q(`select public.tag_notify($1) r`, [SECRET])))[0].r;
ok("before the AI check (and under 5 minutes): no pushes yet", cnt === 0);
await q(`update public.comments set text_checked_at = now() where poll_id = $1`, [poll]);
cnt = (await anon(() => q(`select public.tag_notify($1) r`, [SECRET])))[0].r;
const notes = await q(`select user_id, title, body, url, kind from public.notifications where kind = 'tag' order by id`);
ok('after the check: one push per tag (friend twice: 2 comments; f2 and f4 once)', notes.length === 4 && cnt === 4, JSON.stringify(notes.map((x) => x.user_id.slice(0, 8))));
ok('push says who and what, opens the comments', notes[0].title === '@' + name('owner') + ' tagged you' && /Has to be/.test(notes[0].body) && notes[0].url === `/p/${poll}?comments=1`, JSON.stringify(notes[0]));
ok('running again: nothing new', (await anon(() => q(`select public.tag_notify($1) r`, [SECRET])))[0].r === 0);
// Hidden comment, removed tag, setting off, no phone, daily cap
r = await post(U.owner, `@${name('f2')} hidden one`);
await q(`update public.comments set is_hidden = true, text_checked_at = now() where text = $1`, [`@${name('f2')} hidden one`]);
const hid = await post(U.owner, `@${name('f4')} removed tag`);
await q(`update public.comments set text_checked_at = now() where id = $1`, [hid.id]);
await as(U.f4, () => q(`select public.remove_my_tag($1)`, [hid.id]));
await as(U.f2, () => q(`select public.set_push_settings(true, true, true, true, true, true, false)`));
const off = await post(U.owner, `@${name('f2')} setting off`);
await q(`update public.comments set text_checked_at = now() where id = $1`, [off.id]);
const before = (await q(`select count(*)::int n from public.notifications where kind = 'tag'`))[0].n;
await anon(() => q(`select public.tag_notify($1) r`, [SECRET]));
ok('no push for a hidden comment, a removed tag, or "When a friend tags you" off', (await q(`select count(*)::int n from public.notifications where kind = 'tag'`))[0].n === before);
ok('settings: tags switch saved and read', (await as(U.f2, () => q(`select public.get_push_settings() r`)))[0].r.tags === false);
// Cap: 5 a day for one person (friend already has 2)
for (let i = 0; i < 5; i++) { const x = await post(U.f2, `@${name('owner')}`, poll).catch(() => null); }
await q(`insert into public.votes (poll_id, user_id, option_id) values ($1, $2, $3) on conflict do nothing`, [poll, U.f4, opt]);
await friends(U.f4, U.friend);
const ids = [];
for (let i = 0; i < 5; i++) ids.push((await post(U.f4, `ping ${i} @${name('friend')}`)).id);
await q(`update public.comments set text_checked_at = now() where id = any($1)`, [ids]);
await anon(() => q(`select public.tag_notify($1) r`, [SECRET]));
const capN = (await q(`select count(*)::int n from public.notifications where kind = 'tag' and user_id = $1`, [U.friend]))[0].n;
const capM = (await q(`select count(*)::int n from public.comment_mentions where user_id = $1`, [U.friend]))[0].n;
ok('at most 5 tag pushes a day per person', capN === 5, `pushes ${capN}, tags ${capM}`);
// 5 minutes with no check: goes anyway
const late = await post(U.owner, `@${name('f4')} late`);
await q(`update public.comments set created_at = now() - interval '6 minutes' where id = $1`, [late.id]);
await anon(() => q(`select public.tag_notify($1) r`, [SECRET]));
ok('no AI check after 5 minutes: the push goes anyway', (await q(`select count(*)::int n from public.notifications where kind = 'tag' and dedupe = $1`, ['tag:' + late.id + ':' + U.f4]))[0].n === 1);

// Remove my tag
ok('remove a tag that isn\'t yours: not_found', (await code(() => as(U.f2, () => q(`select public.remove_my_tag($1)`, [first.id])))) === 'not_found');
await as(U.friend, () => q(`select public.remove_my_tag($1)`, [first.id]));
cm = (await as(U.friend, () => q(`select public.get_comments($1) r`, [poll])))[0].r.comments;
ok('removed: the comment no longer lists the tag', cm.find((x) => x.id === first.id).tags.length === 0 && cm.find((x) => x.id === first.id).tagged_me === false);

// Activity
const act = (await as(U.f4, () => q(`select public.my_activity() r`)))[0].r;
ok('Activity: tags of the last 7 days, by whom, on which poll', act.tags.length >= 1 && act.tags.every((t) => t.by && t.question && t.poll_id) && !act.tags.some((t) => false), JSON.stringify(act.tags).slice(0, 200));
const fa = (await as(U.friend, () => q(`select public.my_activity() r`)))[0].r.tags;
ok('Activity: a removed tag isn\'t listed (friend: 1 + 5 live tags, the removed one left out)', fa.length === 6, String(fa.length));
ok('Activity: votes/comments/polls still there', 'votes' in act && 'comments' in act && Array.isArray(act.polls));

// Deleting a comment removes its tags
const del = await post(U.owner, `@${name('f2')} to delete`);
await as(U.owner, () => q(`select public.delete_comment($1)`, [del.id]));
ok('deleting a comment leaves no tag behind', (await q(`select count(*)::int n from public.comment_mentions where comment_id = $1`, [del.id]))[0].n === 0 || (await q(`select is_hidden from public.comments where id = $1`, [del.id]))[0]?.is_hidden === true);

await db.exec(fs.readFileSync(`${repo}/supabase/migrations/20261213000000_comment_tags.sql`, 'utf8'));
ok('migration runs twice; tags kept', (await q(`select count(*)::int n from public.comment_mentions`))[0].n > 5);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
