// Shared paths for the test suites: the repo, a scratch folder for flags the fakes read and the
// requests they record, and where screenshots go. Set EITHR_TEST_DIR to move the scratch folder.
const os = require('os');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const TMP = process.env.EITHR_TEST_DIR || path.join(os.tmpdir(), 'eithr-tests');
const SHOTS = path.join(TMP, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
module.exports = { ROOT, TMP, SHOTS };
