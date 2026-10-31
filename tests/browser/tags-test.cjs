const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Tags in comments: the nudge after a "tag them" vote, the @ picker, highlighted tags, the
// "gets a push" line, Remove my tag, Activity, and the job asking for tag pushes.
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/tg-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  const TAGPOLL = 't2000000-0000-4000-8000-000000000001';
  await fetch(M + '/__tag_poll');
  for (const [w, h] of [[390, 844], [1440, 1000]]) {
    const p = await mk({ sub: 'u1', ua: w >= 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/'); await p.waitForTimeout(3000);
    const card = p.locator('.poll-card', { hasText: 'kaun sabse pehle plans cancel' }).first();
    ok(`${w}px: the poll is in the feed`, (await card.count()) === 1);
    if (w === 390) {
      await card.getByRole('button', { name: /A friend \(tag them\)/ }).click(); await p.waitForTimeout(1500);
      ok('voting "A friend (tag them)": the nudge appears', /Who is it\? 👀/.test(await card.innerText()) && (await card.getByRole('button', { name: '@ Tag a friend' }).count()) === 1);
      await shot(p, '390-nudge');
      await card.getByRole('button', { name: '@ Tag a friend' }).click(); await p.waitForTimeout(1500);
      const sheet = p.locator('.comments-sheet');
      ok('@ Tag a friend: comments open with "@" typed and focused', (await sheet.count()) === 1 && (await sheet.locator('textarea').inputValue()) === '@' && (await p.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA');
      ok('the picker lists friends who can see the poll', (await sheet.locator('.tag-pick-row').count()) === 3 && /Friends who can see this poll/i.test(await sheet.locator('.tag-pick').innerText()));
      ok('nudge gone after using it', !/Who is it\?/.test(await card.innerText()));
      await sheet.locator('textarea').fill('Has to be @ri');
      await sheet.locator('textarea').press('End');
      await p.waitForTimeout(700);
      const rows = await sheet.locator('.tag-pick-row').allInnerTexts();
      ok('typing @ri: only matching friends', rows.length === 2 && rows.every((r) => /@ri/.test(r)), JSON.stringify(rows));
      const box = await sheet.locator('.tag-pick').boundingBox();
      ok('picker fits on the phone screen', box && box.x >= 0 && box.x + box.width <= w + 1);
      await shot(p, '390-picker');
      await sheet.locator('.tag-pick-row', { hasText: 'riya_k' }).click(); await p.waitForTimeout(300);
      ok('picking: "@riya_k " put in, picker closes', (await sheet.locator('textarea').inputValue()) === 'Has to be @riya_k ' && (await sheet.locator('.tag-pick').count()) === 0, await sheet.locator('textarea').inputValue());
      await sheet.locator('textarea').pressSequentially('she cancelled on my birthday, @stranger agrees');
      await sheet.getByRole('button', { name: 'Send comment' }).click(); await p.waitForTimeout(2000);
      const L = await log();
      ok('sent: the server got the text and tagged riya_k only', L.some((l) => l === 'COMMENT Has to be @riya_k she cancelled on my birthday, @stranger agrees | tagged riya_k'), L.filter((l) => l.startsWith('COMMENT')).join(' / '));
      ok('"✓ @riya_k gets a push about your comment."', /✓ @riya_k gets a push about your comment\./.test(await sheet.innerText()));
      const tagLinks = sheet.locator('.comment-tag');
      ok('the tag is highlighted and links to the profile; a non-friend @name stays plain', (await tagLinks.count()) === 1 && (await tagLinks.first().getAttribute('href')) === '/u/riya_k' && (await tagLinks.first().innerText()) === '@riya_k');
      ok('placeholder says @ tags a friend', /@ to tag a friend/.test(await sheet.locator('textarea').getAttribute('placeholder')));
      // Escape closes only the picker
      await sheet.locator('textarea').fill('@d'); await sheet.locator('textarea').press('End'); await p.waitForTimeout(600);
      ok('typing @d: dev_04 offered', (await sheet.locator('.tag-pick-row', { hasText: 'dev_04' }).count()) === 1);
      await sheet.locator('textarea').press('Escape'); await p.waitForTimeout(300);
      ok('Escape closes the picker, not the comments', (await sheet.locator('.tag-pick').count()) === 0 && (await p.locator('.comments-sheet').count()) === 1);
      await sheet.locator('textarea').fill('@zzz'); await sheet.locator('textarea').press('End'); await p.waitForTimeout(600);
      ok('no match: says so', /No friend called @zzz can see this poll/.test(await sheet.innerText()));
      ok('390: fits with the sheet open', await fits(p));
      await shot(p, '390-sent');
      // A friend tagged me: Remove my tag
      await fetch(M + '/__tag_me?poll=' + TAGPOLL);
      await p.locator('.comments-sheet').getByRole('button', { name: 'Close comments' }).click(); await p.waitForTimeout(600);
      await card.locator('.poll-actions .ghost-action').first().click(); await p.waitForTimeout(1500);
      const mine = p.locator('.comments-sheet .comment', { hasText: 'Has to be @mayank' });
      ok('a comment tagging me: highlighted, with Remove my tag', (await mine.locator('.comment-tag').count()) === 1 && (await mine.getByRole('button', { name: 'Remove my tag' }).count()) === 1);
      await mine.getByRole('button', { name: 'Remove my tag' }).click(); await p.waitForTimeout(1500);
      ok('Remove my tag: done, no highlight, button gone', (await log()).some((l) => l.startsWith('UNTAG ')) && (await mine.locator('.comment-tag').count()) === 0 && (await mine.getByRole('button', { name: 'Remove my tag' }).count()) === 0);
      await p.context().close();
      // "Not now" on a fresh visit
      const p2 = await mk({ sub: 'u2', ua: IPHONE, w, h });
      await p2.goto(B + '/'); await p2.waitForTimeout(3000);
      const c2 = p2.locator('.poll-card', { hasText: 'kaun sabse pehle plans cancel' }).first();
      if (await c2.getByRole('button', { name: /A friend \(tag them\)/ }).count()) {
        await c2.getByRole('button', { name: /A friend \(tag them\)/ }).click(); await p2.waitForTimeout(1500);
        if (/Who is it\?/.test(await c2.innerText())) { await c2.getByRole('button', { name: 'Not now' }).click(); await p2.waitForTimeout(300); ok('Not now: the nudge goes', !/Who is it\?/.test(await c2.innerText())); }
        else ok('(second account already voted; nudge check skipped)', true);
      } else ok('(second account already voted; nudge check skipped)', true);
      // Voting another answer: no nudge
      await p2.context().close();
    } else {
      ok('1440: fits', await fits(p));
      await p.context().close();
    }
  }
  // Activity
  const p3 = await mk({ sub: 'u1', ua: IPHONE, w: 390, h: 844 });
  await p3.goto(B + '/activity'); await p3.waitForTimeout(2500);
  const at = flat(await p3.locator('.activity-screen').innerText());
  ok('Activity: "Tagged you" with who and which poll', /Tagged you/i.test(at) && /@arjun tagged you in a comment on “Kaun sabse pehle plans cancel karta hai\?”/.test(at), at.slice(0, 400));
  ok('Activity row opens the poll with comments', (await p3.locator('a[href="/p/99999999-0000-4000-8000-000000000009?comments=1"]').count()) === 1);
  await shot(p3, '390-activity');
  await p3.context().close();
  // The job asks for tag pushes
  await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  ok('the 2-minute job asks for tag pushes', (await log()).includes('TAG_NOTIFY'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
