## Context

The gateway serves an authenticated terminal WebSocket; nothing renders it. This change is the
browser client. It's the payoff of the smoke test's hard-won lessons (documented in
docs/terminal-frontend-plan.md): stock ttyd broke on wrapped links, had no clipboard, and was
unusable on mobile — all frontend problems this change fixes by owning the client.

## Goals / Non-Goals

**Goals:**
- A testable `TerminalClient` (WebSocket + `@podbay/shared` protocol) and an xterm.js
  `<PodTerminal>` React component.
- The four validated differentiators: link chips, clipboard (OSC 52), mobile key bar, correct
  viewport/font.
- Auth-gated `/pods/[id]` page. Reconnect on drop.

**Non-Goals:**
- Dashboard (list/launch pods) — next change.
- Live gateway/Fly deploy — needs real pods.
- Multiplayer/grouped sessions; preview-URL embedding.

## Decisions

- **Split `TerminalClient` (pure) from `<PodTerminal>` (React/xterm).** The client manages the
  socket, framing, events, and reconnect with an **injectable WebSocket**, so vitest tests it with
  a mock — no browser. The component is thin glue to xterm.js. Same DI discipline as provider /
  gateway. _Alternative:_ logic inside the component — untestable without a DOM/browser.
- **`@xterm/xterm` + `@xterm/addon-fit`.** The maintained xterm packages; fit addon drives
  `resize`. Load the component dynamically (`ssr: false`) since xterm is browser-only.
- **Link chips via the `links` protocol message, not in-buffer detection.** The gateway/pod-agent
  already extract whole URLs (`capture-pane -J`); the client just renders chips. This is the fix
  for wrapped/unclickable links and works identically on mobile. OAuth URLs (match
  `claude.*/oauth`, `codex` login) get a promoted "Sign in" chip.
- **Clipboard via xterm OSC 52 handler.** Register `parser.registerOscHandler(52, …)` →
  base64-decode → `navigator.clipboard.writeText`. Paste → `navigator.clipboard.readText` →
  bracketed-paste input. Requires the tmux `set-clipboard on` + `allow-passthrough on` already set
  in pod-agent.
- **Mobile: key bar + visualViewport.** A sticky toolbar injects keystrokes; use the
  `visualViewport` API to keep the input above the keyboard and lock body scroll. Font size is a
  setting with a sane mobile default (the smoke test showed 18px readable).
- **Gateway URL via `NEXT_PUBLIC_GATEWAY_URL`.** Same-origin path or subdomain so the browser sends
  the session cookie; the gateway validates it. Connect to `<gateway>/pods/<id>`.
- **Reconnect with backoff.** On unexpected close, retry with capped backoff; the persistent tmux
  session on the pod means reconnect resumes seamlessly.

## Risks / Trade-offs

- **xterm.js is browser-only / hard to unit test** → put all logic in `TerminalClient` (mock-ws
  tested); the visual render is a documented manual check against a local gateway + pod-agent
  (both run on a dev machine).
- **Clipboard API needs a user gesture / HTTPS** → copy-on-select may be blocked; fall back to a
  Copy chip. Document the constraint.
- **Mobile keyboard/viewport is fiddly across iOS/Android** → rely on `visualViewport`, test on
  real devices; this is the riskiest UX and the reason the smoke test flagged it.
- **Gateway not deployed yet** → the page and client build and unit-test now; the end-to-end live
  experience awaits the gateway deploy. Same deferral pattern as the rest of the pod path.

## Migration Plan

Additive: new client, component, and page in `apps/web`. Nothing to migrate. Wired to a real
terminal once the gateway is deployed and `NEXT_PUBLIC_GATEWAY_URL` is set. Rollback = revert.

## Open Questions

- Copy-on-select vs explicit Copy chip as default (clipboard gesture rules). Leaning: OSC 52 for
  app-driven copies + a Copy chip for selections.
- Whether the terminal page also shows pod status/controls (sleep/keepAwake) now or with the
  dashboard. Leaning: minimal status now, controls with the dashboard.
