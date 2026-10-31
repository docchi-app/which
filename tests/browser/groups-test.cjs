const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Group links and friends' picks: the share sheet's two WhatsApp messages, quick vote links (one tap votes, Change undoes),
// this chat's verdict, link previews that never vote; friends' picks (ask once, faces, hide), Settings, matches, admin.
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
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}/gr-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const vshot = (p, name) => p.screenshot({ path: `${SHOTS}/gr-${String(++n).padStart(2, '0')}-${name}.png` });
  const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const state = (name, s) => fetch(`${M}/__fn_state?name=${name}&state=${encodeURIComponent(s)}`);
  const since = async (k) => (await log()).slice(k);
  // Other prompts the app shows (Home Screen, notifications) step aside; the picks question stays.
  const clear = async (p) => { for (let i = 0; i < 3 && (await p.locator('.sheet-layer:not(:has(.picks-sheet))').count()); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(250); const later = p.locator('.sheet-layer:not(:has(.picks-sheet)) .sheet-later, .sheet-layer:not(:has(.picks-sheet)) button:has-text("Not now")').first(); if (await later.count()) await later.click().catch(() => {}); await p.waitForTimeout(250); } };
  const A1 = 'a1000000-0000-4000-8000-000000000001', A2 = 'a2000000-0000-4000-8000-000000000002', A4 = 'a4000000-0000-4000-8000-000000000004';
  const opened = (p) => p.evaluate(() => window.__opened || []);
  const catchOpen = (p) => p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });

  // ── Share sheet: Quick vote links (default) or Just the link ──
  let p = await mk({ sub: 'u2' });
  await p.goto(B + '/'); await p.waitForTimeout(2500); await clear(p);
  let k = (await log()).length;
  await p.locator(`article[data-poll="${A1}"] button[aria-label*="Share"], article[data-poll="${A1}"] .poll-actions button:has-text("Share")`).first().click(); await p.waitForTimeout(900);
  const sheet = p.locator('.share-sheet');
  ok('share sheet: WhatsApp choice shows, Quick vote links picked', (await sheet.locator('.share-style-opt').count()) === 2 && (await sheet.locator('.share-style-opt[aria-checked="true"]').innerText()).includes('Quick vote links'));
  ok('share sheet: a quick link is made as it opens (ready for the tap)', (await since(k)).some((l) => l.startsWith('LINK quick ')));
  await vshot(p, 'share-sheet');
  ok('390 share sheet: fits', await fits(p));
  await catchOpen(p);
  await sheet.locator('.share-btn-whatsapp').click(); await p.waitForTimeout(400);
  let msg = decodeURIComponent((await opened(p))[0]?.split('text=')[1] ?? '');
  const quickCode = /\/v\/([0-9a-f]{10})1/.exec(msg)?.[1];
  ok('WhatsApp (quick): one link per answer, "Tap your pick"', /Tap your pick 👇/.test(msg) && !!quickCode && msg.includes(`/v/${quickCode}2`) && /\nA · .+: http/.test(msg), msg);
  ok('WhatsApp (quick): marked as shared', (await since(k)).includes('LINK_SHARED ' + quickCode));
  k = (await log()).length;
  await sheet.locator('.share-style-opt').nth(1).click(); await p.waitForTimeout(700);
  ok('Just the link: picked; its own link made', (await sheet.locator('.share-style-opt[aria-checked="true"]').innerText()).includes('Just the link') && (await since(k)).some((l) => l.startsWith('LINK link ')));
  await catchOpen(p);
  await sheet.locator('.share-btn-whatsapp').click(); await p.waitForTimeout(400);
  msg = decodeURIComponent((await opened(p))[0]?.split('text=')[1] ?? '');
  ok('WhatsApp (just the link): one /v link, no answer lines', /\/v\/[0-9a-f]{10}$/.test(msg.trim()) && !/Tap your pick/.test(msg), msg);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // A friends-only poll can't have group links.
  await p.goto(B + '/p/a6000000-0000-4000-8000-000000000006'); await p.waitForTimeout(2200); await clear(p);
  await p.context().close();

  // ── Link previews never vote ──
  await fetch(`${M}/__link?poll=${A2}&code=abcdef0123&others=2,1`);
  await fetch(`${M}/__link?poll=${A4}&code=0123abcdef&others=1,2,0`);
  k = (await log()).length;
  const html = await (await fetch(B + '/v/abcdef01232', { headers: { 'user-agent': 'WhatsApp/2.23.20.0' } })).text();
  ok('link page (as WhatsApp sees it): the poll\'s preview image, not indexed', html.includes(`/p/${A2}/opengraph-image`) && /<meta name="robots" content="noindex/.test(html));
  ok('opening the link without a browser never votes', !(await since(k)).some((l) => l.startsWith('/rest/v1/rpc/cast_vote')));
  ok('unknown link: 404', (await fetch(B + '/v/ffffffffff')).status === 404 && (await fetch(B + '/v/nothex')).status === 404);

  // ── Quick vote link: one tap votes, Change undoes ──
  p = await mk({ sub: 'u3' });
  k = (await log()).length;
  await p.goto(B + '/v/abcdef01232'); await p.waitForTimeout(3200); await clear(p);
  let card = p.locator(`article[data-poll="${A2}"]`);
  let lines = await since(k);
  const vote = lines.find((l) => l.startsWith('/rest/v1/rpc/cast_vote'));
  ok('quick link: votes answer 2 once the page is up', !!vote && vote.includes('a2000000-0000-4000-8000-000000000002') && lines.filter((l) => l.startsWith('/rest/v1/rpc/cast_vote')).length === 1, vote);
  ok('quick link: the address drops the answer (a reload won\'t vote again)', new URL(p.url()).pathname === '/v/abcdef0123');
  let t = flat(await card.innerText());
  ok('quick link: "✓ You picked … · Change (Ns)"', /✓ You picked .+ Change \(\d+s\)/.test(t), t.slice(0, 400));
  ok('quick link: my vote joins the chat (link_vote)', (await since(k)).includes('LINK_VOTE abcdef0123'));
  ok('this chat\'s verdict: split shown, 4 voted, who asked', /This chat's verdict/.test(t) && /4 people voted from this chat · @priya asked/.test(t) && (await card.locator('.chat-verdict li').count()) === 3, t.slice(0, 500));
  await vshot(p, 'quick-voted');
  ok('390 quick link: fits', await fits(p));
  await catchOpen(p);
  await card.locator('.chat-verdict-share').click(); await p.waitForTimeout(300);
  msg = decodeURIComponent((await opened(p))[0]?.split('text=')[1] ?? '');
  ok('Share result to the chat: the verdict with bars and the link', /^This chat's verdict on ".+"\n.+▓+ \d\n.+\n4 voted · add yours: http.+\/v\/abcdef0123$/s.test(msg), msg);
  k = (await log()).length;
  await card.locator('.quick-pick-change').click(); await p.waitForTimeout(1800);
  t = flat(await card.innerText());
  ok('Change: the vote is taken back and the answers show again', (await since(k)).includes('UNDO ' + A2) && (await card.locator('.answers button.answer').count()) >= 2, t.slice(0, 300));
  await p.waitForTimeout(1500);
  ok('Change: it doesn\'t vote again by itself', !(await since(k)).some((l) => l.startsWith('/rest/v1/rpc/cast_vote')));
  ok('before voting again: "3 from this chat voted. Pick to see their side."', /3 from this chat voted\. Pick to see their side\./.test(flat(await card.innerText())));
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(1500);
  ok('pick again: counted in the chat again', (await since(k)).filter((l) => l === 'LINK_VOTE abcdef0123').length === 1 && /4 people voted from this chat/.test(flat(await card.innerText())));
  await p.setViewportSize({ width: 320, height: 640 }); await p.waitForTimeout(300);
  ok('320 verdict: fits', await fits(p));
  await vshot(p, 'verdict-320');
  await p.context().close();

  // ── Just the link: the pick is made on the page ──
  p = await mk({ sub: 'u4' });
  k = (await log()).length;
  await p.goto(B + '/v/0123abcdef'); await p.waitForTimeout(3000); await clear(p);
  card = p.locator(`article[data-poll="${A4}"]`);
  ok('just the link: no vote until you pick', !(await since(k)).some((l) => l.startsWith('/rest/v1/rpc/cast_vote')));
  ok('just the link: "3 from this chat voted"', /3 from this chat voted\. Pick to see their side\./.test(flat(await card.innerText())));
  await card.locator('.answers button.answer').nth(1).click(); await p.waitForTimeout(1500);
  t = flat(await card.innerText());
  ok('just the link: voted → verdict, no Change line (you picked it yourself)', /This chat's verdict/.test(t) && !/Change \(/.test(t) && (await since(k)).includes('LINK_VOTE 0123abcdef'), t.slice(0, 300));
  await p.context().close();

  // ── Friends' picks: asked once, then faces and the line ──
  p = await mk({ sub: 'u5' });
  await p.goto(B + '/'); await p.waitForTimeout(2500); await clear(p);
  card = p.locator(`article[data-poll="${A1}"]`);
  await card.locator('.answers button.answer').first().click(); await p.waitForTimeout(2200);
  const ask = p.locator('.picks-sheet');
  ok('first vote where friends voted: "Show your picks to friends?" (asked, not assumed)', (await ask.count()) === 1 && /Only people you've added as friends see them/.test(await ask.innerText()));
  ok('no faces before answering', (await card.locator('.row-faces').count()) === 0);
  await vshot(p, 'picks-ask');
  ok('390 ask: fits', await fits(p));
  k = (await log()).length;
  await ask.locator('.picks-yes').click(); await p.waitForTimeout(1800);
  t = flat(await card.innerText());
  ok('Show to friends: saved, faces on the answers', (await since(k)).includes('PICKS true') && (await card.locator('.row-faces').count()) === 2 && (await card.locator('.row-faces .person-avatar').count()) === 3, t.slice(0, 300));
  ok('the line: "You and @averylongusername_20 picked this. 2 friends went the other way."', /💜 You and @averylongusername_20 picked this\. 2 friends went the other way\./.test(t), t.slice(0, 500));
  await vshot(p, 'picks-faces');
  ok('390 faces: fits', await fits(p));
  k = (await log()).length;
  await card.locator('.friend-picks-hide').click(); await p.waitForTimeout(900);
  ok('Hide my pick on this one: hidden', (await since(k)).includes(`HIDE ${A1} true`) && /Your pick is hidden from friends · Show it/.test(flat(await card.innerText())));
  await p.setViewportSize({ width: 320, height: 640 }); await p.waitForTimeout(300);
  ok('320 faces: fits', await fits(p));

  // Settings
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(B + '/settings'); await p.waitForTimeout(2200);
  t = flat(await p.locator('body').innerText());
  ok('Settings: "Friends see my picks" on, 1 hidden pick', /Friends see my picks/.test(t) && (await p.locator('section[aria-labelledby="picks-settings-title"] input[role="switch"]').isChecked()) && /1 poll your friends can't see your pick on/.test(t));
  await p.locator('section[aria-labelledby="picks-settings-title"] button.settings-row').click(); await p.waitForTimeout(300);
  k = (await log()).length;
  await p.locator('.hidden-picks button').first().click(); await p.waitForTimeout(700);
  ok('Settings: Show it', (await since(k)).includes(`HIDE ${A1} false`) && (await p.locator('.hidden-picks li').count()) === 0);
  await vshot(p, 'settings');
  ok('390 settings: fits', await fits(p));

  // Matches
  await p.goto(B + '/u/priya'); await p.waitForTimeout(2500);
  t = flat(await p.locator('.match-card').innerText().catch(() => ''));
  ok('a friend\'s profile: "You and @priya" 71%, by topic, biggest split', /You and @priya/.test(t) && /71%/.test(t) && /10 of 14/.test(t) && /Food/.test(t) && /Biggest split/.test(t), t);
  await vshot(p, 'match');
  ok('390 match: fits', await fits(p));
  await p.goto(B + '/u/aman'); await p.waitForTimeout(2200);
  ok('not a friend: no match card', (await p.locator('.match-card').count()) === 0);
  await p.goto(B + '/friends'); await p.waitForTimeout(2500);
  t = flat(await p.locator('.match-list').innerText().catch(() => ''));
  ok('Friends tab: "Your friends, by match" with "your opposite"', /Your friends, by match/.test(t) && /@priya 71%/.test(t) && /@zoya 27% · your opposite/.test(t), t);
  await p.setViewportSize({ width: 320, height: 640 }); await p.waitForTimeout(300);
  ok('320 friends tab: fits', await fits(p));
  // Switched off: no picks, no matches.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(B + '/settings'); await p.waitForTimeout(2000);
  await p.locator('section[aria-labelledby="picks-settings-title"] input[role="switch"]').click(); await p.waitForTimeout(700);
  ok('switched off in Settings', (await log()).includes('PICKS false'));
  await p.goto(B + '/friends'); await p.waitForTimeout(2200);
  ok('off: no match list', (await p.locator('.match-list').count()) === 0);
  await p.context().close();

  // ── Admin: which kind of link works ──
  p = await mk({ sub: 'u1', ua: MAC, w: 1280, h: 800 });
  await p.goto(B + '/admin#sources'); await p.waitForTimeout(2600);
  t = flat(await p.locator('section[aria-labelledby="gr-links"]').innerText().catch(() => ''));
  ok('Admin Sources: WhatsApp group links, quick vs just the link, per share', /Quick vote links 9 7 31 3\.4/.test(t) && /Just the link 4 2 6 1\.5/.test(t), t);
  await p.context().close();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
