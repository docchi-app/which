// Layout check: opens every poll format (with the longest content allowed) and every
// main screen at small phone widths, and fails if any text spills out of its box or is
// cut off, or if the page scrolls sideways. See "Layout check" in the README.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npm run build
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npx next start -p 3145
//   npm run check:layout            (in another terminal; needs Playwright: npx playwright install chromium)

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Needs Playwright: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
require("./mock-supabase.cjs"); // fresh pretend Supabase on :54339 for this run

const fs = require("fs");
const BASE = process.env.BASE_URL ?? "http://localhost:3145";
const OUT = `${__dirname}/out/`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const POLLS = {
  classic: "a1000000-0000-4000-8000-000000000001",
  "long words": "a2000000-0000-4000-8000-000000000002",
  "hot take": "a3000000-0000-4000-8000-000000000003",
  mystery: "a4000000-0000-4000-8000-000000000004",
  "snap, 2 answers": "a5000000-0000-4000-8000-000000000005",
  "snap, 4 answers": "a6000000-0000-4000-8000-000000000006",
  "snap, emoji": "a7000000-0000-4000-8000-000000000007",
  "snap, 3 answers": "a8000000-0000-4000-8000-000000000008",
};
const CARD_SIZES = [[320, 640], [360, 740], [390, 844], [412, 892]];
const SCREEN_SIZES = [[320, 640], [360, 740]];
const SCREENS = ["/friends", "/leaders", "/profile", "/settings", "/activity", "/create", "/props", "/u/priya", "/notifications", "/snap"];

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // Signed in as a pretend user.
  const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: "u1", role: "authenticated", is_anonymous: false, exp: now + 3600 })}.sig`;
  const user = { id: "u1", aud: "authenticated", role: "authenticated", is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const session = { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user };
  await ctx.addCookies([{ name: "sb-localhost-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: BASE }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("docchi.tipsSeen", JSON.stringify(["create", "comments", "leaders", "circle", "activity", "bell", "friends", "profile"]));
      localStorage.setItem("docchi.welcomed", "1");
    } catch {}
  });
  await ctx.addInitScript({ path: `${__dirname}/detect.js` });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));

  let failed = 0;
  let passed = 0;
  async function check(label, root) {
    await p.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
    await p.waitForTimeout(300);
    const found = await p.evaluate((sel) => window.__overflow(document.querySelector(sel) || document.body), root);
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sideways > 1) found.push({ text: "(page)", in: "html", box: "html", how: `page scrolls sideways by ${sideways}px` });
    if (!found.length) return passed++;
    failed++;
    console.log(`✗ ${label}`);
    for (const x of found) console.log(`    "${x.text}" in .${x.in} → ${x.how} (box .${x.box})`);
    await p.screenshot({ path: `${OUT}${label.replace(/[^a-z0-9]+/gi, "-")}.png` });
  }
  // The card's action row: one line at its normal height, nothing past its edge.
  async function checkRow(label) {
    const bad = await p.evaluate(() => {
      const row = document.querySelector(".feed-item .poll-actions");
      if (!row) return null;
      const end = row.clientWidth - parseFloat(getComputedStyle(row).paddingRight);
      const kids = [...row.children].filter((c) => c.offsetWidth > 1);
      const tops = new Set(kids.map((c) => Math.round(c.offsetTop + c.offsetHeight / 2)));
      const out = kids.filter((c) => c.offsetLeft + c.offsetWidth > end + 0.5).map((c) => c.className.split(" ")[0]);
      if (tops.size > 1) return "wrapped to a second line";
      if (out.length) return `past the edge: ${out.join(", ")}`;
      if (row.offsetHeight > 70) return `row is ${row.offsetHeight}px tall`;
      return null;
    });
    if (!bad) return passed++;
    failed++;
    console.log(`✗ ${label}: action row ${bad}`);
    await p.screenshot({ path: `${OUT}${label.replace(/[^a-z0-9]+/gi, "-")}-row.png` });
  }
  const go = async (path) => {
    await p.goto(BASE + path);
    await p.waitForTimeout(1800);
  };

  // Poll cards: before voting at every size, then vote once and check the results at every size.
  for (const phase of ["before vote", "after vote"]) {
    for (const [w, h] of CARD_SIZES) {
      await p.setViewportSize({ width: w, height: h });
      for (const [name, id] of Object.entries(POLLS)) {
        await go(`/p/${id}`);
        if (phase === "after vote" && w === CARD_SIZES[0][0]) {
          const answer = p.locator(".feed-item .answer, .feed-item button.snapc-answer").first();
          if (await answer.count()) {
            await answer.click();
            await p.waitForTimeout(2200);
          }
        }
        await check(`${name} ${w}px ${phase}`, ".feed-item .poll-card");
        await checkRow(`${name} ${w}px ${phase}`);
      }
    }
  }

  // Everyday content on full-size phones: once voted, nothing scrolls inside the card, and ✓
  // stays on your pick's line.
  for (const [w, h] of [[390, 844], [411, 851], [412, 892]]) {
    await p.setViewportSize({ width: w, height: h });
    await go("/p/a9000000-0000-4000-8000-000000000009");
    const answer = p.locator(".feed-item .answer").first();
    if (await answer.count()) {
      await answer.click();
      await p.waitForTimeout(2200);
    }
    await p.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
    await p.waitForTimeout(300);
    const bad = await p.evaluate(() => {
      const card = document.querySelector(".feed-item .poll-card");
      const over = card.scrollHeight - card.clientHeight;
      if (over > 1) return `scrolls by ${over}px`;
      const check = card.querySelector(".result-check");
      const text = check?.nextSibling;
      if (!check || !text) return "no ✓ on your pick";
      const range = document.createRange();
      range.selectNodeContents(text);
      const first = range.getClientRects()[0];
      const c = check.getBoundingClientRect();
      if (!first || Math.abs(first.top + first.height / 2 - (c.top + c.height / 2)) > 6) return "✓ on its own line";
      return null;
    });
    if (!bad) passed++;
    else {
      failed++;
      console.log(`✗ everyday mystery ${w}x${h} after vote: ${bad}`);
      await p.screenshot({ path: `${OUT}everyday-${w}x${h}.png` });
    }
  }

  // The scrolling feed: scrolled down, the slim bar keeps all three tabs and the bell on one
  // line inside the screen; no card in the list ever scrolls inside itself.
  for (const [w, h] of CARD_SIZES) {
    await p.setViewportSize({ width: w, height: h });
    await go("/");
    await p.mouse.wheel(0, 900);
    await p.waitForTimeout(800);
    const bad = await p.evaluate(() => {
      const out = [];
      const top = document.querySelector(".feed-top");
      if (!top?.classList.contains("slim")) out.push("no slim bar after scrolling down");
      const bar = top?.querySelector(".tabs");
      const kids = [...(bar?.children ?? [])].filter((c) => c.offsetWidth > 1);
      const mids = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)));
      if (mids.size > 1) out.push("slim bar wraps to a second line");
      for (const c of kids) if (c.getBoundingClientRect().right > innerWidth - 4) out.push(`slim bar: ${c.className.split(" ")[0] || c.tagName} past the edge`);
      const barTop = bar?.getBoundingClientRect().top ?? -99;
      if (barTop < -1 || barTop > 12) out.push(`slim bar sits at ${Math.round(barTop)}px`);
      for (const c of document.querySelectorAll(".feed-item .poll-card")) {
        if (c.scrollHeight > c.clientHeight + 1) out.push(`"${c.querySelector("h1")?.textContent?.slice(0, 30)}" scrolls inside itself`);
      }
      return out;
    });
    if (!bad.length) passed++;
    else {
      failed++;
      console.log(`✗ feed ${w}px scrolled`);
      for (const x of bad) console.log(`    ${x}`);
      await p.screenshot({ path: `${OUT}feed-scrolled-${w}.png` });
    }
  }

  // First visit: the "How Eithr works" sheet fits every phone without scrolling, with motion
  // (captions that change) and without it (the steps as a list).
  for (const reduced of [false, true]) {
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: reduced ? "reduce" : "no-preference" });
    await fresh.addInitScript({ path: `${__dirname}/detect.js` });
    for (const [w, h] of CARD_SIZES) {
      const fp = await fresh.newPage();
      fp.on("pageerror", (e) => errors.push(e.message));
      await fp.setViewportSize({ width: w, height: h });
      await fp.goto(BASE + "/");
      await fp.waitForTimeout(1800);
      const label = `first-visit sheet ${w}px${reduced ? " (reduced motion)" : ""}`;
      const bad = await fp.evaluate(() => {
        const sheet = document.querySelector(".howto-sheet");
        if (!sheet) return ["no sheet"];
        const out = window.__overflow(sheet).map((x) => `"${x.text}" → ${x.how}`);
        if (sheet.scrollHeight > sheet.clientHeight + 1) out.push(`sheet scrolls by ${sheet.scrollHeight - sheet.clientHeight}px`);
        if (sheet.getBoundingClientRect().top < 0) out.push("sheet taller than the screen");
        // The changing captions are hidden from the detector (screen readers get the list).
        for (const c of document.querySelectorAll(".howto-caps p")) {
          if (c.scrollWidth > c.clientWidth + 1) out.push(`caption "${c.textContent.slice(0, 30)}" spills sideways`);
        }
        const caps = document.querySelector(".howto-caps");
        if (caps && getComputedStyle(caps).display !== "none" && caps.scrollHeight > caps.clientHeight + 1) out.push("captions taller than their box");
        return out;
      });
      if (!bad.length) passed++;
      else {
        failed++;
        console.log(`✗ ${label}`);
        for (const x of bad) console.log(`    ${x}`);
        await fp.screenshot({ path: `${OUT}${label.replace(/[^a-z0-9]+/gi, "-")}.png` });
      }
      await fp.close();
    }
    await fresh.close();
  }

  // Every main screen, plus the comments and share sheets.
  for (const [w, h] of SCREEN_SIZES) {
    await p.setViewportSize({ width: w, height: h });
    await go("/");
    await check(`feed ${w}px`, "body");
    await p.locator('.feed-item [aria-label*="omment" i]').first().click().catch(() => {});
    await p.waitForTimeout(1200);
    await check(`comments ${w}px`, "body");
    await go("/");
    await p.locator(".feed-item button", { hasText: "Share" }).first().click().catch(() => {});
    await p.waitForTimeout(1200);
    await check(`share sheet ${w}px`, "body");
    for (const path of SCREENS) {
      await go(path);
      await check(`${path} ${w}px`, "body");
    }
    // Create, as a mystery poll with the longest teaser.
    await go("/create");
    await p.locator(".more-toggle").click();
    await p.waitForTimeout(400);
    await p.locator("button", { hasText: "Mystery" }).last().click();
    await p.locator("#teaser").fill("Guess the market mood before everyone else does it 📈📈");
    await p.evaluate(() => window.scrollTo(0, 0));
    await check(`/create mystery ${w}px`, "body");
  }

  // The share image WhatsApp and X show, with the longest question and answers.
  const og = await fetch(`${BASE}/p/${POLLS.classic}/opengraph-image`);
  fs.writeFileSync(`${OUT}share-image.png`, Buffer.from(await og.arrayBuffer()));
  if (!og.ok) failed++;

  console.log(`\n${passed} passed, ${failed} failed${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`);
  console.log(`Screenshots of failures and the share image: ${OUT}`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
