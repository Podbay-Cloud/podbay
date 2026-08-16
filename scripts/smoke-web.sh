#!/usr/bin/env bash
# Post-deploy smoke check for the web app — exercises the critical prod paths
# that unit/e2e can't (real host/DNS canonicalization, cookie-domain + origin
# config on the live better-auth endpoint). Fails loudly so a bad deploy is
# caught immediately.
#
#   ./scripts/smoke-web.sh                       # against https://podbay.cloud
#   ./scripts/smoke-web.sh https://podbay.cloud  # explicit base
#
# These are the regressions this guards, in order of how they've actually bitten:
#  1. www.<apex> must 308→apex with NO leaked internal port  (INVALID_ORIGIN bug)
#  2. /signin must render
#  3. the GitHub social endpoint must start OAuth, never INVALID_ORIGIN
#  4. gated pages must redirect anonymous users to /signin
set -uo pipefail

BASE="${1:-https://podbay.cloud}"
APEX_HOST="${BASE#https://}"
APEX_HOST="${APEX_HOST#http://}"
APEX_HOST="${APEX_HOST%%/*}"
WWW="https://www.${APEX_HOST}"

fail=0
pass() { printf '  ✓ %s\n' "$1"; }
bad()  { printf '  ✗ %s\n' "$1"; fail=1; }

echo "smoke: $BASE"

# 1. www → apex canonicalization, exact Location (guards the port-leak too).
loc=$(curl -sI "$WWW/signin" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
if [ "$loc" = "$BASE/signin" ]; then pass "www/signin → $loc"
else bad "www/signin should 308 → $BASE/signin, got '${loc:-<none>}'"; fi

# 2. /signin renders on the canonical host.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/signin")
[ "$code" = 200 ] && pass "/signin = 200" || bad "/signin = $code (want 200)"

# 3. GitHub social sign-in starts OAuth (never INVALID_ORIGIN).
body=$(curl -s -X POST "$BASE/api/auth/sign-in/social" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"github","callbackURL":"/dashboard"}')
if printf '%s' "$body" | grep -qi 'INVALID_ORIGIN'; then
  bad "social sign-in returned INVALID_ORIGIN"
elif printf '%s' "$body" | grep -q 'github.com/login/oauth/authorize'; then
  pass "social sign-in → GitHub OAuth"
else
  bad "social sign-in gave no GitHub URL: $(printf '%s' "$body" | head -c 120)"
fi

# 4. Gated page redirects anonymous → /signin.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/dashboard")
[ "$code" = 307 ] || [ "$code" = 302 ] && pass "/dashboard gates anon ($code)" \
  || bad "/dashboard = $code (want 302/307 to /signin)"

if [ "$fail" = 0 ]; then echo "smoke: PASS"; else echo "smoke: FAIL"; fi
exit "$fail"
