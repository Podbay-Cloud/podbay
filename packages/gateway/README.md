# @podbay/gateway

The authenticated terminal front door. A Node HTTP+WebSocket service that sits between the
browser and a pod's `pod-agent` (which is unauthenticated by design, on the private network).

## Per connection

1. **Authenticate** — resolve the Podbay session to a user id (`@podbay/auth`); reject if absent.
2. **Authorize** — `control-plane.getPod(userId, podId)`; cross-owner is refused as not-found.
3. **Wake** — if the pod is asleep, `control-plane.wake` and wait for running (bounded).
4. **Proxy** — frame-transparent bidirectional pipe browser ↔ `pod-agent`.
5. **Activity** — throttled `markActive` bumps `lastActiveAt`.

It also runs `control-plane.sleepIdlePods` on a timer, closing the loop `pod-agent`'s idle
signal opens.

Connect URL: `wss://<gateway>/pods/<podId>`.

## Design

- **Separate service**, not a Next custom server — Next's WS-upgrade story is awkward; a plain
  http+ws service (the smoke-proxy shape) is simpler and testable.
- **Dependency-injected**: `authenticate`, `control` (PodService), and `resolveAgentUrl` are
  config, so tests drive the real proxy against a local `pod-agent` with a stub authenticator and
  an in-memory control plane. Production wiring is in `main.ts` (better-auth sessions, Fly
  provider, Neon store).
- **Security boundary**: the gateway is the only authenticated entry; `pod-agent` stays private.
  Neither reads model credentials.

## Tests

`pnpm -F @podbay/gateway test` drives a **real pod-agent** (node-pty + tmux, forks pool):
unauth refused, cross-owner refused, owner terminal round-trip, wake-on-connect, idle sweep.

## Deploy (later, with the live pod path)

Runs as its own service (e.g. a `podbay-gateway` Fly app) reachable from the browser, with 6PN
egress to pods. Not deployed until real pods exist.
