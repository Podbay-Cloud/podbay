## ADDED Requirements

### Requirement: Connect and render a pod terminal

The frontend SHALL connect to the gateway over WebSocket for a given pod and render an interactive
terminal, sending keystrokes as protocol `input`, applying terminal output from `output` messages,
and sending `resize` on size changes.

#### Scenario: Input and output

- **WHEN** the user types in the terminal
- **THEN** the client SHALL send an `input` message, and incoming `output` messages SHALL be
  written to the terminal display

#### Scenario: Resize is sent

- **WHEN** the terminal viewport changes size
- **THEN** the client SHALL send a `resize` message with the new cols/rows

### Requirement: Protocol client is testable in isolation

The connection/protocol logic SHALL live in a framework-agnostic client with an injectable
WebSocket, so it is unit-tested without a browser.

#### Scenario: Handles protocol messages via a mock socket

- **WHEN** the client is driven with a mock WebSocket emitting `output`, `links`, and `status`
  frames
- **THEN** it SHALL surface each through its corresponding event without a real network

### Requirement: Link chips from agent output

The frontend SHALL present URLs delivered in `links` messages as tappable chips offering open,
copy, and QR actions, so links (including wrapped ones) never require in-buffer clicking. An OAuth
sign-in URL SHALL be surfaced as a prominent sign-in action.

#### Scenario: A link becomes a chip

- **WHEN** a `links` message arrives with a URL
- **THEN** a chip SHALL appear offering to open, copy, and show a QR of that URL

#### Scenario: OAuth link is promoted

- **WHEN** a `links` URL is a Claude/Codex OAuth sign-in URL
- **THEN** it SHALL be presented as a prominent sign-in action

### Requirement: Clipboard bridge

The frontend SHALL copy terminal selections/copies to the system clipboard via an OSC 52 handler,
and SHALL support pasting into the terminal.

#### Scenario: Copy reaches the clipboard

- **WHEN** the terminal emits an OSC 52 copy sequence
- **THEN** the frontend SHALL write that text to the browser clipboard

### Requirement: Mobile usability

On mobile the frontend SHALL provide a key bar for keys absent from touch keyboards (at least Esc,
Tab, Ctrl, arrows), keep the input line visible above the on-screen keyboard, and prevent the page
body from scrolling horizontally.

#### Scenario: Key bar sends control keys

- **WHEN** the user taps Esc / Tab / an arrow on the key bar
- **THEN** the corresponding sequence SHALL be sent to the terminal as input

#### Scenario: Page does not scroll horizontally

- **WHEN** the terminal is shown on a narrow viewport
- **THEN** the page body SHALL NOT scroll horizontally; the terminal manages its own overflow

### Requirement: Connection lifecycle and status

The frontend SHALL show connection status (connecting, connected, disconnected) and SHALL attempt
to reconnect on an unexpected drop, resuming the same pod session.

#### Scenario: Reconnect on drop

- **WHEN** the WebSocket drops unexpectedly
- **THEN** the client SHALL attempt to reconnect and, on success, resume streaming the session

### Requirement: Authenticated terminal page

The pod terminal page SHALL require an authenticated user; unauthenticated visitors SHALL be
redirected to sign-in.

#### Scenario: Unauthenticated visitor is redirected

- **WHEN** an unauthenticated user opens `/pods/[id]`
- **THEN** they SHALL be redirected to sign-in before any terminal connection is attempted
