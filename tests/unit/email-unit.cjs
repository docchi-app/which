const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Compiles src/lib/email-server.ts on the fly (imports stubbed) and checks every email version.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs'); const Module = require('module');
const src = fs.readFileSync(ROOT + '/src/lib/email-server.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = new Module('email-server'); m.paths = module.paths;
const realReq = m.require.bind(m);
m.require = (id) => id === 'server-only' ? {} : id === './push-server' ? { cronSecret: 'sec', rpc: async () => [] } : id === './server-poll' ? { siteUrl: () => new URL('https://eithr.app') } : realReq(id);
m._compile(js, 'email-server.js');
const { composeSummary, raceOf } = m.exports;
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };
const site = new URL('https://eithr.app');
const base = { user_id: '00000000-0000-4000-8000-000000000001', email: 'a@x.com', username: 'maya', slot: 'lunch', votes: 0, comments: 0, props: 0, requests: 0, top_poll: 'p1', top_question: 'Goa or Manali?', top_votes: 0, top_before: 0, top_closed: false, top_answers: ['Goa', 'Manali'], top_counts: [0, 0], commenters: [], commenter_count: 0, comment_question: null, requesters: [], lunch_sent: false };
const mk = (o) => composeSummary({ ...base, ...o }, site);
const R = (o) => raceOf({ ...base, ...o }).race;

// The race, without saying who leads.
ok('first vote', R({ votes: 1, top_votes: 1, top_before: 0, top_counts: [1, 0] }) === 'first');
ok('tie', R({ votes: 2, top_votes: 2, top_before: 4, top_counts: [3, 3] }) === 'tie');
ok('neck and neck (52/48)', R({ votes: 3, top_votes: 3, top_before: 28, top_counts: [16, 15] }) === 'neck');
ok('pulling ahead (7/2)', R({ votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }) === 'ahead');
ok('not neck with 3 votes 2/1', R({ votes: 1, top_votes: 1, top_before: 2, top_counts: [2, 1] }) === 'ahead');
ok('milestone 25 (crossed from 22)', raceOf({ ...base, votes: 4, top_votes: 4, top_before: 22, top_counts: [14, 12] }).milestone === 25);
ok('no milestone when already past (26 → 28)', R({ votes: 2, top_votes: 2, top_before: 26, top_counts: [15, 13] }) !== 'milestone');
ok('milestone 10 beats first vote', R({ votes: 10, top_votes: 10, top_before: 0, top_counts: [6, 4] }) === 'milestone');
ok('closed beats everything', R({ votes: 3, top_votes: 3, top_before: 0, top_closed: true, top_counts: [3, 3] }) === 'closed');
ok('3 answers: tie on top two', R({ votes: 1, top_votes: 1, top_before: 5, top_counts: [1, 3, 3] }) === 'tie');
ok('guest-only votes (counts 0): plain', R({ votes: 2, top_votes: 2, top_before: 1, top_counts: [0, 0] }) === 'plain');

// Each version's subject, headline and button.
const cases = [
  ['first', { votes: 1, top_votes: 1, top_counts: [1, 0] }, /first vote|just voted/i, /Your first vote is in/, /See what they picked/],
  ['tie', { votes: 2, top_votes: 2, top_before: 4, top_counts: [3, 3] }, /tie|tied/i, /tie right now|Dead even/, /See the tie/],
  ['neck', { votes: 3, top_votes: 3, top_before: 28, top_counts: [16, 15] }, /neck and neck|close/i, /neck and neck|close one/, /See who(&#39;|')s ahead/],
  ['ahead', { votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }, /pulling ahead|front-runner/i, /pulling ahead|taking the lead|front-runner/, /See which one/],
  ['milestone', { votes: 4, top_votes: 4, top_before: 22, top_counts: [14, 12] }, /25 votes/, /25 votes and counting/, /See the results/],
  ['closed', { top_closed: true, top_counts: [18, 13] }, /final result|closed/i, /Your poll has closed/, /See the final result/],
];
for (const [n, o, subj, title, cta] of cases) {
  const e = mk(o);
  ok(`${n}: subject`, subj.test(e.subject), e.subject);
  ok(`${n}: headline`, title.test(e.html), e.text);
  ok(`${n}: button`, cta.test(e.html), e.html.match(/See [^<]*/g));
  ok(`${n}: never says "winning" or which answer leads`, !/winning|Goa (is|leads)|Manali (is|leads)|\b\d+%/.test(e.text + e.subject));
  ok(`${n}: answers shown with ???`, /Goa<br><span[^>]*>\?\?\?/.test(e.html) && /Manali<br><span[^>]*>\?\?\?/.test(e.html));
  ok(`${n}: opens the poll`, /https:\/\/eithr\.app\/p\/p1\?utm_source=email/.test(e.html));
}
ok('closed: says the total', /got 31 votes/.test(mk({ top_closed: true, top_counts: [18, 13] }).text));

// Other leads.
const props = mk({ props: 1, votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] });
ok('props lead: subject, never who, opens Activity', /^💜/.test(props.subject) && /never say who/.test(props.text) && /\/activity\?/.test(props.html), props.subject);
ok('props lead: votes become a line, no answers block', /2 new votes on “Goa or Manali\?”/.test(props.text) && !/\?\?\?/.test(props.html));
const req = mk({ requests: 2, requesters: ['arjun', 'riya'] });
ok('2 requests: names both, plural button, opens Friends', /@arjun and @riya/.test(req.subject + req.text) && /See the requests/.test(req.html) && /\/friends\?/.test(req.html), req.subject);
const req1 = mk({ requests: 1, requesters: ['arjun'] });
ok('1 request', /@arjun/.test(req1.subject) && /See the request →/.test(req1.html), req1.subject);
const com = mk({ comments: 3, commenter_count: 3, commenters: ['kabir', 'meera', 'dev'], comment_question: 'Rate my fit', top_poll: null, top_question: null });
ok('comments lead: names, no comment text, question quoted', /@kabir/.test(com.subject + com.text) && /Rate my fit/.test(com.subject) && /3 people commented/.test(com.text) && /Read the comments/.test(com.html), com.subject);
// Every subject version (they change by person and day) still names who commented.
{ const subs = new Set(); let named = 0;
  for (let i = 0; i < 40; i++) { const e = mk({ user_id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, comments: 3, commenter_count: 3, commenters: ['kabir', 'meera', 'dev'], comment_question: 'Rate my fit', top_poll: null, top_question: null }); subs.add(e.subject.replace(/@\S+/g, '@x')); if (/@kabir, @meera and @dev/.test(e.subject + e.text)) named++; }
  ok('all comment subject versions seen, names always there', subs.size >= 2 && named === 40, [...subs].join(' | ') + ' named ' + named); }
const many = mk({ comments: 6, commenter_count: 5, commenters: ['a1', 'b2', 'c3'], comment_question: 'Q' });
ok('5 commenters: "@a1, @b2 and 3 others"', /@a1, @b2 and 3 others/.test(many.subject + many.text), many.subject);

// Greetings.
ok('lunch: morning', /here's your morning on Eithr/.test(mk({ votes: 1, top_votes: 1, top_counts: [1, 0] }).text));
ok('evening after a lunch email: since lunch', /since lunch/.test(mk({ slot: 'evening', lunch_sent: true, votes: 1, top_votes: 1, top_counts: [1, 0] }).text));
ok('evening with no lunch email: your day', /here's your day on Eithr/.test(mk({ slot: 'evening', lunch_sent: false, votes: 1, top_votes: 1, top_counts: [1, 0] }).text));

// Wording varies by person, stays the same for one person.
const subjects = new Set(); for (let i = 0; i < 40; i++) subjects.add(mk({ user_id: `u${i}`, votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }).subject);
ok('ahead: both subject wordings appear across people', subjects.size === 2, [...subjects].join(' | '));
const titles = new Set(); for (let i = 0; i < 60; i++) titles.add(mk({ user_id: `u${i}`, votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }).html.match(/font-size:26px[^>]*>([^<]*)/)[1]);
ok('ahead: all three headlines appear across people', titles.size === 3, [...titles].join(' | '));
ok('same person, same day: same wording', mk({ votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }).subject === mk({ votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2] }).subject);

// Escaping, and nothing undefined/null leaks into text.
const xss = mk({ votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2], top_question: '<b>hi</b>', top_answers: ['<i>x</i>', 'y'] });
ok('question and answers escaped', /&lt;b&gt;hi&lt;\/b&gt;/.test(xss.html) && /&lt;i&gt;x&lt;\/i&gt;/.test(xss.html) && !/<b>hi|<i>x/.test(xss.html));
let leak = false; for (const [, o] of cases) { const e = mk(o); if (/undefined|null|NaN/.test(e.subject + e.text)) leak = true; }
for (const e of [props, req, req1, com, many]) if (/undefined|null|NaN/.test(e.subject + e.text)) leak = true;
ok('no undefined/null/NaN in any email', !leak);
// 4 answers fit.
const four = mk({ votes: 2, top_votes: 2, top_before: 7, top_counts: [7, 2, 1, 0], top_answers: ['Chai', 'Coffee', 'Green tea', 'Nothing'] });
ok('4 answers: all shown', (four.html.match(/\?\?\?/g) ?? []).length === 4);
fs.writeFileSync(TMP + '/four.html', four.html); fs.writeFileSync(TMP + '/closed.html', mk(cases[5][1]).html); fs.writeFileSync(TMP + '/tie.html', mk(cases[1][1]).html);
// The admin's test samples: every version composes cleanly and matches its name.
const { sampleRow, TEST_VERSIONS } = m.exports;
const me = { user_id: base.user_id, email: 'a@x.com', username: 'maya' };
const want = { props: /💜/, request: /friend/i, comments: /comment/i, first: /first vote|just voted/i, tie: /tie|tied/i, neck: /neck|close/i, ahead: /ahead|front-runner/i, milestone: /25 votes/, closed: /final result|closed/i };
ok('9 test versions', TEST_VERSIONS.length === 9);
for (const v of TEST_VERSIONS) { const e = composeSummary(sampleRow(v, me), site); ok(`sample ${v}: subject fits`, want[v].test(e.subject) && !/undefined|null|NaN/.test(e.subject + e.text), e.subject); }
console.log(`\n${pass} pass, ${fail} fail`);
