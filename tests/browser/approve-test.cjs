const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Drafts: an approved draft stays in New marked approved (with Undo); one that can not be approved
// says why on its own card; the Post as switch is drawn inside its frame.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const log = async () => (await fetch(M + '/__log')).json();
const flat = (s) => s.replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async ({ sub = null, ua = IPHONE, w = 390, h = 844 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/ap-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  const wait = async (re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const L = await log(); if (L.some((l) => re.test(l))) return L; await new Promise((r) => setTimeout(r, 400)); } return log(); };
  for (const [w, h] of [[1440, 1000], [390, 844]]) {
    const p = await mk({ sub: 'u1', ua: w >= 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
    if (w === 1440) {
      await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(500);
      await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
      await wait(/^AGENT_SAVE/);
      await p.reload(); await p.waitForTimeout(2500);
      await p.locator('#dr-max').selectOption('1');
      await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
      // Approve one for tomorrow: stays, marked approved
      const maggi = p.locator('.dr-card', { hasText: 'Maggi at 2 am' });
      await maggi.getByRole('button', { name: /^Approve:/ }).click(); await p.waitForTimeout(1500);
      let t = flat(await maggi.innerText());
      ok('approved draft stays in New, marked "✓ Approved · goes out Tomorrow 8 pm", no Skip/Approve', /✓ Approved · goes out Tomorrow 8 pm/.test(t) && (await maggi.getByRole('button', { name: /^Approve:/ }).count()) === 0 && (await maggi.getByRole('button', { name: /^Skip:/ }).count()) === 0, t);
      ok('and it has Undo', (await maggi.getByRole('button', { name: /^Undo:/ }).count()) === 1);
      ok('top note says approved', /1 draft approved\./.test(flat(await p.locator('.dr').innerText())));
      // Another for tomorrow with a limit of 1: says why on its card
      const space = p.locator('.dr-card', { hasText: 'Space trip or deep sea dive?' });
      await space.getByRole('button', { name: /^Approve:/ }).click(); await p.waitForTimeout(1500);
      t = flat(await space.innerText());
      ok('not approved: the reason is on the card itself, buttons still there', /Not approved: that day already has its most posts/.test(t) && (await space.getByRole('button', { name: /^Approve:/ }).count()) === 1, t);
      ok('top note points to the card', /1 draft not approved: see why on the card/.test(flat(await p.locator('.dr').innerText())));
      await shot(p, '1440-approve');
      // Undo
      await maggi.getByRole('button', { name: /^Undo:/ }).click(); await p.waitForTimeout(1500);
      ok('Undo: back to a normal draft (Skip / Approve)', (await log()).some((l) => l.startsWith('UNSCHEDULE Maggi')) && (await maggi.getByRole('button', { name: /^Approve:/ }).count()) === 1);
      // Now the second one can go
      await space.getByRole('button', { name: /^Approve:/ }).click(); await p.waitForTimeout(1500);
      ok('after Undo the other one approves and its reason goes away', /✓ Approved/.test(await space.innerText()) && !/Not approved/.test(await space.innerText()));
      // Scheduled tab still lists it; reopening the screen moves approved ones out of New
      await p.getByRole('button', { name: /^Scheduled/ }).click(); await p.waitForTimeout(400);
      ok('Scheduled tab has it', (await p.locator('.dr-card', { hasText: 'Space trip' }).count()) === 1);
      await p.reload(); await p.waitForTimeout(2500);
      ok('reopened: approved drafts are no longer in New', (await p.locator('.dr-card', { hasText: 'Space trip' }).count()) === 0);
    }
    // Post as: the switch inside its frame, under its label
    await p.locator('.dr-card').first().getByRole('button', { name: /^Change:/ }).click(); await p.waitForTimeout(500);
    const g = await p.evaluate(() => {
      const leg = document.querySelector('.dr-seg legend').getBoundingClientRect();
      const box = document.querySelector('.dr-seg-opts');
      const b = box.getBoundingClientRect();
      const btns = [...box.querySelectorAll('button')].map((x) => x.getBoundingClientRect());
      return { legBottom: leg.bottom, boxTop: b.top, inside: btns.every((r) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5), clip: getComputedStyle(box).overflow, radius: getComputedStyle(box).borderTopRightRadius, fieldsetBorder: getComputedStyle(document.querySelector('.dr-seg')).borderTopWidth };
    });
    ok(`${w}px: Post as label sits above the frame, not on its line`, g.legBottom <= g.boxTop + 0.5 && g.fieldsetBorder === '0px', JSON.stringify(g));
    ok(`${w}px: both choices inside the rounded frame, corners clipped`, g.inside && g.clip === 'hidden' && g.radius === '16px', JSON.stringify(g));
    await p.locator('.dr-seg button').nth(1).click();
    await shot(p, `${w}-postas`);
    ok(`${w}px: fits`, await fits(p));
    await p.context().close();
  }
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
