const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Compiles src/lib/content-agent.ts on the fly (imports stubbed): the RSS reader and India-time scheduling.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs'); const Module = require('module');
const src = fs.readFileSync(ROOT + '/src/lib/content-agent.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = new Module('content-agent'); m.paths = module.paths;
const realReq = m.require.bind(m);
m.require = (id) => id === 'server-only' ? {} : id === './text-moderation' ? { rpc: async () => null, scoreText: async () => null, textVerdict: () => ({ verdict: 'ok' }), notMigrated: () => false } : id === './push-server' ? { sendAll: async () => ({}) } : id === './server-errors' ? { reportServerError: async () => {} } : id === './poll-tags' ? { TOPICS: ['food'], FEELS: ['debate'], LANGS: ['en'] } : realReq(id);
m._compile(js, 'content-agent.js');
const { parseRss, publishAt, agentConfigured, headlineKey, SOURCES } = m.exports;
let pass = 0, fail = 0; const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : x); };

const xml = `<rss><channel><title>Feed</title>
<item><title><![CDATA[Tom &amp; Jerry <b>live</b>]]></title><link>https://a.example/1</link></item>
<item><title>Caf&#233; &#x2615; &quot;news&quot;</title><link>http://insecure.example/2</link></item>
<item><title></title><link>https://a.example/empty</link></item>
<item><title>Third</title><link>javascript:alert(1)</link></item>
</channel></rss>`;
const h = parseRss(xml, 'News');
ok('3 items (empty title left out)', h.length === 3, JSON.stringify(h));
ok('CDATA, entities and tags cleaned', h[0].title === 'Tom & Jerry live' && h[1].title === 'Café ☕ "news"', JSON.stringify(h.map((x) => x.title)));
ok('only https links kept', h[0].url === 'https://a.example/1' && h[1].url === null && h[2].url === null);
ok('source label kept', h.every((x) => x.source === 'News'));
ok('max items', parseRss(xml.repeat(1).replace(/<item>/g, '<item>'), 'X', 2).length === 2);
ok('channel title not taken as an item', !h.some((x) => x.title === 'Feed'));
ok('garbage in: nothing out', parseRss('not xml at all', 'X').length === 0);
const long = parseRss(`<item><title>${'x'.repeat(500)}</title></item>`, 'X');
ok('long titles cut to 200', long[0].title.length === 200);

// publishAt: India time; a time already past moves a day on.
const at = (iso) => new Date(iso);
const ist = (s) => { const d = new Date(new Date(s).getTime() + 330 * 60000); return `${d.toISOString().slice(0, 10)} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const now = at('2026-10-31T06:00:00Z'); // 11:30 am India time
ok('today 8 pm → 8 pm today', ist(publishAt('today', 20, now)) === '2026-10-31 20:00', ist(publishAt('today', 20, now)));
ok('tomorrow 9 am → 9 am tomorrow', ist(publishAt('tomorrow', 9, now)) === '2026-11-01 9:00');
ok('today 9 am (past) → tomorrow 9 am', ist(publishAt('today', 9, now)) === '2026-11-01 9:00');
ok('today 11 am (25 minutes ago) → tomorrow', ist(publishAt('today', 11, now)) === '2026-11-01 11:00');
ok('today 11:30 am exactly now → moved on (needs 10 minutes)', ist(publishAt('today', 11, at('2026-10-31T05:35:00Z'))) === '2026-11-01 11:00');
ok('bad hour → 8 pm', ist(publishAt('today', 99, now)) === '2026-10-31 20:00' && ist(publishAt('today', -1, now)) === '2026-10-31 20:00');
const lateNight = at('2026-10-31T18:45:00Z'); // 00:15 am 1 Nov India time
ok('just after midnight India time: "today 8 pm" is the new day', ist(publishAt('today', 20, lateNight)) === '2026-11-01 20:00', ist(publishAt('today', 20, lateNight)));
ok('not configured without keys', agentConfigured === false);
// Headline times, scorecards, the day's key, the feeds
const timed = parseRss(`<item><title>Toss done</title><link>https://a.example/t</link><pubDate>Sat, 31 Oct 2026 12:30:00 GMT</pubDate></item><item><title>No date</title></item><item><title>Live Cricket Score | Scorecard | IND vs AUS</title></item><item><title>Ball by ball commentary</title></item><item><title>Bad date</title><pubDate>not a date</pubDate></item>`, 'Cricket');
ok('pubDate read as ISO; missing or bad date is null', timed[0].published === '2026-10-31T12:30:00.000Z' && timed[1].published === null && timed.find((h) => h.title === 'Bad date')?.published === null, JSON.stringify(timed));
ok('scorecard and ball-by-ball pages left out', !timed.some((h) => /Scorecard|Ball by ball/.test(h.title)) && timed.length === 3);
ok('headline key: lower case, first 60 characters (not UTF-16 units)', headlineKey('ABC') === 'abc' && headlineKey('ജ'.repeat(70)).length === 60 && [...headlineKey('😀'.repeat(70))].length === 60);
ok('six feeds: trends, top stories (5), cricket, sports, entertainment, tech', SOURCES.length === 6 && SOURCES.find((x) => x.label === 'News').max === 5 && ['Sports', 'Entertainment', 'Tech'].every((l) => SOURCES.some((x) => x.label === l)));
console.log(`${pass} pass, ${fail} fail`);
