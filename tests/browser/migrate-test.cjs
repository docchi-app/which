const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The 2-minute job when a feature's migration hasn't been run yet (the function is missing): it
// skips that step quietly, everything else still runs; a function that's there but broken is
// still reported.
require(ROOT + '/scripts/layout-check/mock-supabase.cjs');
const B = 'http://localhost:3145', M = 'http://localhost:54339';
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const log = async () => (await fetch(M + '/__log')).json();
const set = (name, state) => fetch(`${M}/__fn_state?name=${name}&state=${state}`);
const job = async () => { const r = await fetch(B + '/api/push/run', { method: 'POST', headers: { authorization: 'Bearer test-secret-test-secret-123' } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const since = async (n) => (await log()).slice(n);
(async () => {
  for (const f of ['polls_to_tag', 'post_due_drafts', 'agent_start']) await set(f, 'missing');
  let n = (await log()).length;
  let r = await job();
  await new Promise((res) => setTimeout(res, 3000)); // the agent runs after the answer
  let L = await since(n);
  ok('migrations not run: the job still answers 200', r.status === 200, JSON.stringify(r));
  ok('it did ask for the missing functions', ['polls_to_tag', 'post_due_drafts', 'agent_start'].every((f) => L.includes('MISSING ' + f)), L.filter((l) => l.startsWith('MISSING')).join(','));
  ok('no error reported for them', !L.some((l) => /^SERVER_ERROR .*(poll tags|post drafts|content agent)/.test(l)), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));
  ok('the rest of the run still happened (push collect, errors tick, morning, tally)', L.includes('ERRORS_TICK') && L.includes('MORNING') && L.some((l) => l.startsWith('PUSH_TALLY')), L.join(','));
  // Broken (the function exists but fails): still reported
  for (const f of ['polls_to_tag', 'post_due_drafts', 'agent_start']) await set(f, 'broken');
  n = (await log()).length;
  r = await job();
  await new Promise((res) => setTimeout(res, 3000));
  L = await since(n);
  ok('a broken function: still reported (poll tags)', L.some((l) => /^SERVER_ERROR job\|Background job · poll tags\|/.test(l)), L.filter((l) => l.startsWith('SERVER_ERROR')).join(' / '));
  ok('a broken function: still reported (post drafts)', L.some((l) => /^SERVER_ERROR job\|Background job · post drafts\|/.test(l)));
  ok('a broken function: still reported (content agent)', L.some((l) => /^SERVER_ERROR job\|Background job · content agent\|/.test(l)));
  ok('and the job still answers 200', r.status === 200);
  // Back to normal
  for (const f of ['polls_to_tag', 'post_due_drafts', 'agent_start']) await set(f, 'ok');
  n = (await log()).length;
  r = await job();
  await new Promise((res) => setTimeout(res, 3000));
  L = await since(n);
  ok('back to normal: tags asked for, no errors', L.some((l) => l.startsWith('POLLS_TO_TAG')) && !L.some((l) => l.startsWith('SERVER_ERROR')), L.join(','));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Error', e); process.exit(1); });
