#!/usr/bin/env bash
# Diagnose Claude Code credential refresh/rotation on a pod (see docs/plans/agent-auth-plan.md).
#
# Run against a pod that has a FRESH, valid login (this is what tells us whether a token
# refresh ROTATES the refresh token — the open question behind "reused auth expired").
# Reports only hashes and timestamps; never prints token values.
#
#   ./scripts/diagnose-agent-auth.sh <machine-id> [app]
#
# It: (1) snapshots refresh-token hash + expiries, (2) forces ONE refresh via a tiny
# headless `claude -p` (uses a trivial amount of the user's subscription), (3) re-snapshots.
# Rotation is confirmed if the refresh-token hash changes or refreshTokenExpiresAt advances.
set -euo pipefail

MACHINE=${1:?usage: diagnose-agent-auth.sh <machine-id> [app]}
APP=${2:-podbay-pods}

# The remote probe. Base64'd before crossing the ssh boundary, so quoting/pipes survive intact.
# It backs up the creds, forces the access token to look expired (so the CLI refreshes on the
# next call — a fresh token wouldn't refresh), runs one tiny prompt, then compares. Restores
# the backup if the refresh cleared the tokens.
read -r -d '' PROBE <<'REMOTE' || true
#!/bin/bash
f=/home/dev/.claude/.credentials.json
cp -a "$f" "$f.diagbak"
snap() {
  echo "  refreshToken_len=$(jq -r '.claudeAiOauth.refreshToken | tostring | length' "$f")"
  echo "  refreshToken_sha=$(jq -r '.claudeAiOauth.refreshToken' "$f" | tr -d '\n' | sha256sum | cut -c1-12)"
  echo "  accessToken_sha=$(jq -r '.claudeAiOauth.accessToken' "$f" | tr -d '\n' | sha256sum | cut -c1-12)"
  echo "  expiresAt=$(jq -r '.claudeAiOauth.expiresAt' "$f")"
  echo "  refreshTokenExpiresAt=$(jq -r '.claudeAiOauth.refreshTokenExpiresAt' "$f")"
}
echo "=== BEFORE ==="; snap
# Make the access token look expired (1h ago) so the CLI takes the refresh path.
past=$(( $(date +%s%3N) - 3600000 ))
tmp=$(mktemp); jq --argjson e "$past" '.claudeAiOauth.expiresAt = $e' "$f" > "$tmp" && mv "$tmp" "$f"
chown dev:dev "$f"; chmod 600 "$f"
echo "=== FORCE REFRESH (expired access token -> tiny prompt) ==="
su - dev -c 'cd ~ && timeout 60 claude -p "reply with just: ok"' 2>&1 | tail -3
echo "=== AFTER ==="; snap
# Safety: if the refresh cleared the tokens, put the (still-valid) backup back.
if [ "$(jq -r '.claudeAiOauth.refreshToken | tostring | length' "$f")" = "0" ]; then
  echo "!! tokens cleared — restoring backup"; cp -a "$f.diagbak" "$f"; chown dev:dev "$f"; chmod 600 "$f"
fi
REMOTE

B64=$(printf '%s' "$PROBE" | base64 | tr -d '\n')
echo "Probing machine $MACHINE in $APP …"
fly ssh console -a "$APP" --machine "$MACHINE" -C "bash -lc 'echo $B64 | base64 -d | bash'"

echo
echo "Interpretation:"
echo "  refreshToken_sha changed  OR  refreshTokenExpiresAt advanced  =>  ROTATION (need M1/M2)."
echo "  both unchanged after refresh                                   =>  no rotation (M1 alone suffices)."
