// Secret audit: opens every screen signed out, signed in and as the admin with the network log on,
// and fails if a secret value shows up in any request, response or browser storage, if a key or
// token is in an address (Supabase Storage's signed snap photo links aside), or if a secret value is
// in the built browser files (.next/static). Build and start the app with made-up "canary" secrets
// first; see "Security" in the README.
//
//   OPENAI_API_KEY=sk-CANARYOPENAI0123456789 RESEND_API_KEY=re_CANARYRESEND0123456789 \
//   GOOGLE_CLIENT_SECRET=GOCSPX-CANARYGOOGLE012345 PUSH_CRON_SECRET=test-secret-test-secret-123 \
//   VAPID_PRIVATE_KEY=<a test key> NEXT_PUBLIC_VAPID_PUBLIC_KEY=<its public key> \
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon  npm run build, then npx next start -p 3145
//   VAPID_PRIVATE_KEY=<the same test key> npm run check:secrets      (in another terminal)

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Needs Playwright: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
require("./mock-supabase.cjs"); // fresh pretend Supabase on :54339 for this run

const fs = require("fs");
const path = require("path");
const B = process.env.BASE_URL ?? "http://localhost:3145";
const CRON = process.env.PUSH_CRON_SECRET ?? "test-secret-test-secret-123";
const SECRETS = {
  openai: "CANARYOPENAI",
  resend: "CANARYRESEND",
  google: "CANARYGOOGLE",
  vapid_private: process.env.VAPID_PRIVATE_KEY,
  cron: CRON,
  service_role: "service_role",
};
// The one token expected in an address: a signed snap photo link (short-lived, one file).
const expectedInUrl = (k, u) => k === "token" && /^\/storage\/v1\/object\/sign\/snaps\//.test(u.pathname);

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const POLL = "a1000000-0000-4000-8000-000000000001";
const SIGNED_OUT = ["/", `/p/${POLL}`, "/u/riya.k", "/leaders", "/profile", "/settings", "/create", "/privacy", "/terms", "/guidelines", "/?utm_source=email&utm_campaign=summary-lunch", "/admin"];
const SIGNED_IN = ["/", `/p/${POLL}`, "/u/riya.k", "/leaders", "/profile", "/settings", "/create", "/friends", "/activity", "/props", "/?n=12&utm_source=push"];
const ADMIN = ["overview", "errors", "users", "guests", "funnel", "sources", "metrics", "content", "notifications", "reports", "snaps", "words", "schedule", "limits", "tests", "log"];

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(cond ? "PASS" : "FAIL", label, cond ? "" : extra);
};

(async () => {
  const browser = await chromium.launch();
  const hits = [];
  const urlFlags = [];
  const expected = [];
  const counts = { requests: 0, responses: 0, hosts: {} };
  const scan = (where, text) => {
    for (const [k, v] of Object.entries(SECRETS)) if (v && text && text.includes(v)) hits.push(`${k} in ${where}`);
  };

  const visit = async (label, sub, paths) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (sub) {
      const jwt = `${b64({ alg: "HS256" })}.${b64({ sub, role: "authenticated", exp: now + 3600 })}.sig`;
      const user = { id: sub, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
      const session = { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user };
      await ctx.addCookies([{ name: "sb-localhost-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: B }]);
    }
    const page = await ctx.newPage();
    page.on("request", (r) => {
      counts.requests++;
      const u = new URL(r.url());
      counts.hosts[u.host] = (counts.hosts[u.host] ?? 0) + 1;
      scan(`${label} request ${r.method()} ${u.pathname}`, `${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ""}`);
      for (const k of u.searchParams.keys())
        if (/token|key|secret|password|auth|jwt|sig/i.test(k)) (expectedInUrl(k, u) ? expected : urlFlags).push(`${label}: ${k} in ${u.pathname.replace(/[^/]+$/, "…")}`);
      if (/eyJ[\w-]+\.[\w-]+\./.test(u.search) && !expectedInUrl("token", u)) urlFlags.push(`${label}: a JWT in ${u.pathname}`);
    });
    page.on("response", async (r) => {
      counts.responses++;
      try {
        scan(`${label} response ${new URL(r.url()).pathname}`, `${JSON.stringify(r.headers())} ${await r.text()}`);
      } catch {
        // A redirect or a cancelled request has no body.
      }
    });
    for (const p of paths) {
      await page.goto(B + p).catch(() => {});
      await page.waitForTimeout(1800);
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(500);
    }
    if (label === "admin")
      for (const t of ADMIN) {
        await page.goto(`${B}/admin#${t}`);
        await page.waitForTimeout(1500);
      }
    scan(`${label} browser storage`, await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie).catch(() => ""));
    await ctx.close();
  };

  await visit("signed out", null, SIGNED_OUT);
  await visit("signed in", "notadmin", SIGNED_IN);
  await visit("admin", "u1", ["/admin", "/settings"]);
  // The 2-minute job: the secret goes in the header, and nothing secret comes back.
  const job = await fetch(`${B}/api/push/run`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  scan("job response", JSON.stringify([...job.headers]) + (await job.text()));

  // The built browser files.
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else files.push(path.join(d, e.name));
    }
  };
  const statics = path.join(__dirname, "../../.next/static");
  if (fs.existsSync(statics)) walk(statics);
  const inFiles = files.filter((f) => {
    const text = fs.readFileSync(f, "latin1");
    return Object.values(SECRETS).some((v) => v && text.includes(v));
  });

  console.log(JSON.stringify(counts));
  console.log("SECRET HITS:", hits.length ? [...new Set(hits)].join("\n  ") : "none");
  console.log("KEYS/TOKENS IN ADDRESSES:", urlFlags.length ? [...new Set(urlFlags)].join("\n  ") : "none");
  console.log("EXPECTED IN ADDRESSES:", expected.length ? [...new Set(expected)].join("\n  ") : "none");
  ok(`every screen visited (${counts.requests} requests, ${counts.responses} responses)`, counts.requests > 200 && counts.responses > 200);
  ok("no secret value in any request, response or browser storage", hits.length === 0, [...new Set(hits)].join("; "));
  ok("no key or token in any address (signed snap photo links aside)", urlFlags.length === 0, [...new Set(urlFlags)].join("; "));
  ok("the 2-minute job ran (secret in the header only)", job.status === 200, String(job.status));
  ok(`no secret value in the built browser files (${files.length} files)`, files.length > 0 && inFiles.length === 0, inFiles.join(" "));
  ok("the test VAPID private key was given (VAPID_PRIVATE_KEY)", Boolean(SECRETS.vapid_private));
  console.log(`\n${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
