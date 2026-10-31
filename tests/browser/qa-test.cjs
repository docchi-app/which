const { ROOT, TMP, SHOTS } = require('../env.cjs');
// QA round: keyboard handling on the snap ask screen and Type it, audiences that can't be used
// yet, camera in the background, wrong messages.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const fs = require('fs');
const B = 'http://localhost:3145';
const M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mkCtx = async ({ w = 390, h = 844, age = 30 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - age * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    return ctx;
  };
  const errors = [];
  const watch = (pg) => pg.on('pageerror', (e) => errors.push(e.message));
  const st = (p) => p.evaluate(() => ({
    title: document.querySelector('.ask-top .cam-title')?.textContent,
    focused: ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName),
    ideas: [...document.querySelectorAll('.ask-chips .ask-chip')].filter((c) => !c.closest('[hidden]')).map((c) => c.textContent),
    seg: !!document.querySelector('.ask-aud') && !document.querySelector('.ask-aud').closest('[hidden]'),
    send: document.querySelector('.ask-send')?.textContent,
    bar: !!document.querySelector('.ask-bar') && !document.querySelector('.ask-bar').hidden,
    sendOn: (() => { const r = document.querySelector('.ask-send')?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight + 1 && r.top >= 0; })(),
    side: document.documentElement.scrollWidth <= innerWidth,
    answers: [...document.querySelectorAll('.ask-answer input')].map((i) => i.value),
    answersFit: [...document.querySelectorAll('.ask-answer input')].every((i) => i.scrollWidth <= i.clientWidth + 1),
  }));
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/qa2-${String(++n).padStart(2, '0')}-${name}.png` });

  // ── Snap: the keyboard (every phone size: redesign-test) ──
  let ctx = await mkCtx();
  let p = await ctx.newPage(); watch(p);
  await p.goto(B + '/snap'); await p.waitForTimeout(2000);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1500);
  let s = await st(p);
  ok('photo in: nothing focused (iPhone only opens the keyboard for a tap), Send ready', !s.focused && s.title === 'Ask about it' && s.send === 'Send to friends →' && s.seg && s.bar, JSON.stringify(s));
  await p.getByRole('button', { name: /Rate my fit/ }).click(); await p.waitForTimeout(200);
  ok('pick an idea: question and answers swapped', (await p.locator('.ask-q').inputValue()) === 'Rate my fit' && (await st(p)).answers.length === 4);
  // Tap the question; the keyboard opens and the page shrinks above it (resizes-content).
  await p.locator('.ask-q').click();
  await p.setViewportSize({ width: 390, height: 470 }); await p.waitForTimeout(500);
  s = await st(p);
  ok('keyboard up: ideas, who sees it and Send out of the way', s.ideas.length === 0 && !s.seg && !s.bar && s.focused && s.title === 'Your question', JSON.stringify(s));
  ok('keyboard up: question on screen, answers whole', s.answersFit && await p.evaluate(() => { const r = document.querySelector('.ask-q').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), JSON.stringify(s));
  await shot(p, 'keyboard-up');
  // Android back hides the keyboard without leaving the box.
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  s = await st(p);
  ok('keyboard hidden by the phone: typing ends, ideas + who sees it + Send are back', !s.focused && s.seg && s.bar && s.sendOn && s.title === 'Ask about it' && s.ideas.length === 6, JSON.stringify(s));
  await shot(p, 'keyboard-closed');
  // Your own question: the idea's answers go, pairs to fill them in.
  await p.locator('.ask-q').click(); await p.setViewportSize({ width: 390, height: 470 }); await p.waitForTimeout(400);
  await p.locator('.ask-q').fill('Goa or Manali?'); await p.waitForTimeout(200);
  s = await st(p);
  ok('own question: answers cleared, pairs offered', s.answers.length === 0 && (await p.locator('.ask-offers .ask-chip').allTextContents()).includes('Goa / Manali'), JSON.stringify(s));
  await p.getByRole('button', { name: 'Goa / Manali' }).click();
  // ‹ while the keyboard is up only puts it away.
  await p.locator('.ask-top button').first().click(); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  s = await st(p);
  ok('‹ while typing: keyboard away, photo and question kept', !s.focused && (await p.locator('.ask-screen').count()) === 1 && (await p.locator('.ask-q').inputValue()) === 'Goa or Manali?', JSON.stringify(s));
  await p.locator('.ask-top button').first().click(); await p.waitForTimeout(800);
  ok('‹ when not typing: retake (camera)', (await p.locator('.cam-shutter').count()) === 1);
  // Retake, new photo: your own question and answers are still there.
  await p.waitForTimeout(800);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1500);
  s = await st(p);
  ok('retake: own question and answers kept', (await p.locator('.ask-q').inputValue()) === 'Goa or Manali?' && JSON.stringify(s.answers) === '["Goa","Manali"]', JSON.stringify(s));
  for (const [name, label] of [[/Everyone/, 'Send to everyone →'], [/Link only/, 'Send and get the link →'], [/Friends/, 'Send to friends →']]) {
    await p.getByRole('radio', { name }).click();
    ok(`Send label: ${label}`, (await p.locator('.ask-send').textContent()) === label);
  }
  // Camera: off in the background, back on return.
  await p.locator('.ask-top button').first().click(); await p.waitForTimeout(1500);
  const vis = (v) => p.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await vis('hidden'); await p.waitForTimeout(500);
  ok('app in the background: camera off', await p.evaluate(() => { const s = document.querySelector('.cam-video').srcObject; return !s || s.getVideoTracks().every((t) => t.readyState === 'ended'); }));
  ok('...shutter disabled meanwhile', await p.locator('.cam-shutter').isDisabled());
  await vis('visible'); await p.waitForTimeout(1500);
  ok('back in the app: camera on again', await p.evaluate(() => document.querySelector('.cam-video').srcObject?.getVideoTracks()[0]?.readyState === 'live') && !(await p.locator('.cam-shutter').isDisabled()));
  // A file that isn't a photo.
  fs.writeFileSync(TMP + '/not-a-photo.jpg', 'hello');
  await p.locator('input[type=file]').first().setInputFiles(TMP + '/not-a-photo.jpg'); await p.waitForTimeout(1000);
  ok('unreadable photo: says so (not "couldn\'t post")', (await p.locator('.cam-error').textContent().catch(() => '')) === "Couldn't open that photo. Try another one.");
  await ctx.close();

  // ── No friends yet ──
  ctx = await mkCtx();
  await ctx.route('**/rest/v1/rpc/my_circle', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], members: [], groups: [], joined: [] }) }));
  p = await ctx.newPage(); watch(p);
  await p.goto(B + '/snap'); await p.waitForTimeout(2000);
  await p.evaluate(() => localStorage.setItem('docchi.snapPrefs', JSON.stringify({ idea: 'buy', audience: 'circle' })));
  await p.reload(); await p.waitForTimeout(2000);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1500);
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  const friendsBtn = p.getByRole('radio', { name: /Friends/ });
  ok('no friends: Friends can\'t be picked, says why', (await friendsBtn.isDisabled()) && /Add friends first/.test(await friendsBtn.textContent()));
  ok('...Link only is picked instead', (await p.getByRole('radio', { name: /Link only/ }).getAttribute('aria-checked')) === 'true' && (await p.locator('.ask-send').textContent()) === 'Send and get the link →');
  await shot(p, 'no-friends');
  await p.locator('.ask-send').click(); await p.waitForTimeout(2500);
  const L = (await (await fetch(M + '/__log')).json()).filter((l) => l.startsWith('CREATE ')).pop() ?? '';
  ok('...and it sends as Link only (no failed upload)', /"vis":"link"/.test(L), L);
  await ctx.close();

  // ── New account: Everyone from tomorrow ──
  ctx = await mkCtx({ age: 0.1 });
  p = await ctx.newPage(); watch(p);
  await p.goto(B + '/snap'); await p.waitForTimeout(2000);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1500);
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  const every = p.getByRole('radio', { name: /Everyone/ });
  ok('new account: Everyone can\'t be picked, "from tomorrow"', (await every.isDisabled()) && /From tomorrow/.test(await every.textContent()));
  await ctx.close();

  // ── Small phone, keyboard up ──
  ctx = await mkCtx({ w: 360, h: 640 });
  p = await ctx.newPage(); watch(p);
  await p.goto(B + '/snap'); await p.waitForTimeout(2000);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1500);
  await p.locator('.ask-q').click(); await p.setViewportSize({ width: 360, height: 330 }); await p.waitForTimeout(400);
  s = await st(p);
  ok('360×640, keyboard up: only question and answers, question on screen, nothing sideways', !s.bar && s.ideas.length === 0 && s.answersFit && s.side && await p.evaluate(() => { const r = document.querySelector('.ask-q').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), JSON.stringify(s));
  await shot(p, 'small-keyboard');
  await p.setViewportSize({ width: 360, height: 640 }); await p.waitForTimeout(500);
  s = await st(p);
  ok('360×640, keyboard hidden: back to the full page', !s.focused && s.seg && s.bar && s.sendOn, JSON.stringify(s));

  // ── Type it ──
  await p.goto(B + '/create'); await p.waitForTimeout(1500);
  await p.keyboard.type('Guitar or piano?'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('Type it: Enter goes to the first answer', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Answer 1'));
  ok('...and adds no line break', (await p.locator('#question').inputValue()) === 'Guitar or piano?');
  await p.keyboard.type('Guitar');
  const posts = async () => (await (await fetch(M + '/__log')).json()).filter((l) => l.startsWith('CREATE_POLL')).length;
  const before = await posts();
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('Enter in Answer 1: on to Answer 2', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Answer 2'));
  await p.keyboard.type('Piano'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  ok('Enter in the last answer: keyboard away, nothing posted', (await posts()) === before && new URL(p.url()).pathname === '/create' && await p.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
  await p.getByRole('radio', { name: 'Mystery' }).click(); await p.waitForTimeout(800);
  ok('Mystery: the teaser box gets the keyboard', await p.evaluate(() => document.activeElement?.id === 'teaser'));
  ok('...and is on screen', await p.evaluate(() => { const r = document.querySelector('#teaser').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  await p.locator('#question').click();
  await p.setViewportSize({ width: 360, height: 330 }); await p.waitForTimeout(400);
  ok('Type it, keyboard up: Post above it', await p.evaluate(() => { const r = document.querySelector('.post-btn').getBoundingClientRect(); return r.bottom <= innerHeight + 1; }));
  ok('Type it, keyboard up: nothing sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot(p, 'type-keyboard');
  ok('viewport: keyboard resizes the page', /interactive-widget=resizes-content/.test(await p.evaluate(() => document.querySelector('meta[name=viewport]').content)));
  await ctx.close();

  // ── Feed tabs and the back button; snap photos coming back ──
  ctx = await mkCtx();
  p = await ctx.newPage(); watch(p);
  const path = () => new URL(p.url()).pathname;
  const tabOn = () => p.locator('[role=tab][aria-selected=true]').textContent();
  const back = async () => { await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(800); };
  await p.goto(B + '/friends'); await p.waitForTimeout(1200);
  await p.locator('.nav-pill a[aria-label="Feed"]').click(); await p.waitForTimeout(1800);
  await p.getByRole('tab', { name: 'New' }).click(); await p.waitForTimeout(1000);
  await back();
  ok('feed: New, then back → For you (app stays open)', path() === '/' && (await tabOn()) === 'For you', `${path()} ${await tabOn()}`);
  await p.getByRole('tab', { name: 'New' }).click(); await p.waitForTimeout(800);
  await p.getByRole('tab', { name: 'Friends' }).click(); await p.waitForTimeout(800);
  await p.getByRole('tab', { name: 'New' }).click(); await p.waitForTimeout(800);
  await back();
  ok('New → Friends → New, back → For you (one step)', path() === '/' && (await tabOn()) === 'For you', `${path()} ${await tabOn()}`);
  await p.getByRole('tab', { name: 'Friends' }).click(); await p.waitForTimeout(800);
  await p.getByRole('tab', { name: 'For you' }).click(); await p.waitForTimeout(1000);
  ok('tap For you: For you', (await tabOn()) === 'For you');
  await back();
  ok('...then back leaves the feed (no empty step)', path() === '/friends', path());
  await p.locator('.nav-pill a[aria-label="Feed"]').click(); await p.waitForTimeout(1800);
  // Bring the snap cards' photos in, go to another tab of the app, come back.
  for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, 700); await p.waitForTimeout(250); }
  await p.waitForTimeout(1500);
  const shownBefore = await p.evaluate(() => document.querySelectorAll('.snapc-img').length);
  await p.locator('.nav-pill a[aria-label="Profile"]').click(); await p.waitForTimeout(1500);
  await back();
  const firstFrame = await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r([...document.querySelectorAll('.snapc')].map((c) => { const img = c.querySelector('.snapc-img'); return img ? (img.classList.contains('snapc-img-in') ? 'in' : 'fading') : 'none'; })))));
  ok('back to the feed: snap photos there at once, no fading in again', shownBefore > 0 && firstFrame.length > 0 && firstFrame.every((x) => x === 'in'), JSON.stringify({ shownBefore, firstFrame }));
  await ctx.close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(0);
})();
