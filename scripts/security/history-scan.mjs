// Secret scan of git history: every line added in the given range (default: the last 8 days; "all"
// for everything) is checked for key, token and private-key patterns. Usage:
//   node scripts/security/history-scan.mjs [all | <days>]
// Exits non-zero on a hit, printing the commit and file but never the matched value itself.
import { execFileSync } from 'node:child_process';
const arg = process.argv[2] || '8';
const range = arg === 'all' ? ['--all'] : [`--since=${Number(arg) || 8}.days`];
const log = execFileSync('git', ['log', '-p', '--no-color', '--unified=0', ...range], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const PATTERNS = [
  ['OpenAI key', /sk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['Sarvam key', /sk_[a-z0-9]{8}_[A-Za-z0-9]{20,}/],
  ['Resend key', /re_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}/],
  ['Google client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Supabase service key', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/],
  ['secret in an env assignment', /^\+\s*(OPENAI_API_KEY|RESEND_API_KEY|SARVAM_API_KEY|GOOGLE_CLIENT_SECRET|VAPID_PRIVATE_KEY|PUSH_CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["']?[A-Za-z0-9_\-]{16,}/],
];
// The tests' planted canary values and placeholders are allowed.
const ALLOWED = /CANARY|test-secret-test-secret|your-|<|example|xxxx/i;
let commit = '', file = '', hits = 0, lines = 0;
for (const line of log.split('\n')) {
  if (line.startsWith('commit ')) commit = line.slice(7, 19);
  else if (line.startsWith('+++ b/')) file = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) {
    lines++;
    for (const [name, re] of PATTERNS) {
      const m = line.match(re);
      if (m && !ALLOWED.test(line)) { hits++; console.log(`FAIL ${name} added in commit ${commit}, ${file}`); }
    }
  }
}
console.log(`${lines} added lines checked (${arg === 'all' ? 'all history' : `last ${Number(arg) || 8} days`}), ${hits} possible secrets`);
process.exit(hits ? 1 : 0);
