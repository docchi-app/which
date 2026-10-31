const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The phone's back button: closes the sheet or menu on top, steps back through the snap
// screens, and never leaves an empty step behind.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145';
const M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mkCtx = async (seen = true) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['camera'] });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - (seen ? 30 * 864e5 : 0)).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    if (seen) await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    return ctx;
  };
  const errors = [];
  const ctx = await mkCtx();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const path = () => new URL(p.url()).pathname;
  const back = async () => { await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(700); };
  const sheets = () => p.locator('.sheet-layer').count();
  const nav = async (label) => { await p.locator(`.nav-pill a[aria-label="${label}"], .nav-pill a:has-text("${label}")`).first().click(); await p.waitForTimeout(1500); };

  // Start on Friends, then the feed: the feed has a screen before it.
  await p.goto(B + '/friends'); await p.waitForTimeout(1500);
  await nav('Feed');
  ok('on the feed', path() === '/');

  // ── Comments ──
  await p.mouse.wheel(0, 500); await p.waitForTimeout(500);
  const y0 = await p.evaluate(() => scrollY);
  await p.locator('.feed-item [aria-label*="omment" i]').first().click(); await p.waitForTimeout(1200);
  ok('comments open', (await p.locator('.comments-sheet').count()) === 1);
  await back();
  ok('back: comments close', (await p.locator('.comments-sheet').count()) === 0);
  ok('...and the feed stays', path() === '/' && (await p.locator('.feed-item').count()) > 0);
  ok('...at the same place', Math.abs((await p.evaluate(() => scrollY)) - y0) < 5, `${y0} → ${await p.evaluate(() => scrollY)}`);
  // Close with ✕, then back once: leaves the feed (no empty step).
  await p.locator('.feed-item [aria-label*="omment" i]').first().click(); await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'Close comments' }).click(); await p.waitForTimeout(600);
  ok('✕ closes comments', (await p.locator('.comments-sheet').count()) === 0 && path() === '/');
  await back();
  ok('then one back leaves the feed (to Friends)', path() === '/friends', path());
  await p.goForward().catch(() => {}); await p.waitForTimeout(1500);
  if (path() !== '/') { await nav('Feed'); }

  // ── Report sheet ──
  await p.locator('.feed-item .more-btn').first().click(); await p.waitForTimeout(1000);
  ok('report sheet open', (await p.locator('.report-sheet').count()) === 1);
  await back();
  ok('back: report sheet closes, still on the feed', (await p.locator('.report-sheet').count()) === 0 && path() === '/');

  // ── Share sheet ──
  await p.locator('.feed-item button', { hasText: 'Share' }).first().click().catch(() => {});
  await p.locator('.feed-item [aria-label="Share"]').first().click().catch(() => {});
  await p.waitForTimeout(1000);
  ok('share sheet open', (await p.locator('.share-sheet').count()) === 1);
  await back();
  ok('back: share sheet closes, still on the feed', (await p.locator('.share-sheet').count()) === 0 && path() === '/');
  ok('no sheet left anywhere', (await sheets()) === 0);

  // ── + menu ──
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  ok('+ menu open', (await p.locator('.create-menu').count()) === 1);
  await back();
  ok('back: + menu closes, still on the feed', (await p.locator('.create-menu').count()) === 0 && path() === '/');
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Type it/ }).click(); await p.waitForURL(/\/create/); await p.waitForTimeout(1200);
  await back();
  ok('Type it, then back: the feed (not the menu)', path() === '/' && (await p.locator('.create-menu').count()) === 0, path());
  await back();
  ok('one more back: Friends (no empty steps)', path() === '/friends', path());
  await p.goForward().catch(() => {}); await p.waitForTimeout(1200);
  if (path() !== '/') { await nav('Feed'); }

  // ── Create: ✕ and after posting ──
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Type it/ }).click(); await p.waitForURL(/\/create/); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Close' }).click(); await p.waitForTimeout(1200);
  ok('Type it ✕: back to the feed', path() === '/', path());
  await back();
  ok('...which was a step back, not a new step (back: Friends)', path() === '/friends', path());
  await p.goForward().catch(() => {}); await p.waitForTimeout(1200);
  if (path() !== '/') { await nav('Feed'); }
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Type it/ }).click(); await p.waitForURL(/\/create/); await p.waitForTimeout(1200);
  await p.keyboard.type('Back button test?');
  await p.getByLabel('Answer 1').fill('Yes'); await p.getByLabel('Answer 2').fill('No');
  await p.getByRole('button', { name: /Post poll/ }).click(); await p.waitForTimeout(3000);
  ok('posted: on the new poll with its share sheet', path() === '/' && (await p.locator('.share-sheet').count()) === 1);
  await back();
  ok('back: the share sheet closes', (await p.locator('.share-sheet').count()) === 0 && path() === '/');
  await back();
  ok('back again: not the empty create form', path() !== '/create', path());

  // ── Snap: back steps back to the camera ──
  await p.goto(B + '/'); await p.waitForTimeout(1500);
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Snap it/ }).click(); await p.waitForURL(/\/snap/); await p.waitForTimeout(2000);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1200);
  ok('photo taken: asking', (await p.locator('.ask-screen').count()) === 1);
  await back();
  ok('back: the camera again, still /snap', (await p.locator('.cam-shutter').count()) === 1 && path() === '/snap', path());
  await p.waitForTimeout(800);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  await p.locator('.ask-screen button[aria-label="Retake"]').click(); await p.waitForTimeout(800);
  ok('Retake button: the camera', (await p.locator('.cam-shutter').count()) === 1 && path() === '/snap');
  await back();
  ok('then back: leaves /snap for the feed (no empty step)', path() === '/', path());
  // ✕ on the camera goes back, not forward.
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Snap it/ }).click(); await p.waitForURL(/\/snap/); await p.waitForTimeout(1800);
  await p.locator('.cam-screen button[aria-label="Close"]').click(); await p.waitForTimeout(1200);
  ok('camera ✕: the feed', path() === '/', path());
  // Sending: back afterwards doesn't return to the ask screen.
  await p.locator('.create-btn').click(); await p.waitForTimeout(300);
  await p.getByRole('menuitem', { name: /Snap it/ }).click(); await p.waitForURL(/\/snap/); await p.waitForTimeout(1800);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  await p.getByRole('radio', { name: /Everyone/ }).click();
  await p.locator('.ask-send').click();
  await p.locator('.check-review').waitFor({ timeout: 25000 }).catch(() => {});
  ok('sent: waiting for review', (await p.locator('.check-review').count()) === 1);
  await back();
  ok('back from the review: the feed (not retake)', path() === '/', path());

  // ── Profile: ••• menu, Share from it, Settings ──
  await p.goto(B + '/profile'); await p.waitForTimeout(2000);
  await p.locator('button[aria-label="Poll options"]').first().click(); await p.waitForTimeout(300);
  ok('poll menu open', (await p.locator('.poll-menu').count()) === 1);
  await back();
  ok('back: the menu closes, still on Profile', (await p.locator('.poll-menu').count()) === 0 && path() === '/profile');
  await p.locator('button[aria-label="Poll options"]').first().click(); await p.waitForTimeout(300);
  await p.locator('.poll-menu [role=menuitem]', { hasText: /Share/ }).first().click(); await p.waitForTimeout(1200);
  ok('menu → Share: the share sheet', (await p.locator('.share-sheet').count()) === 1 && (await p.locator('.poll-menu').count()) === 0);
  await back();
  ok('back: share sheet closes, still on Profile', (await p.locator('.share-sheet').count()) === 0 && path() === '/profile', path());
  await p.locator('a[href="/settings"]').first().click(); await p.waitForURL(/settings/); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Back' }).click(); await p.waitForTimeout(1200);
  ok('Settings ←: Profile', path() === '/profile', path());
  await p.goForward().catch(() => {}); await p.waitForTimeout(1000);
  ok('...as a step back (forward returns to Settings)', path() === '/settings', path());

  // ── A link inside comments: back from there skips the closed sheet ──
  await fetch(M + '/rest/v1/rpc/post_comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ poll: 'a1000000-0000-4000-8000-000000000001', body: 'Hello there' }) });
  await p.goto(B + '/friends'); await p.waitForTimeout(1200);
  await nav('Feed');
  await p.locator('.feed-item[data-poll="a1000000-0000-4000-8000-000000000001"] [aria-label*="omment" i], [data-poll="a1000000-0000-4000-8000-000000000001"] [aria-label*="omment" i]').first().click(); await p.waitForTimeout(1500);
  await p.locator('.comment-name').first().click(); await p.waitForTimeout(1800);
  ok('comment name → profile page', /^\/(u\/|profile)/.test(path()), path());
  await back();
  ok('back: the feed, no comments sheet', path() === '/' && (await p.locator('.comments-sheet').count()) === 0, path());
  await back();
  ok('back again: Friends (the closed sheet\'s step is skipped)', path() === '/friends', path());

  // ── First visit: "How Eithr works" ──
  const fresh = await mkCtx(false);
  const f = await fresh.newPage();
  f.on('pageerror', (e) => errors.push(e.message));
  await f.goto(B + '/friends'); await f.waitForTimeout(1200);
  await f.goto(B + '/'); await f.waitForTimeout(2500);
  const had = await f.locator('.howto-sheet').count();
  await f.goBack({ waitUntil: 'commit' }).catch(() => {}); await f.waitForTimeout(800);
  ok('first visit: back closes "How Eithr works" and stays', had === 1 && (await f.locator('.howto-sheet').count()) === 0 && new URL(f.url()).pathname === '/', `${had} ${f.url()}`);
  ok('...and it counts as seen', await f.evaluate(() => !!localStorage.getItem('docchi.welcomed')));
  await fresh.close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close();
  process.exit(0);
})();
