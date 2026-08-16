#!/bin/sh
# Gateway entrypoint: bring up WireGuard to the Incus box (if configured), then
# exec the gateway. infra-strategy.md M1 — the gateway stays on Fly and reaches
# Incus pods over wg0; Fly-only deployments (no PODBAY_WG_CONF) skip all of this.
#
# PODBAY_WG_CONF: full wg-quick-style config as a Fly secret (multiline PEM-ish).
# Uses the kernel WireGuard module (Fly machine kernels ship it; VERIFY at M0 —
# fallback if absent: add wireguard-go to the image and `wireguard-go wg0` first).
set -e

if [ -n "${PODBAY_WG_CONF:-}" ]; then
  echo "[wg-up] configuring wg0"
  umask 077
  mkdir -p /etc/wireguard
  printf '%s\n' "$PODBAY_WG_CONF" > /etc/wireguard/wg0.conf
  # The peer config from the secret has no keepalive; without one our Fly-side NAT
  # mapping + WG handshake expire when idle and the box can't push data back, so
  # terminal/preview I/O over the tunnel stalls. [Peer] is the last section, so
  # appending lands under it; wg-quick applies it natively at bring-up (more
  # reliable than a post-up `wg set`).
  grep -qi '^PersistentKeepalive' /etc/wireguard/wg0.conf \
    || printf 'PersistentKeepalive = 25\n' >> /etc/wireguard/wg0.conf
  # wg-quick handles interface, addresses and AllowedIPs routes in one shot.
  if wg-quick up wg0; then
    echo "[wg-up] wg0 up"
    # Keep the tunnel warm. We sit behind Fly's NAT, so without a keepalive our
    # NAT mapping + WG handshake expire during quiet moments — the box can then no
    # longer push data back and terminal I/O stalls (the browser still shows
    # "connected"; input hangs, then bursts through on the next packet). 25s is the
    # WireGuard norm. Set on every peer so we don't need the box's pubkey here.
    for p in $(wg show wg0 peers 2>/dev/null); do
      wg set wg0 peer "$p" persistent-keepalive 25 2>/dev/null || true
    done
  else
    # Never block the gateway on the tunnel: Fly pods must keep working even if
    # the box link is down. Incus-routed calls will fail until it recovers.
    echo "[wg-up] WARNING: wg0 failed to come up — continuing without it" >&2
  fi
fi

exec node packages/gateway/dist/main.js
