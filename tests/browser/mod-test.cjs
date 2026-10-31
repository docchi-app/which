const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Moderation in the app: Admin → Words, the auto-check label in the queue, and the AI
// check asked for right after posting a typed poll or a comment (fake OpenAI preloaded
// into the server: "dumbest" → harassment 0.95, "ugly" → 0.55).
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145';
const M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const log = async () => (await (await fetch(M + '/__log')).json());
const waitLog = async (re, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const l = (await log()).find((x) => re.test(x)); if (l) return l; await new Promise((r) => setTimeout(r, 300)); } return null; };

(async () => {
  const b = await chromium.launch();
  const mkCtx = async (w = 390) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    return ctx;
  };
  const errors = [];
  const ctx = await mkCtx();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const shot = (name) => p.screenshot({ path: `${SHOTS}/mod-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });

  // ── Admin queue: auto-check label ──
  await p.goto(B + '/admin#reports'); await p.waitForTimeout(2000);
  ok('queue: an AI-filed report says so', /🤖 Auto check: harassment/.test(await p.locator('.admin-reasons').first().textContent().catch(() => '')));

  // ── Admin → Words ──
  await p.getByRole('tab', { name: 'Words' }).click(); await p.waitForTimeout(1200);
  ok('Words: the list', (await p.locator('.word-row').count()) === 3, String(await p.locator('.word-row').count()));
  await p.getByLabel('Test any text').fill('chal na bsdk'); await p.waitForTimeout(900);
  ok('test: blocked, and by what', /Blocked by: bsdk/.test(await p.locator('.word-verdict').textContent()));
  await p.getByLabel('Test any text').fill('shiitake risotto'); await p.waitForTimeout(900);
  ok('test: an allowed word goes through', /Goes through/.test(await p.locator('.word-verdict').textContent()));
  await p.getByLabel('Add a word').fill('Zhantu'); await p.getByLabel('How it matches').selectOption('word'); await p.getByLabel('Language').selectOption('mr');
  await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(1000);
  ok('add: in the list, cleaned', (await p.locator('.word-term').allTextContents()).includes('zhantu') && !!(await waitLog(/^WORD\+ zhantu word$/)));
  await p.getByLabel('Find a word').fill('zhan'); await p.waitForTimeout(200);
  ok('find: filters the list', (await p.locator('.word-row').count()) === 1);
  await shot('words');
  await p.getByRole('button', { name: 'Remove zhantu' }).click(); await p.waitForTimeout(800);
  ok('remove: gone', (await p.locator('.word-row').count()) === 0 && !!(await waitLog(/^WORD- zhantu$/)));
  await p.getByLabel('Find a word').fill('');
  await p.getByLabel('Add a word').fill('a');
  ok('one letter: Add stays off', await p.getByRole('button', { name: 'Add', exact: true }).isDisabled());
  ok('Words: nothing sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // ── Typed poll: posted, then checked (hide) ──
  await p.goto(B + '/create'); await p.waitForTimeout(1500);
  await p.keyboard.type('Who is the dumbest guy in class?');
  await p.getByLabel('Answer 1').fill('Ravi'); await p.getByLabel('Answer 2').fill('Amit');
  await p.getByRole('button', { name: /Post poll/ }).click();
  ok('posted at once (lands on the poll)', await p.waitForURL(/\/\?poll=/, { timeout: 8000 }).then(() => true).catch(() => false));
  const v1 = await waitLog(/^VERDICT poll /);
  ok('then checked: hidden for harassment', v1 === 'VERDICT poll hide harassment', v1);
  // ── A fine poll: ok ──
  await p.goto(B + '/create'); await p.waitForTimeout(1500);
  await p.keyboard.type('Tea or coffee this evening?');
  await p.getByLabel('Answer 1').fill('Tea'); await p.getByLabel('Answer 2').fill('Coffee');
  await p.getByRole('button', { name: /Post poll/ }).click(); await p.waitForURL(/\/\?poll=/, { timeout: 8000 }).catch(() => {});
  const v2 = await waitLog(/^VERDICT poll ok$/);
  ok('a fine poll: ok', !!v2, v2);
  // ── Violence aimed at someone: hidden; a film fight: only reviewed ──
  await p.goto(B + '/create'); await p.waitForTimeout(1500);
  await p.keyboard.type('Should we beat up the new kid after school?');
  await p.getByLabel('Answer 1').fill('Yes'); await p.getByLabel('Answer 2').fill('No');
  await p.getByRole('button', { name: /Post poll/ }).click(); await p.waitForURL(/\/\?poll=/, { timeout: 8000 }).catch(() => {});
  const v4 = await waitLog(/^VERDICT poll .*violence$/);
  ok('beat up the new kid: hidden for violence', v4 === 'VERDICT poll hide violence', v4);
  await p.goto(B + '/create'); await p.waitForTimeout(1500);
  await p.keyboard.type('Which KGF fight scene was the best?');
  await p.getByLabel('Answer 1').fill('Mumbai'); await p.getByLabel('Answer 2').fill('Climax');
  await p.getByRole('button', { name: /Post poll/ }).click(); await p.waitForURL(/\/\?poll=/, { timeout: 8000 }).catch(() => {});
  const v5 = await waitLog(/^VERDICT poll review violence$/);
  ok('film fight scene: review only, stays up', !!v5, v5);
  // ── A comment: review ──
  await p.goto(B + '/'); await p.waitForTimeout(2000);
  const first = p.locator('.feed-item').first();
  await first.locator('.answer, button.snapc-answer').first().click().catch(() => {}); await p.waitForTimeout(1500);
  await first.locator('[aria-label*="omment" i]').first().click(); await p.waitForTimeout(1500);
  await p.locator('.comments-sheet textarea, .comments-sheet input[type=text]').first().fill('you are so ugly lol');
  await p.locator('.comments-sheet button[type=submit], .comments-sheet button:has-text("Post"), .comments-sheet button:has-text("Send")').first().click();
  const v3 = await waitLog(/^VERDICT comment /);
  ok('comment: then checked, sent for review', v3 === 'VERDICT comment review harassment', v3);

  // ── Small phone: Words fits ──
  const small = await mkCtx(320);
  const s = await small.newPage();
  await s.goto(B + '/admin'); await s.waitForTimeout(1500);
  await s.getByRole('tab', { name: 'Words' }).click(); await s.waitForTimeout(1000);
  ok('320 px: Words fits (nothing sideways)', await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await s.screenshot({ path: `${SHOTS}/mod-${String(++n).padStart(2, '0')}-words-320.png`, fullPage: true });
  await small.close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(0);
})();
