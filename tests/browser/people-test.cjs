const { ROOT, TMP, SHOTS } = require('../env.cjs');
// People: recording where a first visit came from (and phone/notifications), Admin → Users
// (list, search, filters, a person's page and its actions) and Admin → Guests, phone + laptop.
const { chromium } = require('playwright');
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let pass = 0, fail = 0, n = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INSTA = IPHONE.replace('Safari/604.1', 'Instagram 300.0.0 (iPhone14,5)');
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const log = async () => (await fetch(M + '/__log')).json();
const visitors = async () => (await fetch(M + '/__visitors')).json();
const RIYA = 'e2000000-0000-4000-8000-000000000001', KABIR = 'e2000000-0000-4000-8000-000000000003', ME = 'e2000000-0000-4000-8000-000000000007';
(async () => {
  const b = await chromium.launch(); const errors = [];
  const mk = async ({ sub = null, ua = IPHONE, w = 390, h = 844 } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: ua, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
    if (sub) {
      const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub, role: 'authenticated', is_anonymous: false, exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
      await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })).toString('base64url'), url: B }]);
    }
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
    await ctx.addInitScript(() => { try { localStorage.setItem('docchi.tipsSeen', JSON.stringify(['create','comments','leaders','circle','activity','bell','friends','profile'])); localStorage.setItem('docchi.welcomed', '1'); localStorage.setItem('eithr.firstOpenDone', '1'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/ppl-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const lastVisitor = async () => (await visitors()).at(-1);

  // ── Recording where people came from ──
  const POLL = 'a1000000-0000-4000-8000-000000000001';
  let p = await mk({ ua: INSTA });
  await p.goto(B + '/p/' + POLL); await p.waitForTimeout(3000);
  let v = await lastVisitor();
  ok('shared poll in Instagram: poll source, phone, browser, in-app, notifications', v && v.source === 'poll' && v.source_poll === POLL && v.device === 'iPhone' && v.in_app === 'Instagram' && v.installed === false && ['default', 'unsupported', 'granted', 'denied'].includes(v.notif) && /^[0-9a-f-]{36}$/.test(v.visitor), JSON.stringify(v));
  const before = (await visitors()).length;
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  ok('next visit, nothing changed: not sent again', (await visitors()).length === before);
  await p.context().close();
  const cases = [
    ['/u/riya.k?invite=abc123', null, (x) => x.source === 'invite' && x.source_by === 'riya.k', 'invite link'],
    ['/?utm_source=email&utm_campaign=summary-lunch', null, (x) => x.source === 'email', 'email link'],
    ['/move', null, (x) => x.source === 'old_address', 'old address'],
    ['/', 'https://www.instagram.com/', (x) => x.source === 'instagram', 'from instagram.com'],
    ['/', 'https://news.example.com/article?x=secret', (x) => x.source === 'other_site' && x.site === 'news.example.com', 'another site: its name only, never the full address'],
    ['/', 'https://www.google.com/', (x) => x.source === 'search', 'search'],
    ['/', null, (x) => x.source === 'direct', 'typed in'],
  ];
  for (const [path, ref, check, label] of cases) {
    p = await mk({ ua: MAC, w: 1280, h: 800 });
    await p.goto(B + path, ref ? { referer: ref } : {}); await p.waitForTimeout(2800);
    v = await lastVisitor();
    ok(`source: ${label}`, v && check(v) && v.device === 'Mac' && v.browser === 'Chrome', JSON.stringify(v));
    await p.context().close();
  }
  ok('no full addresses sent', !(await visitors()).some((x) => JSON.stringify(x).includes('secret') || JSON.stringify(x).includes('http')));
  // Signing in sends again (the person is now linked).
  p = await mk({ sub: 'u1', ua: MAC, w: 1280, h: 800 });
  await p.goto(B + '/'); await p.waitForTimeout(2800);
  v = await lastVisitor();
  ok('signed in: sent (to link this browser to them)', v && v.source === 'direct');
  await p.context().close();

  // ── Admin → Users ──
  p = await mk({ sub: 'notadmin' });
  await p.goto(B + '/admin#users'); await p.waitForTimeout(2500);
  ok('not the admin: nothing', (await p.locator('.ppl').count()) === 0);
  await p.context().close();

  for (const [w, h] of [[1440, 1000], [1024, 800], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w > 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#users'); await p.waitForTimeout(2600);
    ok(`${w}px: Users open`, /Users/.test(await p.locator('.admin-title').innerText()) && (await p.locator('.ppl').count()) === 1);
    if (w >= 1024) ok(`${w}px: sidebar People: Users, Guests`, /People\s*Users\s*Guests/i.test(await p.locator('.admin-side').innerText()));
    else ok(`${w}px: Users and Guests tabs`, (await p.getByRole('tab', { name: 'Users' }).count()) === 1 && (await p.getByRole('tab', { name: 'Guests' }).count()) === 1);
    const tiles = await p.locator('.ppl-tiles').innerText();
    ok(`${w}px: tiles`, /86/.test(tiles) && /\+12 this week/.test(tiles) && /41/.test(tiles) && /48%/.test(tiles) && /29/.test(tiles) && /22 never asked/.test(tiles) && /9/.test(tiles), tiles.replace(/\n/g, ' | '));
    ok(`${w}px: 7 people`, (await p.locator('.ppl-row').count()) === 7);
    const riya = await p.locator('.ppl-row', { hasText: '@riya.k' }).innerText();
    ok(`${w}px: riya: name, was a guest, came from a shared poll by @arjun_07, installed, on`, /Riya Kapoor/.test(riya) && /was a guest for 2 days/.test(riya) && /Shared poll/.test(riya) && /by @arjun_07/.test(riya) && /installed app/.test(riya) && /On/.test(riya), riya.replace(/\n/g, ' | '));
    const all = await p.locator('.ppl-rows').innerText();
    ok(`${w}px: badges and states (You, Test, Banned, Blocked, Never asked, Unknown source)`, /You/.test(all) && /Test/.test(all) && /Banned/.test(all) && /Blocked/.test(all) && /Never asked/.test(all) && /Unknown/.test(all) && /inside Instagram/.test(all));
    ok(`${w}px: Export CSV locked`, await p.getByRole('button', { name: /Export CSV/ }).isDisabled());
    ok(`${w}px: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await shot(p, `users-${w}`);
    if (w === 1440) {
      await p.locator('#ppl-search').fill('riya'); await p.waitForTimeout(900);
      ok('search (after typing stops)', (await log()).some((l) => l.startsWith('USERS all|riya|')) && (await p.locator('.ppl-row').count()) === 1);
      await p.locator('#ppl-search').fill(''); await p.waitForTimeout(900);
      await p.getByRole('button', { name: 'Banned', exact: true }).click(); await p.waitForTimeout(800);
      ok('filter: Banned', (await p.locator('.ppl-row').count()) === 1 && /rohan__/.test(await p.locator('.ppl-rows').innerText()));
      await p.getByRole('button', { name: 'Everyone' }).click(); await p.locator('#ppl-sort').selectOption('votes'); await p.waitForTimeout(800);
      ok('sort: most votes', (await log()).some((l) => /^USERS all\|\|votes\|50\|0$/.test(l)) && /@riya\.k/.test(await p.locator('.ppl-row').first().innerText()));
    }
    // Open a person.
    await p.locator('.ppl-row', { hasText: '@riya.k' }).click(); await p.waitForTimeout(1300);
    ok(`${w}px: person page, address #users/<id>`, p.url().endsWith('#users/' + RIYA) && /@riya\.k/.test(await p.locator('.ppl-name').innerText()));
    const pg = await p.locator('.ppl-person').innerText();
    ok(`${w}px: person: email hidden, facts, 8 stats, timeline, polls`, /r••••@gmail\.com/.test(pg) && /Notifications: On/.test(pg) && /iPhone · installed app/.test(pg) && /Came from: Shared poll by @arjun_07/.test(pg) && /6-day streak/.test(pg) && (await p.locator('.ppl-stats > div').count()) === 8 && (await p.locator('.ppl-tl li').count()) === 6 && (await p.locator('.ppl-polls li').count()) === 3, pg.slice(0, 400).replace(/\n/g, ' | '));
    ok(`${w}px: person fits`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (w >= 1440) {
      const a = await p.locator('.ppl-col').nth(0).boundingBox(), c = await p.locator('.ppl-col').nth(1).boundingBox();
      ok('1440px: two columns', c.x > a.x + a.width - 1 && Math.abs(c.y - a.y) < 5);
    }
    await shot(p, `person-${w}`);
    await p.getByRole('button', { name: '‹ Users' }).click(); await p.waitForTimeout(1000);
    ok(`${w}px: ‹ Users back to the list`, p.url().endsWith('#users') && (await p.locator('.ppl-row').count()) >= 1);
    await p.context().close();
  }

  // Actions (laptop).
  p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#users/' + RIYA); await p.waitForTimeout(2800);
  ok('link #users/<id> opens the person', /@riya\.k/.test(await p.locator('.ppl-name').innerText().catch(() => '')));
  await p.getByRole('button', { name: 'Show' }).click(); await p.waitForTimeout(700);
  ok('Show email: shown, logged', /riyak@gmail\.com/.test(await p.locator('.ppl-email').innerText()) && /in the admin log/.test(await p.locator('.ppl-email').innerText()) && (await log()).includes('EMAIL_VIEWED riya.k'));
  const polls = p.locator('.ppl-polls li');
  ok('polls: Remove on live, Restore on hidden, nothing on deleted', /Remove/.test(await polls.nth(0).innerText()) && /Restore/.test(await polls.nth(1).innerText()) && (await polls.nth(2).locator('button').count()) === 0 && /deleted by them/.test(await polls.nth(2).innerText()));
  await polls.nth(0).getByRole('button', { name: 'Remove' }).click(); await p.waitForTimeout(900);
  ok('Remove a poll', (await log()).includes('ADMIN remove poll f1000000-0000-4000-8000-000000000001') && /Removed/.test(await p.locator('.ppl-person [role=status]').innerText()));
  await p.getByRole('button', { name: 'Reset username' }).click();
  await p.getByRole('button', { name: 'Reset it' }).click(); await p.waitForTimeout(900);
  ok('Reset username, after a confirm', (await log()).includes('USERNAME_RESET riya.k') && /Username reset/.test(await p.locator('.ppl-person [role=status]').innerText()));
  await p.getByRole('button', { name: 'Ban…' }).click();
  const banBtn = p.getByRole('button', { name: 'Ban @riya.k' });
  ok('Ban: disabled until the username is typed', await banBtn.isDisabled());
  await p.locator('#ppl-ban').fill('riya'); ok('Ban: wrong name, still disabled', await banBtn.isDisabled());
  await p.locator('#ppl-ban').fill('@Riya.K'); ok('Ban: right name (any case, @ ok), enabled', !(await banBtn.isDisabled()));
  await banBtn.click(); await p.waitForTimeout(900);
  ok('Ban', (await log()).includes(`ADMIN ban user ${RIYA}`) && /Banned/.test(await p.locator('.ppl-person [role=status]').innerText()));
  await p.getByRole('button', { name: 'Mark as test account' }).click(); await p.waitForTimeout(900);
  ok('Mark as test account', (await log()).includes('TEST riya.k true'));
  await p.getByRole('button', { name: 'Copy user ID' }).click(); await p.waitForTimeout(300);
  ok('Copy user ID', (await p.evaluate(() => navigator.clipboard.readText())) === RIYA);
  await p.goto(B + '/admin#users/' + ME); await p.waitForTimeout(2500);
  ok('your own page: no actions', /@mayank/.test(await p.locator('.ppl-name').innerText()) && (await p.getByRole('button', { name: /Ban/ }).count()) === 0);
  await p.goto(B + '/admin#users/e2000000-0000-4000-8000-000000000099'); await p.waitForTimeout(2500);
  ok('unknown person: a clear message', /gone, or the link is wrong/.test(await p.locator('.ppl').innerText()));
  await p.context().close();

  // ── Admin → Guests ──
  for (const [w, h] of [[1440, 1000], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w > 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#guests'); await p.waitForTimeout(2600);
    const flow = await p.locator('.ppl-flow').innerText();
    ok(`${w}px: flow 212 → 74 (35%) → 13 (18%, 6%)`, /212/.test(flow) && /74/.test(flow) && /35%/.test(flow) && /13/.test(flow) && /18%/.test(flow) && /6% of visitors/.test(flow), flow.replace(/\n/g, ' | '));
    const two = await p.locator('.ppl-two').innerText();
    ok(`${w}px: time to sign up, median, vote split, left after 1, votes per guest`, /Same visit\s*6/.test(two) && /Median: 40 minutes/.test(two) && /Signed in 69%/.test(two) && /Guests 31%/.test(two) && /41%/.test(two) && /6\.2/.test(two) && /median 3/.test(two), two.replace(/\n/g, ' | '));
    ok(`${w}px: still guests by code, no names`, (await p.locator('.ppl-rows li').count()) === 2 && /Guest a3f2/.test(await p.locator('.ppl-rows').innerText()) && /inside Instagram/.test(await p.locator('.ppl-rows').innerText()));
    ok(`${w}px: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot(p, `guests-${w}`);
    if (w === 1440) {
      await p.getByRole('button', { name: '30 days' }).click(); await p.waitForTimeout(800);
      ok('30 days', (await log()).includes('GUESTS 30') && (await log()).includes('GUEST_LIST 30 still'));
      await p.getByRole('button', { name: 'Signed up' }).click(); await p.waitForTimeout(800);
      ok('signed-up guests show their username', /Signed up as @kabir\.s/.test(await p.locator('.ppl-rows').innerText()));
      await p.locator('.ppl-row', { hasText: 'kabir.s' }).click(); await p.waitForTimeout(1300);
      ok('clicking one opens their Users page', p.url().endsWith('#users/' + KABIR) && /@kabir\.s/.test(await p.locator('.ppl-name').innerText()));
    }
    await p.context().close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
