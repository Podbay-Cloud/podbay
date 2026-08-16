## Context

`pod-agent` is an unauthenticated PTY/WebSocket server bound to the pod's private network — by
design, per its spec and the security audit. The gateway is the authenticated front door that
audit named as required before user traffic. It ties together `auth` (who), `control-plane`
(ownership + lifecycle), and `pod-agent` (the terminal). The smoke test's `auth-proxy.js` is the
shape; this productizes it with real sessions and ownership.

## Goals / Non-Goals

**Goals:**
- Authenticated, ownership-checked WebSocket proxy browser → `pod-agent`.
- Wake-on-connect; activity tracking; run the idle policy.
- Testable against a real local `pod-agent` + in-memory control-plane + seeded session (pglite).

**Non-Goals:**
- The xterm.js browser client and the dashboard (next changes).
- HTTP preview-URL proxying (later).
- Live Fly deploy / 6PN wiring (needs real pods).
- Multiplayer/grouped sessions.

## Decisions

- **Separate service `packages/gateway`, not a Next custom server.** Next's App Router has an
  awkward WebSocket-upgrade story; a plain Node http+ws service (like the smoke proxy) is simpler,
  framework-independent, and cleanly testable. It can deploy as its own Fly app or alongside web.
  _Alternative:_ custom Next server — fights the standalone build; rejected.
- **Validate sessions via the shared better-auth instance.** Extract the auth config into a small
  shared seam (`@podbay/auth`, or move `apps/web/lib/auth-config` into a package) so the gateway
  calls the same `auth.api.getSession(headers)` as the app. Avoids re-implementing better-auth's
  cookie/token format. _Alternative:_ raw session-table lookup — brittle against better-auth's
  token hashing/signing; rejected.
- **Authorization through `control-plane.getPod(userId, podId)`.** Reuses the existing
  owner-scoped, not-found-on-miss semantics — no new authz surface.
- **Gateway owns the idle scheduler.** `control-plane.sleepIdlePods` is a pure method by design;
  the gateway is the host that runs it on a timer and updates `lastActiveAt` from proxied
  activity — closing the loop pod-agent's idle signal opened.
- **Endpoint via provider/control-plane.** The gateway resolves the pod's `pod-agent` address
  (`provider.endpoint`) after ensuring the pod is running; for tests it targets a local pod-agent
  URL injected via config.
- **Proxy is frame-transparent.** The gateway forwards WS frames unchanged (it does not parse the
  terminal protocol) except to observe liveness for activity — keeps it simple and protocol-version
  independent.

## Risks / Trade-offs

- **Session validation coupling** → the shared `@podbay/auth` seam is a small refactor; keep it
  minimal (config + `getSession` helper) so web and gateway stay in sync.
- **6PN reachability only exists with real pods** → tests target a local pod-agent; the
  private-network proxy path is verified at deploy. Documented, like prior live-path deferrals.
- **Wake latency** (a suspended pod takes time to resume) → the gateway waits for running/health
  before proxying, and surfaces a "starting" state; a hard timeout avoids hanging clients.
- **Activity vs idle race** (sleeping a pod a user just reconnected to) → check `keepAwake` and
  recent `lastActiveAt` atomically enough in the policy; the gateway sets activity before the
  policy tick sees it.
- **Deployment shape** (own Fly app vs alongside web) → decided at deploy; the package is
  deploy-agnostic.

## Migration Plan

New package; nothing to migrate. The shared-auth extraction updates `apps/web` imports only.
Live deploy (own Fly app + 6PN egress to pods) is deferred with the rest of the live pod path.
Rollback = revert; no user surface depends on it until the frontend/dashboard land.

## Open Questions

- Deploy target: a dedicated `podbay-gateway` Fly app (clean isolation, one more app) vs a second
  process in `podbay-web`. Leaning dedicated app for a clean WS surface.
- Whether the gateway also fronts pod **preview URLs** (HTTP) now or in a later change. Leaning
  later — keep this change terminal-only.
