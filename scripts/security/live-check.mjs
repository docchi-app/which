// Live site check: what an outside scanner looks at, run against the real site without signing in
// and without sending anything that changes data. Usage: node scripts/security/live-check.mjs [url]
// (default https://eithr.app). Exits non-zero if anything fails.
//
// Checks: HTTP goes to HTTPS; the security headers and their values; no server version leaks;
// private files (.env, .git, source, migrations) aren't served; source maps aren't served; the
// admin pages and secret-protected API routes refuse an anonymous caller; no cross-site access
// (CORS); the browser files carry no secret-looking value and only the public "anon" database key;
// and Mozilla Observatory's grade.
const base = (process.argv[2] || 'https://eithr.app').replace(/\/$/, '');
const host = new URL(base).host;
let pass = 0, fail = 0, warn = 0;
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
const note = (label, extra = '') => { warn++; console.log('WARN', label, extra); };
const get = (path, init = {}) => fetch(path.startsWith('http') ? path : base + path, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20000) });

// 1. HTTPS
const plain = await get(`http://${host}/`).catch(() => null);
// Some networks (proxies) block plain HTTP: then it can't be checked from here.
if (!plain) note('http:// could not be reached from this network, so the redirect to https:// was not checked');
else ok('http:// redirects to https://', [301, 302, 307, 308].includes(plain.status) && /^https:\/\//.test(plain.headers.get('location') || ''), `${plain.status} ${plain.headers.get('location')}`);

// 2. Headers
const home = await get('/');
const h = (k) => home.headers.get(k) || '';
const csp = h('content-security-policy');
ok('home page answers 200', home.status === 200, String(home.status));
ok('CSP: default-src self', /default-src 'self'/.test(csp), csp);
ok("CSP: no framing (frame-ancestors 'none')", /frame-ancestors 'none'/.test(csp));
ok("CSP: no plugins (object-src 'none')", /object-src 'none'/.test(csp));
ok("CSP: base-uri and form-action locked to self", /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp));
ok('CSP: scripts only from the site itself (no outside script hosts)', /script-src 'self'( 'unsafe-inline')?;/.test(csp), csp.match(/script-src[^;]*/)?.[0]);
if (/script-src[^;]*'unsafe-inline'/.test(csp)) note("CSP allows inline scripts ('unsafe-inline'), which Next.js needs without nonces; React escapes text, so the risk is small");
ok('CSP: no wildcard connect-src', !/connect-src[^;]*\s\*(\s|;)/.test(csp));
const hsts = h('strict-transport-security');
ok('HSTS at least 1 year with subdomains', Number(hsts.match(/max-age=(\d+)/)?.[1] || 0) >= 31536000 && /includeSubDomains/i.test(hsts), hsts);
if (!/preload/i.test(hsts)) note('HSTS has no "preload" (optional: lets browsers know before the first visit)');
ok('X-Frame-Options DENY', /^deny$/i.test(h('x-frame-options')), h('x-frame-options'));
ok('X-Content-Type-Options nosniff', /^nosniff$/i.test(h('x-content-type-options')));
ok('Referrer-Policy strict', /strict-origin|no-referrer|same-origin/.test(h('referrer-policy')), h('referrer-policy'));
ok('Permissions-Policy: camera only for the site, no microphone or location', /camera=\(self\)/.test(h('permissions-policy')) && /microphone=\(\)/.test(h('permissions-policy')) && /geolocation=\(\)/.test(h('permissions-policy')), h('permissions-policy'));
ok('Cross-Origin-Opener-Policy same-origin', /same-origin/.test(h('cross-origin-opener-policy')));
ok('no X-Powered-By (framework version not advertised)', !home.headers.get('x-powered-by'), h('x-powered-by'));

// 3. Private files
for (const p of ['/.env', '/.env.local', '/.env.production', '/.git/HEAD', '/.git/config', '/package.json', '/next.config.ts', '/supabase/seed.sql',
  '/supabase/migrations/20261023000000_init.sql', '/src/lib/push-server.ts', '/README.md', '/.vercel/project.json']) {
  const r = await get(p);
  const body = r.status === 200 ? await r.text() : '';
  ok(`not served: ${p}`, r.status === 404 || (r.status === 200 && !/(SUPABASE|secret|ref: refs|"dependencies"|create table|import )/i.test(body) && /<html/i.test(body)), `${r.status}`);
}

// 4. Browser files: source maps, secrets, the database key
const html = await home.text();
const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]))].slice(0, 40);
ok('found the browser script files', scripts.length > 0, String(scripts.length));
let mapsServed = 0; const hits = []; const jwts = new Set();
for (const s of scripts) {
  const url = new URL(s, base).href;
  const js = await (await get(url)).text();
  if ((await get(url + '.map')).status === 200) mapsServed++;
  for (const [name, re] of [['OpenAI key', /sk-(proj-)?[A-Za-z0-9_-]{20,}/], ['Sarvam key', /sk_[a-z0-9]{8,}_[A-Za-z0-9]{16,}/], ['Resend key', /re_[A-Za-z0-9]{20,}/],
    ['Google client secret', /GOCSPX-[A-Za-z0-9_-]{10,}/], ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['service_role mention', /service_role/]]) {
    if (re.test(js)) hits.push(`${name} in ${s}`);
  }
  for (const m of js.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) jwts.add(m[0]);
}
ok('no source maps served (code stays unreadable to scanners)', mapsServed === 0, `${mapsServed} served`);
ok('no secret-looking value in the browser files', hits.length === 0, hits.join(' | '));
const roles = [...jwts].map((t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role; } catch { return '?'; } });
ok('the only database key in the browser is the public "anon" one', roles.every((r) => r === 'anon'), roles.join(','));

// 5. Admin and API routes refuse an anonymous caller
const admin = await get('/admin');
ok('/admin: "not found" for someone not signed in', admin.status === 404, String(admin.status));
for (const [p, method] of [['/api/push/run', 'POST'], ['/api/push/test', 'POST'], ['/api/email/test', 'POST'], ['/api/snap/check', 'POST'], ['/api/moderate/check', 'POST']]) {
  const r = await get(p, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
  ok(`${method} ${p} without a secret or sign-in: refused`, r.status >= 400 && r.status < 500, String(r.status));
}
const run = await get('/api/push/run', { method: 'POST', headers: { authorization: 'Bearer wrong-secret' } });
ok('POST /api/push/run with a wrong secret: refused', run.status === 401 || run.status === 403, String(run.status));

// 6. CORS: another site can't read answers with the visitor's cookies
const cors = await get('/api/views', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
const acao = cors.headers.get('access-control-allow-origin');
ok('no cross-site access to the API (CORS)', !acao || (acao !== '*' && acao !== 'https://evil.example'), String(acao));

// 7. Mozilla Observatory
try {
  const r = await fetch(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${host}`, { method: 'POST', signal: AbortSignal.timeout(60000) });
  const o = await r.json();
  if (o.grade) {
    console.log(`INFO Mozilla Observatory: grade ${o.grade}, score ${o.score}, ${o.tests_passed}/${o.tests_quantity} tests passed (${o.details_url ?? ''})`);
    ok('Mozilla Observatory grade B+ or better', ['A+', 'A', 'A-', 'B+'].includes(o.grade), o.grade);
  } else note('Mozilla Observatory gave no grade', JSON.stringify(o).slice(0, 200));
} catch (e) {
  note('Mozilla Observatory not reachable', e.message);
}

console.log(`\n${pass} passed, ${fail} failed, ${warn} notes`);
process.exit(fail ? 1 : 0);
