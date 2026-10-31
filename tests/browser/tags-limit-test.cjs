const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The tagger and OpenAI's limits: a per-minute rate limit pauses tagging until the next run and is
// not reported; no credit is reported; afterwards tags are saved as usual.
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
const fs = require('fs'); const D = TMP + '/';
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const log = async () => (await fetch(M + '/__log')).json();
const on = (f) => fs.writeFileSync(D + f, '1'); const off = (f) => { try { fs.unlinkSync(D + f); } catch {} };
const job = async () => (await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } })).status;
(async () => {
  off('tags-ratelimit'); off('tags-nocredit');
  on('tags-ratelimit');
  let n = (await log()).length;
  ok('rate limited: the job still answers 200', (await job()) === 200);
  let L = (await log()).slice(n);
  ok('it asked for polls to tag, saved none', L.some((l) => l.startsWith('POLLS_TO_TAG')) && !L.some((l) => l.startsWith('POLL_TAGS')), L.join(','));
  ok('no error reported for a rate limit', !L.some((l) => /^SERVER_ERROR .*poll tags/.test(l)), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));
  off('tags-ratelimit'); on('tags-nocredit');
  n = (await log()).length;
  await job();
  L = (await log()).slice(n);
  ok('no credit: reported', L.some((l) => /^SERVER_ERROR job\|Background job · poll tags \(OpenAI\)\|.*no credits/i.test(l)), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));
  ok('no credit: nothing saved, polls not counted as a try', !L.some((l) => l.startsWith('POLL_TAGS')));
  off('tags-nocredit');
  n = (await log()).length;
  await job();
  L = (await log()).slice(n);
  ok('back to normal: all 4 polls tagged (3 with tags, 1 refused answer)', L.filter((l) => l.startsWith('POLL_TAGS')).length === 4 && !L.some((l) => l.startsWith('SERVER_ERROR')), L.filter((l) => l.startsWith('POLL_TAGS') || l.startsWith('SERVER_ERROR')).join(' / '));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
