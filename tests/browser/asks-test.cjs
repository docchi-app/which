const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Bringing people back: Home Screen / notification asks at the right moments, the first
// Home Screen open, the evening email (fake Resend) with its unsubscribe, Settings switch.
const { chromium } = require('playwright');
const fs = require('fs');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const SENT = TMP + '/resend-sent.json';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
(async () => {
  const b = await chromium.launch(); const errors = [];
  // installed: the page thinks it was opened from the Home Screen. perm: what the phone answers.
  const mk = async ({ ua = IPHONE, installed = false, perm = 'default', w = 390, h = 844 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(({ installed, perm }) => {
      try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile','leaders'])); localStorage.setItem('docchi.welcomed', '1'); } catch {}
      if (installed) { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q)); }
      if (window.Notification) {
        let p = perm;
        Object.defineProperty(Notification, 'permission', { get: () => p, configurable: true });
        Notification.requestPermission = async () => { window.__asked = (window.__asked || 0) + 1; p = 'denied'; return 'denied'; };
      }
    }, { installed, perm });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const sheetText = (p) => p.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent).join(' | '));
  const post = async (p, q) => {
    await p.goto(B + '/create'); await p.waitForTimeout(1500);
    await p.keyboard.type(q); await p.getByLabel('Answer 1').fill('Yes'); await p.getByLabel('Answer 2').fill('No');
    await p.getByRole('button', { name: /Post poll/ }).click(); await p.waitForURL(/\/\?poll=/, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(1800);
  };

  // ── iPhone, Safari: the Home Screen step ──
  let p = await mk();
  await post(p, 'Should I get bangs?');
  ok('posted: the share sheet comes first', (await p.locator('.share-sheet').count()) === 1 && !/Home Screen/.test(await sheetText(p)));
  await p.keyboard.press('Escape'); await p.locator('.sheet-backdrop').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(1600);
  let t = await sheetText(p);
  ok('iPhone Safari, after posting: Home Screen sheet with a reason', /Add Eithr to your Home Screen/.test(t) && /moment friends vote/.test(t), t.slice(0, 160));
  await p.screenshot({ path: `${SHOTS}/ask-${String(++n).padStart(2, '0')}-iphone-posted.png` });
  await p.getByRole('button', { name: 'Not now' }).click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(500);
  await post(p, 'Pizza or pasta tonight?');
  await p.keyboard.press('Escape'); await p.locator('.sheet-backdrop').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(1600);
  ok('iPhone Safari: not again within a week', !/Add Eithr to your Home Screen/.test(await sheetText(p)));
  await p.context().close();
  // Props, on a fresh phone.
  await fetch(M + '/__props_reset');
  p = await mk();
  await p.goto(B + '/activity'); await p.waitForTimeout(2600);
  t = await sheetText(p);
  ok('iPhone Safari, new props: Home Screen sheet, "Someone picked you"', /Home Screen/.test(t) && /Someone picked you/.test(t), t.slice(0, 160));
  await p.context().close();
  // Friends.
  p = await mk();
  await p.goto(B + '/friends'); await p.waitForTimeout(1800);
  const accept = p.getByRole('button', { name: 'Accept' }).first();
  if (await accept.count()) { await accept.click(); await p.waitForTimeout(1800); }
  t = await sheetText(p);
  ok('iPhone Safari, accepted a friend: Home Screen sheet', /Home Screen/.test(t) && /friends post or pick you/.test(t), t.slice(0, 160));
  await p.context().close();

  // ── Installed (Home Screen) ──
  p = await mk({ installed: true });
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  t = await sheetText(p);
  ok('first open from the Home Screen: full screen, with reasons', (await p.locator('.notify-ask-full').count()) === 1 && /Votes on your polls/.test(t) && /Props from friends/.test(t), t.slice(0, 120));
  ok('...nothing sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.screenshot({ path: `${SHOTS}/ask-${String(++n).padStart(2, '0')}-first-open.png` });
  await p.getByRole('button', { name: 'Turn on notifications' }).click(); await p.waitForTimeout(600);
  ok('tap: asks the phone right away; "Don\'t Allow" is explained', (await p.evaluate(() => window.__asked)) === 1 && /iPhone Settings → Notifications → Eithr/.test(await sheetText(p)));
  await p.getByRole('button', { name: 'Close' }).click(); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(2500);
  ok('first open: only once', (await p.locator('.notify-ask-full').count()) === 0);
  await p.context().close();
  // Installed, said "Not now" on first open: a moment asks with a sheet, once a week.
  await fetch(M + '/__props_reset');
  p = await mk({ installed: true });
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Not now' }).click(); await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.removeItem('eithr.pushAskAt')); // a week later
  await p.goto(B + '/activity'); await p.waitForTimeout(2600);
  t = await sheetText(p);
  ok('installed, new props: "Turn on notifications" sheet (not full screen)', /Someone picked you/.test(t) && /Turn on notifications/.test(t) && (await p.locator('.notify-ask-full').count()) === 0, t.slice(0, 160));
  await p.screenshot({ path: `${SHOTS}/ask-${String(++n).padStart(2, '0')}-props-sheet.png` });
  await p.getByRole('button', { name: 'Not now' }).click(); await p.waitForTimeout(300);
  await fetch(M + '/__props_reset');
  await p.goto(B + '/activity'); await p.waitForTimeout(2600);
  ok('installed: not again within a week', !/Turn on notifications/.test(await sheetText(p)));
  await post(p, 'Beach or mountains?');
  await p.keyboard.press('Escape'); await p.locator('.sheet-backdrop').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(1600);
  ok('installed, after posting: no sheet (the poll has its own "Get a ping" row)', !/Turn on notifications/.test(await sheetText(p)));
  await p.context().close();
  // Already said "Don't Allow": never asked.
  await fetch(M + '/__props_reset');
  p = await mk({ installed: true, perm: 'denied' });
  await p.goto(B + '/activity'); await p.waitForTimeout(2600);
  ok('notifications blocked: no first-open ask, no moment ask', (await p.locator('.notify-ask-full').count()) === 0 && !/Turn on notifications/.test(await sheetText(p)));
  await p.context().close();
  // Laptop: never.
  await fetch(M + '/__props_reset');
  p = await mk({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', w: 1280, h: 800 });
  await p.goto(B + '/activity'); await p.waitForTimeout(2600);
  ok('laptop: no Home Screen sheet', !/Home Screen/.test(await sheetText(p)));
  await p.context().close();

  // ── Settings: Email me what I missed ──
  p = await mk({ ua: ANDROID });
  await p.goto(B + '/settings'); await p.waitForTimeout(2000);
  const sw = p.getByRole('switch', { name: /Email me what I missed/ });
  ok('Settings: email switch, on', (await sw.count()) === 1 && (await sw.isChecked()));
  await sw.click(); await p.waitForTimeout(600);
  ok('Settings: turned off, saved', !(await sw.isChecked()) && (await (await fetch(M + '/__log')).json()).includes('EMAIL_ON false'));
  await sw.click(); await p.waitForTimeout(600);
  ok('Settings: on again', await sw.isChecked());
  await p.context().close();

  // ── The lunch and evening emails (fake Resend) ──
  try { fs.unlinkSync(SENT); } catch {}
  await fetch(M + '/__email_due');
  const bad = await fetch(B + '/api/push/run', { method: 'POST', headers: { Authorization: 'Bearer nope' } });
  ok('job without the secret: refused', bad.status === 403);
  const run = await fetch(B + '/api/push/run', { method: 'POST', headers: { Authorization: 'Bearer test-secret-test-secret-123' } });
  const body = await run.json();
  ok('job: three emails sent', run.ok && body.emails?.sent === 3, JSON.stringify(body));
  const sent = JSON.parse(fs.readFileSync(SENT, 'utf8'));
  const m = sent.find((x) => x.body.to[0] === 'riya@example.com')?.body ?? {};
  ok('to the right person, from Eithr, with the key', m.to?.[0] === 'riya@example.com' && /Eithr <hello@eithr\.app>/.test(m.from) && /^Bearer re_(test_key|CANARYRESEND0123456789)$/.test(sent[0].auth));
  ok('subject leads with the friend request', ['@arjun wants to be friends on Eithr', '@arjun sent you a friend request'].includes(m.subject), m.subject);
  ok('evening greeting, no lunch email today', /here's your day on Eithr/.test(m.text));
  ok('lists votes on the poll, other votes, who commented', /9 new votes on “Chai or coffee <b>today<\/b>\?”/.test(m.text) && /3 more votes on your other polls/.test(m.text) && /@kabir and @meera commented/.test(m.text), m.text);
  ok('poll text escaped in HTML', /&lt;b&gt;today&lt;\/b&gt;/.test(m.html) && !/<b>today/.test(m.html));
  ok('hidden preview line', /<div style="display:none[^"]*">Plus 9 new votes/.test(m.html));
  ok('button: See the request, opens Friends', /\/friends\?utm_source=email&amp;utm_campaign=summary-evening/.test(m.html) && /See the request/.test(m.html));
  const dev = sent.find((x) => x.body.to[0] === 'dev@example.com')?.body ?? {};
  ok('votes email: one answer ahead (3 vs 2), subject quotes the poll', ['One answer is pulling ahead on “Rate my fit”', 'There\'s a front-runner on “Rate my fit”'].includes(dev.subject), dev.subject);
  ok('votes email: lunch greeting, answers with the result hidden', /here's your morning on Eithr/.test(dev.text) && />🔥<br><span[^>]*>\?\?\?</.test(dev.html) && />🧊<br><span[^>]*>\?\?\?</.test(dev.html));
  ok('votes email: See which one opens the poll', /See which one/.test(dev.html) && /\/p\/a1000000-0000-4000-8000-000000000001\?utm_source=email/.test(dev.html));
  ok('votes email: names the commenter, no comment text', /@kabir commented/.test(dev.text) && !/said|“[^”]*”\s*$/.test(dev.text.split('\n').find((l) => /kabir/.test(l)) ?? ''));
  const zoe = sent.find((x) => x.body.to[0] === 'zoe@example.com')?.body ?? {};
  ok('props email: never who, opens Activity', ['💜 2 friends picked you for props', '💜 You got 2 props'].includes(zoe.subject) && /never say who/.test(zoe.text) && /since lunch/.test(zoe.text) && /\/activity\?utm_source=email/.test(zoe.html), zoe.subject);
  ok('one-click unsubscribe header', /^<https?:\/\/[^>]+\/api\/email\/unsubscribe\?u=[0-9a-f-]+&t=[\w-]+>$/.test(m.headers?.['List-Unsubscribe'] ?? '') && m.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', m.headers?.['List-Unsubscribe']);
  const again = await (await fetch(B + '/api/push/run', { method: 'POST', headers: { Authorization: 'Bearer test-secret-test-secret-123' } })).json();
  ok('next run: nothing more', !again.emails);
  // Unsubscribe link.
  const link = new URL(m.headers['List-Unsubscribe'].slice(1, -1));
  const local = B + link.pathname + link.search;
  const forged = await fetch(B + link.pathname + '?u=' + link.searchParams.get('u') + '&t=forged');
  ok('a forged link: refused', forged.status === 400 && /didn't work/.test(await forged.text()));
  const off = await fetch(local);
  ok('the link: "no more emails" page, and turned off', off.status === 200 && /no more emails/.test(await off.text()) && (await (await fetch(M + '/__log')).json()).some((l) => l.startsWith('EMAIL_OFF 00000000-0000-4000-8000-0000000000e1')));
  const one = await fetch(local, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
  ok('one-click (POST) works too', one.status === 200);
  { const q = await b.newPage({ viewport: { width: 320, height: 640 } }); let fits = true; for (const e of [m, dev, zoe]) { await q.setContent(e.html); fits &&= await q.evaluate(() => document.documentElement.scrollWidth <= 320); } ok('emails fit a 320 px screen', fits); await q.setContent(dev.html); await q.screenshot({ path: `${SHOTS}/ask-${String(++n).padStart(2, '0')}-email.png`, fullPage: true }); await q.close(); }

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
