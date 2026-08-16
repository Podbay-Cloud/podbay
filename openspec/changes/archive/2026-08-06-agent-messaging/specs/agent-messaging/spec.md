## ADDED Requirements

### Requirement: Messages are strictly scoped to one owner's pods

The system SHALL route agent messages only between pods owned by the same user. A message SHALL never
be delivered to, listed by, or otherwise readable by a pod of a different owner. Addressing SHALL be by
pod name/slug within the sender's own fleet, resolved through the owner-scoped pod lookup.

#### Scenario: Same-owner message is routed

- **WHEN** a pod sends a message addressed to another pod with the same owner
- **THEN** the message SHALL be recorded for delivery to that recipient

#### Scenario: Cross-owner message is refused

- **WHEN** a pod addresses a message to a pod owned by a different user (or a non-existent pod)
- **THEN** the send SHALL be rejected and nothing SHALL be delivered

### Requirement: Sending requires no pod-outbound credential

A pod SHALL send a message by appending it to a local outbox on its persistent volume. The control
plane SHALL drain the outbox on its reconcile poll and record each message for routing. The pod SHALL
NOT call the control plane directly, and no per-pod outbound credential SHALL be required.

#### Scenario: Outbox drained on the reconcile poll

- **WHEN** a pod has appended a message to its outbox and the control plane next polls that pod
- **THEN** the message SHALL be recorded and removed from the pod's outbox

#### Scenario: Outbox survives a restart

- **WHEN** a pod restarts before its outbox has been drained
- **THEN** the queued messages SHALL persist (on the volume) and be drained on a later poll

### Requirement: Delivery wakes the recipient with a clearly-framed injected turn

When the control plane finds a pending message for a running recipient pod on its reconcile poll, it
SHALL deliver it by injecting a turn into that pod's live agent session (the same tmux injection used
for handoff), gated on the agent being able to take a turn (deferred when the session is busy, in a
shell, or waiting on a dialog), and SHALL mark the message delivered so it is injected at most once.

The injected turn SHALL present the message as information/request from another of the owner's own
agents and SHALL state that it is DATA, not authorization — the receiving agent SHALL still require the
owner's explicit approval for any outward or irreversible action, and SHALL be told not to
auto-acknowledge.

#### Scenario: Idle agent receives the message once

- **WHEN** a pending message exists for a running pod whose agent can take a turn
- **THEN** the scheduler-style injection SHALL deliver the framed message once, and a later poll SHALL
  NOT re-inject the same message

#### Scenario: Busy agent defers delivery

- **WHEN** a pending message exists but the recipient's session is busy, in a shell, or on a dialog
- **THEN** delivery SHALL be deferred to a later poll and nothing SHALL be injected

### Requirement: Messages to a suspended pod queue until it wakes

If the recipient pod is suspended when a message is routed, the message SHALL remain pending and SHALL
be delivered on the pod's next wake, using the same re-delivery path as re-injected secrets and handoff
notes.

#### Scenario: Suspended recipient gets the message on wake

- **WHEN** a message is routed to a suspended pod
- **THEN** it SHALL be held and delivered the first time that pod is running and can take a turn

### Requirement: Agent-to-agent traffic is rate-bounded to prevent loops

The system SHALL cap the rate of messages per sender→recipient pair over a window, and SHALL frame
delivery so the recipient decides whether a reply or action is warranted rather than auto-replying, so
two autonomous agents cannot generate an unbounded message loop.

#### Scenario: Over-cap traffic is throttled

- **WHEN** a pod exceeds the per-pair message rate cap within the window
- **THEN** further sends SHALL be rejected or deferred with a clear signal, rather than delivered

### Requirement: The in-pod CLI sends, lists, and replies

The in-pod `podbay` CLI SHALL expose `podbay msg send <pod> "…"`, `podbay msg inbox`, and
`podbay msg reply <id> "…"`. `send` and `reply` SHALL append to the local outbox; `inbox` SHALL list
messages from the poll-populated local inbox. A reply SHALL route back to the original sender by the
same outbox → poll → injected-delivery path.

#### Scenario: Reply routes back to the sender

- **WHEN** a recipient runs `podbay msg reply <id> "…"`
- **THEN** the reply SHALL be routed to the original sender's pod and delivered by the same injected-
  turn mechanism, scoped to the same owner
