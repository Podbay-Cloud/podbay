#!/usr/bin/env bash
# Pre-deploy guard: does prod still owe any DB migration the repo has?
#
# The web image is a pruned Next standalone that CANNOT run migrations — only the gateway does, via
# its Fly release_command. So a web deploy that depends on a not-yet-applied migration ships broken
# (prod broke exactly this way on 0039: web selected pods.cpus/memory_mb before the column existed).
# This runs `migrate-prod --check` (read-only) against the prod DB and exits NONZERO if anything is
# pending, so deploy-app.sh can refuse `web` until `gateway` has been deployed first.
#
# Connectivity: podbay-db is Fly-internal (podbay-db.flycast), so we open a short-lived `fly proxy`
# tunnel and read DATABASE_URL from the gateway's env (never printed). Needs `fly` + the built
# packages/db/dist/migrate-prod.js. Emergency override lives in deploy-app.sh, not here.
set -euo pipefail
cd "$(dirname "$0")/.."

DBAPP="${PODBAY_DB_APP:-podbay-db}"
GWAPP="${PODBAY_GATEWAY_APP:-podbay-gateway}"
PORT="${PODBAY_DB_PROXY_PORT:-15533}"

command -v fly >/dev/null 2>&1 || { echo "check-migrations: 'fly' not found — cannot reach prod DB" >&2; exit 1; }
[ -f packages/db/dist/migrate-prod.js ] || { echo "check-migrations: build @podbay/db first (pnpm --filter @podbay/db build)" >&2; exit 1; }

# Open the tunnel in the background; always tear it down on exit.
fly proxy "${PORT}:5432" -a "$DBAPP" >/dev/null 2>&1 &
PROXY_PID=$!
cleanup() { kill "$PROXY_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Wait (max ~15s) for the local port to accept connections.
for _ in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then exec 3>&- 3<&-; break; fi
  sleep 0.5
done

# Pull the prod DATABASE_URL from the gateway env, rewrite host→local tunnel, force plaintext
# (the tunnel is a local loopback). Keep it in a var — never echo it.
DBURL="$(fly ssh console -a "$GWAPP" -C 'printenv DATABASE_URL' 2>/dev/null | grep -oE 'postgres[^[:space:]]+' | head -1 || true)"
[ -n "$DBURL" ] || { echo "check-migrations: could not read DATABASE_URL from $GWAPP" >&2; exit 1; }
LOCALURL="$(printf '%s' "$DBURL" | sed -E "s#@[^/]+/#@127.0.0.1:${PORT}/#; s#\?.*\$##")?sslmode=disable"

# migrate-prod --check: prints "up to date" (exit 0) or the pending list (exit 2).
DATABASE_URL="$LOCALURL" node packages/db/dist/migrate-prod.js --check
