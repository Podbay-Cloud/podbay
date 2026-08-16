#!/usr/bin/env bash
# Export the OSS-eligible subset of this monorepo to the public mirror.
#
#   scripts/oss-mirror.sh                 # DRY RUN: build the staging tree, scan it, report. No push.
#   scripts/oss-mirror.sh --push          # after review: squash-commit + push to the public repo
#
# Model (see docs/strategy/oss-repo-shape.md): this private monorepo is the SOURCE OF TRUTH; the public
# repo is a ONE-WAY projection. We publish MOST of the code under BSL and subtract a short infra/ops
# overlay. History is NOT mirrored — each sync is a single squashed commit onto the public main, so an
# old secret in past history can never leak. A secret scan gates every run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${OSS_STAGE:-/tmp/podbay-oss-mirror}"
PUBLIC_REMOTE="${OSS_PUBLIC_REMOTE:-https://github.com/Podbay-Cloud/podbay.git}"
PUSH=0
[ "${1:-}" = "--push" ] && PUSH=1

# ── The exclude-list: infra topology, ops, internal planning, secrets. Everything NOT here is
# published. Keep this SHORT and infra-only — when in doubt, a path is public. Refine during dry-run.
EXCLUDES=(
  # infra topology — Fly app configs + fleet/deploy/box orchestration (the ops moat)
  "apps/web/fly.toml" "packages/gateway/fly.toml" "packages/provider/pod-base/fly.toml"
  "smoke/fly.toml" "scripts/db-backup"
  "scripts/deploy-app.sh" "scripts/deploy-pod-base.sh" "scripts/incus"
  # ops runbooks reveal infra topology
  "docs/runbooks"
  # internal planning / GTM / business
  "0asks.md" "0audit.md" "docs/strategy" "docs/plans"
  # internal agent/dev-workflow instructions (reference prod DB, the box, deploy procedures)
  "CLAUDE.md" ".claude"
  # internal release + infra tooling (mirror scripts, DB migration between hosts)
  "scripts/migrate-db-neon-to-fly.sh" "scripts/publish-relay-mirror.sh" "scripts/publish-install-mirror.sh"
  # deploy CI references the managed infra; the public repo gets its own lint/test CI at launch
  ".github/workflows"
  # never mirror agent-internal + env files
  ".git" ".env" ".env.local" ".env.production"
)

REF="${OSS_REF:-HEAD}"   # CI sets this to the pushed main; local runs use committed HEAD.
echo "== staging OSS tree → $STAGE (from $(git -C "$ROOT" rev-parse --short "$REF")) =="
rm -rf "$STAGE"; mkdir -p "$STAGE"
# Start from a clean, tracked-files-only export of REF (no node_modules, dist, .next, untracked
# cruft, and never any uncommitted local edits).
git -C "$ROOT" archive --format=tar "$REF" | tar -x -C "$STAGE"

echo "== applying exclude-list =="
for p in "${EXCLUDES[@]}"; do
  if [ -e "$STAGE/$p" ]; then rm -rf "$STAGE/$p"; echo "  - removed $p"; fi
done
# Any stray fly.toml the list missed (defense in depth — infra configs must never ship).
find "$STAGE" -name "fly.toml" -print -delete | sed 's/^/  - removed (stray) /' || true

echo "== ensure OSS launch files are present =="
for f in LICENSE LICENSING.md CONTRIBUTING.md SECURITY.md; do
  [ -f "$STAGE/$f" ] && echo "  ✓ $f" || echo "  ⚠ MISSING $f (add it before launch)"
done

echo "== secret scan (HARD GATE) =="
if command -v gitleaks >/dev/null 2>&1; then
  # No-git mode: scan the staged FILES, not history (there is no history yet).
  GL_CONF=""; [ -f "$STAGE/.gitleaks.toml" ] && GL_CONF="--config $STAGE/.gitleaks.toml"
  if gitleaks detect --no-git --source "$STAGE" $GL_CONF --redact -v; then
    echo "  ✓ gitleaks: clean"
  else
    echo "  ✗ gitleaks found potential secrets in the export — ABORTING. Fix or extend EXCLUDES." >&2
    exit 1
  fi
else
  echo "  ⚠ gitleaks not installed — CANNOT verify the export is secret-free." >&2
  echo "    Install it (https://github.com/gitleaks/gitleaks) before --push. Refusing to push blind." >&2
  [ "$PUSH" = 1 ] && exit 1
fi

echo "== summary =="
echo "  files staged: $(find "$STAGE" -type f | wc -l | tr -d ' ')"
echo "  top-level:    $(cd "$STAGE" && ls -d */ 2>/dev/null | tr '\n' ' ')"

if [ "$PUSH" = 0 ]; then
  echo ""
  echo "DRY RUN complete. Review the tree at: $STAGE"
  echo "When it looks right AND gitleaks is clean, publish with:  scripts/oss-mirror.sh --push"
  exit 0
fi

# ── Publish: APPEND one commit to the public main (never force-push — contributors' clones must
# stay valid). Clone the existing public repo, swap in the fresh export tree, commit the delta, push
# fast-forward. Only tree content crosses over (one commit per sync); private history never does.
echo "== PUBLISH → $PUBLIC_REMOTE =="
SHA="$(git -C "$ROOT" rev-parse --short "$REF")"
# Token-based push for CI: embed OSS_PUSH_TOKEN in the remote (a PAT with contents:write on the
# public repo). Locally, leave it unset and rely on the git credential helper (gh auth setup-git).
REMOTE="$PUBLIC_REMOTE"
if [ -n "${OSS_PUSH_TOKEN:-}" ]; then
  REMOTE="https://x-access-token:${OSS_PUSH_TOKEN}@${PUBLIC_REMOTE#https://}"
fi
PUB="${STAGE}.git"; rm -rf "$PUB"
if git clone --depth 1 "$REMOTE" "$PUB" >/dev/null 2>&1 && [ -d "$PUB/.git" ]; then
  echo "  appending to existing public main"
else
  echo "  public repo empty/new — initializing"
  rm -rf "$PUB"; mkdir -p "$PUB"
  ( cd "$PUB" && git init -q && git checkout -q -b main && git remote add origin "$REMOTE" )
fi
# Swap the tracked contents for the freshly-scanned export (keep the public .git).
rsync -a --delete --exclude '.git' "$STAGE/" "$PUB/"
cd "$PUB"
git add -A
if git diff --cached --quiet; then
  echo "== no changes since last sync — nothing to push =="
  exit 0
fi
git -c user.name="podbay" -c user.email="oss@podbay.cloud" commit -q -m "sync: podbay OSS mirror @ $SHA"
git push origin main
echo "== pushed OSS mirror ($SHA) to $PUBLIC_REMOTE =="
