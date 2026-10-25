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
const CARD_SIZES = [[320, 640], [360, 740], [390, 844]];
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
          const answer = p.locator(".swipe-card .answer, .swipe-card button.snapc-answer").first();
          if (await answer.count()) {
            await answer.click();
            await p.waitForTimeout(2200);
          }
        }
        await check(`${name} ${w}px ${phase}`, ".swipe-card .poll-card");
      }
    }
  }

  // Every main screen, plus the comments and share sheets.
  for (const [w, h] of SCREEN_SIZES) {
    await p.setViewportSize({ width: w, height: h });
    await go("/");
    await check(`feed ${w}px`, "body");
    await p.locator('.swipe-card [aria-label*="omment" i]').first().click().catch(() => {});
    await p.waitForTimeout(1200);
    await check(`comments ${w}px`, "body");
    await go("/");
    await p.locator(".swipe-card button", { hasText: "Share" }).first().click().catch(() => {});
    await p.waitForTimeout(1200);
    await check(`share sheet ${w}px`, "body");
    for (const path of SCREENS) {
      await go(path);
      await check(`${path} ${w}px`, "body");
    }
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
