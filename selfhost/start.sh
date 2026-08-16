#!/bin/sh
# Shared entrypoint for the self-host compose services. Ensures two per-install secrets exist,
# generated once and persisted on the shared /data volume so web + serve agree across restarts:
#   - PODBAY_CRED_KEY     — the pod-secrets vault key (encrypt/decrypt with the SAME key)
#   - BETTER_AUTH_SECRET  — the session-signing secret for the auth gate; web SETS the cookie and
#                           serve VALIDATES it, so both MUST share one secret or the terminal rejects
#                           the owner's session.
# An explicitly provided value always wins; services without /data (migrate) skip key handling.
# Then execs the service command.
set -e

# Generate-and-persist a base64 secret at $2 into env var $1 (if unset and /data is mounted).
ensure_secret() {
  var="$1"; file="$2"
  eval "cur=\$$var"
  [ -n "$cur" ] && return 0
  [ -d /data ] || return 0
  if [ ! -s "$file" ]; then
    tmp="$file.$$"
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$tmp"
    # Atomic claim: hard-link into place; if a sibling service won the race, use theirs.
    ln "$tmp" "$file" 2>/dev/null || true
    rm -f "$tmp"
  fi
  eval "export $var=\"\$(cat \"$file\")\""
}

ensure_secret PODBAY_CRED_KEY /data/cred.key
ensure_secret BETTER_AUTH_SECRET /data/auth.secret
exec "$@"
