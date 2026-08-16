## Context

`sandbox-provider` provisions pods and stubs the base image entrypoint at `podbay-init`.
`pod-agent` replaces that stub with a real terminal server and the sidecar signals the control
plane needs. The smoke test is the reference for what works (persistent tmux, auto-handoff
onboarding) and what doesn't (ttyd's auth/link/clipboard limits — all frontend-side, addressed
by our own protocol + later frontend). This change owns the *server* side; the browser client is
a later `apps/web` change.

## Goals / Non-Goals

**Goals:**
- A robust PTY↔WebSocket bridge over a persistent tmux session, with resize and reconnect.
- Onboarding/regular flow productized from the smoke test `session` script.
- Sidecar signals: link extraction (`capture-pane -J`), idle reporting, health.
- One typed wire protocol in `@podbay/shared`.
- Real-PTY tests (no mocking the terminal).

**Non-Goals:**
- Browser/xterm.js client, OSC52 clipboard, mobile key bar → frontend change.
- Cookie/session auth → control-plane front door.
- Grouped-session multiplayer → later; v0 mirrors one session to N clients.
- Per-env image building.

## Decisions

- **`node-pty` for the PTY.** The de-facto Node PTY; correct resize/echo semantics. _Alternative:_
  shelling `script`/`unbuffer` — fragile. node-pty is a native module; the base image and CI
  approve its build script.
- **`ws` for the WebSocket server.** Minimal, battle-tested. The agent is a plain Node HTTP+WS
  server on the pod-internal interface.
- **Persistent session via tmux** (`tmux new -A -s main`), reusing the smoke-test model. The PTY
  the agent spawns is a `tmux attach` client, so disconnect never kills the session.
- **Protocol: JSON control frames + text/binary data frames.** `{type:"input"|"resize"|...}` for
  control; terminal bytes as WS binary. Types live in `@podbay/shared/protocol`. _Alternative:_
  a fully binary framed protocol — premature; JSON control is debuggable and cheap.
- **Sidecar in-process, not a separate daemon.** Link extraction, idle tracking, and health are
  timers/handlers in the same Node process; simpler lifecycle, and it already sees all I/O for
  activity tracking. Link extraction shells `tmux capture-pane -pJ` on demand/interval.
- **Onboarding handoff logic** ported from smoke `session`: watch for the credentials file; run
  `claude /login` outside tmux for a clickable link; once creds exist, transition into the tmux
  session. In the product the link is delivered as a protocol `links` message, so the browser
  can render a chip — no reliance on in-terminal clickability.
- **No auth in the agent.** It binds to the Fly 6PN private address; only the control plane
  reaches it. This matches the topology decision and keeps the agent simple. The front door owns
  auth.
- **Idle signal is pull + push.** The agent tracks `lastActivity`; it exposes current idle in
  `status` messages and a health endpoint, and emits a `status` update when it crosses the idle
  threshold, so the control plane can sleep the pod promptly.

## Risks / Trade-offs

- **node-pty native build** (platform/CI friction) → approve the build script explicitly in the
  base image and the workspace; pin a known-good version.
- **tmux control-mode vs plain attach** — plain attach mirrors and resizes to the smallest
  client (known tmux behavior). v0 accepts mirror semantics; grouped sessions + per-client sizing
  are the later multiplayer change. Documented, matches architecture-topology.md.
- **capture-pane cost** if polled too often → extract on an interval and on known link-producing
  events (login), not per keystroke.
- **Idle accuracy** — output-only activity (a long build) must count as activity, not just input;
  track both streams.
- **Reconnect races** — a new client attaching while another is live must not duplicate the
  session; always `tmux new -A` (attach-or-create) against a fixed session name.

## Migration Plan

New capability; the only touch to existing code is the base image CMD (`podbay-init` →
`pod-agent`) and bundling the built agent into `podbay-pod-base`. The smoke-test app is untouched
and remains the manual reference until this ships. Rollback = revert; provider still provisions
pods (they just lack the terminal server).

## Open Questions

- Deliver the built agent into the image via `npm i -g @podbay/pod-agent` (needs publishing) vs
  copying `dist` in the Docker build. v0 leans on copying `dist` from the workspace during image
  build to avoid a publish step.
- Whether the health/readiness and idle signals are a tiny HTTP endpoint alongside the WS, or
  only protocol messages. Leaning: a minimal HTTP `/healthz` + protocol `status` for richer data.
