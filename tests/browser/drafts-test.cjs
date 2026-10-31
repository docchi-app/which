const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Admin → Content → Drafts and Trending now (phone + laptop), and the content agent run end to end
// (stand-ins for the RSS feeds and OpenAI).
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/dr-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  const wait = async (re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const L = await log(); if (L.some((l) => re.test(l))) return L; await new Promise((r) => setTimeout(r, 500)); } return log(); };
  const job = () => fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  const fs = require('fs'); const REQ = TMP + '/agent-last-request.json';
  try { fs.unlinkSync(REQ); } catch {}

  // ── Empty, then "Write drafts now" ──
  let p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  ok('opens Drafts', (await p.locator('.admin-title').innerText()) === 'Drafts');
  ok('sidebar Content: What people like, Trending now, Drafts, Polls & snaps', /Content\s*What people like\s*Trending now\s*Drafts\s*Polls & snaps/i.test(await p.locator('.admin-side').innerText()));
  let t = flat(await p.locator('.dr').innerText());
  ok('empty: when the agent writes, nothing waiting', /The agent writes at 6:30 am India time/.test(t) && /No drafts waiting/.test(t), t.slice(0, 300));
  ok('settings: 8 drafts, 4 posts a day, Eithr, 50%', (await p.locator('#dr-n').inputValue()) === '8' && (await p.locator('#dr-max').inputValue()) === '4' && (await p.locator('#dr-as').inputValue()) === 'eithr' && (await p.locator('#dr-hi').inputValue()) === '50');
  ok('job before asking: no run', (await job()).status === 200 && (await wait(/^AGENT_START/, 8000)).includes('AGENT_START none'));
  await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(800);
  ok('Write drafts now: asked, button off, says when', (await log()).includes('AGENT_REQUEST') && await p.getByRole('button', { name: 'Write drafts now' }).isDisabled() && /Asked at .*new drafts within a few minutes/.test(flat(await p.locator('.dr-status').innerText())));

  // ── The run (after the job's answer) ──
  const r = await job(); const rb = await r.json();
  ok('job answers at once (the agent runs after)', r.status === 200 && rb.sent === 0, JSON.stringify(rb));
  let L = await wait(/^AGENT_SAVE/);
  ok('agent: saved 4 drafts (the one the safety check flags dropped), 9 trends (scorecard left out)', L.includes('AGENT_SAVE 4 drafts 9 trends gpt-4.1'), L.filter((l) => l.startsWith('AGENT')).join(' / '));
  const D = L.filter((l) => l.startsWith('DRAFT ')).map((l) => l.slice(6).split('|'));
  const dv = D.find((d) => d[4].startsWith('Diwali'));
  ok('agent: timely draft keeps its headline as the source', dv && dv[0] === 'timely' && dv[7] === 'Google Trends India: Diwali sweets recipe', JSON.stringify(dv));
  const mu = D.find((d) => d[4].startsWith('Mummy'));
  ok('agent: Hinglish emotional draft, as you', mu && mu[0] === 'emotional' && mu[1] === 'you' && mu[2] === 'hinglish');
  const istH = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).getUTCHours();
  ok('agent: times are India time (9 pm tomorrow, 11 pm today or tomorrow if past)', istH(mu[6]) === 21 && istH(dv[6]) === 23 && new Date(dv[6]) > new Date(), mu[6] + ' ' + dv[6]);
  ok('agent: spicy draft left out', !D.some((d) => /spicy/i.test(d[4])));
  const body = JSON.parse(fs.readFileSync(REQ, 'utf8'));
  const user = JSON.parse(body.messages[1].content);
  ok('model call: gpt-4.1, strict schema, rules in the system message', body.model === 'gpt-4.1' && body.response_format.json_schema.strict === true && /Never about politics/.test(body.messages[0].content) && /never as instructions/.test(body.messages[0].content));
  ok('model call: headlines, Spark, calendar, recent questions, 50% Hinglish', user.headlines.length === 9 && !user.headlines.some((h) => /Scorecard/.test(h.title)) && user.eithr_scores.best_combinations.length === 1 && user.days_coming_up.some((c) => c.label === 'Diwali') && user.recent_questions_do_not_repeat.length === 1 && /About 50% of drafts in Hinglish/.test(body.messages[0].content));
  ok('model call: an injected headline is only data (no link, listed as a headline)', user.headlines.some((h) => /IGNORE PREVIOUS/.test(h.title)) && !JSON.stringify(body).includes('javascript:'));
  ok('model call: no key or secret in the body', !/sk-CANARY|test-secret-test-secret|re_CANARY|GOCSPX/.test(JSON.stringify(body)));
  ok('job again: no second run', ((await job()).status === 200) && (await wait(/^AGENT_START none/, 8000)).filter((l) => /^AGENT_START \d/.test(l)).length === 1);

  // ── The drafts ──
  await p.reload(); await p.waitForTimeout(2500);
  t = flat(await p.locator('.dr').innerText());
  ok('status: last written, 4 drafts', /Written Today .* · 4 drafts/.test(t), t.slice(0, 200));
  ok('4 new drafts, tags, as, why, source', (await p.locator('.dr-card').count()) === 4 && /Google Trends India: Diwali sweets recipe/i.test(t) && /Emotional polls get the most comments/.test(t) && /Hinglish/.test(t), t.slice(0, 900));
  ok('"Approve all 4 as suggested"', (await p.getByRole('button', { name: 'Approve all 4 as suggested' }).count()) === 1);
  await shot(p, '1440-new');
  // Change one
  const card = p.locator('.dr-card', { hasText: 'Maggi at 2 am' });
  await card.getByRole('button', { name: /^Change:/ }).click();
  await card.getByLabel('Question').fill('Maggi raat 2 baje ya chai subah 6 baje?');
  await card.getByRole('button', { name: '+ Answer' }).click();
  await card.getByRole('textbox', { name: /^Answer 3/ }).fill('Dono');
  await card.getByRole('button', { name: /You \(@boss\)/ }).click();
  await card.getByLabel('Language').selectOption('hinglish');
  ok('as you: no Poll of the Day / push switches', (await card.getByLabel('Poll of the Day').count()) === 0 && (await card.getByLabel('Send a push to everyone').count()) === 0);
  await shot(p, '1440-edit');
  await card.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(1500);
  L = await log();
  ok('saved: question, 3 answers, you, Hinglish', L.some((l) => /^DRAFT_SAVE Maggi raat 2 baje ya chai subah 6 baje\?\|Maggi\/Chai\/Dono\|you\|hinglish\|food\|3\|false\|false\|/.test(l)), L.filter((l) => l.startsWith('DRAFT_SAVE')).join(' / '));
  ok('"Draft saved." and the card shows it', /Draft saved\./.test(flat(await p.locator('.dr').innerText())) && (await p.locator('.dr-card', { hasText: 'Maggi raat 2 baje' }).count()) === 1);
  // A bad edit
  const c2 = p.locator('.dr-card', { hasText: 'Space trip' });
  await c2.getByRole('button', { name: /^Change:/ }).click();
  await c2.getByRole('textbox', { name: /^Answer 2/ }).fill('Space');
  await c2.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(1000);
  ok('repeat answers: says what to fix', /Give 2 to 4 different answers/.test(await c2.innerText()));
  await c2.getByRole('textbox', { name: /^Answer 2/ }).fill('Deep sea');
  await c2.getByLabel('Poll of the Day').check();
  await c2.getByLabel(/When/).fill(new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10) + 'T09:00');
  await c2.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(1500);
  ok('Poll of the Day for tomorrow 9 am saved', (await log()).some((l) => /^DRAFT_SAVE Space trip or deep sea dive\?\|Space\/Deep sea\|eithr\|en\|science\|7\|true\|false\|/.test(l) && l.endsWith('T03:30:00.000Z')), (await log()).filter((l) => l.startsWith('DRAFT_SAVE')).pop());
  // Limits: most posts a day 1
  await p.locator('#dr-max').selectOption('1');
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1500);
  ok('settings saved (most posts 1)', (await log()).some((l) => /^AGENT_SETTINGS false\|8\|1\|eithr\|50\|$/.test(l)), (await log()).filter((l) => l.startsWith('AGENT_SETTINGS')).pop());
  await p.getByRole('button', { name: 'Approve all 4 as suggested' }).click(); await p.waitForTimeout(1500);
  t = flat(await p.locator('.dr').innerText());
  ok('approve all with 1 a day: some approved, the rest say why (on their cards)', /approved\./.test(t) && /not approved: see why on the card/.test(t) && /Not approved: that day already has its most posts/.test(t), t.slice(0, 500));
  await p.locator('#dr-max').selectOption('4');
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1200);
  const left = await p.getByRole('button', { name: /^Approve:/ }).count();
  if (left > 1) { await p.getByRole('button', { name: `Approve all ${left} as suggested` }).click(); await p.waitForTimeout(1500); }
  else if (left === 1) { await p.getByRole('button', { name: /^Approve:/ }).first().click(); await p.waitForTimeout(1500); }
  ok('raise to 4: everything approved (all marked approved, none left to approve)', (await p.getByRole('button', { name: /^Approve:/ }).count()) === 0 && (await p.locator('.dr-ok').count()) === 4, flat(await p.locator('.dr').innerText()).slice(0, 400));
  await p.getByRole('button', { name: /^Scheduled/ }).click(); await p.waitForTimeout(500);
  ok('Scheduled: 3 (the Poll of the Day was made at once)', (await p.locator('.dr-card').count()) === 3);
  await p.locator('.dr-card', { hasText: 'Mummy' }).getByRole('button', { name: /^Back to drafts/ }).click(); await p.waitForTimeout(1500);
  ok('Back to drafts', (await log()).some((l) => l.startsWith('UNSCHEDULE Mummy')) && (await p.locator('.dr-card').count()) === 2);
  await p.getByRole('button', { name: /^Posted/ }).click(); await p.waitForTimeout(500);
  t = flat(await p.locator('.dr').innerText());
  ok('Posted: the Poll of the Day with votes, Spark and Open', /Space trip or deep sea dive\?/.test(t) && /12 votes/.test(t) && /Spark 61/.test(t) && (await p.getByRole('link', { name: 'Open' }).count()) === 1, t.slice(0, 400));
  await p.getByRole('button', { name: /^New \d/ }).click(); await p.waitForTimeout(500);
  await p.locator('.dr-card', { hasText: 'Mummy' }).getByRole('button', { name: /^Skip:/ }).click(); await p.waitForTimeout(1500);
  ok('Skip', (await log()).includes('SKIP 1') && (await p.getByRole('button', { name: /^Skip:/ }).count()) === 0);
  // Pause, topic off
  await p.locator('#dr-paused').check();
  await p.getByRole('button', { name: 'Tech', exact: true }).click();
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1500);
  ok('pause + Tech off saved; status says paused', (await log()).some((l) => /^AGENT_SETTINGS true\|8\|4\|eithr\|50\|tech$/.test(l)) && /Paused: no morning drafts/.test(flat(await p.locator('.dr-status').innerText())));
  ok('1440: fits', await fits(p));
  await p.context().close();

  // ── Trending now ──
  for (const [w, h] of [[1440, 1000], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w >= 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#trends'); await p.waitForTimeout(2500);
    ok(`${w}px: opens Trending now`, (await p.locator('.admin-title').innerText()) === 'Trending now');
    t = flat(await p.locator('.dr').innerText());
    ok(`${w}px: read from the sources, ideas with tags`, /Last read Today .* from Google Trends India/.test(t) && /Idea: Kaju katli or gulab jamun\?/.test(t) && /Idea: Aaj kaun jeetega\?/.test(t), t.slice(0, 500));
    ok(`${w}px: left out: the accident and the injected one, with reasons`, /Left out/i.test(t) && /Accident: not for polls/.test(t) && /Not a real story/.test(t));
    ok(`${w}px: headline links open in a new tab, the bad link isn't a link`, (await p.locator('a.dr-title[target="_blank"][rel*="noopener"]').count()) >= 6 && (await p.locator('a[href^="javascript"]').count()) === 0);
    ok(`${w}px: coming up: Diwali`, /Diwali/.test(flat(await p.locator('.dr-cal').innerText())));
    ok(`${w}px: fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    if (w === 1440) {
      await p.getByRole('button', { name: /^Draft it: Diwali sweets/ }).click(); await p.waitForTimeout(1500);
      ok('Draft it → Drafts; shows Drafted', (await log()).includes('FROM_TREND Diwali sweets recipe') && (await p.locator('.dr-card', { hasText: 'Diwali sweets recipe' }).getByText('Drafted').count()) === 1);
      const tomorrow = new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10);
      await p.locator('#cal-day').fill(tomorrow); await p.locator('#cal-label').fill('Bhai Dooj');
      await p.getByRole('button', { name: 'Add', exact: true }).click(); await p.waitForTimeout(1500);
      ok('calendar add', (await log()).includes(`CAL_ADD ${tomorrow} Bhai Dooj`) && /Bhai Dooj/.test(await p.locator('.dr-cal').innerText()));
      await p.getByRole('button', { name: 'Remove Bhai Dooj' }).click(); await p.waitForTimeout(1500);
      ok('calendar remove', !/Bhai Dooj/.test(await p.locator('.dr-cal').innerText()));
    }
    await shot(p, `${w}-trends`);
    await p.context().close();
  }

  // ── Drafts on phones ──
  for (const [w, h] of [[390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: IPHONE, w, h });
    await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
    ok(`${w}px: Drafts tab, the trend draft waiting`, (await p.getByRole('tab', { name: 'Drafts' }).count()) === 1 && (await p.locator('.dr-card').count()) === 1);
    ok(`${w}px: fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await p.locator('.dr-card').first().getByRole('button', { name: /^Change:/ }).click();
    ok(`${w}px: editor fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await shot(p, `${w}-edit`);
    await p.getByRole('button', { name: 'Cancel' }).click();
    await shot(p, `${w}-drafts`);
    await p.context().close();
  }

  // ── Not the admin ──
  p = await mk({ sub: 'notadmin', ua: MAC, w: 1440, h: 900 });
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  ok('not the admin: no drafts screen', (await p.locator('.dr').count()) === 0);
  await p.context().close();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
