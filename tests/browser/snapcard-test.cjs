const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Snaps in the feed as an Eithr card (photo on top, edge to edge, 3:4; question and answers below),
// and "Who sees it" on your own snap and typed poll, at phone and laptop sizes.
const { chromium } = require('playwright');
require(process.env.MOCK || ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const log = async () => (await fetch(M + '/__log')).json();
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SNAP = 'b1000000-0000-4000-8000-000000000001', MINE = 'b2000000-0000-4000-8000-000000000002', OTHER = 'a5000000-0000-4000-8000-000000000005';
(async () => {
  await new Promise((r) => setTimeout(r, 400)); await fetch(M + '/__mine_in_feed');
  const b = await chromium.launch(); const errors = [];
  const mk = async (w, h, sub = 'u1') => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 800 ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}) });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {} };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name, el) => (el ?? p).screenshot({ path: `${SHOTS}/sc-${String(++n).padStart(2, '0')}-${name}.png`, ...(el ? {} : { fullPage: false }) });
  const card = (p, id) => p.locator(`article[data-poll="${id}"]`);

  for (const [w, h] of [[390, 844], [320, 640], [1440, 1000]]) {
    const p = await mk(w, h);
    await p.goto(B + '/'); await p.waitForTimeout(2600);
    const c = card(p, SNAP);
    await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
    const g = await c.evaluate((el) => {
      const r = (s) => el.querySelector(s)?.getBoundingClientRect();
      const card = el.getBoundingClientRect(), photo = r('.snapc-photo'), q = r('.snapc-q'), ans = r('.snapc-answers');
      const cs = getComputedStyle(el);
      return { cardL: card.left + parseFloat(cs.borderLeftWidth), cardR: card.right - parseFloat(cs.borderRightWidth), cardT: card.top + parseFloat(cs.borderTopWidth), photo: photo && { l: photo.left, r: photo.right, t: photo.top, b: photo.bottom, w: photo.width, h: photo.height }, qTop: q?.top, ansTop: ans?.top, ansBottom: ans?.bottom, img: !!el.querySelector('.snapc-photo img'), onPhoto: [...el.querySelectorAll('.snapc-photo .snapc-q, .snapc-photo .snapc-answers')].length };
    });
    ok(`${w}px: photo edge to edge in the card (no inner frame)`, g.photo && Math.abs(g.photo.l - g.cardL) < 1.5 && Math.abs(g.photo.r - g.cardR) < 1.5 && Math.abs(g.photo.t - g.cardT) < 1.5, JSON.stringify(g));
    ok(`${w}px: photo 3:4, nothing cropped`, g.photo && Math.abs(g.photo.h / g.photo.w - 4 / 3) < 0.02, JSON.stringify(g.photo));
    ok(`${w}px: question and answers under the photo, not on it`, g.onPhoto === 0 && g.qTop >= g.photo.b - 1 && g.ansTop > g.qTop, JSON.stringify(g));
    ok(`${w}px: the photo is shown`, g.img);
    const typed = await card(p, MINE).evaluate((el) => { const cs = getComputedStyle(el); return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, shadow: cs.boxShadow !== 'none' }; });
    const snapc = await c.evaluate((el) => { const cs = getComputedStyle(el); return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, shadow: cs.boxShadow !== 'none' }; });
    ok(`${w}px: same card as a typed poll (corners, border, shadow)`, JSON.stringify(typed) === JSON.stringify(snapc), JSON.stringify({ typed, snapc }));
    ok(`${w}px: nothing sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot(p, `feed-${w}`, c);
    if (w === 390) {
      // Someone else's snap: vote, results fill in under the photo.
      const o = card(p, OTHER); await o.scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
      await o.locator('button.snapc-answer').first().click(); await p.waitForTimeout(1200);
      ok('vote on a snap: results below the photo', (await o.locator('.snapc-results').count()) === 1 && (await o.locator('.snapc-photo .snapc-results').count()) === 0);
      // The votes line and "who voted" sit inside the card's padding, in line with the question.
      const cardBox = await o.boundingBox(); const footBox = await o.locator('.result-foot').boundingBox();
      ok('vote on a snap: the votes line is inside the card padding', cardBox && footBox && footBox.x >= cardBox.x + 12 && footBox.x + footBox.width <= cardBox.x + cardBox.width - 12, JSON.stringify({ cardBox, footBox }));
      ok('someone else\'s snap: no ••• for who sees it', (await o.locator('.snapc-more').count()) === 0);
      await shot(p, 'voted-390', o);
    }
    await p.context().close();
  }

  // Who sees it: my snap (sent to Everyone by mistake) → Friends.
  let p = await mk(390, 844);
  await p.goto(B + '/'); await p.waitForTimeout(2600);
  let c = card(p, SNAP);
  await c.locator('.snapc-more').click(); await p.waitForTimeout(400);
  ok('my snap: ••• has Share, Who sees it, Delete', /Share snap[\s\S]*Who sees it[\s\S]*Delete snap/.test(await c.locator('.snap-menu').innerText()));
  await c.getByRole('menuitem', { name: /Who sees it/ }).click(); await p.waitForTimeout(600);
  const sheet = p.locator('.sheet', { hasText: 'Who sees this snap' });
  ok('sheet: Everyone, Friends, Link only with what each means', (await sheet.getByRole('radio').count()) === 3 && /In the public feed/.test(await sheet.innerText()) && /Only your friends/.test(await sheet.innerText()) && /Only people you send it to/.test(await sheet.innerText()));
  ok('sheet: Everyone picked now (it was sent to Everyone)', (await sheet.getByRole('radio', { name: /Everyone/ }).getAttribute('aria-checked')) === 'true');
  await shot(p, 'sheet-everyone');
  await sheet.getByRole('radio', { name: /Friends/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(900);
  ok('Save: changed to Friends on the server', (await log()).includes(`VIS ${SNAP} circle`));
  const lbl = await c.locator('.snapc-name small').innerText().catch((e) => 'ERR ' + e.message.slice(0, 60)); const tst = await c.locator('.who-toast').innerText().catch(() => 'none');
  ok('the card says Friends, and a line confirms it', /All friends/.test(lbl) && /Now friends only/.test(tst), lbl + ' / ' + tst);
  await shot(p, 'after-friends', c);
  // Now Friends: Everyone is off (snaps go public only when sent).
  await c.locator('.snapc-more').click(); await c.getByRole('menuitem', { name: /Who sees it/ }).click(); await p.waitForTimeout(500);
  const ev = p.locator('.sheet').getByRole('radio', { name: /Everyone/ });
  ok('Friends snap: Everyone is off, with the reason', await ev.isDisabled() && /stricter photo check/.test(await ev.innerText()));
  await shot(p, 'sheet-locked');
  await p.locator('.sheet').getByRole('radio', { name: /Link only/ }).click();
  await p.locator('.sheet').getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(900);
  ok('Friends → Link only works', (await log()).includes(`VIS ${SNAP} link`));
  // My typed poll: ••• → Who sees it (any of the three).
  const t = card(p, MINE); await t.scrollIntoViewIfNeeded();
  await t.getByRole('button', { name: 'Who sees this poll' }).click(); await p.waitForTimeout(500);
  const ts = p.locator('.sheet', { hasText: 'Who sees this poll' });
  ok('my typed poll: the same sheet, all three open', (await ts.getByRole('radio').count()) === 3 && !(await ts.getByRole('radio', { name: /Everyone/ }).isDisabled()));
  await ts.getByRole('radio', { name: /Link only/ }).click(); await ts.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(900);
  ok('typed poll → Link only saved', (await log()).includes(`VIS ${MINE} link`) && /Now link only/.test(await t.locator('.who-toast').innerText()));
  ok('not mine: no "Who sees this poll" button', (await card(p, OTHER).getByRole('button', { name: 'Who sees this poll' }).count()) === 0);
  await p.context().close();

  // The snap screen's "how it'll look" uses the same card.
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
