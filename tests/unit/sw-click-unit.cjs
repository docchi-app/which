const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The service worker's notification tap: lands on the poll whether the app is closed, open and
// controlled, or open but not controlled by this worker (navigate throws or gives null).
const vm = require('vm'); const fs = require('fs');
const code = fs.readFileSync(ROOT + '/public/sw.js', 'utf8');
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const click = async (windows, navigate) => {
  const handlers = {}; const calls = []; const waits = [];
  const self = {
    addEventListener: (t, f) => (handlers[t] = f), skipWaiting: () => {}, location: { origin: 'https://eithr.app' },
    registration: { showNotification: async () => {} },
    clients: {
      claim: async () => {},
      matchAll: async () => windows.map((u) => ({ url: u, focus: async () => calls.push('focus'), navigate: async (to) => { calls.push('navigate ' + to); return navigate(to); } })),
      openWindow: async (u) => { calls.push('open ' + u); return {}; },
    },
    caches: undefined,
  };
  vm.runInNewContext(code, { self, URL, JSON, Boolean, caches: { open: async () => ({}) }, fetch: async () => ({}) });
  handlers.notificationclick({ waitUntil: (p) => waits.push(p), notification: { close: () => calls.push('close'), data: { url: '/p/abc?n=12&utm_source=push' } } });
  await Promise.all(waits);
  return calls;
};
(async () => {
  const U = 'https://eithr.app/p/abc?n=12&utm_source=push';
  let c = await click([], () => null);
  ok('app closed: opens the poll (with ?n= so the tap counts)', c.join('|') === `close|open ${U}`, c.join('|'));
  c = await click(['https://eithr.app/'], (to) => ({ url: to }));
  ok('app open and controlled: focuses and moves it, no second window', c.join('|') === `close|focus|navigate ${U}`, c.join('|'));
  c = await click(['https://eithr.app/'], () => { throw new TypeError('not controlled'); });
  ok('app open but not controlled (navigate throws): opens the poll in a window', c.includes(`open ${U}`), c.join('|'));
  c = await click(['https://eithr.app/'], () => null);
  ok('navigate gives null: opens the poll in a window', c.includes(`open ${U}`), c.join('|'));
  c = await click(['https://other.site/'], () => ({}));
  ok('only another site open: opens the poll', c.join('|') === `close|open ${U}`, c.join('|'));
  console.log(`${pass} pass, ${fail} fail`);
})();
