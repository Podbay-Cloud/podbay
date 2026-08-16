## 1. Shared auth seam

- [x] 1.1 Extract better-auth config into a shared package/module (`@podbay/auth` or move
  `apps/web/lib/auth-config`) exposing `createAuth(env)` + a `getSessionUser(headers)` helper
- [x] 1.2 Update `apps/web` to import from the shared seam (no behavior change; existing tests green)

## 2. Gateway package scaffold

- [x] 2.1 Create `packages/gateway` (`@podbay/gateway`, ESM, tsconfig, vitest); depend on
  `@podbay/control-plane`, `@podbay/provider`, the auth seam, `ws`
- [x] 2.2 Typed config (bind host/port, idle threshold + tick, endpoint resolution, pod-agent
  target override for tests)

## 3. Connection handling

- [x] 3.1 On WS upgrade: authenticate the session → user id; refuse if invalid (before upstream)
- [x] 3.2 Authorize via `control-plane.getPod(userId, podId)`; refuse cross-owner as not-found
- [x] 3.3 Wake the pod if sleeping; wait for running/health; hard timeout to avoid hangs
- [x] 3.4 Resolve the pod-agent endpoint and open the upstream WebSocket

## 4. Proxy & lifecycle

- [x] 4.1 Frame-transparent bidirectional pipe browser ↔ pod-agent; clean teardown on either close
- [x] 4.2 Update `lastActiveAt` on proxied activity
- [x] 4.3 Run `control-plane.sleepIdlePods(threshold)` on a timer; stop on shutdown (SIGTERM drain)

## 5. Tests (real local pod-agent + in-memory control-plane + pglite session)

- [x] 5.1 Unauthenticated connection refused; no upstream opened
- [x] 5.2 Cross-owner connection refused (not-found); owner permitted
- [x] 5.3 Authorized owner: terminal input → output round-trips through the gateway to a real pod-agent
- [x] 5.4 Wake-on-connect: a sleeping pod is woken before proxying
- [x] 5.5 Idle policy sleeps an idle pod; skips keepAwake; activity advances lastActiveAt

## 6. Docs

- [x] 6.1 `packages/gateway/README.md`: role, auth/authz flow, security boundary, deploy note
- [x] 6.2 Note in docs/roadmap.md that the terminal gateway is implemented (Phase 2 begins)
