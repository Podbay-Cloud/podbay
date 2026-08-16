## Why

Every backend foundation exists and is tested — environments resolve, pods provision, `pod-agent`
serves a terminal, `control-plane` persists pods for real users — but nothing connects a signed-in
browser to a pod's terminal. `pod-agent` deliberately has **no auth** and binds to the pod's
private network; something authenticated must sit in front of it. The smoke test proved the shape
(a Node cookie-auth proxy → ttyd), but that used a shared password and no ownership check. This
change builds the **terminal gateway**: an authenticated WebSocket proxy that verifies the Podbay
session, authorizes that the user **owns** the target pod, wakes it if asleep, streams the terminal
to/from `pod-agent`, and drives the idle→sleep policy. It's the piece that turns the tested
foundations into a usable, end-to-end product (and the security boundary the pod-agent audit
flagged as required before user traffic).

## What Changes

- New `packages/gateway` (`@podbay/gateway`): a Node HTTP+WebSocket service that, per connection:
  1. **Authenticates** the Podbay session (validates the better-auth session → user id).
  2. **Authorizes** ownership via `control-plane.getPod(userId, podId)` (not owned → refused).
  3. **Wakes** a sleeping pod (`control-plane.wake`) and resolves its `pod-agent` endpoint.
  4. **Proxies** the WebSocket bidirectionally between the browser and `pod-agent`.
  5. **Tracks activity** (updates `lastActiveAt`) and **runs the idle policy**
     (`control-plane.sleepIdlePods`) on a timer — consuming pod-agent's idle signal.
- **Shared session validation**: extract the better-auth config so both `apps/web` and the gateway
  validate sessions the same way (a small `@podbay/auth` seam, or a shared session helper).
- Tests: against a **real local `pod-agent`** + in-memory `control-plane` + a seeded session
  (pglite): unauth refused, cross-owner refused, owner connects and round-trips terminal I/O,
  wake-on-connect, idle policy sleeps an idle pod.

Security: the gateway is the authenticated front door; `pod-agent` stays unauthenticated on the
private network behind it. The gateway never handles model credentials — it only proxies the
official CLI's bytes.

## Capabilities

### New Capabilities
- `terminal-gateway`: the authenticated, ownership-checked WebSocket proxy from browser to
  `pod-agent`, with wake-on-connect, activity tracking, and idle-policy execution.

### Modified Capabilities
<!-- None to spec behavior. It consumes control-plane, pod-agent, provider, auth as-is. -->

## Impact

- New package `packages/gateway` (`@podbay/gateway`), depending on `@podbay/control-plane`,
  `@podbay/provider`, and the shared auth/session validation.
- A small refactor to share the better-auth config between `apps/web` and the gateway.
- Consumed next by the **xterm.js frontend** (the browser client that speaks the wire protocol to
  this gateway) and the **dashboard** (launch/list/open pods).
- Non-goals (explicit): the browser/xterm.js terminal UI and the dashboard (next changes); HTTP
  preview-URL proxying for pods (a later change); the live Fly deployment / 6PN wiring (needs real
  pods — tests target a local pod-agent); multiplayer/grouped sessions.
