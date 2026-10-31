const { ROOT, TMP, SHOTS } = require('../env.cjs');
// A poll hidden or removed while the app is open leaves every list: the tab on screen, the
// other tabs, the phone's copy of the feed, and the feed an admin goes back to after removing it.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145';
const M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };

(async () => {
  const b = await chromium.launch();
  const mkCtx = async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    return ctx;
  };
  const errors = [];
  const ids = (p) => p.evaluate(() => [...document.querySelectorAll('[data-feed-item] [data-poll]')].map((e) => e.getAttribute('data-poll')));
  const tab = (p, name) => p.getByRole('tab', { name }).click();
  const waitGone = async (p, id, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) { if (!(await ids(p)).includes(id)) return Date.now(); await p.waitForTimeout(250); } return 0; };

  // ── Hidden behind the app's back (another admin, reports, the AI check) ──
  const ctx = await mkCtx();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  const first = (await ids(p))[0];
  ok('feed shows the poll', !!first, first);
  await tab(p, 'New'); await p.waitForTimeout(1500);
  ok('New shows it too', (await ids(p)).includes(first));
  await tab(p, 'For you'); await p.waitForTimeout(800);
  ok('phone copy has it', await p.evaluate((id) => (localStorage.getItem('eithr.feedSnap') || '').includes(id), first));
  await p.evaluate(() => window.dispatchEvent(new Event('scroll'))); // someone's using the app
  const t0 = Date.now();
  await fetch(`${M}/__hide?id=${first}`);
  const at = await waitGone(p, first);
  ok('gone from the tab on screen, by itself', at > 0, at ? `${((at - t0) / 1000).toFixed(1)} s` : 'still there');
  await tab(p, 'New'); await p.waitForTimeout(150);
  ok('gone from New at once (no reload of the tab)', !(await ids(p)).includes(first));
  ok('gone from the phone copy', !(await p.evaluate((id) => (localStorage.getItem('eithr.feedSnap') || '').includes(id), first)));
  await tab(p, 'For you'); await p.waitForTimeout(150);
  ok('still gone back on For you', !(await ids(p)).includes(first));
  ok('other polls stay', (await ids(p)).length > 0, String((await ids(p)).length));
  await p.reload(); await p.waitForTimeout(300);
  ok('reopening the app: not in the first paint', !(await ids(p)).includes(first));
  await ctx.close();

  // ── Admin removes a poll, then goes back to the feed in the app ──
  const actx = await mkCtx();
  const a = await actx.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(B + '/'); await a.waitForTimeout(2500);
  const target = (await ids(a))[0];
  await a.route(`${M}/rest/v1/rpc/admin_reports`, async (route) => {
    const res = await route.fetch(); const body = await res.json();
    if (body[0]) { body[0].target_id = target; body[0].is_hidden = false; body[0].hidden_reason = null; }
    route.fulfill({ response: res, json: body });
  });
  await a.evaluate(() => window.next.router.push('/admin#reports')); await a.waitForTimeout(2500);
  await a.getByRole('button', { name: 'Remove poll' }).first().click(); await a.waitForTimeout(1200);
  const log = await (await fetch(M + '/__log')).json();
  ok('admin: removed', log.includes(`ADMIN remove poll ${target}`));
  await a.evaluate(() => window.next.router.push('/')); await a.waitForTimeout(200);
  const back = await ids(a);
  ok('admin back on the feed: gone straight away', back.length > 0 && !back.includes(target), `${back.length} cards`);
  await tab(a, 'New'); await a.waitForTimeout(150);
  ok('admin: gone from New too', !(await ids(a)).includes(target));
  await actx.close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(0);
})();
