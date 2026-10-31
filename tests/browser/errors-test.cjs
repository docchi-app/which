const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Errors: catching in the app (script errors, rejections, failed requests, a screen that fails
// to draw), the "Something went wrong" screen, server/job reports, and Admin → Errors at
// phone and laptop sizes.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const log = async () => (await fetch(M + '/__log')).json();
const reports = async () => (await fetch(M + '/__error_reports')).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async ({ sub = null, ua = IPHONE, w = 390, h = 844 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/Test boom|Rejected thing|ResizeObserver|repeat me|options|flood|In Instagram|aborted a request/.test(e.message)) errors.push(e.message); });
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/err-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });

  // ── Catching, as a signed-out visitor on an iPhone ──
  let p = await mk();
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  await p.evaluate(() => setTimeout(() => { throw new Error('Test boom 42'); }));
  await p.evaluate(() => { Promise.reject(new TypeError('Rejected thing')); });
  await p.evaluate(() => setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }));
  await p.evaluate(() => { Promise.reject(new DOMException('The user aborted a request.', 'AbortError')); });
  await p.evaluate(async () => { await fetch('http://localhost:54339/rest/v1/rpc/boom_500', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
  for (let i = 0; i < 5; i++) await p.evaluate(() => setTimeout(() => { throw new Error('repeat me'); }));
  await p.waitForTimeout(1500);
  let L = await log();
  ok('script error reported, with the screen', L.includes('ERROR_REPORT Error|Test boom 42|Feed (/)'), L.filter((l) => l.startsWith('ERROR_REPORT')).join(' / '));
  ok('unhandled rejection reported', L.includes('ERROR_REPORT TypeError|Rejected thing|Feed (/)'));
  ok('a 500 from the database reported, naming the call', L.includes('ERROR_REPORT ServerResponse|500 from database: boom_500|Feed (/)'));
  ok('noise ignored (ResizeObserver, AbortError)', !L.some((l) => /ResizeObserver|aborted/.test(l) && l.startsWith('ERROR_REPORT')));
  ok('the same error at most 3 times per page load', L.filter((l) => l === 'ERROR_REPORT Error|repeat me|Feed (/)').length === 3);
  let R = await reports();
  const boom = R.find((r) => r.message === 'Test boom 42');
  ok('details: iPhone, Safari, not installed, app version, visitor code, path', boom && boom.device === 'iPhone' && boom.browser === 'Safari' && boom.in_app === null && boom.installed === false && boom.app_version === 'dev' && /^[0-9a-f-]{36}$/.test(boom.visitor) && boom.path === 'Feed (/)', JSON.stringify(boom));
  ok('details: stack (first lines) and code', boom && /Test boom 42/.test(boom.stack) && boom.stack.split('\n').length <= 8 && boom.code !== undefined);
  ok('nothing typed is sent (only these fields)', boom && Object.keys(boom).sort().join(',') === 'app_version,browser,code,device,in_app,installed,kind,message,path,place,prev_path,stack,visitor', Object.keys(boom ?? {}).join(','));
  // 20 an hour from one browser (the server limits too).
  await p.evaluate(() => { for (let i = 0; i < 30; i++) setTimeout(() => { throw new Error('flood ' + i); }); });
  await p.waitForTimeout(1500);
  R = await reports();
  ok('at most 20 reports an hour from one phone', R.length <= 20, String(R.length));
  // Instagram's browser.
  await p.context().close();
  p = await mk({ ua: IPHONE.replace('Safari/604.1', 'Instagram 300.0.0 (iPhone14,5)') });
  await p.goto(B + '/'); await p.waitForTimeout(2000);
  await p.evaluate(() => setTimeout(() => { throw new Error('In Instagram'); }));
  await p.waitForTimeout(1200);
  ok('Instagram browser detected', (await reports()).find((r) => r.message === 'In Instagram')?.in_app === 'Instagram');
  await p.context().close();

  // ── A screen that fails to draw ──
  p = await mk();
  await fetch(M + '/__crash_get_poll');
  await p.goto(B + '/'); await p.waitForTimeout(3000);
  const oops = p.getByRole('heading', { name: 'Something went wrong' });
  ok('"Something went wrong" instead of a blank page', (await oops.count()) === 1, (await p.locator('body').innerText()).slice(0, 200));
  if (!(await oops.count())) { console.log('no crash; stopping'); await fetch(M + '/__crash_get_poll?off'); }
  ok('says it was reported, offers Try again and Go to the feed', (await oops.count()) === 1 && /We’ve been told about it|We've been told about it/.test(await p.locator('.oops-card').innerText()) && (await p.getByRole('button', { name: 'Try again' }).count()) === 1 && (await p.getByRole('button', { name: 'Go to the feed' }).count()) === 1);
  await shot(p, 'oops-390');
  await p.waitForTimeout(800);
  L = await log();
  ok('render error reported from the feed', L.some((l) => /^ERROR_REPORT (Render|TypeError)\|.*\|Feed \(\/\)$/.test(l)), L.filter((l) => l.startsWith('ERROR_REPORT')).slice(-3).join(' / '));
  ok('the saved feed copy is cleared (no crash loop on reload)', await p.evaluate(() => localStorage.getItem('eithr.feedSnap') === null));
  await fetch(M + '/__crash_get_poll?off');
  await p.getByRole('button', { name: 'Try again' }).click(); await p.waitForTimeout(2500);
  ok('Try again: the feed shows', (await oops.count()) === 0 && (await p.locator('.poll-card').count()) > 0);
  await p.context().close();
  p = await mk({ w: 320, h: 640 });
  await fetch(M + '/__crash_get_poll');
  await p.goto(B + '/'); await p.waitForTimeout(3000);
  ok('320 px: error screen fits', (await p.getByRole('heading', { name: 'Something went wrong' }).count()) === 1 && (await p.evaluate(() => document.documentElement.scrollWidth <= 320)));
  await fetch(M + '/__crash_get_poll?off');
  await p.getByRole('button', { name: 'Go to the feed' }).click(); await p.waitForURL(B + '/', { timeout: 8000 }).catch(() => {});
  ok('Go to the feed', new URL(p.url()).pathname === '/' && (await p.locator('.poll-card').count()) > 0);
  await p.context().close();

  // ── Server and job reports ──
  const run = await fetch(B + '/api/push/run', { method: 'POST', headers: { Authorization: 'Bearer test-secret-test-secret-123' } });
  ok('push job ran', run.ok, String(run.status));
  L = await log();
  ok('job: errors tick (alerts + 30-day cleanup) called', L.includes('ERRORS_TICK'));
  await fetch(B + '/api/views', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (iPhone)' }, body: JSON.stringify({ ids: ['a1000000-0000-4000-8000-000000000001'] }) });
  await wait(500);
  L = await log();
  ok('server route error reported (views)', L.some((l) => l.startsWith('SERVER_ERROR server|/api/views|')), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));

  // ── Admin → Errors ──
  p = await mk({ sub: 'notadmin' });
  await p.goto(B + '/admin#errors'); await p.waitForTimeout(2500);
  ok('not the admin: no errors screen', (await p.locator('.err').count()) === 0);
  await p.context().close();

  for (const [w, h] of [[1440, 1000], [1024, 800], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w > 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#errors'); await p.waitForTimeout(2500);
    ok(`${w}px: Errors section open`, (await p.locator('.err').count()) === 1 && /Errors/.test(await p.locator('.admin-title').innerText()));
    if (w >= 1024) ok(`${w}px: sidebar Health → Errors with "1 new"`, /1 new/.test(await p.locator('.admin-side').innerText()) && /Health/i.test(await p.locator('.admin-side').innerText()));
    else ok(`${w}px: Errors tab with a dot`, (await p.locator('.admin-tabs .admin-dot').count()) === 1);
    const tiles = await p.locator('.err-tiles').innerText();
    ok(`${w}px: tiles (new, people of opened, errors, jobs OK)`, /NEW ERRORS\s*1/i.test(tiles) && /19/.test(tiles) && /of 212/.test(tiles) && /43/.test(tiles) && /OK/.test(tiles), tiles.replace(/\n/g, ' | '));
    const rows = p.locator('.err-row');
    ok(`${w}px: needs a look: 3 errors`, (await rows.count()) === 3);
    ok(`${w}px: chips New, Spike, Open, Back after fix`, await (async () => { const t = await p.locator('.err-rows').innerText(); return /New/.test(t) && /Spike/.test(t) && /Back after fix/.test(t) && /Open/.test(t); })());
    ok(`${w}px: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await rows.first().click(); await p.waitForTimeout(1200);
    const det = p.locator('.err-detail');
    ok(`${w}px: detail opens`, (await det.count()) === 1 && /Failed to fetch/.test(await det.locator('.err-title').innerText()));
    ok(`${w}px: address has #errors/101`, p.url().endsWith('#errors/101'));
    ok(`${w}px: 24 hourly bars`, (await det.locator('.err-bar').count()) === 24);
    const dt = await det.innerText();
    ok(`${w}px: phones, who, names, latest with stack`, /iPhone · Safari/.test(dt) && /3 signed in · 6 guests · 5 visitors/.test(dt) && /@riya\.k/.test(dt) && (await det.locator('.err-latest details').count()) >= 1, dt.slice(0, 300));
    ok(`${w}px: detail fits (no sideways scroll)`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (w === 1440) {
      const box = await p.locator('.err-list-card').boundingBox(), dbox = await p.locator('.err-detail-card').boundingBox();
      ok('1440px: list and details side by side', dbox.x > box.x + box.width - 1 && Math.abs(dbox.y - box.y) < 5, JSON.stringify([box, dbox]));
    }
    if (w === 390) {
      const box = await p.locator('.err-list-card').boundingBox(), dbox = await p.locator('.err-detail-card').boundingBox();
      ok('390px: details under the list, scrolled to', dbox.y >= box.y + box.height - 1 && await p.evaluate(() => { const r = document.querySelector('.err-detail-card').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; }));
    }
    await shot(p, `admin-${w}`);
    await p.context().close();
  }

  // Actions (laptop).
  p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#errors/101'); await p.waitForTimeout(2800);
  ok('link #errors/101 opens that error', /Failed to fetch/.test(await p.locator('.err-title').innerText().catch(() => '')));
  await p.getByRole('button', { name: 'Copy for Claude' }).click(); await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok('Copy for Claude: the report', /^Eithr error report\nError: Failed to fetch \(TypeError\)\nWhere: The app · Feed \(\/\)\nCode: polls\.ts fetchFeed/.test(clip) && /Seen: 31 times by 14 people in the last 24 hours/.test(clip) && /Phones: iPhone · Safari 9/.test(clip) && /Who: 3 signed in · 6 guests · 5 visitors/.test(clip) && /Stack \(first lines\):\n  TypeError: Failed to fetch/.test(clip) && /Steps before: Poll page \(\/p\/:id\) → Feed \(\/\)/.test(clip) && /Admin: http:\/\/localhost:3145\/admin#errors\/101$/.test(clip), clip);
  ok('report has no usernames or emails', !/@riya|@arjun|@[a-z0-9.-]+\.[a-z]{2,}/i.test(clip));
  ok('status note: Copied', /Copied/.test(await p.locator('.err-detail [role=status]').innerText()));
  const gh = await p.getByRole('link', { name: 'Open GitHub issue' }).getAttribute('href');
  const ghu = new URL(gh);
  ok('GitHub issue link: repo, title, body, label, new tab', ghu.origin + ghu.pathname === 'https://github.com/docchi-app/which/issues/new' && ghu.searchParams.get('title') === '[Error] Failed to fetch · Feed (/) · 14 people' && ghu.searchParams.get('body') === clip && ghu.searchParams.get('labels') === 'bug' && (await p.getByRole('link', { name: 'Open GitHub issue' }).getAttribute('target')) === '_blank', gh.slice(0, 200));
  await p.getByRole('button', { name: '7 days' }).click(); await p.waitForTimeout(1200);
  ok('7 days: list and detail reload, 7 daily bars', (await log()).some((l) => l === 'ERROR_DETAIL 101 7') && (await p.locator('.err-bar').count()) === 7);
  await p.getByRole('group', { name: 'Mark as' }).getByRole('button', { name: 'Fixed' }).click(); await p.waitForTimeout(1200);
  ok('Mark as Fixed: saved, note, out of "needs a look", badge gone', (await log()).includes('ERROR_STATUS 101 fixed') && /Marked fixed/.test(await p.locator('.err-detail [role=status]').innerText()) && (await p.locator('.err-row').count()) === 2 && !/new/.test(await p.locator('.admin-side-item[aria-current=page]').innerText()));
  await p.getByRole('button', { name: /^Ignored/ }).click(); await p.waitForTimeout(1000);
  ok('Ignored filter', (await p.locator('.err-row').count()) === 1 && /Snap check timed out/.test(await p.locator('.err-rows').innerText()));
  await p.getByRole('button', { name: /^All/ }).click(); await p.locator('.err-where select').selectOption('server'); await p.waitForTimeout(1000);
  ok('Where: Server', (await log()).some((l) => l === 'ERRORS_LIST 7 all server') && (await p.locator('.err-row').count()) === 1);
  await p.locator('.err-where select').selectOption(''); await p.getByRole('button', { name: /^All/ }).click(); await p.waitForTimeout(800);
  await p.locator('.err-row', { hasText: 'Back after fix' }).click(); await p.waitForTimeout(1000);
  await p.getByRole('group', { name: 'Mark as' }).getByRole('button', { name: 'Ignore' }).click(); await p.waitForTimeout(800);
  ok('Ignore: saved, note', (await log()).includes('ERROR_STATUS 103 ignored') && /Ignored/.test(await p.locator('.err-detail [role=status]').innerText()));
  await shot(p, 'admin-actions');
  await p.context().close();
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
