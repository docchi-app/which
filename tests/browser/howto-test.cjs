const { ROOT, TMP, SHOTS } = require('../env.cjs');
// First visit: the "How Eithr works" sheet and the "Next one ↑" nudge.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145';
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png` });

async function context(b, { w = 360, h = 740, account = null, storage = {}, reduced = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (account) {
    const created = new Date(Date.now() - account.ageDays * 864e5).toISOString();
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: created };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
  }
  await ctx.addInitScript((storage) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        // Tips would cover things; they're not what this tests.
        localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create', 'comments', 'leaders', 'circle', 'activity', 'bell', 'friends', 'profile']));
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        sessionStorage.setItem('seeded', '1');
      }
    } catch {}
  }, storage);
  return ctx;
}
const sheetUp = (p) => p.locator('#howto-title').isVisible().catch(() => false);

(async () => {
  const b = await chromium.launch();
  const errors = [];

  // 1. A brand-new visitor (signed out): the sheet, captions that change, fits the screen.
  for (const [w, h] of [[320, 640], [360, 740], [412, 892]]) {
    const ctx = await context(b, { w, h });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(B + '/'); await p.waitForTimeout(1500);
    ok(`${w}x${h}: new visitor sees "How Eithr works"`, await sheetUp(p));
    const fit = await p.evaluate(() => {
      const s = document.querySelector('.howto-sheet');
      const r = s.getBoundingClientRect();
      return { scrolls: s.scrollHeight - s.clientHeight, top: Math.round(r.top), btn: Math.round(document.querySelector('.howto-go').getBoundingClientRect().bottom), vh: innerHeight };
    });
    ok(`${w}x${h}: sheet fits without scrolling`, fit.scrolls <= 1 && fit.top >= 0 && fit.btn <= fit.vh, JSON.stringify(fit));
    if (w === 360) {
      const caps = [];
      for (const t of [300, 2000, 2000]) {
        await p.waitForTimeout(t);
        caps.push(await p.evaluate(() => [...document.querySelectorAll('.howto-caps p')].find((e) => getComputedStyle(e).opacity > 0.5)?.querySelector('strong')?.textContent));
      }
      ok('captions step through 1 → 2 → 3', caps.join('|') === '1. Tap the side you’re on|2. See where everyone lands|3. Scroll for more', caps.join(' | '));
      await p.waitForTimeout(100);
      await shot(p, 'sheet-360');
    }
    if (w === 320) await shot(p, 'sheet-320');
    await p.locator('.howto-go').click(); await p.waitForTimeout(400);
    ok(`${w}x${h}: "Got it" closes it`, !(await sheetUp(p)));
    await p.reload(); await p.waitForTimeout(1500);
    ok(`${w}x${h}: only once`, !(await sheetUp(p)));
    await ctx.close();
  }

  // 2. Who doesn't get it.
  for (const [label, opts] of [
    ['already saw the old banner', { storage: { 'docchi.welcomed': '1' } }],
    ['moved from the old address', { storage: { 'eithr.moved': '1' } }],
    ['signed in, account a month old (new phone)', { account: { ageDays: 30 } }],
  ]) {
    const ctx = await context(b, opts);
    const p = await ctx.newPage();
    await p.goto(B + '/'); await p.waitForTimeout(1800);
    ok(`no sheet: ${label}`, !(await sheetUp(p)));
    await ctx.close();
  }

  // 3. Signed in with a brand-new account: sheet, then vote → nudge → Next → gone for good.
  {
    const ctx = await context(b, { account: { ageDays: 0 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(B + '/'); await p.waitForTimeout(1500);
    ok('new account sees the sheet', await sheetUp(p));
    await p.locator('.howto-go').click(); await p.waitForTimeout(400);
    await p.locator('.feed-item .answer').first().click(); await p.waitForTimeout(2200);
    ok('after the first vote: no "Next one" bubble (the next poll is already on screen)', (await p.locator('.next-nudge').count()) === 0);
    await shot(p, 'nudge-360');
    await p.reload(); await p.waitForTimeout(1800);
    ok('after reload: no sheet', !(await sheetUp(p)));
    await ctx.close();
  }

  // 4. Reduced motion: the steps as a list, no moving captions.
  {
    const ctx = await context(b, { reduced: true });
    const p = await ctx.newPage();
    await p.goto(B + '/'); await p.waitForTimeout(1500);
    const s = await p.evaluate(() => ({ list: getComputedStyle(document.querySelector('.howto-steps')).position, items: document.querySelector('.howto-steps').innerText, caps: getComputedStyle(document.querySelector('.howto-caps')).display, bar: getComputedStyle(document.querySelector('.howto-mine .howto-bar')).width }));
    ok('reduced motion: steps shown as a list', s.list === 'static' && /Tap the side/.test(s.items) && /Scroll for more/.test(s.items), JSON.stringify(s));
    ok('reduced motion: no moving captions', s.caps === 'none');
    ok('reduced motion: demo rests on the results', parseFloat(s.bar) > 50, s.bar);
    await shot(p, 'sheet-reduced');
    await ctx.close();
  }

  // 5. Another sheet is open first: waits for it to close.
  {
    const ctx = await context(b);
    await ctx.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const d = document.createElement('div'); d.className = 'sheet-layer fake'; document.body.appendChild(d);
        setTimeout(() => d.remove(), 2500);
      });
    });
    const p = await ctx.newPage();
    await p.goto(B + '/'); await p.waitForTimeout(1500);
    ok('waits while another sheet is open', !(await sheetUp(p)));
    await p.waitForTimeout(2000);
    ok('then shows', await sheetUp(p));
    await ctx.close();
  }

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close();
  process.exit(0);
})();
