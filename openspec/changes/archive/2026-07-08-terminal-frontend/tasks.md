## 1. TerminalClient (testable core)

- [x] 1.1 `apps/web/lib/terminal-client.ts`: manage a WebSocket (injectable) to `<gateway>/pods/<id>`;
  encode `input`/`resize`/`ping`, decode `output`/`links`/`status`/`exit`/`pong` via `@podbay/shared`
- [x] 1.2 Event surface (onOutput/onLinks/onStatus/onOpen/onClose) + `sendInput`/`sendResize`
- [x] 1.3 Reconnect with capped backoff on unexpected close
- [x] 1.4 Tests against a mock WebSocket: framing, message dispatch, reconnect

## 2. Dependencies & component scaffold

- [x] 2.1 Add `@xterm/xterm` + `@xterm/addon-fit` to `apps/web`
- [x] 2.2 `<PodTerminal>` client component (dynamic import, `ssr:false`): mount xterm + fit,
  wire to `TerminalClient`, send resize on fit, write output, show status

## 3. Link chips

- [x] 3.1 Render `links` as chips with Open / Copy / QR actions above the terminal
- [x] 3.2 Promote OAuth sign-in URLs (claude/codex login) to a prominent "Sign in" chip
- [x] 3.3 QR render for a URL (small inline QR)

## 4. Clipboard

- [x] 4.1 Register an xterm OSC 52 handler → `navigator.clipboard.writeText`
- [x] 4.2 Paste: `navigator.clipboard.readText` → bracketed-paste input; Copy chip fallback

## 5. Mobile

- [x] 5.1 Sticky key bar (Esc, Tab, Ctrl, arrows, `/`, paste) injecting the right sequences
- [x] 5.2 `visualViewport` handling: keep input above keyboard; lock body from horizontal scroll
- [x] 5.3 Readable default font size (mobile) + per-user override

## 6. Page & lifecycle

- [x] 6.1 `/pods/[id]` page, `requireUser`-gated; mounts `<PodTerminal>` with the pod id
- [x] 6.2 Connection status UI (connecting/connected/disconnected) + reconnect indicator

## 7. Docs

- [x] 7.1 Note config `NEXT_PUBLIC_GATEWAY_URL`; document the manual end-to-end check vs a local gateway
- [x] 7.2 Update docs/roadmap.md that the terminal frontend is implemented
