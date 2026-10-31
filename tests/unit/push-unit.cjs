const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Compiles src/lib/push-server.ts with web-push stubbed: the Topic header and what a failed send reports.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs'); const Module = require('module');
const js = ts.transpileModule(fs.readFileSync(ROOT + '/src/lib/push-server.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const calls = [];
const fake = { setVapidDetails() {}, sendNotification: async (sub, body, opts) => { calls.push({ sub, body: JSON.parse(body), opts }); if (sub.endpoint.includes('bad')) { const e = new Error('Received unexpected response code'); e.statusCode = 400; e.body = '{"reason":"BadWebPushTopic"}'; throw e; } } };
const m = new Module('push-server'); m.paths = module.paths;
const realReq = m.require.bind(m);
m.require = (id) => id === 'server-only' ? {} : (id === 'web-push' ? { __esModule: true, default: fake } : realReq(id));
m._compile(js, 'push-server.js');
const { topicOf, sendAll, tagUrl } = m.exports;
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const B64URL = /^[A-Za-z0-9_-]{32}$/;
for (const tag of ['votes', 'daily', 'props', 'admin-morning', 'test', 'votes:a1000000-0000-4000-8000-000000000001', 'circle-requests', 'x'])
  ok(`topic for "${tag}": exactly 32 URL-safe Base64 characters`, B64URL.test(topicOf(tag)), topicOf(tag));
ok('same tag, same topic (still replaces the older push)', topicOf('votes:p1') === topicOf('votes:p1'));
ok('different tags, different topics', topicOf('votes:p1') !== topicOf('votes:p2'));
ok('no tag, no topic', topicOf(null) === undefined && topicOf('') === undefined && topicOf(undefined) === undefined);
(async () => {
  const good = { endpoint: 'https://web.push.apple.com/ok1', p256dh: 'k', auth: 'a' };
  const bad = { endpoint: 'https://web.push.apple.com/bad1', p256dh: 'k', auth: 'a' };
  const r = await sendAll([
    { target: good, payload: { title: 'Votes are in', body: 'b', url: '/', tag: 'votes' } },
    { target: bad, payload: { title: '☀️ Yesterday on Eithr', body: 'b', url: '/admin#overview', tag: 'admin-morning' } },
    { target: good, payload: { title: 'No tag', body: 'b', url: '/', tag: null } },
  ]);
  ok('sent 2, failed 1', r.sent === 2 && r.failed === 1, JSON.stringify(r));
  ok('the header sent is the hashed topic', calls[0].opts.topic === topicOf('votes') && calls[2].opts.topic === undefined && calls[0].opts.urgency === 'high');
  ok('error: status and Apple\'s reason', r.firstError === '400 {"reason":"BadWebPushTopic"}', r.firstError);
  ok('detail: push service, tag, topic and title', r.firstDetail === `web.push.apple.com · tag "admin-morning" · topic "${topicOf('admin-morning')}" · “☀️ Yesterday on Eithr”`, r.firstDetail);
  ok('tagUrl keeps the hash', tagUrl('/p/x#comments', 7) === '/p/x?n=7&utm_source=push#comments' && tagUrl('/?a=1', 7) === '/?a=1&n=7&utm_source=push');
  console.log(`\n${pass} pass, ${fail} fail`);
})();
