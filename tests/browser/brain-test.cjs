const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Brain breaks: the agent writes one, a second AI checks it, Admin sees and edits it; the card
// keeps the answer until you vote, then right or wrong, the why, the share line and Wrong answer?; the profile teaser.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = process.env.B || 'http://localhost:3145', M = 'http://localhost:54339';
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/bb-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  const fs = require('fs'); const D = TMP + '/';
  const flagOn = (f) => fs.writeFileSync(D + f, '1'); const flagOff = (f) => { try { fs.unlinkSync(D + f); } catch {} };
  for (const f of ['rss-refresh', 'openai-down', 'brain-down', 'brain-alldisagree', 'brain-last-request.json', 'brain-checks.log']) flagOff(f);
  const wait = async (re, ms = 40000, from = 0) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const L = await log(); if (L.slice(from).some((l) => re.test(l))) return L; await new Promise((r) => setTimeout(r, 400)); } return log(); };
  const job = () => fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  const since = async (k) => (await log()).slice(k);

  // ── The agent writes a Brain break ──
  await fetch(M + '/__brain_due');
  let p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(600);
  let k = (await log()).length;
  await job();
  await wait(/^AGENT_SAVE/);
  let L = await since(k);
  const kept = L.filter((l) => l.startsWith('BRAIN kept'));
  const dropped = L.filter((l) => l.startsWith('BRAIN dropped'));
  ok('one Brain break kept: the twister the second check agreed with', kept.length === 1 && /\|twister\|Kitne months/.test(kept[0]), L.filter((l) => l.startsWith('BRAIN')).join(' / '));
  ok('the one the check disagreed with goes in as dropped', dropped.length === 1 && /\|gk\|India ka sabse purana/.test(dropped[0]));
  ok('a third that passed is not saved (one a day)', !L.some((l) => /Goldfish/.test(l)));
  const kv = kept[0]?.split('|') ?? [];
  ok('it carries its right answer, why, feel quiz', kv[4] === '1' && /Feb just stops there/.test(kv[5]) && kv[7] === 'quiz', String(kv));
  const pubAt = new Date(kv[6]);
  const istHour = new Date(pubAt.getTime() + 330 * 60000).getUTCHours();
  ok('set for 1 pm India time', istHour === 13 && pubAt.getTime() > Date.now(), kv[6]);
  ok('the run still saved its normal drafts', L.some((l) => /^AGENT_SAVE [1-9]\d* drafts/.test(l)), L.filter((l) => l.startsWith('AGENT')).join(' / '));
  const breq = JSON.parse(fs.readFileSync(D + 'brain-last-request.json', 'utf8'));
  ok('written by OpenAI with a strict schema', breq._via === 'openai' && breq.response_format.json_schema.strict === true && breq.response_format.json_schema.name === 'eithr_brain');
  ok('the prompt: kinds, last kind and how many got it right, recent ones', /last time was gk/.test(breq.messages[0].content) && /40–70%/.test(breq.messages[0].content) && /right_pct/.test(breq.messages[1].content) && /coastline/.test(breq.messages[1].content));
  const checks = fs.readFileSync(D + 'brain-checks.log', 'utf8').trim().split('\n');
  ok('checked by the other AI (Sarvam), shown only the question and answers', checks.length === 3 && checks.every((c) => c.startsWith('sarvam|') && c.endsWith('["question","answers"]')), checks.join(' / '));
  const dreq = JSON.parse(fs.readFileSync(D + 'agent-last-request.json', 'utf8'));
  ok('the fun voice is in every draft prompt', /write the way friends text each other/.test(dreq.messages[0].content) && /Choose your fighter/.test(dreq.messages[0].content));

  // ── Admin ──
  await p.reload(); await p.waitForTimeout(2500);
  let t = flat(await p.locator('.dr').innerText());
  ok('Admin: the Brain break card with kind, right answer, why, double-checked', /🧠 Brain break\s*Twister/.test(t) && /All 12 ✓/.test(t) && /Why \(shown after voting\) Every month/.test(t) && /✓ Double-checked A second AI got the same answer/.test(t), t.slice(0, 600));
  ok('Admin: the dropped one, with why', /1 Brain break dropped today \(The two checks disagreed\): “India ka sabse purana/.test(t));
  await shot(p, '1440-drafts');
  const card = p.locator('.dr-card', { hasText: 'Kitne months' });
  await card.getByRole('button', { name: /^Change/ }).click(); await p.waitForTimeout(300);
  ok('editor: ✓ buttons, the second marked', (await card.getByRole('button', { name: 'Answer 2 is the right answer' }).getAttribute('aria-pressed')) === 'true' && (await card.getByRole('button', { name: 'Answer 1 is the right answer' }).getAttribute('aria-pressed')) === 'false');
  await card.getByLabel('Why (shown after voting)').fill('');
  await card.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(800);
  ok('editor: an empty why is refused with a clear message', /Mark the right answer .* and write the why/.test(await card.innerText()));
  await card.getByLabel('Why (shown after voting)').fill('Har month mein kam se kam 28 din 😅');
  k = (await log()).length;
  await card.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(1200);
  ok('editor: saved with the right answer and the new why', (await since(k)).some((l) => l === 'BRAIN_SAVE 1|Har month mein kam se kam 28 din 😅'), (await since(k)).join(' / '));
  // Settings
  const bw = p.getByLabel('🧠 Brain breaks a week');
  ok('settings: 3 a week at 1 pm', (await bw.inputValue()) === '3' && (await p.getByLabel('Brain break time').inputValue()) === '13' && /3 a week: Monday, Wednesday and Friday/.test(await p.locator('.dr').innerText()));
  await bw.selectOption('5');
  ok('settings: 5 explains the days', /5 a week: Monday to Friday/.test(await p.locator('.dr').innerText()));
  await p.getByRole('button', { name: 'Odd one out', exact: true }).click();
  k = (await log()).length;
  await p.locator('#dr-settings').locator('..').getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
  ok('settings: saved (5 a week, 1 pm, odd one out off)', (await since(k)).some((l) => l === 'BRAIN_SETTINGS 5|13|odd'), (await since(k)).join(' / '));
  ok('1440: fits', await fits(p));
  await p.context().close();

  // ── Admin at 390 ──
  p = await mk({ sub: 'u1' });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  ok('390: Admin drafts fit', await fits(p));
  await shot(p, '390-drafts');
  await p.context().close();

  // ── The card ──
  await fetch(M + '/__brain_poll');
  for (const w of [390, 320]) {
    p = await mk({ sub: 'u2', w, h: 800 });
    await p.goto(B + '/'); await p.waitForTimeout(2500);
    const c = p.locator('article[data-poll="b1000000-0000-4000-8000-000000000001"]');
    const before = flat(await c.innerText());
    if (w === 390) {
      ok('before voting: the 🧠 Brain break label, the hook, "the answer shows after you vote"', /🧠\s*Brain break/i.test(before) && /Dimaag lagao 👀 · 1 sec, socho mat/.test(before) && /the answer shows after you vote/.test(before), before.slice(0, 300));
      ok('before voting: no answer asked for or shown', !(await log()).some((l) => l.startsWith('BRAIN_REVEAL')) && !/✓/.test(before));
      await shot(p, '390-before');
      k = (await log()).length;
      await c.getByRole('button', { name: /Sirf 1 \(Feb\)/ }).click(); await p.waitForTimeout(2000);
      const after = flat(await c.innerText());
      ok('wrong: "Arre yaar 😅 …% fell for it too. Not just you."', /Arre yaar 😅 \d+% fell for it too\. Not just you\./.test(after), after.slice(0, 500));
      ok('wrong: the right answer marked, the twist explained', (await c.locator('.result-right').innerText()).includes('All 12') && (await c.getByLabel('Right answer').count()) === 1 && /Here's the twist Every month has at least 28 days/.test(after));
      ok('wrong: "Trap a friend with this 🪤"', /Trap a friend with this 🪤/.test(after));
      ok('the answer was asked for only after voting', (await since(k)).some((l) => l === 'BRAIN_REVEAL answered'));
      ok('390 after voting: fits', await fits(p));
      await shot(p, '390-wrong');
      k = (await log()).length;
      await c.getByRole('button', { name: 'Wrong answer? Tell us' }).click(); await p.waitForTimeout(800);
      ok('Wrong answer?: sent, thanked, once', (await since(k)).some((l) => l.startsWith('BRAIN_FLAG')) && /Thanks, we'll double-check it ✓/.test(await c.innerText()) && (await c.getByRole('button', { name: /Thanks/ }).isDisabled()));
      // The same vote, with the answer flipped: right.
      await fetch(M + '/__brain_answer?i=0');
      await p.reload(); await p.waitForTimeout(2500);
      const right = flat(await c.innerText());
      ok('right: "Big brain energy 🧠✨ Only N% got this."', /Big brain energy 🧠✨ Only \d+% got this\./.test(right), right.slice(0, 400));
      ok('right: "Send to someone who\'ll say All 12 😏"', /Send to someone who'll say All 12 😏/.test(right));
      ok('a flag already sent stays thanked', /Thanks, we'll double-check it ✓/.test(right));
      await shot(p, '390-right');
      await fetch(M + '/__brain_answer?i=1');
    } else {
      ok('320: the card fits after voting', await fits(p));
      await shot(p, '320-card');
    }
    await p.context().close();
  }

  // ── Profile teaser ──
  p = await mk({ sub: 'u2' });
  await p.goto(B + '/profile'); await p.waitForTimeout(2500);
  let pt = flat(await p.locator('.brain-teaser').innerText().catch(() => ''));
  ok('profile: "Brain streak: coming soon" with my right answers', /Brain streak: coming soon/.test(pt) && /You got 4 Brain breaks right/.test(pt), pt);
  ok('profile 390: fits', await fits(p));
  await shot(p, '390-profile');
  await p.context().close();

  // ── The Brain break call failing doesn't stop the run ──
  flagOn('brain-down');
  await fetch(M + '/__brain_due');
  p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(600);
  await p.context().close();
  k = (await log()).length;
  await job();
  await wait(/^AGENT_SAVE/, 40000, k);
  L = await since(k);
  ok('Brain break writer down: the normal drafts still save, the error is reported', L.some((l) => /^AGENT_SAVE [1-9]\d* drafts/.test(l)) && !L.some((l) => l.startsWith('BRAIN ')) && L.some((l) => /SERVER_ERROR job\|Background job · content agent \(Brain break\)/.test(l)), L.filter((l) => /AGENT|BRAIN|SERVER_ERROR/.test(l)).join(' / '));
  flagOff('brain-down');

  // ── Before the migration ──
  await fetch(M + '/__fn_state?name=my_brain_score&state=missing');
  p = await mk({ sub: 'u2' });
  await p.goto(B + '/profile'); await p.waitForTimeout(2500);
  ok('profile before the migration: no teaser, no crash', (await p.locator('.brain-teaser').count()) === 0 && /Streak/.test(await p.locator('body').innerText()));
  await p.context().close();
  await fetch(M + '/__fn_state?name=my_brain_score&state=ok');
  await fetch(M + '/__no_brain_settings');
  p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  ok('Admin before the migration: no Brain break settings', (await p.getByLabel('🧠 Brain breaks a week').count()) === 0);
  await p.getByLabel('Drafts a day').selectOption('9');
  k = (await log()).length;
  await p.locator('#dr-settings').locator('..').getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
  L = await since(k);
  ok('Admin before the migration: settings still save (no Brain break fields sent)', L.some((l) => /^AGENT_SETTINGS false\|9\|/.test(l)) && !L.some((l) => /PGRST202|BRAIN_SETTINGS/.test(l)) && /Saved\./.test(await p.locator('.dr').innerText()), L.join(' / '));
  await p.context().close();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
