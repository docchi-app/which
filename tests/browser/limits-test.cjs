const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Admin → Run → Limits (polls a day, snaps a day) at laptop and phone sizes, and the Type it
// screen's text following the setting.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const log = async () => (await fetch(M + '/__log')).json();
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async (w, h, sub = 'u1') => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 800 ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}) });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', exp: now + 3600 })}.sig`;
    const user = { id: sub, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/lim-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fillPoll = async (p) => { await p.locator('#question').fill('Chai or coffee?'); await p.getByLabel('Answer 1').fill('Chai'); await p.getByLabel('Answer 2').fill('Coffee'); await p.waitForTimeout(300); };
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // Type it: the text follows the limit (10 to start).
  let p = await mk(390, 844);
  await p.goto(B + '/create'); await p.waitForTimeout(2000); await fillPoll(p);
  ok('Type it: "Up to 10 polls a day · 9 left today"', /Up to 10 polls a day · 9 left today/.test(await p.locator('#post-hint').innerText()), await p.locator('#post-hint').innerText());
  await p.context().close();

  for (const [w, h] of [[1440, 1000], [390, 844], [320, 640]]) {
    p = await mk(w, h);
    await p.goto(B + '/admin#limits'); await p.waitForTimeout(2500);
    ok(`${w}px: Limits open`, (await p.locator('.admin-title').innerText()) === 'Limits');
    if (w >= 1024) ok('sidebar Run: Schedule, Limits, Test accounts, Admin log', /Run\s*Schedule\s*Limits\s*Test accounts\s*Admin log/i.test(await p.locator('.admin-side').innerText()));
    else ok(`${w}px: a Limits tab`, (await p.getByRole('tab', { name: 'Limits' }).count()) === 1);
    const [pv, sv] = [await p.locator('#lim-polls').inputValue(), await p.locator('#lim-snaps').inputValue()];
    ok(`${w}px: shows the saved numbers, hot takes fixed at 1 a day`, (w === 1440 ? pv === '10' && sv === '3' : pv === '1' && sv === '2') && /1 a day/.test(await p.locator('.lim').innerText()), pv + ' ' + sv);
    ok(`${w}px: Save off until something changes`, await p.getByRole('button', { name: 'Save' }).isDisabled());
    ok(`${w}px: fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    if (w === 1440) {
      ok('no changes yet: says where it started', /No changes yet\. Polls started at 10 a day, snaps at 3\./.test(await p.locator('.gr').count() ? '' : await p.locator('.ppl').innerText()));
      await p.getByRole('button', { name: 'More polls a day' }).click();
      ok('+ makes it 11, Not saved yet', (await p.locator('#lim-polls').inputValue()) === '11' && /Not saved yet/.test(await p.locator('.lim-foot').innerText()));
      await p.locator('#lim-polls').fill('99');
      ok('typing 99: kept at 50', (await p.locator('#lim-polls').inputValue()) === '50');
      await p.locator('#lim-polls').fill('1');
      await p.getByRole('button', { name: 'Fewer snaps a day' }).click();
      ok('− on snaps: 2', (await p.locator('#lim-snaps').inputValue()) === '2');
      ok('− off at the bottom (polls 1)', await p.getByRole('button', { name: 'Fewer polls a day' }).isDisabled());
      await p.getByRole('button', { name: 'Save' }).click(); await p.waitForTimeout(900);
      const L = await log();
      ok('Save: both saved, Saved · in the Admin log', L.includes('LIMITS polls 1') && L.includes('LIMITS snaps 2') && /Saved · in the Admin log/.test(await p.locator('.lim-foot').innerText()));
      const ch = await p.locator('.lim-log').innerText();
      ok('Changes list: newest first', /Snaps a day: 3 → 2[\s\S]*Polls a day: 10 → 1/.test(ch), ch);
      ok('Save off again after saving', await p.getByRole('button', { name: 'Save' }).isDisabled());
    }
    await shot(p, `admin-${w}`);
    await p.context().close();
  }

  // Type it with the limit at 1 (one used): the right message.
  p = await mk(390, 844);
  await p.goto(B + '/create'); await p.waitForTimeout(2000); await fillPoll(p);
  ok('Type it at limit 1: "That\'s 1 poll today. You can post again after midnight."', /That's 1 poll today\. You can post again after midnight\./.test(await p.locator('#post-hint').innerText()), await p.locator('#post-hint').innerText());
  await shot(p, 'create-at-limit');
  await p.context().close();

  // Not the admin.
  p = await mk(390, 844, 'notadmin');
  const res = await p.goto(B + '/admin#limits'); await p.waitForTimeout(1500);
  ok('not the admin: no Limits', (await p.locator('.lim').count()) === 0);
  ok('API: not the admin, refused', (await (await fetch(M + '/rest/v1/rpc/admin_limits', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: 'notadmin' })}.sig` }, body: '{"polls":50}' })).text()).includes('not_admin'));
  await p.context().close();
  // Put it back for other suites.
  await fetch(M + '/rest/v1/rpc/admin_limits', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: 'u1' })}.sig` }, body: '{"polls":10,"snaps":3}' });
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
