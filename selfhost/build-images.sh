#!/bin/sh
# Build + push the self-host images from a workstation with buildx (e.g. an M-series Mac:
# arm64 native + amd64 emulated) — an alternative to the selfhost-images GitHub workflow that
# spends no CI minutes. Produces one multi-arch manifest per image, pushed to ghcr.
#
#   docker login ghcr.io -u <your-gh-user>      # once, with a PAT that has write:packages
#   ./build-images.sh                            # both images
#   ./build-images.sh pod-app                    # just the dashboard/daemon image
#   OWNER=velsa PLATFORMS=linux/arm64 ./build-images.sh pod-base   # arm64-only, faster
#
# NOTE: pod-base fetches from postgresql.org / nodesource / etc. during its build — run it on a
# network WITHOUT HTTPS interception (a corp VPN breaks cert verification). pod-app is lighter.
# After the first push the packages are PRIVATE (private repo) — make them public once in GitHub.
set -eu
OWNER="${OWNER:-velsa}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
what="${1:-both}"
cd "$(CDPATH= cd "$(dirname "$0")/.." && pwd)"

build() {
  echo ">> building ghcr.io/$OWNER/$1 ($PLATFORMS)"
  docker buildx build --platform "$PLATFORMS" --push \
    -t "ghcr.io/$OWNER/$1:latest" -f "$2" .
}

case "$what" in
  both | pod-app)  build pod-app  selfhost/Dockerfile ;;
esac
case "$what" in
  both | pod-base) build pod-base packages/provider/pod-base/Dockerfile ;;
esac
echo "done — pushed to ghcr.io/$OWNER (make the packages PUBLIC once so compose can pull them)"
