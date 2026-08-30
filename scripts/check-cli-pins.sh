#!/usr/bin/env bash
# check-cli-pins.sh — are the agent CLIs we pin still current?
#
# Every agent CLI in the pod image is PINNED, so a pod's behaviour is a thing we
# can name ("2.1.215 did X"). The cost of pinning is that nothing tells you when a
# pin falls behind — so this does, on a cadence, instead of relying on someone
# remembering. Read-only: it reports, it never bumps.
#
#   scripts/check-cli-pins.sh            human report; exit 1 if anything is behind
#   scripts/check-cli-pins.sh --json     for a scheduled job to post
set -uo pipefail

DOCKERFILE="${DOCKERFILE:-packages/provider/pod-base/Dockerfile}"
JSON=0
[ "${1:-}" = "--json" ] && JSON=1

pin_of() { # pin_of <npm package>
  grep -oE "$1@[0-9]+\.[0-9]+\.[0-9]+" "$DOCKERFILE" | head -1 | sed "s|.*@||"
}
latest_of() { npm view "$1" version 2>/dev/null; }

# The standalone build is pinned separately (CODEX_VERSION) and must MATCH the npm
# codex: the two share ~/.codex and its state DB, so a version split is a real
# compatibility hazard, not a cosmetic mismatch.
sa_pin() { grep -oE "CODEX_VERSION=[0-9]+\.[0-9]+\.[0-9]+" "$DOCKERFILE" | head -1 | sed "s|.*=||"; }

behind=0
rows=""
add_row() { rows="${rows}${rows:+,}{\"name\":\"$1\",\"pinned\":\"$2\",\"latest\":\"$3\",\"behind\":$4}"; }

for pkg in "@anthropic-ai/claude-code" "@openai/codex"; do
  p=$(pin_of "$pkg"); l=$(latest_of "$pkg")
  if [ -z "$p" ]; then echo "check-cli-pins: no pin found for $pkg in $DOCKERFILE" >&2; continue; fi
  if [ -z "$l" ]; then echo "check-cli-pins: could not reach npm for $pkg" >&2; continue; fi
  b=false; [ "$p" != "$l" ] && { b=true; behind=$((behind+1)); }
  add_row "$pkg" "$p" "$l" "$b"
  [ "$JSON" = 1 ] || printf '  %-28s pinned %-10s latest %-10s %s\n' "$pkg" "$p" "$l" \
    "$([ "$b" = true ] && echo "← BEHIND" || echo "ok")"
done

# codex standalone (the RC daemon) must match the npm codex pin.
npm_codex=$(pin_of "@openai/codex"); sa=$(sa_pin)
split=false
if [ -n "$npm_codex" ] && [ -n "$sa" ] && [ "$npm_codex" != "$sa" ]; then
  split=true; behind=$((behind+1))
fi
add_row "codex-standalone" "$sa" "$npm_codex" "$split"
[ "$JSON" = 1 ] || printf '  %-28s pinned %-10s must match npm codex %-6s %s\n' "codex-standalone" "$sa" "$npm_codex" \
  "$([ "$split" = true ] && echo "← SPLIT" || echo "ok")"

# The build INPUT (provision-pod-base.sh) reinstalls the CLIs, so its pins must MATCH the Dockerfile —
# a split there silently ships the OLD version even when the Dockerfile is bumped (hit live 2026-08-30:
# the image shipped 2.1.215 while the Dockerfile said 2.1.251, because only the Dockerfile was bumped).
PROVISION="${PROVISION:-scripts/incus/provision-pod-base.sh}"
for pkg in "@anthropic-ai/claude-code" "@openai/codex"; do
  d=$(pin_of "$pkg"); pv=$(grep -oE "$pkg@[0-9]+\.[0-9]+\.[0-9]+" "$PROVISION" | head -1 | sed "s|.*@||")
  if [ -n "$d" ] && [ -n "$pv" ] && [ "$d" != "$pv" ]; then
    behind=$((behind+1))
    [ "$JSON" = 1 ] || printf '  %-28s Dockerfile %-10s provision %-10s %s\n' "$pkg" "$d" "$pv" "← SPLIT (provision-pod-base.sh)"
  fi
done

if [ "$JSON" = 1 ]; then
  printf '{"behind":%d,"pins":[%s]}\n' "$behind" "$rows"
else
  [ "$behind" -eq 0 ] && echo "check-cli-pins: all pins current." \
    || echo "check-cli-pins: $behind pin(s) need a deliberate bump (image rebuild + verify on a pod)."
fi
[ "$behind" -eq 0 ]
