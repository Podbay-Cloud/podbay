## 1. Shared protocol

- [x] 1.1 Add `@podbay/shared/protocol`: typed client↔agent messages (`input`, `resize`, `output`,
  `links`, `status`, `exit`) + type guards; export from the package
- [x] 1.2 Unit-test the protocol type guards (valid/invalid frames)

## 2. Package scaffold

- [x] 2.1 Create `packages/pod-agent` (`@podbay/pod-agent`, ESM, tsconfig, vitest); depend on
  `@podbay/shared`, `node-pty`, `ws`
- [x] 2.2 Approve the `node-pty` build script in the workspace; pin a known-good version

## 3. PTY + session core

- [x] 3.1 Spawn a PTY attached to a persistent tmux session (`tmux new -A -s main`); expose
  read/write/resize/kill
- [x] 3.2 Track activity on BOTH input and output; maintain `lastActivity` and an idle threshold

## 4. WebSocket bridge

- [x] 4.1 HTTP+WS server bound to the pod-internal interface (no end-user auth); accept a client,
  attach it to the PTY
- [x] 4.2 Map protocol frames ↔ PTY: `input`→write, `resize`→resize, PTY output→`output`; handle
  multiple concurrent clients (mirror)
- [x] 4.3 Clean client teardown without killing the tmux session (reconnect resumes)

## 5. Onboarding flow

- [x] 5.1 Port smoke-test handoff: if no credentials, run `claude /login` for a clickable link and
  auto-transition into the persistent session once credentials appear
- [x] 5.2 Emit login/auth URLs as `links` messages (not reliant on in-terminal clickability)

## 6. Sidecar signals

- [x] 6.1 Link extraction via `tmux capture-pane -pJ` (joined lines) on interval + on demand;
  publish latest URLs as `links`
- [x] 6.2 `status` messages with idle duration; emit on crossing the idle threshold
- [x] 6.3 Minimal HTTP `/healthz` readiness (PTY/session up) for the control plane + provider endpoint

## 7. Base-image integration

- [x] 7.1 Bundle built `pod-agent` into `podbay-pod-base`; change Dockerfile CMD from
  `podbay-init` to `pod-agent` (which runs `podbay-init` first, then supervises)
- [x] 7.2 Update `packages/provider` docs/spec note to reflect the new base-image entrypoint

## 8. Tests (real PTY, no terminal mocking)

- [x] 8.1 Round-trip: connect → `echo hi` → output contains `hi`
- [x] 8.2 Resize applies to the PTY (assert reported size)
- [x] 8.3 Reconnect: disconnect, reconnect → same session/scrollback
- [x] 8.4 Two concurrent clients receive the same output (mirror)
- [x] 8.5 Link extraction recovers a wrapped URL whole from a tmux buffer
- [x] 8.6 Idle: no activity past threshold → status idle; activity resets it

## 9. Docs

- [x] 9.1 `packages/pod-agent/README.md`: protocol, run model, security boundary, tmux/mirror note
- [x] 9.2 Note in docs/roadmap.md that Phase-1 `pod-agent` is implemented
