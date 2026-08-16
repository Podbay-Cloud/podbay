## Why

The whole backend is built and tested — the gateway proxies an authenticated, ownership-checked
terminal to a pod's `pod-agent` — but there's no browser client to actually *use* it. This change
builds the **xterm.js terminal frontend**: the web UI that connects to the gateway, renders the
pod terminal, and delivers the fixes the smoke test proved are necessary (stock `ttyd` couldn't do
them): tappable **link chips** from the agent's output, a real **clipboard** bridge, and a usable
**mobile** experience (key bar, viewport, font). It's the piece that turns everything into
something a person can see and touch.

## What Changes

- New **`TerminalClient`** (framework-agnostic, testable): manages the WebSocket to the gateway,
  speaks the `@podbay/shared` wire protocol (input/resize/output/links/status/exit), and exposes
  events + reconnect. WebSocket is injectable so it runs under vitest with a mock.
- New **`<PodTerminal>`** React component in `apps/web`: mounts xterm.js (+ fit addon), wires it to
  `TerminalClient`, handles resize, and renders connection/idle status.
- **Link chips**: render the `links` messages as tappable **[Open] [Copy] [QR]** chips above the
  terminal, with the OAuth sign-in URL promoted to a prominent "Sign in with Claude" action — no
  reliance on in-buffer link clicking.
- **Clipboard**: an OSC 52 handler writes terminal "copy" to `navigator.clipboard`; paste sends
  bracketed input. (The smoke test proved HTTP Basic Auth + ttyd couldn't do clipboard at all.)
- **Mobile**: a sticky key bar (Esc, Tab, Ctrl, arrows, `/`, paste), correct viewport handling
  (input stays visible above the keyboard, the page itself doesn't scroll), and a readable font.
- **Auth-gated pod terminal page** at `/pods/[id]` (`requireUser`) that mounts `<PodTerminal>`.
- Tests: `TerminalClient` against a mock WebSocket (protocol framing, output/links/status handling,
  reconnect); the live browser experience is a documented manual check against a local gateway.

## Capabilities

### New Capabilities
- `terminal-frontend`: the browser terminal — gateway connection + protocol client, xterm.js
  rendering, link chips, clipboard, mobile key bar/viewport, and the pod terminal page.

### Modified Capabilities
<!-- None. Consumes the gateway and the @podbay/shared protocol as-is. -->

## Impact

- `apps/web`: adds `@xterm/xterm` + `@xterm/addon-fit`, `lib/terminal-client.ts`, a
  `<PodTerminal>` component, and the `/pods/[id]` page.
- Connects to the gateway via a configured WebSocket URL (`NEXT_PUBLIC_GATEWAY_URL`); the browser
  sends the Podbay session cookie, which the gateway validates.
- Consumed next by the **dashboard** (list/launch pods, open the terminal) and enabled fully by
  the **live gateway deploy**.
- Non-goals (explicit): the dashboard UI (launch/list — next change); the live gateway/Fly deploy
  (needs real pods); multiplayer/grouped sessions; pod preview-URL embedding.
