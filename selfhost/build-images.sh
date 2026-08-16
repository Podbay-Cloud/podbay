#!/bin/sh
# Build + push the self-host images from a workstation with buildx (e.g. an M-series Mac:
# arm64 native + amd64 emulated) — an alternative to the selfhost-images GitHub workflow that
# spends no CI minutes. Produces one multi-arch manifest per image, pushed to ghcr.
#
#   docker login ghcr.io -u <your-gh-user>      # once, with a PAT that has write:packages
#   ./build-images.sh                            # both images, pushed to every OWNERS namespace
#   ./build-images.sh pod-app                    # just the dashboard/daemon image
#   OWNERS=podbay-cloud PLATFORMS=linux/arm64 ./build-images.sh pod-base   # single namespace, arm64-only
#
# OWNERS is a SPACE-SEPARATED list of ghcr namespaces; each image is tagged into all of them in one
# build. During the velsa→podbay-cloud transition the default is BOTH, so existing installs (pinned
# ghcr.io/velsa/*) and new installs (ghcr.io/podbay-cloud/*) both keep pulling. Drop `velsa` from the
# list once the deprecation window closes (see docs/plans/ghcr-namespace-migration.md).
#
# NOTE: pod-base fetches from postgresql.org / nodesource / etc. during its build — run it on a
# network WITHOUT HTTPS interception (a corp VPN breaks cert verification). pod-app is lighter.
# After the first push a new package is PRIVATE — make it public once in GitHub so compose can pull it.
set -eu
OWNERS="${OWNERS:-${OWNER:-velsa podbay-cloud}}"   # back-compat: OWNER still selects a single namespace
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
what="${1:-both}"
cd "$(CDPATH= cd "$(dirname "$0")/.." && pwd)"

build() {
  tags=""
  for o in $OWNERS; do tags="$tags -t ghcr.io/$o/$1:latest"; done
  echo ">> building$tags ($PLATFORMS)"
  # shellcheck disable=SC2086 # $tags is a deliberate list of -t flags
  docker buildx build --platform "$PLATFORMS" --push $tags -f "$2" .
}

case "$what" in
  both | pod-app)  build pod-app  selfhost/Dockerfile ;;
esac
case "$what" in
  both | pod-base) build pod-base packages/provider/pod-base/Dockerfile ;;
esac
echo "done — pushed to: $(for o in $OWNERS; do printf 'ghcr.io/%s ' "$o"; done)(make any NEW package PUBLIC in GitHub so compose can pull it)"
