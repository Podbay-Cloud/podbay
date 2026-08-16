#!/bin/sh
# Web entrypoint: bring up WireGuard to the Incus box (if configured), then exec
# the Next standalone server. infra-strategy.md M1 — the web app runs the durable
# provisioner + reconcile, so it (like the gateway) needs to reach the box's
# Incus API + pod IPs over wg0. Fly-only deployments (no PODBAY_WG_CONF) skip it.
#
# PODBAY_WG_CONF: full wg-quick config as a Fly secret. Never blocks the server:
# if the tunnel fails, web keeps serving (Fly pods keep working); Incus-routed
# provisioning/reconcile fails until it recovers.
set -e

if [ -n "${PODBAY_WG_CONF:-}" ]; then
  echo "[wg-up] configuring wg0"
  umask 077
  mkdir -p /etc/wireguard
  printf '%s\n' "$PODBAY_WG_CONF" > /etc/wireguard/wg0.conf
  # No keepalive in the peer config → our Fly-side NAT mapping expires when idle
  # and the box can't push data back (terminal/preview I/O stalls). [Peer] is last,
  # so appending lands under it; wg-quick applies it natively at bring-up.
  grep -qi '^PersistentKeepalive' /etc/wireguard/wg0.conf \
    || printf 'PersistentKeepalive = 25\n' >> /etc/wireguard/wg0.conf
  if wg-quick up wg0; then
    echo "[wg-up] wg0 up"
    # Behind Fly NAT: without a keepalive our NAT mapping + handshake expire when
    # idle and the box can't push data back (stalls terminal/preview I/O over the
    # tunnel). 25s keepalive on every peer keeps it warm.
    for p in $(wg show wg0 peers 2>/dev/null); do
      wg set wg0 peer "$p" persistent-keepalive 25 2>/dev/null || true
    done
  else
    echo "[wg-up] WARNING: wg0 failed to come up — continuing without it" >&2
  fi
fi

exec node apps/web/server.js
