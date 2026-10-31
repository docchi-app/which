const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Compiles src/lib/content-agent.ts (imports stubbed) and checks brainDrafts: who writes, who checks,
// what is kept, dropped or left out.
const REPO = ROOT;
const ts = require(REPO + '/node_modules/typescript');
const fs = require('fs'); const Module = require('module');
const src = fs.readFileSync(REPO + '/src/lib/content-agent.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let unsafe = () => false;
const load = (env) => {
  for (const k of ['OPENAI_API_KEY', 'SARVAM_API_KEY']) delete process.env[k];
  Object.assign(process.env, { PUSH_CRON_SECRET: 's', NEXT_PUBLIC_SUPABASE_URL: 'http://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a' }, env);
  const m = new Module('content-agent'); m.paths = module.paths;
  const realReq = m.require.bind(m);
  m.require = (id) => id === 'server-only' ? {} : id === './text-moderation' ? { rpc: async () => null, scoreText: async (t) => ({ t }), textVerdict: (s) => ({ verdict: unsafe(s.t) ? 'block' : 'ok' }), notMigrated: () => false } : id === './push-server' ? { sendAll: async () => ({}) } : id === './server-errors' ? { reportServerError: async () => {} } : id === './poll-tags' ? { TOPICS: ['fun', 'science'], FEELS: ['quiz'], LANGS: ['en', 'hinglish'] } : realReq(id);
  m._compile(js, 'content-agent.js');
  return m.exports;
};
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const CANDS = [
  { question: 'Kitne months mein 28 days? 🤔', answers: ['Sirf 1', 'All 12'], correct: 1, explain: 'Every month has 28+.', brain_sort: 'twister', lang: 'hinglish', topic: 'fun' },
  { question: 'Sabse purana shehar?', answers: ['Varanasi', 'Madurai'], correct: 0, explain: 'Varanasi.', brain_sort: 'gk', lang: 'hinglish', topic: 'science' },
  { question: 'Goldfish 3 second memory?', answers: ['Myth', 'Fact'], correct: 0, explain: 'Months.', brain_sort: 'myth', lang: 'hinglish', topic: 'science' },
  { question: 'Broken one', answers: ['A', 'B'], correct: 5, explain: 'x', brain_sort: 'odd', lang: 'en', topic: 'fun' },
];
let calls = [];
let writerFails = new Set(); let checkThrows = false; let checkAnswer = (q) => (/purana/.test(q) ? 1 : /28/.test(q) ? 1 : 0);
global.fetch = async (url, init) => {
  const b = JSON.parse(init.body); const who = url.includes('sarvam') ? 'Sarvam' : 'OpenAI'; const name = b.response_format.json_schema.name;
  calls.push(`${who}:${name}`);
  const ok2 = (o) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) } }] }), text: async () => '' });
  if (name === 'eithr_brain') { if (writerFails.has(who)) return { ok: false, status: 429, text: async () => 'no credits' }; return ok2({ brain: CANDS }); }
  if (checkThrows) throw new Error('timeout');
  const q = JSON.parse(b.messages[1].content);
  if (Object.keys(q).join() !== 'question,answers') throw new Error('the check saw more than the question: ' + Object.keys(q));
  return ok2({ answer: checkAnswer(q.question), sure: true });
};
const ctx = (wanted = 1) => ({ settings: { hinglish: 50, post_as: 'eithr' }, brain: { wanted, hour: 13, sorts: ['twister', 'gk', 'myth'], results: [{ sort: 'gk', question: 'x', votes: 10, right_pct: 80 }], recent: [] } });
(async () => {
  let A = load({ OPENAI_API_KEY: 'sk-o', SARVAM_API_KEY: 'sk-s' });
  calls = [];
  ok('none wanted: nothing asked', (await A.brainDrafts(ctx(0))).length === 0 && calls.length === 0);
  ok('before the migration (no brain in the context): nothing asked', (await A.brainDrafts({ settings: {} })).length === 0 && calls.length === 0);
  calls = [];
  let out = await A.brainDrafts(ctx());
  ok('both keys: OpenAI writes, Sarvam checks each of the 3 valid ones', calls[0] === 'OpenAI:eithr_brain' && calls.slice(1).length === 3 && calls.slice(1).every((c) => c === 'Sarvam:eithr_brain_check'), calls.join(' '));
  ok('kept: the first one the check agreed with, then the dropped ones', out.length === 2 && out[0].brain_sort === 'twister' && out[0].checked === true && out[1].brain_sort === 'gk' && out[1].checked === false && out[1].drop_reason === 'The two checks disagreed', JSON.stringify(out.map((d) => [d.brain_sort, d.checked])));
  ok('a second agreed one is not kept; a right answer out of range is left out', !out.some((d) => d.brain_sort === 'myth' || d.brain_sort === 'odd'));
  unsafe = (t) => /Goldfish|28/.test(t);
  out = await A.brainDrafts(ctx());
  ok('one the safety check blocks is left out entirely (not even dropped)', !out.some((d) => d.brain_sort === 'twister') && out.length === 1 && out[0].brain_sort === 'gk' && !out[0].checked, JSON.stringify(out.map((d) => d.brain_sort)));
  unsafe = () => false;
  checkAnswer = () => 3;
  out = await A.brainDrafts(ctx());
  ok('the check agrees with none: all dropped, none kept', out.length === 3 && out.every((d) => !d.checked));
  checkAnswer = (q) => (/purana/.test(q) ? 1 : /28/.test(q) ? 1 : 0);
  checkThrows = true;
  out = await A.brainDrafts(ctx());
  ok('the check fails: dropped, never kept unchecked', out.length === 3 && out.every((d) => !d.checked));
  checkThrows = false;
  writerFails = new Set(['OpenAI']); calls = [];
  out = await A.brainDrafts(ctx());
  ok('OpenAI fails: Sarvam writes and OpenAI checks', calls[0] === 'OpenAI:eithr_brain' && calls[1] === 'Sarvam:eithr_brain' && calls.slice(2).every((c) => c === 'OpenAI:eithr_brain_check') && out[0]?.checked === true, calls.join(' '));
  writerFails = new Set(['OpenAI', 'Sarvam']);
  ok('both fail: it throws (the run reports it and goes on)', await A.brainDrafts(ctx()).then(() => false, () => true));
  writerFails = new Set();
  A = load({ OPENAI_API_KEY: 'sk-o' }); calls = [];
  out = await A.brainDrafts(ctx());
  ok('only OpenAI: it writes and checks in a fresh call', calls[0] === 'OpenAI:eithr_brain' && calls.slice(1).every((c) => c === 'OpenAI:eithr_brain_check') && out[0]?.checked === true, calls.join(' '));
  writerFails = new Set(['OpenAI']);
  ok('only OpenAI, failing: it throws', await A.brainDrafts(ctx()).then(() => false, () => true));
  writerFails = new Set();
  A = load({ SARVAM_API_KEY: 'sk-s' }); calls = [];
  out = await A.brainDrafts(ctx());
  ok('only Sarvam: it writes and checks', calls[0] === 'Sarvam:eithr_brain' && calls.slice(1).every((c) => c === 'Sarvam:eithr_brain_check'), calls.join(' '));
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
