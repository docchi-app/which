const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Admin phase 1: only the owner gets in (404 for everyone else, decided on the server),
// a sidebar on laptops and tabs on phones, Back to Eithr, test accounts, the admin log.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async (w, h, { sub = 'u1', signedIn = true, expired = false } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 800, hasTouch: w < 800 });
    if (signedIn) {
      const exp = expired ? now - 600 : now + 3600;
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const side = (p) => p.evaluate(() => { const s = document.querySelector('.admin-side'); return !!s && getComputedStyle(s).display !== 'none'; });
  const tabs = (p) => p.evaluate(() => { const s = document.querySelector('.admin-tabs'); return !!s && getComputedStyle(s).display !== 'none'; });
  const flat = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  // ── Turned away: decided on the server ──
  for (const [label, opts] of [['signed in, not the admin', { sub: 'notadmin' }], ['signed out', { signedIn: false }]]) {
    const p = await mk(1366, 800, opts);
    const res = await p.goto(B + '/admin'); await p.waitForTimeout(800);
    const html = await p.content();
    ok(`${label}: 404 from the server, nothing of the admin sent`, res.status() === 404 && !/admin-side|Test accounts|Reports/.test(html), String(res.status()));
    await p.context().close();
  }
  // Expired sign-in: the server can't tell, the page checks (and still turns them away).
  { const p = await mk(390, 800, { sub: 'notadmin', expired: true });
    await p.route(`${M}/auth/v1/token**`, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' }));
    const res = await p.goto(B + '/admin'); await p.waitForTimeout(1500);
    ok('expired sign-in: page checks, says not found, no admin shown', res.status() === 200 && /could not be found/.test(await p.textContent('body')) && (await p.locator('.admin-side-item').count()) === 0);
    await p.context().close(); }

  // ── The owner on a laptop ──
  let p = await mk(1366, 800);
  let res = await p.goto(B + '/admin'); await p.waitForTimeout(1500);
  ok('owner: 200', res.status() === 200);
  ok('laptop: sidebar, no phone tabs', (await side(p)) && !(await tabs(p)));
  ok('laptop: sections grouped (Today, Health, People, Growth, Content, Safety, Run)', JSON.stringify(await p.locator('.admin-side-label').allTextContents()) === '["Today","Health","People","Growth","Content","Safety","Run"]');
  ok('laptop: /admin opens Overview', (await p.locator('.admin-title').textContent()) === 'Overview');
  ok('laptop: content uses the width', await p.evaluate(() => document.querySelector('.admin-main').getBoundingClientRect().width > 900));
  ok('laptop: nothing sideways', await flat(p));
  await p.screenshot({ path: `${SHOTS}/adm-${String(++n).padStart(2, '0')}-laptop-reports.png` });
  await p.getByRole('button', { name: 'Metrics' }).click(); await p.locator('.metric-grid').waitFor({ timeout: 8000 }).catch(() => {});
  ok('section in the address (#metrics)', new URL(p.url()).hash === '#metrics' && (await p.locator('.admin-title').textContent()) === 'Metrics');
  ok('Metrics: four tiles across', await p.evaluate(() => getComputedStyle(document.querySelector('.metric-grid')).gridTemplateColumns.split(' ').length === 4));
  ok('Metrics: says whose numbers are left out', /Leaving out your account/.test(await p.locator('.admin-note').last().textContent()));
  await p.screenshot({ path: `${SHOTS}/adm-${String(++n).padStart(2, '0')}-laptop-metrics.png` });
  await p.reload(); await p.locator('.admin-title').waitFor({ timeout: 8000 }).catch(() => {});
  ok('reload: still on Metrics', (await p.locator('.admin-title').textContent()) === 'Metrics' && (await p.locator('.admin-side-item[aria-current="page"]').textContent()) === 'Metrics');
  // Test accounts.
  await p.getByRole('button', { name: 'Test accounts' }).click(); await p.waitForTimeout(800);
  ok('Test accounts: empty to start', /No test accounts yet/.test(await p.textContent('.admin-tests')));
  await p.locator('#test-account').fill('@Riya_K'); await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(800);
  ok('add @Riya_K: listed, box cleared', (await p.locator('.admin-tests .admin-card').count()) === 1 && /@riya_k/.test(await p.textContent('.admin-tests')) && (await p.locator('#test-account').inputValue()) === '');
  await p.locator('#test-account').fill('mayank'); await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(600);
  ok('your own account: says it\'s always left out', /always left out/.test(await p.locator('.admin-tests .poll-error').textContent()));
  await p.locator('#test-account').fill('nobody'); await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(600);
  ok('unknown username: says so', /No one has that username/.test(await p.locator('.admin-tests .poll-error').textContent()));
  await p.screenshot({ path: `${SHOTS}/adm-${String(++n).padStart(2, '0')}-laptop-tests.png` });
  // Admin log.
  await p.getByRole('button', { name: 'Admin log' }).click(); await p.waitForTimeout(1000);
  const logText = await p.textContent('.admin-main');
  ok('Admin log: moderation and other changes', /Moderation/.test(logText) && /Other changes/.test(logText) && /marked @riya_k as a test account/.test(logText) && /added the word zhantu/.test(logText));
  await p.getByRole('button', { name: 'Test accounts' }).click(); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Count @riya_k again' }).click(); await p.waitForTimeout(700);
  ok('remove: gone from the list', /No test accounts yet/.test(await p.textContent('.admin-tests')));
  // Every section opens without errors.
  for (const name of ['Reports', 'Snaps', 'Words', 'Schedule']) {
    await p.getByRole('button', { name, exact: true }).click(); await p.waitForTimeout(900);
    ok(`laptop: ${name} opens, nothing sideways`, (await p.locator('.admin-title').textContent()) === name && (await flat(p)));
  }
  // Back to Eithr.
  await p.getByRole('link', { name: '← Back to Eithr' }).click(); await p.waitForURL((u) => new URL(u).pathname === '/', { timeout: 8000 }).catch(() => {});
  ok('← Back to Eithr: the feed', new URL(p.url()).pathname === '/');
  await p.context().close();

  // ── Phones ──
  for (const [w, h] of [[390, 844], [320, 568]]) {
    p = await mk(w, h);
    await p.goto(B + '/admin#metrics'); await p.locator('.metric-grid').waitFor({ timeout: 8000 }).catch(() => {});
    ok(`${w}px: tabs, no sidebar, opened on #metrics`, (await tabs(p)) && !(await side(p)) && (await p.locator('.admin-tabs [aria-selected="true"]').textContent()) === 'Metrics');
    ok(`${w}px: nothing sideways`, await flat(p));
    await p.screenshot({ path: `${SHOTS}/adm-${String(++n).padStart(2, '0')}-${w}-metrics.png` });
    await p.getByRole('tab', { name: 'Test accounts' }).click(); await p.waitForTimeout(600);
    ok(`${w}px: Test accounts fits`, await flat(p));
    await p.getByRole('link', { name: 'Back to Eithr' }).first().click(); await p.waitForURL((u) => new URL(u).pathname === '/', { timeout: 8000 }).catch(() => {});
    ok(`${w}px: back button: the feed`, new URL(p.url()).pathname === '/');
    await p.context().close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
