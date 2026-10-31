const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Settings → Send me a test email (admin only): picker, send via fake Resend, limits, errors.
const { chromium } = require('playwright');
const fs = require('fs');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const SENT = TMP + '/resend-sent.json';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const jwtFor = (sub) => `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const sent = () => { try { return JSON.parse(fs.readFileSync(SENT, 'utf8')); } catch { return []; } };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async (sub, w = 390, h = 844) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ANDROID, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwtFor(sub), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  try { fs.unlinkSync(SENT); } catch {}

  // Not the admin: no test row, and the route refuses.
  let p = await mk('notadmin');
  await p.goto(B + '/settings'); await p.waitForTimeout(2200);
  ok('non-admin: Email switch shows, no test row', (await p.getByRole('switch', { name: /Email me what I missed/ }).count()) === 1 && (await p.getByText('Send me a test email').count()) === 0);
  await p.context().close();
  const api = (body, token) => fetch(B + '/api/email/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  let r = await api({ version: 'tie' });
  ok('route: no token → 401 sign_in', r.status === 401 && (await r.json()).error === 'sign_in');
  r = await api({ version: 'tie' }, jwtFor('notadmin'));
  ok('route: non-admin → 403 not_admin', r.status === 403 && (await r.json()).error === 'not_admin');
  r = await api({ version: 'nope' }, jwtFor('u1'));
  ok('route: unknown version → 400', r.status === 400);
  ok('nothing sent so far', sent().length === 0);

  // The admin, on a phone and a small phone.
  for (const [w, h] of [[390, 844], [320, 640]]) {
    p = await mk('u1', w, h);
    await p.goto(B + '/settings'); await p.waitForTimeout(2200);
    const row = p.locator('.email-test');
    await row.scrollIntoViewIfNeeded();
    ok(`${w}px: admin sees the test row with a picker and Send`, (await row.count()) === 1 && (await row.getByRole('combobox', { name: 'Which email' }).count()) === 1 && (await row.getByRole('button', { name: 'Send' }).count()) === 1);
    ok(`${w}px: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const box = await row.boundingBox(); const btn = await row.getByRole('button', { name: 'Send' }).boundingBox();
    ok(`${w}px: Send button inside the card`, btn.x + btn.width <= box.x + box.width + 0.5, JSON.stringify([box, btn]));
    if (w === 390) await p.screenshot({ path: TMP + '/emailtest-settings.png', clip: { x: 0, y: Math.max(0, box.y - 120), width: w, height: Math.min(500, box.height + 200) } });
    if (w === 320) break;
    // Send a few versions.
    const versions = ['tie', 'props', 'closed'];
    for (const v of versions) {
      await row.getByRole('combobox', { name: 'Which email' }).selectOption(v);
      await row.getByRole('button', { name: 'Send' }).click();
      await p.waitForFunction(() => /Sent to|didn't|Couldn't|set up/.test(document.querySelector('.email-test [role=status]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
    }
    const status = await row.locator('[role=status]').textContent();
    ok('status: Sent to your address', /Sent to mayank@example\.com\. Check your inbox \(and spam\)\./.test(status), status);
    const s = sent();
    ok('3 emails, all to the admin, subjects marked [Test]', s.length === 3 && s.every((x) => x.body.to[0] === 'mayank@example.com' && /^\[Test\] /.test(x.body.subject)), JSON.stringify(s.map((x) => [x.body.to, x.body.subject])));
    ok('tie version: tie subject + See the tie', /tie|tied/i.test(s[0].body.subject) && /See the tie/.test(s[0].body.html), s[0].body.subject);
    ok('props version: props subject, never who', /💜/.test(s[1].body.subject) && /never say who/.test(s[1].body.text), s[1].body.subject);
    ok('closed version: final result', /final result|closed/i.test(s[2].body.subject) && /See the final result/.test(s[2].body.html), s[2].body.subject);
    ok('tagged as a test in Resend', s.every((x) => x.body.tags?.[0]?.value === 'test'));
    ok('sample poll, no real data', s.every((x) => !/undefined|null|NaN/.test(x.body.subject + x.body.text)));
    const log = await (await fetch(M + '/__log')).json();
    ok('each test recorded', ['EMAIL_TEST tie', 'EMAIL_TEST props', 'EMAIL_TEST closed'].every((l) => log.includes(l)));
    // Resend refuses (e.g. domain not verified): its own message is shown.
    fs.writeFileSync(TMP + '/resend-fail', '1');
    await row.getByRole('button', { name: 'Send' }).click(); await p.waitForTimeout(1500);
    const refused = await row.locator('[role=status]').textContent();
    fs.unlinkSync(TMP + '/resend-fail');
    ok('Resend refuses: shows its message', /Resend didn't send it: The eithr\.app domain is not verified\./.test(refused), refused);
    // Up to the limit, then a clear message.
    for (let i = 0; i < 6; i++) await api({ version: 'first' }, jwtFor('u1'));
    await row.getByRole('button', { name: 'Send' }).click();
    await p.waitForTimeout(1500);
    const limited = await row.locator('[role=status]').textContent();
    ok('11th: "That\'s 10 test emails today"', /10 test emails today/.test(limited), limited);
    ok('only 9 delivered in all (the refused one counts toward the 10)', sent().length === 9, String(sent().length));
    await p.context().close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
