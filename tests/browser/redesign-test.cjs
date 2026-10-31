const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The snap ask page, redesigned: one scrolling page (photo, question + answers, ideas, who sees
// it) with Send pinned. Checked at real phone sizes (visible area; inset = iPhone home-bar space).
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, extra); };
const DEVICES = [
  ['iPhone 12–16 app', 390, 797, 34], ['iPhone SE app', 375, 647, 0], ['iPhone SE Safari', 375, 548, 0], ['iPhone mini app', 375, 762, 34],
  ['iPhone 15 Safari', 393, 659, 0], ['Pro Max app', 430, 873, 34], ['Galaxy S23 Chrome', 360, 652, 0], ['Pixel 8 app', 412, 843, 0], ['320 phone', 320, 568, 0],
];

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const errors = [];
  const mkPage = async (w, h, inset, created = 30) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
    const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - created * 864e5).toISOString() };
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(B + '/snap'); await p.waitForTimeout(1600);
    // The iPhone home-bar space (env() is 0 in this browser).
    if (inset) await p.addStyleTag({ content: `.ask-bar { padding-bottom: ${14 + inset}px !important; }` });
    await p.locator('.cam-shutter').click(); await p.waitForTimeout(1300);
    return p;
  };
  const st = (p) => p.evaluate(() => {
    const sendTop = document.querySelector('.ask-send')?.getBoundingClientRect().top ?? 0;
    const above = (sel) => { const e = document.querySelector(sel); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= sendTop + 1; };
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().height > 0; };
    const a = document.querySelector('.ask-screen');
    return {
      title: document.querySelector('.ask-top .cam-title')?.textContent,
      focused: document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT',
      photo: above('.ask-photo'), question: above('.ask-q'), answers: above('.ask-answer:last-of-type'),
      send: vis('.ask-send') && (() => { const r = document.querySelector('.ask-send').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })(),
      sendText: document.querySelector('.ask-send')?.textContent, sendOn: !document.querySelector('.ask-send')?.disabled,
      answerVals: [...document.querySelectorAll('.ask-answer input')].map((i) => i.value),
      addFirst: vis('.ask-add-first'), offers: [...document.querySelectorAll('.ask-offers .ask-chip')].map((c) => c.textContent),
      ideas: vis('.ask-chips'), aud: vis('.ask-aud'), done: vis('.ask-done'), thumb: !!document.querySelector('.ask-thumb-on'),
      side: document.documentElement.scrollWidth <= innerWidth && a.scrollWidth <= a.clientWidth,
      cut: [...document.querySelectorAll('.ask-answer input')].filter((i) => i.scrollWidth > i.clientWidth + 1).length,
    };
  });
  const toBottom = (p) => p.evaluate(() => { document.querySelector('.ask-screen').scrollTop = 1e5; });
  const toTop = (p) => p.evaluate(() => { document.querySelector('.ask-screen').scrollTop = 0; });

  // ── Every phone: the first screen, the end of the page, typing ──
  for (const [name, w, h, inset] of DEVICES) {
    const p = await mkPage(w, h, inset);
    let s = await st(p);
    const firstOk = s.photo && s.question && s.send && (s.answers || name === 'iPhone SE Safari' || name === '320 phone');
    ok(`${name}: first screen shows photo, question${name.includes('SE Safari') || name.includes('320') ? '' : ', answers'} and Send`, firstOk, JSON.stringify({ photo: s.photo, question: s.question, answers: s.answers, send: s.send }));
    ok(`${name}: nothing focused, no typing mode, Send ready`, !s.focused && s.title === 'Ask about it' && !s.done && s.sendOn && /Send to friends/.test(s.sendText), JSON.stringify(s));
    ok(`${name}: nothing sideways, answers not cut`, s.side && s.cut === 0);
    await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-${w}x${h}-top.png` });
    // The end of the page: who sees it fully above Send, the photo small in the top bar.
    await toBottom(p); await p.waitForTimeout(400);
    const end = await p.evaluate(() => { const last = [...document.querySelectorAll('.ask-aud button')].pop().getBoundingClientRect(); return last.bottom <= document.querySelector('.ask-send').getBoundingClientRect().top + 1; });
    s = await st(p);
    ok(`${name}: scrolled to the end, Link only clear of Send; photo in the top bar`, end && s.thumb, JSON.stringify({ end, thumb: s.thumb }));
    await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-${w}x${h}-end.png` });
    // Typing: tap the question, the keyboard comes up.
    await toTop(p); await p.locator('.ask-q').click();
    await p.setViewportSize({ width: w, height: Math.round(h * 0.55) }); await p.waitForTimeout(500);
    s = await st(p);
    ok(`${name}: keyboard up: only question + answers, photo small, Done`, s.done && s.thumb && s.title === 'Your question' && !s.ideas && !s.aud && !s.send && s.side, JSON.stringify(s));
    await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-${w}x${h}-typing.png` });
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
    s = await st(p);
    ok(`${name}: keyboard closed: the whole page is back`, !s.focused && !s.done && s.ideas && s.aud && s.send, JSON.stringify(s));
    await p.context().close();
  }

  // ── The answers rule, ideas, offers, + Add answer ──
  let p = await mkPage(390, 797, 34);
  await p.getByRole('button', { name: /Rate my fit/ }).click(); await p.waitForTimeout(200);
  let s = await st(p);
  ok('idea: Rate my fit fills its answers', JSON.stringify(s.answerVals) === JSON.stringify(['🔥', '😍', '😐', '🙅']) && s.sendOn, JSON.stringify(s.answerVals));
  await p.locator('.ask-q').fill(''); await p.waitForTimeout(200);
  s = await st(p);
  ok('question cleared: answers removed, only + Add answer, Send says Add a question', s.answerVals.length === 0 && s.addFirst && s.offers.length === 0 && s.sendText === 'Add a question' && !s.sendOn, JSON.stringify(s));
  await p.locator('.ask-q').fill('Goa or Manali?'); await p.waitForTimeout(200);
  s = await st(p);
  ok('own question: still no answers, pairs offered, Send says Add 2 answers', s.answerVals.length === 0 && s.addFirst && s.offers.join('|') === 'Goa / Manali|👍 Yes / 👎 No' && s.sendText === 'Add 2 answers', JSON.stringify(s));
  await p.getByRole('button', { name: 'Goa / Manali' }).click(); await p.waitForTimeout(200);
  s = await st(p);
  ok('tap a pair: answers filled, Send ready', JSON.stringify(s.answerVals) === '["Goa","Manali"]' && s.sendOn && s.offers.length === 0, JSON.stringify(s));
  await p.locator('.ask-q').fill('Goa or Manali or Ooty?'); await p.waitForTimeout(200);
  ok('editing your own question keeps your answers', JSON.stringify((await st(p)).answerVals) === '["Goa","Manali"]');
  await p.getByRole('button', { name: /Rate my fit/ }).click(); await p.waitForTimeout(200);
  s = await st(p);
  ok('pick the idea again: question and answers back as they were', JSON.stringify(s.answerVals) === JSON.stringify(['🔥', '😍', '😐', '🙅']) && (await p.locator('.ask-q').inputValue()) === 'Rate my fit');
  // Typing over an idea also clears its answers.
  await p.locator('.ask-q').fill('Rate my fit, honestly'); await p.waitForTimeout(200);
  ok('typing over an idea: its answers go', (await st(p)).answerVals.length === 0);
  // + Add answer: one box, focused; then a second; Send follows.
  await p.locator('.ask-add').click(); await p.waitForTimeout(200);
  s = await st(p);
  ok('+ Add answer: one box, with the cursor in it; Send says Add one more answer', s.answerVals.length === 1 && s.focused && s.sendText === 'Add one more answer', JSON.stringify(s));
  await p.keyboard.type('Yes'); await p.locator('.ask-add').click(); await p.keyboard.type('No'); await p.waitForTimeout(200);
  s = await st(p);
  ok('two answers typed: Send ready', JSON.stringify(s.answerVals) === '["Yes","No"]' && s.sendOn, JSON.stringify(s));
  await p.locator('.ask-add').click(); await p.locator('.ask-add').click(); await p.waitForTimeout(200);
  ok('four answers: no more + Add answer; × on each', (await p.locator('.ask-add').count()) === 0 && (await p.locator('.ask-x').count()) === 4);
  await p.getByRole('button', { name: 'Remove answer 4' }).click(); await p.getByRole('button', { name: 'Remove answer 3' }).click(); await p.waitForTimeout(200);
  ok('remove down to two: × gone', (await p.locator('.ask-x').count()) === 0 && (await st(p)).answerVals.length === 2);
  await p.locator('.ask-answer input').nth(1).fill('Yes'); await p.waitForTimeout(150);
  ok('two the same: Send says so', (await st(p)).sendText === 'Two answers are the same');
  // Enter moves to the next answer, then closes.
  await p.locator('.ask-answer input').first().focus(); await p.keyboard.press('Enter');
  ok('Enter in answer 1 moves to answer 2', await p.evaluate(() => document.activeElement === document.querySelectorAll('.ask-answer input')[1]));
  await p.keyboard.press('Enter');
  ok('Enter in the last answer: done typing', await p.evaluate(() => document.activeElement?.tagName !== 'INPUT'));

  // ── How friends see it ──
  await p.getByRole('button', { name: /Should I go/ }).click();
  const twoUp = await p.evaluate(() => { const r = [...document.querySelectorAll('.ask-answer')].map((e) => e.getBoundingClientRect().top); return r.length === 2 && Math.abs(r[0] - r[1]) < 2; });
  ok('Should I go?: "🙌 Go" and "🛋️ Stay home" side by side', twoUp);
  await p.evaluate(() => { document.querySelector('.ask-screen').scrollTop = 0; });
  await p.getByRole('button', { name: /How friends see it/ }).click(); await p.waitForTimeout(400);
  const look = await p.evaluate(() => ({ q: document.querySelector('.ask-photo .snapc-q')?.textContent, a: [...document.querySelectorAll('.ask-photo .snapc-answer')].map((x) => x.textContent) }));
  ok('How friends see it: the card as in the feed', look.q === 'Should I go?' && JSON.stringify(look.a) === '["🙌 Go","🛋️ Stay home"]', JSON.stringify(look));
  await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-look.png` });
  await p.getByRole('button', { name: /Just the photo/ }).click(); await p.waitForTimeout(200);
  ok('Just the photo: back to the photo', (await p.locator('.ask-photo-img').count()) === 1 && (await p.locator('.ask-photo .snapc').count()) === 0);

  // ── Long question and answers ──
  // Typing over an idea clears its answers, so four boxes are added for the long answers.
  await p.locator('.ask-q').fill('W'.repeat(80));
  for (let i = 0; i < 4; i++) await p.locator('.ask-add').click();
  const ins = p.locator('.ask-answer input');
  const long = ['Honestly the long answer', 'Somebody typed it all ok', 'Supercalifragilisticexpi', 'Another long one here!!'];
  for (let i = 0; i < 4; i++) await ins.nth(i).fill(long[i]);
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  s = await st(p);
  ok('80-letter question, 4 long answers: one per row, shown whole, nothing sideways, question box grew', s.side && s.cut === 0 && s.answerVals.length === 4 && await p.evaluate(() => { const q = document.querySelector('.ask-q'); return q.scrollHeight <= q.clientHeight + 2 && q.clientHeight > 70; }), JSON.stringify(s));
  await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-long.png`, fullPage: false });

  // ── Retake ──
  await p.getByRole('button', { name: /↺ Retake/ }).click(); await p.waitForTimeout(800);
  ok('↺ Retake: back to the camera', (await p.locator('.cam-shutter').count()) === 1);
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1300);
  await p.goBack().catch(() => {}); await p.waitForTimeout(800);
  ok("phone back on the page: back to the camera, still on /snap", (await p.locator('.cam-shutter').count()) === 1 && new URL(p.url()).pathname === '/snap');
  // ── Send: Link only ──
  await p.locator('.cam-shutter').click(); await p.waitForTimeout(1300);
  await toBottom(p); await p.getByRole('radio', { name: /Link only/ }).click(); await p.waitForTimeout(200);
  ok('Link only: Send says it', (await st(p)).sendText === 'Send and get the link →');
  const before = (await (await fetch(M + '/__log')).json()).filter((l) => l.startsWith('CREATE ')).length;
  await p.locator('.ask-send').click(); await p.waitForTimeout(3000);
  const L = (await (await fetch(M + '/__log')).json()).filter((l) => l.startsWith('CREATE '));
  ok('sent once, as link only', L.length === before + 1 && /"vis":"link"/.test(L[L.length - 1]), L[L.length - 1]);
  await p.context().close();

  // ── New account: Everyone from tomorrow ──
  p = await mkPage(375, 647, 0, 0);
  await toBottom(p); await p.waitForTimeout(300);
  const every = p.getByRole('radio', { name: /Everyone/ });
  ok('new account: Everyone off, says why', (await every.isDisabled()) && /From tomorrow/.test(await every.textContent()));
  await p.screenshot({ path: `${SHOTS}/rd-${String(++n).padStart(2, '0')}-new-account.png` });
  await p.context().close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(0);
})();
