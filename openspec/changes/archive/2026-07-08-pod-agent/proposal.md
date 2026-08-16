## Why

A provisioned pod (from `sandbox-provider`) has a filesystem and the official CLIs installed,
but nothing yet lets a browser *drive a terminal* inside it. The smoke test used stock `ttyd`,
which the smoke test itself proved inadequate: HTTP Basic Auth breaks mobile WebSocket upgrades,
tmux-wrapped URLs are unclickable, there's no clipboard bridge, and no idle signal for the
control plane's sleep decisions. This change replaces `ttyd`'s server side with a purpose-built
**in-pod agent**: a PTY↔WebSocket bridge over a persistent tmux session, plus a sidecar that
extracts links (`tmux capture-pane -J`), reports activity/idle, and exposes health. It defines
the wire protocol shared with the (later) custom web frontend. All of this renders the
unmodified official CLI's bytes — no model-auth wrapping (ToS-clean).

## What Changes

- New package `packages/pod-agent`: a Node service that runs inside the pod, spawns a real PTY
  attached to a **persistent tmux session**, and streams stdin/stdout/resize over a WebSocket to
  the control plane.
- **Onboarding vs regular flow** (productized from the smoke test): first run drives
  `claude /login` for a clickable link and auto-hands-off to the persistent session once
  credentials exist; later connections boot straight into the agent.
- **Sidecar signals**: latest-URL extraction via `tmux capture-pane -J` (feeds the frontend's
  link chips), an **activity/idle report** (so the control plane can call `provider.sleep`),
  and a health/readiness endpoint.
- **Wire protocol** in `@podbay/shared`: typed client↔agent messages (input, resize, output,
  links, status, exit) shared by the agent and the future web frontend.
- **Base-image integration**: `podbay-pod-base` runs `pod-agent` as its entrypoint; the agent
  invokes the existing `podbay-init` (first-boot seeding) before supervising the session.
- Tests: drive a real PTY end-to-end (spawn → input → echoed output → resize → reconnect →
  link extraction from a tmux buffer), no network mocking.

Security note: `pod-agent` binds to the pod's internal interface only and trusts the connection
from the control plane over Fly's private network; **it carries no auth of its own** — the
authenticated front door (cookie/session, from a later change) is the boundary. It never sees
or handles model credentials.

## Capabilities

### New Capabilities
- `pod-agent`: the in-pod PTY/WebSocket terminal bridge, persistent-session management,
  onboarding/regular flow, and sidecar signals (links, idle, health), plus the shared wire
  protocol.

### Modified Capabilities
- `sandbox-provider`: the base image's entrypoint changes from the bare `podbay-init` stub to
  `pod-agent` (which calls `podbay-init` then supervises). The provider interface is unchanged;
  only the base-image CMD and its documentation change.

## Impact

- New package `packages/pod-agent` (`@podbay/pod-agent`), depending on `@podbay/shared`; adds a
  PTY dependency (`node-pty`) and a WebSocket dependency (`ws`).
- New protocol module in `@podbay/shared` consumed by the agent and the later web frontend.
- Updates `packages/provider/pod-base` (Dockerfile CMD → pod-agent; bundles the built agent).
- Consumed next by the web terminal frontend (`apps/web`) and `pod-lifecycle` (idle→sleep).
- Non-goals (explicit): the browser/xterm.js client, OSC52 clipboard, and mobile key bar (all
  frontend); cookie/session auth (front door); grouped-session multiplayer (later — v0 supports
  multiple concurrent clients as a mirror of one session); building per-env images.
