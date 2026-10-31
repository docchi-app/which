const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Admin → Content → What people like (phone + laptop): tags, Spark lists, the topic + feel grid,
// best polls, changing a poll's tags; and the 2-minute job tagging polls through OpenAI.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const log = async () => (await fetch(M + '/__log')).json();
const flat = (s) => s.replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async ({ sub = null, ua = IPHONE, w = 390, h = 844 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/lk-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // ── The job tags polls ──
  let run = await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  let body = await run.json().catch(() => ({}));
  let L = await log();
  ok('job: asked for polls to tag', run.status === 200 && L.some((l) => /^POLLS_TO_TAG 4$/.test(l)), String(run.status) + ' ' + L.filter((l) => l.startsWith('POLL')).join(','));
  ok('job: cricket poll → cricket · predict · timely · en', L.includes('POLL_TAGS t1000000-0000-4000-8000-000000000001 cricket predict true en'), L.filter((l) => l.startsWith('POLL_TAGS')).join(' / '));
  ok('job: Hinglish family poll → family · emotional · hinglish', L.includes('POLL_TAGS t1000000-0000-4000-8000-000000000002 family emotional false hinglish'));
  ok('job: an answer that isn\'t a tag (politics) is dropped, counted as a try', L.includes('POLL_TAGS t1000000-0000-4000-8000-000000000003 null null null null'));
  ok('job: snap tagged from its text', L.includes('POLL_TAGS t1000000-0000-4000-8000-000000000004 fashion debate false en'));
  ok('job: run reports 3 tagged', body.tagged === 3, JSON.stringify(body));
  run = await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  body = await run.json().catch(() => ({}));
  ok('job: nothing left → no tagged count', run.status === 200 && body.tagged === undefined, JSON.stringify(body));
  const bad = await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer wrong' } });
  ok('job: wrong secret refused', bad.status === 403);

  // ── The admin screen ──
  for (const [w, h] of [[1440, 1000], [1024, 800], [390, 844], [320, 640]]) {
    const p = await mk({ sub: 'u1', ua: w >= 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#likes'); await p.waitForTimeout(2500);
    ok(`${w}px: opens "What people like"`, (await p.locator('.admin-title').innerText()) === 'What people like');
    if (w >= 1024) ok(`${w}px: sidebar Content: What people like, Polls & snaps, Notifications`, /Content\s*What people like\s*Trending now\s*Drafts\s*Polls & snaps\s*Notifications/i.test(await p.locator('.admin-side').innerText()));
    ok(`${w}px: asked for 14 days`, (await log()).includes('ADMIN_LIKES 14'));
    const t = flat(await p.locator('.lk').innerText());
    ok(`${w}px: tagging progress note`, /Tagging older polls: 57 polls to go/.test(t), t.slice(0, 300));
    ok(`${w}px: early-days note`, /Early days: 38 polls seen by 5 or more people in 14 days/.test(t));
    ok(`${w}px: tiles (scored, top topic Food, top feel Relatable, tagged 41/46)`, /Polls scored 38/i.test(t) && /Top topic Food Spark 82/i.test(t) && /Top feel Relatable/i.test(t) && /41\/46/.test(t), t.slice(0, 600));
    ok(`${w}px: fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    const vis = async (sel) => p.locator(sel).first().isVisible();
    if (w >= 1024) {
      ok(`${w}px: no tabs, topics + feels + combos all shown`, !(await vis('.lk-tabs')) && (await vis('.lk-p-topics')) && (await vis('.lk-p-feels')) && (await vis('.lk-p-combos')));
    } else {
      ok(`${w}px: tabs, Topics shown first`, (await vis('.lk-tabs')) && (await vis('.lk-p-topics')) && !(await vis('.lk-p-feels')) && !(await vis('.lk-p-combos')));
      await p.getByRole('button', { name: 'Feels' }).click();
      ok(`${w}px: Feels tab`, (await vis('.lk-p-feels')) && !(await vis('.lk-p-topics')));
      await p.getByRole('button', { name: 'Best combos' }).click();
      ok(`${w}px: Best combos tab`, (await vis('.lk-p-combos')) && !(await vis('.lk-p-feels')));
      await shot(p, `${w}-combos`);
      await p.getByRole('button', { name: 'Topics' }).click();
    }
    const topics = flat(await p.locator('.lk-p-topics').innerText());
    ok(`${w}px: topics: Food Clear, Relationships Early, change vs before`, /Food Clear 9 polls · ▲ 12 vs before 82/i.test(topics) && /Relationships Early 3 polls · new 77/i.test(topics) && /Cricket Clear 7 polls · ▼ 3 vs before/i.test(topics), topics);
    const grid = p.locator('.lk-grid');
    ok(`${w}px: grid: Food row, Relatable 88 from 6, untried shows a dash`, /88\s*6/.test(await grid.locator('tr', { hasText: 'Food' }).innerText()) && (await grid.locator('td.lk-h0').count()) > 10);
    ok(`${w}px: grid columns: all 8 feels`, (await grid.locator('thead th').count()) === 9);
    const more = flat(await p.locator('.lk-more').innerText());
    ok(`${w}px: compare: posted by You/People/Eithr, Hinglish vs English, timing, time of day`, /You 4 57 67/.test(more) && /Hinglish 14 58 71/.test(more) && /Timely 9 66 75/.test(more) && /Night, 9–12 12 61 74/.test(more), more);
    const best = flat(await p.locator('section', { has: p.locator('#lk-best') }).innerText());
    ok(`${w}px: best polls with tags, author, split`, /Maggi at 2 am or chai at 6 am\? Food Relatable Eithr · 64 votes \(55\/45\) · 14 shares · 11 comments 91/.test(best) && /Hinglish/.test(best) && /a friends-only or link poll/.test(best) && /Timely/.test(best), best);
    await shot(p, `${w}`);
    if (w === 1440 || w === 320) {
      // Change a poll's tags
      const T = w === 1440
        ? { q: 'Test cricket or T20?', id: 'f1000000-0000-4000-8000-000000000023', topic: 'cricket', feel: 'debate', lang: 'en', was: /Tech/, now: /Cricket Debate Timely/ }
        : { q: 'Mummy ki daant', id: 'f1000000-0000-4000-8000-000000000021', topic: 'relationships', feel: 'emotional', lang: 'hinglish', was: /Friends & family/, now: /Relationships Emotional Timely Hinglish/ };
      const row = p.locator('.lk-list li', { hasText: T.q }).last();
      ok(`${w}px: AI tag visible before the change`, T.was.test(await row.innerText()));
      await row.getByRole('button', { name: /Change tags/ }).click();
      await row.getByLabel('Topic').selectOption(T.topic);
      await row.getByLabel('Feel').selectOption(T.feel);
      await row.getByLabel('Timely').check();
      await shot(p, `${w}-edit`);
      ok(`${w}px: editor fits`, await fits(p));
      await row.getByRole('button', { name: 'Save tags' }).click();
      await p.waitForTimeout(1500);
      L = await log();
      ok(`${w}px: saved with admin_set_poll_tags`, L.includes(`SET_TAGS ${T.id} ${T.topic} ${T.feel} true ${T.lang}`), L.filter((l) => l.startsWith('SET_TAGS')).join(' / '));
      const row2 = flat(await p.locator('.lk-list li', { hasText: T.q }).last().innerText());
      ok(`${w}px: shows new tags, "Tagged by you", "Tags saved."`, T.now.test(row2) && /Tagged by you/.test(row2) && /Tags saved\./.test(flat(await p.locator('.lk').innerText())), row2);
      ok(`${w}px: untagged poll says waiting`, /Not tagged yet.*Waiting for the AI/.test(flat(await p.locator('.lk-list li', { hasText: 'Just posted' }).innerText())));
      // Cancel leaves things alone
      const r3 = p.locator('.lk-list li', { hasText: 'Rate my fit' });
      await r3.getByRole('button', { name: /Change tags/ }).click();
      await r3.getByRole('button', { name: 'Cancel' }).click();
      ok(`${w}px: Cancel closes the editor`, (await r3.getByRole('button', { name: /Change tags/ }).count()) === 1);
    }
    if (w === 1440) {
      await p.getByRole('button', { name: '30 days' }).click(); await p.waitForTimeout(1200);
      ok('range 30 days asks again', (await log()).includes('ADMIN_LIKES 30'));
    }
    await p.context().close();
  }

  // ── Not the admin ──
  const p = await mk({ sub: 'notadmin', ua: MAC, w: 1440, h: 900 });
  await p.goto(B + '/admin#likes'); await p.waitForTimeout(2500);
  ok('not the admin: no likes screen', (await p.locator('.lk').count()) === 0);
  await p.context().close();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
