#!/usr/bin/env bash
# Cut a Podbay release (release-versioning §3.1). A release = a pod-base image ship (image-only,
# per-ship — the settled §7 decisions), so cutting one does three things:
#   1. attaches the version LABEL to the CURRENT pod-base manifest image (the one just shipped),
#   2. tags the private repo `v<version>` and creates a GitHub Release with notes from CHANGELOG.md,
#   3. (deferred to §3.2/§4) the public mirror tag + releases.json — NOT done here yet.
#
# The version is the single source of truth in CHANGELOG.md's top `## X.Y.Z` heading and the matching
# git tag. There is no VERSION file and packages stay 0.0.0 — only the RELEASE is versioned.
#
# Usage:
#   scripts/cut-release.sh              # cut the version at the top of CHANGELOG.md
#   scripts/cut-release.sh --dry-run    # print what it WOULD do, touch nothing
#   scripts/cut-release.sh 0.2.0        # assert the top CHANGELOG version is 0.2.0, then cut it
#
# Requires: ADMIN_API_TOKEN (Fly secret), gh authed with write on the private repo, clean tree at
# origin/main. RUNNING this publishes outward (a tag + a GitHub Release) — get the owner's yes first.
set -euo pipefail

REPO="velsa/podbay"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG="$ROOT/CHANGELOG.md"
WEB="${PODBAY_WEB_URL:-https://podbay.cloud}"
DRY=0
WANT=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) WANT="$a" ;;
  esac
done

# The version is whatever sits at the top `## X.Y.Z` of the CHANGELOG — that is the human-written
# release, and cutting a release the changelog doesn't describe is exactly the footgun to avoid.
VERSION="$(sed -n 's/^## \([0-9]\{1,\}\.[0-9]\{1,\}\.[0-9]\{1,\}\).*/\1/p' "$CHANGELOG" | head -1)"
if [ -z "$VERSION" ]; then
  echo "REFUSING: no '## X.Y.Z' heading found in $CHANGELOG — write the release section first." >&2
  exit 1
fi
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "REFUSING: top CHANGELOG version '$VERSION' is not semver X.Y.Z." >&2
  exit 1
fi
if [ -n "$WANT" ] && [ "$WANT" != "$VERSION" ]; then
  echo "REFUSING: you asked to cut '$WANT' but the top of CHANGELOG is '$VERSION' — reconcile them." >&2
  exit 1
fi
TAG="v$VERSION"

# The release body is this version's CHANGELOG section (everything up to the next `## `).
NOTES="$(awk -v v="## $VERSION" '$0 ~ "^"v"($|[^0-9.])"{f=1;print;next} /^## [0-9]/{f=0} f' "$CHANGELOG")"
if [ -z "$NOTES" ]; then
  echo "REFUSING: could not extract the '## $VERSION' section from $CHANGELOG." >&2
  exit 1
fi

# The image this version names: the CURRENT pod-base manifest image (the one just shipped).
: "${ADMIN_API_TOKEN:?ADMIN_API_TOKEN required (the record/version write is server-side)}"
CUR_JSON="$(curl -fsS -H "Authorization: Bearer $ADMIN_API_TOKEN" "$WEB/api/admin/images")"
CUR_DIGEST="$(printf '%s' "$CUR_JSON" | sed -n 's/.*"currentDigest":"\([0-9a-f]*\)".*/\1/p')"
if [ -z "$CUR_DIGEST" ]; then
  echo "REFUSING: no current pod-base image in the manifest — ship an image before cutting a release." >&2
  exit 1
fi

echo "== cut-release =="
echo "   version : $VERSION  (tag $TAG)"
echo "   image   : ${CUR_DIGEST:0:12}  (current pod-base)"
echo "   repo    : $REPO"
echo "   notes   : $(printf '%s' "$NOTES" | wc -l) lines from CHANGELOG.md"

if [ "$DRY" = 1 ]; then
  echo "== DRY RUN — would attach $VERSION to ${CUR_DIGEST:0:12}, tag $TAG, and cut the GitHub Release =="
  printf '%s\n' "--- release body ---" "$NOTES" "---"
  exit 0
fi

# Refuse to cut from a tree that isn't exactly origin/main — a tag must point at pushed, reviewed code.
git -C "$ROOT" fetch --quiet origin main
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "REFUSING: working tree is dirty — cut a release only from a clean origin/main." >&2; exit 1
fi
if [ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse origin/main)" ]; then
  echo "REFUSING: HEAD != origin/main — push first." >&2; exit 1
fi

# 1. Attach the version to the shipped image (re-records the SAME digest with a version; recordImage
#    preserves its existing notes/summary — the re-record guard added in §2 protects the changelog).
echo "== recording version $VERSION onto ${CUR_DIGEST:0:12} =="
REC="$(curl -fsS -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d "$(printf '{"digest":"%s","version":"%s"}' "$CUR_DIGEST" "$VERSION")" "$WEB/api/admin/images")"
printf '   %s\n' "$REC"

# 2. Tag + GitHub Release on the private repo.
if git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
  echo "== tag $TAG already exists locally — leaving it =="
else
  git -C "$ROOT" tag -a "$TAG" -m "Podbay $TAG"
  git -C "$ROOT" push origin "$TAG"
fi
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "== release $TAG already exists — leaving it =="
else
  printf '%s\n' "$NOTES" | gh release create "$TAG" -R "$REPO" --title "Podbay $TAG" --notes-file -
fi
echo "== done: https://github.com/$REPO/releases/tag/$TAG =="
echo "NOTE: the PUBLIC mirror tag + releases.json (§3.2/§4) are not published by this script yet."
