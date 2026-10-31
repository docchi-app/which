const { ROOT, TMP, SHOTS } = require('../env.cjs');
// Preloaded into `next start`: stands in for Resend; what would be sent goes to a file.
const fs = require('fs');
const OUT = TMP + '/resend-sent.json';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.resend.com/emails')) {
    // A test can make Resend refuse, like an unverified domain would.
    if (fs.existsSync(TMP + '/resend-fail')) return new Response(JSON.stringify({ statusCode: 403, message: 'The eithr.app domain is not verified.' }), { status: 403, headers: { 'content-type': 'application/json' } });
    const sent = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
    sent.push({ auth: init.headers.Authorization, body: JSON.parse(String(init.body)) });
    fs.writeFileSync(OUT, JSON.stringify(sent));
    return new Response(JSON.stringify({ id: 'email_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
