const { ROOT, TMP, SHOTS } = require('../env.cjs');
// The secret audit now lives in the repo: scripts/layout-check/secret-audit.cjs (PRIV = the test VAPID private key).
process.env.VAPID_PRIVATE_KEY ??= process.env.PRIV;
require(ROOT + '/scripts/layout-check/secret-audit.cjs');
