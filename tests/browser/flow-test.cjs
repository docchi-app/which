const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The new create flow: + menu (Snap it / Type it), the camera's controls, one finishing screen for
// snaps with Link only, Type it without "More options" or the preview (admins can turn it on).
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145';
const M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const log = async () => (await (await fetch(M + '/__log')).json()).join('\n');

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mkCtx = async (width = 390, height = 844) => {
    const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.howItWorks', '1'); } catch {} });
    return ctx;
  };
  const errors = [];
  const ctx = await mkCtx();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const shot = (name) => p.screenshot({ path: `${SHOTS}/new-${String(++n).padStart(2, '0')}-${name}.png` });
  const noSideways = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // ── + menu ──
  await p.goto(B + '/'); await p.waitForTimeout(1800);
  const plus = p.locator('.create-btn');
  ok('+ is a button that says it opens a menu', (await plus.getAttribute('aria-haspopup')) === 'menu' && (await plus.getAttribute('aria-expanded')) === 'false');
  await plus.click(); await p.waitForTimeout(350);
  const items = await p.getByRole('menuitem').allTextContents();
  ok('tap +: two choices, Snap it then Type it', items.length === 2 && /Snap it/.test(items[0]) && /Type it/.test(items[1]), JSON.stringify(items));
  ok('+ now says Close', (await plus.getAttribute('aria-label')) === 'Close' && (await plus.getAttribute('aria-expanded')) === 'true');
  const box = await p.evaluate(() => { const r = document.querySelector('.create-menu').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: innerWidth }; });
  ok('the choices sit on screen, above +', box.l >= 0 && box.r <= box.w && box.t > 0, JSON.stringify(box));
  await shot('plus-menu');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Escape closes it', (await p.locator('.create-menu').count()) === 0);
  await plus.click(); await p.waitForTimeout(250);
  await p.mouse.click(195, 200); await p.waitForTimeout(250);
  ok('tapping outside closes it', (await p.locator('.create-menu').count()) === 0);
  await plus.click(); await p.waitForTimeout(250);
  await plus.click(); await p.waitForTimeout(250);
  ok('tapping ✕ closes it', (await p.locator('.create-menu').count()) === 0);

  // ── Snap it → camera ──
  await plus.click(); await p.waitForTimeout(250);
  await p.getByRole('menuitem', { name: /Snap it/ }).click();
  await p.waitForURL(/\/snap/); await p.waitForTimeout(2200);
  ok('Snap it opens the camera at once', (await p.locator('.cam-shutter').count()) === 1 && !(await p.locator('.cam-shutter').isDisabled()));
  ok('back camera with no torch: no flash button', (await p.getByRole('button', { name: /⚡/ }).count()) === 0);
  const timerBtn = p.getByRole('button', { name: /^Timer/ });
  await timerBtn.click(); ok('timer: 3s', /3s/.test(await timerBtn.textContent()));
  await timerBtn.click(); ok('timer: 10s', /10s/.test(await timerBtn.textContent()));
  await timerBtn.click(); ok('timer: off again', /Off/.test(await timerBtn.textContent()));
  await p.getByRole('button', { name: 'Grid' }).click();
  ok('grid on', (await p.locator('.cam-grid').count()) === 1);
  const fr = await p.locator('.cam-frame').boundingBox();
  await p.mouse.click(fr.x + fr.width * 0.3, fr.y + fr.height * 0.4); await p.waitForTimeout(200);
  const ring = await p.evaluate(() => { const e = document.querySelector('.cam-focus'); return e && { l: parseFloat(e.style.left), t: parseFloat(e.style.top) }; });
  ok('tap: a focus ring where you tapped', ring && Math.abs(ring.l - fr.width * 0.3) < 3 && Math.abs(ring.t - fr.height * 0.4) < 3, JSON.stringify(ring));
  // Drag up: brighter (touch-like pointer drag).
  await p.mouse.move(fr.x + fr.width * 0.5, fr.y + fr.height * 0.6);
  await p.mouse.down(); await p.mouse.move(fr.x + fr.width * 0.5, fr.y + fr.height * 0.6 - 60, { steps: 6 }); await p.mouse.up();
  const bright = await p.evaluate(() => getComputedStyle(document.querySelector('.cam-video')).filter);
  ok('drag up: brighter', /brightness\(1\.\d+\)/.test(bright), bright);
  const zooms = await p.locator('.cam-zoom button').allTextContents();
  ok('zoom stops (no camera zoom here: 1× and 2×)', JSON.stringify(zooms) === '["1×","2×"]', JSON.stringify(zooms));
  await p.getByRole('button', { name: '2×' }).click(); await p.waitForTimeout(200);
  const tf = await p.evaluate(() => document.querySelector('.cam-video').style.transform);
  ok('2×: the picture zooms in', /scale\(2, 2\)/.test(tf), tf);
  ok('camera: nothing sideways', await noSideways());
  await shot('camera');
  // Timer: counts down, and tapping again cancels.
  await timerBtn.click();
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(300);
  ok('timer counts down', (await p.locator('.cam-count').textContent()) === '3');
  await shot('camera-timer');
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1300);
  ok('tapping again cancels it', (await p.locator('.cam-count').count()) === 0 && (await p.locator('.cam-shutter').count()) === 1);
  await timerBtn.click(); await timerBtn.click(); // back to off
  // Front camera: the screen is the flash.
  await p.getByRole('button', { name: 'Switch camera' }).click(); await p.waitForTimeout(1500);
  ok('front camera: a flash button (screen flash)', (await p.getByRole('button', { name: /⚡/ }).count()) === 1);
  await p.getByRole('button', { name: /⚡/ }).click();
  const mirrored = await p.evaluate(() => document.querySelector('.cam-video').style.transform);
  ok('front camera is mirrored, zoom back to 1×', /scale\(-1, 1\)/.test(mirrored), mirrored);
  await p.locator('.cam-shutter').click();
  await p.waitForTimeout(120);
  const flashSeen = await p.locator('.cam-screen-flash').count();
  await p.waitForTimeout(1500);
  ok('flash on: the screen lights up, then the photo is taken', flashSeen === 1 && (await p.locator('.ask-screen').count()) === 1, String(flashSeen));

  // ── Finish: one page that scrolls ──
  ok('photo in: nothing focused, the whole page there', (await p.locator('.ask-top .cam-title').textContent()) === 'Ask about it' && await p.evaluate(() => !['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) && (await p.locator('.ask-aud').count()) === 1);
  ok('no "Type my own" chip', (await p.getByRole('button', { name: /Type my own/ }).count()) === 0);
  const aud = await p.getByRole('radio').allTextContents();
  ok('who sees it: Friends · Everyone · Link only, on the page', aud.length === 3 && /Friends/.test(aud[0]) && /Everyone/.test(aud[1]) && /Link only/.test(aud[2]), JSON.stringify(aud));
  const wrap = await p.evaluate(() => { const c = document.querySelector('.ask-chips'); return { sw: c.scrollWidth, cw: c.clientWidth, wrap: getComputedStyle(c).flexWrap }; });
  ok('ideas wrap, no sideways scrolling', wrap.wrap === 'wrap' && wrap.sw <= wrap.cw + 1, JSON.stringify(wrap));
  const sendBox = await p.locator('.ask-send').boundingBox();
  ok('Send is on screen without scrolling', sendBox && sendBox.y + sendBox.height <= 844, JSON.stringify(sendBox));
  ok('Send works straight away with the last idea', !(await p.locator('.ask-send').isDisabled()));
  await shot('ask');
  await p.getByRole('radio', { name: /Link only/ }).click();
  ok('Link only: the button says you get the link', /link/.test(await p.locator('.ask-send').textContent()));
  // Your own question: the idea's answers go; the two sides are offered as a pair.
  await p.locator('.ask-q').fill('Goa or Manali?'); await p.waitForTimeout(200);
  ok('own question: no answers until you add them', (await p.locator('.ask-answer').count()) === 0 && /Add 2 answers/.test(await p.locator('.ask-send').textContent()));
  await p.getByRole('button', { name: 'Goa / Manali' }).click(); await p.waitForTimeout(200);
  const ans = await p.evaluate(() => [...document.querySelectorAll('.ask-answer input')].map((i) => i.value));
  ok('tap the pair: answers filled', JSON.stringify(ans) === '["Goa","Manali"]', JSON.stringify(ans));
  await shot('ask-typing');
  await shot('ask-link');
  ok('remembers Link only', await p.evaluate(() => JSON.parse(localStorage.getItem('docchi.snapPrefs')).audience === 'link'));
  await p.locator('.ask-send').click();
  await p.waitForTimeout(4000);
  const L = await log();
  ok('sent as link only', /CREATE \{"q":"Goa or Manali\?","answers":\["Goa","Manali"\],"vis":"link"/.test(L), L.split('\n').filter((l) => l.startsWith('CREATE')).pop());
  await p.locator('.check-review').waitFor({ timeout: 25000 }).catch(() => {});
  { const t = await p.locator('.check-card').textContent().catch(() => 'none'); ok('waiting for a check: says the link comes with it', /link to share/.test(t), t); }
  const created = /snap_info \{"ids":\["(b[^"]+)"/.exec(L)?.[1];
  await fetch(M + '/rest/v1/rpc/admin_decide_snap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ poll: created, approve: true }) });
  await p.goto(`${B}/?poll=${created}&created=1`); await p.waitForTimeout(2500);
  ok('live link-only snap: "Send it to someone" opens by itself', (await p.locator('#share-title').textContent().catch(() => '')) === 'Send it to someone');
  ok('...and says only the link gets in', /Only people with this link/.test(await p.locator('.share-sheet .sheet-text').textContent()));
  await shot('snap-share');

  // ── Type it ──
  await p.goto(B + '/'); await p.waitForTimeout(1500);
  await p.locator('.create-btn').click(); await p.waitForTimeout(250);
  await p.getByRole('menuitem', { name: /Type it/ }).click();
  await p.waitForURL(/\/create/); await p.waitForTimeout(1500);
  ok('Type it: title', (await p.locator('.create-title').textContent()) === 'Type a poll');
  ok('the question has the keyboard', await p.evaluate(() => document.activeElement?.id === 'question'));
  ok('no snap tile, no More options, no preview', (await p.locator('.snap-tile, .more-toggle, .preview-card').count()) === 0);
  const seg = await p.locator('.seg3 [role=radio]').allTextContents();
  ok('who sees it: three choices on screen', seg.length === 3, JSON.stringify(seg));
  ok('style chips and open-for on screen', (await p.locator('.style-chip').count()) === 3 && (await p.locator('.days-pick select').count()) === 1);
  ok('Type it: nothing sideways', await noSideways());
  await shot('type');
  await p.keyboard.type('Guitar or piano?');
  await p.getByLabel('Answer 1').fill('Guitar 🎸');
  await p.getByLabel('Answer 2').fill('Piano 🎹');
  await p.getByRole('radio', { name: /Link only/ }).click();
  await p.locator('.days-pick select').selectOption('7');
  await shot('type-filled');
  await p.getByRole('button', { name: /Post poll/ }).click();
  await p.waitForTimeout(3000);
  const L2 = await log();
  ok('posted as link only, 7 days', /CREATE_POLL \{"q":"Guitar or piano\?","vis":"link","days":7\}/.test(L2), L2.split('\n').filter((l) => l.startsWith('CREATE_POLL')).pop());
  { await p.waitForTimeout(1500); const t = await p.locator('#share-title').textContent().catch(() => 'none'); ok('typed link-only poll: "Send it to someone" too', t === 'Send it to someone', t + ' ' + p.url()); }
  await p.close();

  // ── Hot take keeps its hint; small phone fits ──
  const small = await mkCtx(360, 640);
  const s = await small.newPage();
  s.on('pageerror', (e) => errors.push(e.message));
  await s.goto(B + '/create'); await s.waitForTimeout(1500);
  await s.getByRole('radio', { name: 'Hot take' }).click();
  ok('hot take: the one-line hint shows', /One a day/.test(await s.locator('.format-blurb').last().textContent()));
  ok('360 px: Type it nothing sideways', await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const chipsFit = await s.evaluate(() => [...document.querySelectorAll('.style-chip, .days-pick select, .seg3 button')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1; }));
  ok('360 px: every choice fits its button', chipsFit);
  await s.screenshot({ path: `${SHOTS}/new-${String(++n).padStart(2, '0')}-type-360.png` });
  await s.goto(B + '/'); await s.waitForTimeout(1500);
  await s.locator('.create-btn').click(); await s.waitForTimeout(300);
  const tiles = await s.evaluate(() => [...document.querySelectorAll('.create-choice')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1; }));
  ok('360 px: the + choices fit', tiles);
  await s.screenshot({ path: `${SHOTS}/new-${String(++n).padStart(2, '0')}-plus-360.png` });
  await s.goto(B + '/snap'); await s.waitForTimeout(2000);
  ok('360 px: camera nothing sideways', await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const tools = await s.evaluate(() => { const t = document.querySelector('.cam-top').getBoundingClientRect(); const sh = document.querySelector('.cam-shutter').getBoundingClientRect(); return t.right <= innerWidth && sh.bottom <= innerHeight; });
  ok('360×640: tools and shutter on screen', tools);
  await s.locator('.cam-shutter').click(); await s.waitForTimeout(1500);
  const fit = await s.evaluate(() => { const r = document.querySelector('.ask-send').getBoundingClientRect(); const seg = [...document.querySelectorAll('.ask-aud button')].every((e) => e.scrollWidth <= e.clientWidth + 1); return { send: r.bottom <= innerHeight, seg, side: document.documentElement.scrollWidth <= innerWidth }; });
  ok('360×640: Send on screen, choices fit, nothing sideways', fit.send && fit.seg && fit.side, JSON.stringify(fit));
  await s.screenshot({ path: `${SHOTS}/new-${String(++n).padStart(2, '0')}-ask-360.png` });
  await small.close();

  // ── Admin preview ──
  const a = await mkCtx();
  const ap = await a.newPage();
  ap.on('pageerror', (e) => errors.push(e.message));
  await ap.goto(B + '/settings'); await ap.waitForTimeout(1800);
  const sw = ap.getByRole('switch', { name: /Live preview/ });
  ok('admin: Live preview switch in Settings, off', (await sw.count()) === 1 && !(await sw.isChecked()));
  await sw.click();
  await ap.goto(B + '/create'); await ap.waitForTimeout(1800);
  ok('admin with it on: the preview shows', (await ap.locator('.preview-card').count()) === 1);
  await ap.close();
  const na = await mkCtx();
  await na.route('**/rest/v1/rpc/my_profile', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ is_admin: false, username: 'mayank', username_confirmed: true, avatar_url: null, joined: new Date().toISOString(), polls_made: 0, votes_received: 0, shares: 0, votes_cast: 0 }) }));
  await na.addInitScript(() => localStorage.setItem('eithr.createPreview', '1'));
  const np = await na.newPage();
  await np.goto(B + '/settings'); await np.waitForTimeout(1500);
  ok('not an admin: no switch', (await np.getByRole('switch', { name: /Live preview/ }).count()) === 0);
  await np.goto(B + '/create'); await np.waitForTimeout(1800);
  ok('not an admin: no preview, even with the key set', (await np.locator('.preview-card').count()) === 0);
  await na.close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close();
  process.exit(0);
})();
