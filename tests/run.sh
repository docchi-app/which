#!/usr/bin/env bash
# Runs the test suites. Usage: tests/run.sh [db|unit|browser|all] (default all).
#   db       every database test on a throwaway in-memory Postgres (PGlite), the break-in suite,
#            and a check that supabase/checks/migration-check.sql is up to date
#   unit     server code compiled on the fly with its network calls stubbed
#   browser  builds the app twice (without secrets, then with planted "canary" secrets that must
#            never reach the browser) and drives it in Chromium against a mock Supabase and fake
#            OpenAI / Sarvam / Resend; also the network audit and the secret audit
# No real service or key is used anywhere. Exits non-zero if anything fails.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export EITHR_TEST_DIR="${EITHR_TEST_DIR:-${TMPDIR:-/tmp}/eithr-tests}"
mkdir -p "$EITHR_TEST_DIR/shots"
WHAT="${1:-all}"
FAILED=()
PORT=3145

# Runs one suite: prints its last result line; remembers it if it failed.
suite() {
  local name="$1"; shift
  local log="$EITHR_TEST_DIR/${name//\//-}.log"
  # Passed only if it exited cleanly, printed no FAIL line or non-zero failure count, and got as far
  # as its summary (older suites print FAIL lines but always exit 0, so the output decides too).
  timeout 1500 "$@" > "$log" 2>&1
  local code=$?
  if [ $code -eq 0 ] && ! grep -qE '^(FAIL|Error|BAD)\b|\b[1-9][0-9]* (fail|failed)\b|^Node\.js v' "$log" && grep -qE '[0-9]+ (pass|passed)|RESULT|^OK ' "$log"; then
    echo "ok    $name: $(grep -E '[0-9]+ (pass|passed)|RESULT' "$log" | tail -1)"
  else
    echo "FAIL  $name: $(grep -E '[0-9]+ (pass|passed)|RESULT|Error' "$log" | tail -1)"
    grep -E '^FAIL' "$log" | head -20 | cut -c1-300 | sed 's/^/        /'
    FAILED+=("$name")
  fi
}

run_db() {
  for f in tests/db/test*.mjs tests/db/breakin.mjs; do suite "db/$(basename "$f" .mjs)" node --import "$ROOT/tests/db/clock.mjs" "$f" "$ROOT"; done
  # The migration check must match the migrations (regenerate with: node scripts/migration-check/make.mjs).
  if node scripts/migration-check/make.mjs > "$EITHR_TEST_DIR/migration-check.log" 2>&1 && git diff --quiet -- supabase/checks/migration-check.sql; then
    echo "ok    migration-check: up to date"
  else
    echo "FAIL  migration-check: supabase/checks/migration-check.sql is out of date (run node scripts/migration-check/make.mjs)"
    FAILED+=("migration-check")
  fi
}

run_unit() {
  for f in tests/unit/*.cjs; do suite "unit/$(basename "$f" .cjs)" env VAPID_PRIVATE_KEY=x node "$f"; done
}

SERVER_PID=""
start_app() {
  setsid npx next start -p "$PORT" > "$EITHR_TEST_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 90); do curl -s -o /dev/null "http://localhost:$PORT/" && return 0; sleep 1; done
  echo "FAIL  the app didn't start"; FAILED+=("app-start"); return 1
}
stop_app() {
  [ -n "$SERVER_PID" ] && kill -- "-$SERVER_PID" 2>/dev/null
  SERVER_PID=""; sleep 1
}
trap stop_app EXIT

run_browser() {
  local SB="NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon"
  rm -rf .next
  if ! env $SB npx next build > "$EITHR_TEST_DIR/build.log" 2>&1; then echo "FAIL  build (see $EITHR_TEST_DIR/build.log)"; FAILED+=("build"); return; fi
  echo "ok    build"
  start_app || return
  suite browser/layout node scripts/layout-check/run.cjs
  for t in admin1 gone nowait qa flow back redesign howto limits snapcard; do suite "browser/$t" node "tests/browser/$t-test.cjs"; done
  stop_app

  # Planted "canary" secrets: none may reach the browser files or the network.
  local KEYS PUB PRIV
  KEYS=$(node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
  PUB=${KEYS% *}; PRIV=${KEYS#* }
  local CAN="OPENAI_API_KEY=sk-CANARYOPENAI0123456789 RESEND_API_KEY=re_CANARYRESEND0123456789 GOOGLE_CLIENT_SECRET=GOCSPX-CANARYGOOGLE012345 SARVAM_API_KEY=sk_CANARYSARVAM0123456789 VAPID_PRIVATE_KEY=$PRIV PUSH_CRON_SECRET=test-secret-test-secret-123"
  rm -rf .next
  if ! env $CAN NEXT_PUBLIC_VAPID_PUBLIC_KEY="$PUB" $SB npx next build > "$EITHR_TEST_DIR/build-canary.log" 2>&1; then echo "FAIL  canary build"; FAILED+=("canary-build"); return; fi
  local HITS
  HITS=$(grep -rlF -e sk-CANARYOPENAI0123456789 -e re_CANARYRESEND0123456789 -e GOCSPX-CANARYGOOGLE012345 -e sk_CANARYSARVAM0123456789 -e "$PRIV" -e test-secret-test-secret-123 .next/static | wc -l)
  if [ "$HITS" = "0" ]; then echo "ok    canary secrets in browser files: none"; else echo "FAIL  canary secrets found in $HITS browser files"; FAILED+=("canary-static"); fi
  export OPENAI_API_KEY=sk-CANARYOPENAI0123456789 RESEND_API_KEY=re_CANARYRESEND0123456789 GOOGLE_CLIENT_SECRET=GOCSPX-CANARYGOOGLE012345 SARVAM_API_KEY=sk_CANARYSARVAM0123456789 VAPID_PRIVATE_KEY="$PRIV" PUSH_CRON_SECRET=test-secret-test-secret-123
  NODE_OPTIONS="-r $ROOT/tests/fakes/fake-resend.cjs -r $ROOT/tests/fakes/fake-openai.cjs" NEXT_PUBLIC_VAPID_PUBLIC_KEY="$PUB" \
    NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon start_app || return
  suite browser/net-audit env PRIV="$PRIV" node tests/browser/net-audit.cjs
  for t in asks mod emailtest errors people growth fix likes drafts migrate fresh tags-limit approve tags brain states groups; do suite "browser/$t" node "tests/browser/$t-test.cjs"; done
  suite secret-audit npm run -s check:secrets
  stop_app
  unset OPENAI_API_KEY RESEND_API_KEY GOOGLE_CLIENT_SECRET SARVAM_API_KEY VAPID_PRIVATE_KEY PUSH_CRON_SECRET
}

case "$WHAT" in
  db) run_db ;;
  unit) run_unit ;;
  browser) run_browser ;;
  all) run_db; run_unit; run_browser ;;
  *) echo "Usage: tests/run.sh [db|unit|browser|all]"; exit 2 ;;
esac

if [ ${#FAILED[@]} -gt 0 ]; then echo; echo "Failed: ${FAILED[*]}"; exit 1; fi
echo; echo "All passed."
