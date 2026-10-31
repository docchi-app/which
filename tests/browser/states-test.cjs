const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Screen states: a vote with no connection waits and sends itself; a slow vote says so after 3 s and
// is kept after 20 s; our failures say so with Try again; too fast and closed polls; the signed-out sheet; snap upload progress.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = process.env.B || 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const log = async () => (await fetch(M + '/__log')).json();
const flat = (s) => s.replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }); const errors = [];
  const mk = async ({ sub = null, ua = IPHONE, w = 390, h = 844, init = null } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800, permissions: ['camera'] });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/st-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const vshot = (p, name) => p.screenshot({ path: `${SHOTS}/st-${String(++n).padStart(2, '0')}-${name}.png` });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const state = (name, s) => fetch(`${M}/__fn_state?name=${name}&state=${encodeURIComponent(s)}`);
  const since = async (k) => (await log()).slice(k);
  // The nth card in the feed you haven't voted on yet.
  // Other prompts the app shows after a few votes (Home Screen, notifications) step aside.
  const clear = async (p) => { for (let i = 0; i < 3 && (await p.locator('.sheet-layer').count()); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(250); const later = p.locator('.sheet-layer .sheet-later, .sheet-layer button:has-text("Not now")').first(); if (await later.count()) await later.click().catch(() => {}); await p.waitForTimeout(250); } };
  const fresh = (p, i = 0) => p.locator('article.poll-card[data-poll]:has(.answers button.answer)').nth(i);

  // ── No connection: the pick waits, then sends itself ──
  let p = await mk({ sub: 'u2' });
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  let card = fresh(p, 0);
  const qOffline = await card.getAttribute('data-poll');
  const ctx = p.context();
  await ctx.setOffline(true); await p.waitForTimeout(300);
  ok('offline bar: votes are saved and sent later', /Votes you make now are saved and sent when you're back/.test(await p.locator('.offline-bar').innerText().catch(() => '')));
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(900);
  card = p.locator(`article[data-poll="${qOffline}"]`);
  let t = flat(await card.innerText());
  ok('offline vote: the pick is marked "Waiting to send"', (await card.locator('.answer-waiting').count()) === 1 && /Waiting to send/.test(t), t.slice(0, 300));
  ok('offline vote: "No connection. Your pick is saved…" with nothing to tap', /No connection Your pick is saved\. It goes in as soon as you're back online, nothing to tap\./.test(t) && (await card.locator('.state-wait button').count()) === 0);
  ok('offline vote: kept on the phone', await p.evaluate(() => JSON.parse(localStorage.getItem('eithr.outbox.votes') || '[]').length === 1));
  await vshot(p, 'offline-wait');
  ok('390 offline: fits', await fits(p));
  let k = (await log()).length;
  await ctx.setOffline(false); await p.waitForTimeout(3000);
  t = flat(await card.innerText());
  ok('back online: the vote is sent by itself and the results show', (await since(k)).some((l) => l.startsWith('/rest/v1/rpc/cast_vote')) && /You're with the \d+%|First vote/.test(t) && (await card.locator('.state-wait').count()) === 0, t.slice(0, 300));
  ok('back online: nothing left waiting', await p.evaluate(() => !localStorage.getItem('eithr.outbox.votes')));

  // ── Our problem: say so, Try again works ──
  await state('cast_vote', 'broken');
  await clear(p);
  card = fresh(p, 0);
  const qBroken = await card.getAttribute('data-poll');
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1200);
  card = p.locator(`article[data-poll="${qBroken}"]`);
  t = flat(await card.innerText());
  ok('server error: "Eithr hiccuped… That\'s on us, not your phone" with Try again', /Eithr hiccuped 😵‍💫 That's on us, not your phone\. We've been told about it\./.test(t) && (await card.getByRole('button', { name: 'Try again' }).count()) === 1, t.slice(0, 300));
  ok('server error: nothing kept to send later', await p.evaluate(() => !localStorage.getItem('eithr.outbox.votes')));
  await vshot(p, 'server-error');
  await state('cast_vote', 'ok');
  await card.getByRole('button', { name: 'Try again' }).click(); await p.waitForTimeout(1500);
  t = flat(await card.innerText());
  ok('Try again: the vote goes in', /You're with the \d+%|First vote/.test(t) && (await card.locator('.state-us').count()) === 0, t.slice(0, 200));

  // ── Too fast ──
  await state('cast_vote', 'slow_down');
  await clear(p);
  card = fresh(p, 0);
  const qRate = await card.getAttribute('data-poll');
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1200);
  t = flat(await p.locator(`article[data-poll="${qRate}"]`).innerText());
  ok('too fast: "That\'s a lot of votes in a row 😅…"', /That's a lot of votes in a row 😅 Take a breather and try again in a few minutes\./.test(t), t.slice(0, 300));

  // ── Closed meanwhile ──
  await state('cast_vote', 'closed');
  await clear(p);
  card = fresh(p, 0);
  const qClosed = await card.getAttribute('data-poll');
  k = (await log()).length;
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1500);
  t = flat(await p.locator(`article[data-poll="${qClosed}"]`).innerText());
  ok('closed: "This poll just closed. Here\'s how it ended 👇" and the poll is fetched again', /This poll just closed\. Here's how it ended 👇/.test(t) && (await since(k)).some((l) => l.startsWith('/rest/v1/rpc/get_poll')), t.slice(0, 300));

  // ── Slow: a line after 3 s, gone when it lands ──
  await state('cast_vote', 'slow:5000');
  await clear(p);
  card = fresh(p, 0);
  const qSlow = await card.getAttribute('data-poll');
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1500);
  card = p.locator(`article[data-poll="${qSlow}"]`);
  ok('slow: nothing extra in the first 3 seconds', (await card.locator('.state-slow').count()) === 0);
  await p.waitForTimeout(2200);
  t = flat(await card.innerText());
  ok('slow: "Slow connection, still sending" after 3 seconds', /Slow connection, still sending/.test(t) && /Keep scrolling, it finishes on its own\./.test(t), t.slice(0, 300));
  await vshot(p, 'slow');
  await p.waitForTimeout(2500);
  t = flat(await card.innerText());
  ok('slow: the line goes once the vote lands', (await card.locator('.state-slow').count()) === 0 && /You're with the \d+%|First vote/.test(t), t.slice(0, 200));

  // ── Very slow: kept after 20 s, and counted once when it finally lands ──
  await state('cast_vote', 'slow:24000');
  await clear(p);
  card = fresh(p, 0);
  const qVery = await card.getAttribute('data-poll');
  k = (await log()).length;
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(21000);
  card = p.locator(`article[data-poll="${qVery}"]`);
  t = flat(await card.innerText());
  ok('after 20 s: switched to "No connection, your pick is saved"', /No connection Your pick is saved/.test(t) && (await card.locator('.answer-waiting').count()) === 1, t.slice(0, 300));
  await p.waitForTimeout(5000);
  t = flat(await card.innerText());
  ok('it lands after all: results shown, nothing left waiting, sent once', /You're with the \d+%|First vote/.test(t) && await p.evaluate(() => !localStorage.getItem('eithr.outbox.votes')) && (await since(k)).filter((l) => l.startsWith('/rest/v1/rpc/cast_vote')).length === 1, t.slice(0, 200));
  await state('cast_vote', 'ok');
  await p.context().close();

  // ── 320px: a failure message fits ──
  await state('cast_vote', 'broken');
  p = await mk({ sub: 'u2', w: 320, h: 640 });
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  await fresh(p, 0).locator('.answers button.answer').first().click(); await p.waitForTimeout(1200);
  ok('320: the failure message fits', await fits(p) && (await p.locator('.state-us').count()) === 1);
  await vshot(p, '320-error');
  await state('cast_vote', 'ok');
  await p.context().close();

  // ── Signed out on its own: told once; a vote waits for Google ──
  const was = () => { try { if (!localStorage.getItem('eithr.lastAccount')) localStorage.setItem('eithr.lastAccount', JSON.stringify({ at: Date.now() - 864e5, streak: 9, friends: 11, polls: 14 })); } catch {} };
  p = await mk({ init: was });
  await p.goto(B + '/'); await p.waitForTimeout(4500);
  t = flat(await p.locator('.signedout-sheet').innerText().catch(() => ''));
  ok('signed out: "You\'ve been signed out" with streak, friends and polls', /You've been signed out/.test(t) && /🔥 9-day streak/.test(t) && /11 friends/.test(t) && /14 polls/.test(t) && /Continue with Google/.test(t), t);
  ok('390 signed-out sheet: fits', await fits(p));
  await vshot(p, 'signed-out');
  await p.getByRole('button', { name: 'Not now, just browse' }).click(); await p.waitForTimeout(400);
  ok('Not now closes it', (await p.locator('.signedout-sheet').count()) === 0);
  await p.reload(); await p.waitForTimeout(4500);
  ok('shown once: not again on the next open', (await p.locator('.signedout-sheet').count()) === 0);
  k = (await log()).length;
  await clear(p);
  card = fresh(p, 0);
  const pickText = flat(await card.locator('.answers button.answer').first().innerText()).replace(/^[A-D] /, '');
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1500);
  t = flat(await p.locator('.sheet').innerText().catch(() => ''));
  ok('a vote after the sign-in ended: "Sign in to count your vote", pick kept', /Sign in to count your vote/.test(t) && /Your sign-in ended\. We kept your pick/.test(t) && t.includes(pickText), t);
  ok('...and no guest account was started quietly', !(await since(k)).some((l) => l.startsWith('/auth/v1/signup')) && !(await since(k)).some((l) => l.startsWith('/rest/v1/rpc/cast_vote')));
  await vshot(p, 'signed-out-vote');
  await p.context().close();

  // A new visitor (nothing remembered): no sheet. Signed in: no sheet, and the account is remembered.
  p = await mk();
  await p.goto(B + '/'); await p.waitForTimeout(4000);
  ok('new visitor: no signed-out sheet', (await p.locator('.signedout-sheet').count()) === 0);
  await p.context().close();
  p = await mk({ sub: 'u2' });
  await p.goto(B + '/'); await p.waitForTimeout(4000);
  ok('signed in: no sheet, and this phone remembers the account', (await p.locator('.signedout-sheet').count()) === 0 && await p.evaluate(() => Boolean(localStorage.getItem('eithr.lastAccount'))));
  await p.context().close();

  // ── Snap upload on a slow connection: progress, then Cancel keeps the snap ──
  p = await mk({ sub: 'u1' });
  await p.goto(B + '/snap'); await p.waitForTimeout(2500);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1800);
  await p.locator('.ask-q').fill('Goa or Manali?'); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Goa / Manali' }).click(); await p.waitForTimeout(200);
  await state('upload', 'slow:8000');
  await p.locator('.ask-send').click(); await p.waitForTimeout(4000);
  t = flat(await p.locator('.check-card').innerText().catch(() => ''));
  ok('slow upload: "Posting your snap · N%" and keep Eithr open', /Posting your snap · \d+%/.test(t) && /Slow connection\. Keep Eithr open until it's done\./.test(t), t);
  await vshot(p, 'snap-upload');
  await p.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(1200);
  t = flat(await p.locator('body').innerText());
  ok('Cancel: back to the snap, kept, with what to do', (await p.locator('.ask-screen').count()) === 1 && /Stopped\. Your snap is still here: tap Send when you're ready\./.test(t) && (await p.locator('.ask-q').inputValue()) === 'Goa or Manali?', t.slice(0, 300));
  await state('upload', 'ok');
  await p.context().close();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
