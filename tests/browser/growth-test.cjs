const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Growth: Overview as the admin home, Funnel & retention, Sources, Polls & snaps, Notifications
// (phone + laptop), the new sidebar, the 9 am summary switch, and what the app counts (push taps,
// email clicks, notifications turned off, blocked words) and the job's tally.
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/gro-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // ── Counting: push taps, email clicks ──
  let p = await mk({ sub: 'u1', ua: MAC, w: 1280, h: 800 });
  await p.goto(B + '/?n=4711&utm_source=push'); await p.waitForTimeout(3000);
  ok('push tap: counted with its id', (await log()).includes('PUSH_OPENED 4711'));
  ok('push tap: id taken off the address', !/[?&](n|utm_source)=/.test(p.url()), p.url());
  await p.reload(); await p.waitForTimeout(2500);
  ok('reload: not counted again', (await log()).filter((l) => l === 'PUSH_OPENED 4711').length === 1);
  await p.goto(B + '/p/a1000000-0000-4000-8000-000000000001?n=12&utm_source=push#comments'); await p.waitForTimeout(3000);
  ok('push tap to a poll: counted, the hash kept', (await log()).includes('PUSH_OPENED 12') && p.url().endsWith('/p/a1000000-0000-4000-8000-000000000001#comments'), p.url());
  await p.goto(B + '/?n=12abc'); await p.waitForTimeout(2500);
  ok('bad id: not sent', !(await log()).some((l) => l.startsWith('PUSH_OPENED 12abc')));
  await p.context().close();
  p = await mk({ ua: IPHONE });
  await p.goto(B + '/?utm_source=email&utm_campaign=summary-evening'); await p.waitForTimeout(3000);
  ok('email click: counted with which email', (await log()).includes('EMAIL_OPENED summary-evening'));
  ok('email click: tags taken off', p.url() === B + '/', p.url());
  await p.goto(B + '/?n=99&utm_source=push'); await p.waitForTimeout(2500);
  ok('push tap signed out: not sent (only its owner counts)', !(await log()).includes('PUSH_OPENED 99'));
  // Blocked words: counted (where only).
  await p.route('**/rest/v1/rpc/create_poll', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'docchi:blocked_words' }) }));
  await p.evaluate(() => fetch('http://localhost:54339/rest/v1/rpc/create_poll', { method: 'POST', body: '{}' }));
  await p.waitForTimeout(800);
  ok('blocked words: counted with the place, never the words', (await log()).includes('BLOCKED create_poll'));
  await p.route('**/rest/v1/rpc/add_comment', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'docchi:too_long' }) }));
  await p.evaluate(() => fetch('http://localhost:54339/rest/v1/rpc/add_comment', { method: 'POST', body: '{}' }));
  await p.waitForTimeout(800);
  ok('other 400s: not counted', !(await log()).includes('BLOCKED add_comment'));
  await p.context().close();

  // ── The job: tally and morning summary ──
  const run = await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  const L = await log();
  ok('job: morning summary asked, then the tally', run.status === 200 && L.includes('MORNING') && L.some((l) => /^PUSH_TALLY \d+\|\d+\|\d+$/.test(l)) && L.lastIndexOf('MORNING') < L.findLastIndex((l) => l.startsWith('PUSH_TALLY')), String(run.status));

  // ── Not the admin ──
  p = await mk({ sub: 'notadmin' });
  await p.goto(B + '/admin'); await p.waitForTimeout(2500);
  ok('not the admin: nothing', (await p.locator('.gr').count()) === 0 && !(await log()).some((l) => l.startsWith('ADMIN_OVERVIEW')) || (await p.locator('.gr').count()) === 0);
  await p.context().close();

  // ── Overview, every size ──
  for (const [w, h] of [[1440, 1000], [1024, 800], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w > 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin'); await p.waitForTimeout(2800);
    ok(`${w}px: /admin opens Overview`, /Overview/.test(await p.locator('.admin-title').innerText()) && (await p.locator('.gr').count()) === 1);
    if (w >= 1024) ok(`${w}px: sidebar Today · Health · People · Growth · Content · Safety · Run`, /Today\s*Overview\s*Health\s*Errors[\s\S]*People\s*Users\s*Guests\s*Growth\s*Funnel & retention\s*Sources\s*Metrics\s*Content\s*What people like\s*Trending now\s*Drafts\s*Polls & snaps\s*Notifications\s*Safety\s*Reports\s*Snaps\s*Words\s*Run/i.test(await p.locator('.admin-side').innerText()), flat(await p.locator('.admin-side').innerText()));
    else ok(`${w}px: Overview is the first tab`, /Overview/.test(await p.getByRole('tab').first().innerText()));
    const al = flat(await p.locator('.gr-alerts').innerText());
    ok(`${w}px: alerts: error, reports, no sign-ups, job running`, /New error, 14 people: “Failed to fetch” on the feed/.test(al) && /2 reports waiting/.test(al) && /Oldest is 3h old/.test(al) && /No sign-ups in the last 24 hours/.test(al) && /Usually 2 a day\. 41 visitors/.test(al) && /Background jobs running/.test(al) && /12 sent, 0 failed/.test(al), al);
    const cmp = flat(await p.locator('.gr-cmp').innerText());
    ok(`${w}px: today vs yesterday vs last week`, /Visitors 41 ?−7% 44 24/.test(cmp), cmp);
    ok(`${w}px: signed up 0 (−3), polls · snaps`, /Signed up 0 ?−3 3 2/.test(cmp) && /Polls · snaps 5 · 3 6 · 2 4 · 0/.test(cmp) && /Votes 186 ?−9% 204 140/.test(cmp), cmp);
    ok(`${w}px: today table fits without scrolling`, await p.locator('.gr-cmp').evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth));
    const goals = flat(await p.locator('.gr-goals').innerText());
    ok(`${w}px: 4 goals with fixed targets`, /34%.*goal 60%.*was 18%/.test(goals) && /11%.*goal 30%.*was 4\.3%/.test(goals) && /1\.6.*goal 2/.test(goals) && /34%.*goal 50%/.test(goals), goals);
    const marks = await p.locator('.gr-meter em').evaluateAll((els) => els.map((e) => e.style.left));
    ok(`${w}px: goal markers at 60%, 30%, 50%, 50%`, JSON.stringify(marks) === '["60%","30%","50%","50%"]', JSON.stringify(marks));
    ok(`${w}px: 14 days of bars, busiest day named`, (await p.locator('.gr-bars .gr-col').count()) === 14 && /Busiest: .*98 visitors, 6 voted/.test(await p.locator('.gr').innerText()));
    ok(`${w}px: no sideways scroll`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await shot(p, `overview-${w}`);
    if (w === 1440) {
      await p.getByRole('button', { name: 'Review →' }).click(); await p.waitForTimeout(800);
      ok('Review → opens Reports', /Reports/.test(await p.locator('.admin-title').innerText()) && p.url().endsWith('#reports'));
      await p.getByRole('button', { name: 'Overview' }).click(); await p.waitForTimeout(1200);
      await p.getByRole('button', { name: 'Open Errors →' }).click(); await p.waitForTimeout(800);
      ok('Open Errors → opens Errors', /Errors/.test(await p.locator('.admin-title').innerText()));
    }
    await p.context().close();
  }

  // ── Funnel, Sources, Polls & snaps, Notifications ──
  for (const [w, h] of [[1440, 1000], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w > 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#funnel'); await p.waitForTimeout(2600);
    const tiles = flat(await p.locator('.ppl-tiles').innerText());
    ok(`${w}px funnel: active 38 / 96 / 241, stickiness 16%`, /38/.test(tiles) && /96/.test(tiles) && /241/.test(tiles) && /16%/.test(tiles), tiles);
    const fun = flat(await p.locator('.gr-funnel').innerText());
    ok(`${w}px funnel: 6 steps with drops`, (await p.locator('.gr-funnel li').count()) === 6 && /Visited 212/.test(fun) && /Voted once 74 −65%/.test(fun) && /Signed in 31 −58%/.test(fun) && /Added a friend 5 −38%/.test(fun), fun);
    ok(`${w}px funnel: biggest drop named`, /Biggest drop: visited → voted once/.test(await p.locator('.gr').innerText()));
    const ret = flat(await p.locator('.gr-ret').innerText());
    ok(`${w}px retention: cohorts, – when too soon`, /34 joined ?38% – –/.test(ret) && /9 joined ?22% 11% 11%/.test(ret), ret);
    ok(`${w}px compared: push 52 vs 14, invited 44 vs 19, signed 31 vs guest 9`, /On 52%.*Off \/ never 14%.*Invited by a friend 44%.*Found it 19%.*Signed in 31%.*Guest 9%/.test(flat(await p.locator('.gr-vs').allInnerTexts().then((x) => x.join(' ')))));
    ok(`${w}px funnel fits`, await fits(p));
    ok(`${w}px retention table fits without scrolling`, await p.locator('.gr-ret').evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth));
    await shot(p, `funnel-${w}`);
    if (w === 1440) { await p.getByRole('button', { name: '30 days' }).click(); await p.waitForTimeout(800); ok('funnel 30 days', (await log()).includes('ADMIN_FUNNEL 30')); }

    await p.goto(B + '/admin#sources'); await p.waitForTimeout(2400);
    const src = flat(await p.locator('.gr').innerText());
    ok(`${w}px sources: kinds named, total`, /Shared poll 86/.test(src) && /Instagram 71/.test(src) && /Invite link 14/.test(src) && /Other sites 2/.test(src) && /217 first visits/.test(src), src.slice(0, 300));
    ok(`${w}px sources: who brings people in`, /@riya\.k 4 polls shared · 31 visitors · 9 voted · 3 signed up \+3 users/.test(src) && /@arjun_07 invite link \+ 2 polls shared/.test(src) && /\+0 users/.test(src), src);
    ok(`${w}px sources: top polls`, /Who's the funniest in the group\? @arjun_07 · friends only 22 visitors/.test(src));
    ok(`${w}px sources: phones with rates`, /iPhone · inside Instagram 74 9% 1% 7%/.test(src), src);
    ok(`${w}px sources fits`, await fits(p));
    ok(`${w}px sources: phone table fits without scrolling`, await p.locator('.gr-table').evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth));
    await shot(p, `sources-${w}`);

    await p.goto(B + '/admin#content'); await p.waitForTimeout(2400);
    const con = flat(await p.locator('.gr').innerText());
    ok(`${w}px content: tiles`, /Polls made 58 8\.3 a day · 21 snaps/i.test(con) && /Votes per poll 14 median · top 10% get 61\+/i.test(con) && /No votes yet 9 16% of polls · 4 still open/i.test(con) && /Comments 132 2\.3 per poll/i.test(con), con.slice(0, 400));
    ok(`${w}px content: 7 days of stacked bars`, (await p.locator('.gr-stack .gr-col').count()) === 7);
    ok(`${w}px content: top, snaps, safety, props`, /88 votes/.test(con) && /Eithr · everyone/.test(con) && /18 went live/.test(con) && /2 sent to you/.test(con) && /11 stopped by blocked words/.test(con) && /Best laugh 😂 34/.test(con), con);
    ok(`${w}px content fits`, await fits(p));
    await shot(p, `content-${w}`);

    await p.goto(B + '/admin#notifications'); await p.waitForTimeout(2400);
    const no = flat(await p.locator('.gr').innerText());
    ok(`${w}px notifications: tiles`, /Sent 410 pushes · 99% reached the phone/i.test(no) && /Opened 27% 109 pushes tapped/i.test(no) && /Emails 96 lunch 41 · evening 55 · 18% clicked/i.test(no) && /Turned off 4/i.test(no), no.slice(0, 400));
    ok(`${w}px notifications: per kind with open rate`, /Votes on your poll 188 186 52 28%/.test(no) && /Props \(💜\) 64 64 31 48%/.test(no) && /Poll of the Day 52 51 3 6%/.test(no) && /Expired .*: 4 · failed: 0/.test(no), no);
    ok(`${w}px notifications: phones, iPhone browser can't`, /iPhone · installed 79%/.test(no) && /iPhone · browser can't/.test(no));
    ok(`${w}px notifications: job runs and last problem fixed`, /Runs every 2 minutes · last 1m ago/.test(no) && /push_scan: timeout/.test(no) && /Fixed/.test(no), no);
    ok(`${w}px notifications fits`, await fits(p));
    ok(`${w}px notifications: kind table fits without scrolling`, await p.locator('.gr-table').evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth));
    ok(`${w}px notifications: runs all there`, /Runs .* (\d+) of \1/.test(no), no.match(/Runs[^F]*/)?.[0]);
    await shot(p, `notifications-${w}`);
    await p.context().close();
  }

  // ── Settings: the 9 am switch, admin only ──
  p = await mk({ sub: 'u1' });
  await p.goto(B + '/settings'); await p.waitForTimeout(3000);
  const sw = p.getByRole('switch', { name: /Morning summary at 9 am/ });
  ok('settings: morning summary switch, off by default', (await sw.count()) === 1 && !(await sw.isChecked()));
  await sw.click(); await p.waitForTimeout(800);
  ok('settings: switching on saves it (logged)', (await sw.isChecked()) && (await log()).includes('MORNING_SWITCH true'));
  await shot(p, 'settings-morning');
  await p.context().close();
  p = await mk({ sub: 'notadmin' });
  await p.goto(B + '/settings'); await p.waitForTimeout(3000);
  ok('settings: not the admin, no switch', (await p.getByRole('switch', { name: /Morning summary/ }).count()) === 0);
  await p.context().close();

  ok('no page errors', !errors.length, errors.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`); await b.close(); process.exit(0);
})();
