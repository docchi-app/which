const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Two fixes: (1) leaving a person's page (‹ Users) in Chrome/Edge versions where scrollIntoView
// returns a Promise; (2) failed counting calls (visit, visitor, taps, opens) aren't reported.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const full = async () => (await fetch(M + '/__error_reports')).json();
const reports = async () => (await (await fetch(M + '/__log')).json()).filter((l) => l.startsWith('ERROR_REPORT'));
(async () => {
  const b = await chromium.launch();
  const mk = async (w, h, sub) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    // Like Chrome/Edge 2025+: scroll methods return a Promise.
    await ctx.addInitScript(() => { const o = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (...a) { o.apply(this, a); return Promise.resolve(); }; try { localStorage.setItem('eithr.firstOpenDone', '1'); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    return ctx.newPage();
  };
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await mk(w, h, 'u1');
    const before = (await reports()).length;
    await p.goto(B + '/admin#users'); await p.waitForTimeout(2500);
    await p.locator('.ppl-row').first().click(); await p.waitForTimeout(1500);
    ok(`${w}px: person page open`, (await p.locator('.ppl-name').count()) === 1);
    await p.getByRole('button', { name: '‹ Users' }).click(); await p.waitForTimeout(1500);
    const now2 = (await reports()).slice(before);
    ok(`${w}px: ‹ Users goes back to the list, no crash`, (await p.locator('.ppl-row').count()) >= 1 && !now2.some((l) => /not a function/.test(l)), now2.join(' | '));
    await p.context().close();
  }
  // Counting calls failing (a blocker): not reported. A real call failing: still reported.
  const p = await mk(1280, 800, null);
  await p.route('**/rest/v1/rpc/record_visitor', (r) => r.abort('blockedbyclient'));
  await p.route('**/rest/v1/rpc/track_visit', (r) => r.abort('failed'));
  const before = (await full()).length;
  await p.goto(B + '/?utm_source=email&utm_campaign=summary-lunch'); await p.waitForTimeout(3000);
  await p.evaluate(() => fetch('http://localhost:54339/rest/v1/rpc/email_opened', { method: 'POST' }).catch(() => {}));
  await p.route('**/rest/v1/rpc/feed_page**', (r) => r.abort('failed'));
  await p.evaluate(() => fetch('http://localhost:54339/rest/v1/rpc/feed_page', { method: 'POST' }).catch(() => {}));
  await p.waitForTimeout(1500);
  const got = (await full()).slice(before).map((r) => `${r.kind}|${r.code}`);
  ok('blocked visit / visitor / email-open calls: not reported', !got.some((l) => /track_visit|record_visitor|email_opened/.test(l)), got.join(' | '));
  ok('a real call failing (feed): still reported', got.includes('NetworkError|database: feed_page'), got.join(' | '));
  await p.context().close();
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
