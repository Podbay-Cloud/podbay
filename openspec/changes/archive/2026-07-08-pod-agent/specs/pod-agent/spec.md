## ADDED Requirements

### Requirement: PTY WebSocket bridge

The agent SHALL expose a WebSocket endpoint that attaches a client to a real pseudo-terminal in
the pod. It SHALL stream terminal output to the client, forward client input to the terminal,
and apply client-sent resize (cols/rows) to the PTY.

#### Scenario: Round-trip input and output

- **WHEN** a client connects and sends input `echo hi\n`
- **THEN** the agent SHALL forward it to the PTY and stream back output containing `hi`

#### Scenario: Resize is applied

- **WHEN** a client sends a resize message with cols/rows
- **THEN** the agent SHALL resize the PTY to those dimensions

### Requirement: Persistent session across reconnects

The terminal SHALL run inside a persistent tmux session so a client disconnect does not end the
work, and a later connection re-attaches to the same session with its scrollback intact.

#### Scenario: Reconnect resumes the session

- **WHEN** a client disconnects and a new client connects to the same pod
- **THEN** the new client SHALL attach to the existing session and see prior session state

#### Scenario: Multiple concurrent clients mirror one session

- **WHEN** two clients are connected to the same pod at once
- **THEN** both SHALL receive the same terminal output (mirror); grouped/independent views are a
  later capability

### Requirement: Onboarding and regular boot flows

On first connection with no stored credentials, the agent SHALL start the official CLI's login
so the client can complete authentication, and once credentials exist it SHALL hand off to the
persistent session. On subsequent connections it SHALL boot straight into the agent CLI.

#### Scenario: First run drives login then hands off

- **WHEN** a pod has no CLI credentials and a client connects
- **THEN** the agent SHALL start the CLI login flow, and once credentials are present SHALL
  transition the client into the persistent session without a manual step

#### Scenario: Authenticated run boots into the agent

- **WHEN** a pod already has CLI credentials and a client connects
- **THEN** the agent SHALL attach to the persistent session with the agent CLI running

### Requirement: Link extraction signal

The sidecar SHALL extract the most recent URL(s) from the terminal using joined-line capture
(so wrapped URLs are recovered whole) and make them available to the client, enabling link
chips without relying on in-buffer link detection.

#### Scenario: Wrapped URL is recovered whole

- **WHEN** the terminal buffer contains a long URL wrapped across multiple rows
- **THEN** the extracted link SHALL be the complete, unwrapped URL

### Requirement: Activity and idle reporting

The agent SHALL track terminal activity and expose an idle signal (time since last activity), so
the control plane can decide when to sleep the pod. A configurable idle threshold SHALL be
reported as an idle state.

#### Scenario: Idle after inactivity

- **WHEN** no terminal input or output occurs for longer than the idle threshold
- **THEN** the agent's status SHALL report the session as idle with the elapsed duration

#### Scenario: Activity resets idle

- **WHEN** terminal input or output occurs
- **THEN** the reported idle duration SHALL reset

### Requirement: Health and readiness

The agent SHALL expose a health/readiness signal indicating whether the PTY/session is up, for
the control plane and the provider's `endpoint` check.

#### Scenario: Ready when session is up

- **WHEN** the tmux session and PTY bridge are running
- **THEN** the health signal SHALL report ready

### Requirement: No self-auth; trusts the control-plane boundary

The agent SHALL bind to the pod's internal interface and SHALL NOT implement its own end-user
authentication; the authenticated control-plane front door is the security boundary. The agent
SHALL never read or transmit model credentials.

#### Scenario: Binds internally

- **WHEN** the agent starts
- **THEN** it SHALL listen on the pod-internal address (not a public ingress) and SHALL not
  require an end-user credential on the WebSocket itself

### Requirement: Shared wire protocol

The client↔agent messages SHALL be defined as typed messages in `@podbay/shared` (at least:
input, resize, output, links, status, exit) so the agent and the web frontend share one
contract.

#### Scenario: Protocol is the shared contract

- **WHEN** the web frontend and the agent are built
- **THEN** both SHALL import the same message types from `@podbay/shared`
