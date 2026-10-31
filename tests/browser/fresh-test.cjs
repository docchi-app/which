const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Fresh drafts: a 6 pm refresh writes only about new headlines, nothing new means no run and no
// push, timely drafts expire, OpenAI out of credit falls back to Sarvam; and the screens for all of it.
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/fr-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  const fs = require('fs'); const D = TMP + '/';
  const flagOn = (f) => fs.writeFileSync(D + f, '1'); const flagOff = (f) => { try { fs.unlinkSync(D + f); } catch {} };
  for (const f of ['rss-refresh', 'openai-down', 'agent-last-request.json', 'agent-sarvam-request.json']) flagOff(f);
  const wait = async (re, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const L = await log(); if (L.some((l) => re.test(l))) return L; await new Promise((r) => setTimeout(r, 400)); } return log(); };
  const job = () => fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } });
  const since = async (n) => (await log()).slice(n);
  const admin = async () => { const p = await mk({ sub: 'u1', ua: MAC, w: 1440, h: 1000 }); return p; };

  // ── The morning set (Write drafts now) ──
  let p = await admin();
  await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(600);
  let n = (await log()).length;
  await job();
  let L = await wait(/^AGENT_SAVE/);
  L = (await log()).slice(n);
  ok('morning: written by gpt-4.1, 9 headlines, scorecard left out', L.some((l) => /^AGENT_SAVE 4 drafts 9 trends gpt-4\.1$/.test(l)), L.filter((l) => l.startsWith('AGENT')).join(' / '));
  const dv = L.find((l) => l.startsWith('DRAFT timely|'))?.split('|');
  ok('a timely draft carries its headline time', dv && /^\d{4}-\d{2}-\d{2}T/.test(dv[8]), String(dv));
  const kerala = L.find((l) => l.startsWith('TREND Google Trends India|ജയിലര്'))?.split('|');
  ok('a Malayalam trend: English gloss, region, time', kerala && kerala[3] === 'Kerala' && kerala[4] === 'Jailer 2 trailer' && /T/.test(kerala[2]), String(kerala));
  const req1 = JSON.parse(fs.readFileSync(D + 'agent-last-request.json', 'utf8'));
  ok('morning prompt: the full mix, gloss and region asked for', /Write exactly 8 drafts/.test(req1.messages[0].content) && /give gloss/.test(req1.messages[0].content) && req1.response_format.json_schema.schema.properties.trends.items.required.includes('region'));

  // ── 6 pm refresh with two new stories ──
  flagOn('rss-refresh');
  await fetch(M + '/__agent_slot?slot=18');
  n = (await log()).length;
  await job();
  await wait(/^AGENT_SAVE 2 drafts/);
  L = await since(n);
  ok('refresh: started as the 6 pm run', L.some((l) => /^AGENT_START \d+ 18$/.test(l)));
  ok('refresh: 2 fresh drafts from the 2 new headlines only', L.some((l) => /^AGENT_SAVE 2 drafts 2 trends gpt-4\.1$/.test(l)), L.filter((l) => l.startsWith('AGENT')).join(' / '));
  const req2 = JSON.parse(fs.readFileSync(D + 'agent-last-request.json', 'utf8'));
  const heads2 = JSON.parse(req2.messages[1].content).headlines.map((h) => h.title);
  ok('refresh prompt: only the new headlines, up to 3 drafts, empty list allowed', heads2.length === 2 && heads2.includes('Toss: India to bat first') && /This is a 6 pm refresh/.test(req2.messages[0].content) && /Write up to 3 drafts/.test(req2.messages[0].content) && /return an empty drafts list/.test(req2.messages[0].content), JSON.stringify(heads2));
  // ── 1 pm refresh with nothing new: no model call, no push ──
  const before = fs.statSync(D + 'agent-last-request.json').mtimeMs;
  await fetch(M + '/__agent_slot?slot=13');
  n = (await log()).length;
  await job();
  await wait(/^AGENT_SAVE 0 drafts 0 trends/);
  L = await since(n);
  ok('refresh with nothing new: saved empty, no model call', L.some((l) => /^AGENT_SAVE 0 drafts 0 trends -$/.test(l)) && fs.statSync(D + 'agent-last-request.json').mtimeMs === before, L.filter((l) => l.startsWith('AGENT')).join(' / '));
  flagOff('rss-refresh');

  // ── OpenAI out of credit → Sarvam ──
  flagOn('openai-down');
  await p.reload(); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Write drafts now' }).click(); await p.waitForTimeout(600);
  n = (await log()).length;
  await job();
  await wait(/^AGENT_SAVE \d+ drafts .* sarvam/);
  L = await since(n);
  ok('OpenAI fails → Sarvam writes the drafts', L.some((l) => /^AGENT_SAVE 4 drafts 9 trends sarvam-105b-conversations$/.test(l)), L.filter((l) => l.startsWith('AGENT')).join(' / '));
  ok('and the OpenAI failure is still reported', L.some((l) => /^SERVER_ERROR job\|Background job · content agent \(OpenAI failed, Sarvam used\)\|.*no credits/i.test(l)), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));
  const sreq = JSON.parse(fs.readFileSync(D + 'agent-sarvam-request.json', 'utf8'));
  ok('Sarvam call: its key in the header, same strict schema and prompt', sreq.model === 'sarvam-105b-conversations' && sreq._key.startsWith('sk_CANARYSARVAM') && sreq.response_format.json_schema.strict === true && sreq.max_tokens <= 8192 && /Write exactly 8 drafts/.test(sreq.messages[0].content));
  ok('no key in the Sarvam request body', !/CANARY/.test(JSON.stringify({ ...sreq, _key: undefined })));
  flagOff('openai-down');

  // ── The Drafts screen ──
  await p.reload(); await p.waitForTimeout(2500);
  let t = flat(await p.locator('.dr').innerText());
  ok('status: written by Sarvam because OpenAI failed', /Written Today .* · 4 drafts/.test(t) && /Written by Sarvam because OpenAI failed/.test(t), t.slice(0, 300));
  const groups = await p.locator('.dr-group').allInnerTexts();
  ok('fresh drafts first, under "Fresh · 6 pm", then "Earlier"', groups.length === 2 && /Fresh · 6 pm/i.test(groups[0]) && /Earlier/i.test(groups[1]), JSON.stringify(groups));
  const first = p.locator('.dr-card').first();
  ok('the first card is a 6 pm fresh draft', /Toss jeeta India|Big trailer today/.test(await first.innerText()));
  const toss = flat(await p.locator('.dr-card', { hasText: 'Toss jeeta India' }).innerText());
  ok('fresh card: headline, its age, when it expires', /Trends India: Toss: India to bat first/i.test(toss) && /\d+m ago/.test(toss) && /Expires (Today|Tomorrow)/.test(toss), toss);
  const sv = flat(await p.locator('.dr-card', { hasText: 'Sarvam: chai or coffee' }).innerText());
  ok('a Sarvam draft says so', /Written by Sarvam/.test(sv));
  const ev = flat(await p.locator('.dr-card', { hasText: 'Space trip or deep sea dive?' }).first().innerText());
  ok('an evergreen draft has no expiry', !/Expires/.test(ev));
  await shot(p, '1440-drafts');
  // Expiry
  await fetch(M + '/__agent_expire');
  await job(); await wait(/^EXPIRED /);
  await p.reload(); await p.waitForTimeout(2500);
  t = flat(await p.locator('.dr').innerText());
  ok('expired timely drafts gone, with a note', /timely drafts? expired today, not approved in time/.test(t) && (await p.locator('.dr-card', { hasText: 'Toss jeeta India' }).count()) === 0, t.slice(0, 400));
  // Settings
  ok('settings: refreshes on, 3 a refresh, timely 12 hours', await p.locator('#dr-r13').isChecked() && await p.locator('#dr-r18').isChecked() && (await p.locator('#dr-rn').inputValue()) === '3' && (await p.locator('#dr-th').inputValue()) === '12');
  await p.locator('#dr-r13').uncheck(); await p.locator('#dr-rn').selectOption('2'); await p.locator('#dr-th').selectOption('24');
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(1500);
  ok('settings saved: no 1 pm refresh, 2 a refresh, 24 hours', (await log()).includes('AGENT_REFRESH false|true|2|24'), (await log()).filter((l) => l.startsWith('AGENT_REFRESH')).pop());
  ok('1440: fits', await fits(p));
  await p.context().close();

  // ── Trending now ──
  for (const [w, h] of [[1440, 1000], [390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: w >= 800 ? MAC : IPHONE, w, h });
    await p.goto(B + '/admin#trends'); await p.waitForTimeout(2500);
    t = flat(await p.locator('.dr').innerText());
    ok(`${w}px: refresh headlines marked New · 6 pm, with ages`, /New · 6 pm/i.test(t) && /\d+m ago/.test(t) && /\d+h ago/.test(t), t.slice(0, 400));
    ok(`${w}px: regional trend shows its state and English gloss`, /Google Trends India · Kerala/i.test(t) && /Jailer 2 trailer/.test(t));
    ok(`${w}px: no scorecard headline`, !/Scorecard/.test(t));
    const titles = await p.locator('.dr-title').allInnerTexts();
    ok(`${w}px: each story once (two full runs read the same ones)`, titles.length === new Set(titles).size, JSON.stringify(titles));

    ok(`${w}px: fits`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await shot(p, `${w}-trends`);
    await p.context().close();
  }
  for (const [w, h] of [[390, 844], [320, 640]]) {
    p = await mk({ sub: 'u1', ua: IPHONE, w, h });
    await p.goto(B + '/admin#drafts'); await p.waitForTimeout(2500);
    ok(`${w}px: drafts fit`, await fits(p), String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await shot(p, `${w}-drafts`);
    await p.context().close();
  }

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
