# agent-messaging Specification

## Purpose
Defines durable, owner-scoped message passing between a user's OWN pods: "ask the makore pod to
regenerate the sitemap and tell me the count," relayed by the agent the user is talking to. It reuses
podbay's existing rails rather than adding new ones — the reconcile poll drains a pod's local outbox
(no per-pod outbound credential, exactly like fetch-memory), and delivery wakes the recipient by
injecting a turn into its live agent session (the same tmux path as handoff). Messages never cross
owners, delivery is framed as DATA not authorization, addressing accepts loose human references
resolved against a pushed fleet roster, and per-pair rate caps stop two autonomous agents from looping.

## Requirements

### Requirement: Messages are strictly scoped to one owner's pods

The system SHALL route agent messages only between pods owned by the same user. A message SHALL never
be delivered to, listed by, or otherwise readable by a pod of a different owner. The sender SHALL be
attributed from the pod the outbox was drained from, not from any field in the outbox line, so a pod
cannot forge its identity. Addressing SHALL be resolved only within the sender's own fleet.

#### Scenario: Same-owner message is routed

- **WHEN** a pod sends a message addressed to another pod with the same owner
- **THEN** the message SHALL be recorded for delivery to that recipient, attributed to the sending pod

#### Scenario: Cross-owner message is refused

- **WHEN** a pod addresses a message to a pod owned by a different user (or a non-existent pod)
- **THEN** nothing SHALL be routed or delivered, and the other owner's pod's existence SHALL NOT leak

### Requirement: Sending requires no pod-outbound credential

A pod SHALL send a message by appending it to a local outbox on its persistent volume. The control
plane SHALL drain the outbox on its reconcile poll and record each message for routing. The pod SHALL
NOT call the control plane directly, and no per-pod outbound credential SHALL be required. Each message
SHALL carry a client-generated id used as the routing key, scoped to the OWNER: the dedupe key SHALL be
`(owner_id, id)`, so an at-least-once re-drain records a message once WITHOUT one owner's client nonce
suppressing a different owner's message that happens to reuse the same nonce.

Draining SHALL be at-least-once, not fire-and-forget: the drained batch SHALL be moved aside and read
but SHALL NOT be deleted from the pod until every message in it has been durably recorded. A drain
interrupted between reading and recording (a control-plane crash, a database error) SHALL therefore
leave the batch behind to be re-drained and re-recorded on a later poll — deduped by `(owner_id, id)` —
rather than lost. A message the sender's CLI reported "queued" SHALL NOT vanish because the recording
step failed after the read.

#### Scenario: Outbox drained on the reconcile poll

- **WHEN** a pod has appended a message to its outbox and the control plane next polls that pod
- **THEN** the message SHALL be recorded, and the batch removed from the pod ONLY after the record is durable

#### Scenario: A drain interrupted before recording is not lost

- **GIVEN** the control plane has read a drained batch off a pod but fails (crash or database error) before
  the messages are recorded
- **THEN** the batch SHALL remain on the pod and be re-drained on a later poll, and re-recording SHALL be a
  no-op for any message already stored (dedupe by `(owner_id, id)`) — no "queued" message is dropped

#### Scenario: The same client nonce from two owners stays two messages

- **WHEN** pods of two different owners each drain a message carrying the identical client-generated id
- **THEN** both messages SHALL be recorded (dedupe is per `(owner_id, id)`, not global id), while a
  re-drain of the SAME owner's message SHALL still record only once

#### Scenario: Outbox survives a restart

- **WHEN** a pod restarts before its outbox has been drained
- **THEN** the queued messages SHALL persist on the volume and be drained on a later poll

### Requirement: A loose human reference resolves to one pod, or is refused — never guessed

Addressing SHALL accept a human reference (exact slug, display name, an abbreviation, or a token) and
resolve it against the sender's fleet by a fixed ladder — exact, then normalized-exact, then prefix,
then substring — where the first tier with a match decides. A reference that matches two or more pods
SHALL be refused as ambiguous rather than resolved to either. A reference that matches nothing SHALL be
refused. The control plane SHALL push the owner's fleet roster to each pod so the in-pod CLI can resolve
and list without an outbound call, and the control plane SHALL re-resolve as the authority.

#### Scenario: An abbreviation resolves to the full pod

- **WHEN** a pod sends to "cheerful donkey" and the fleet contains exactly one pod `cheerful-donkey-6bc4`
- **THEN** the message SHALL be routed to that pod

#### Scenario: An ambiguous reference is refused with the candidates

- **WHEN** a reference matches more than one pod in the fleet
- **THEN** the send SHALL be refused and the candidate pods SHALL be reported to the sender

#### Scenario: An undeliverable reference bounces back to the sender

- **WHEN** the control plane cannot uniquely resolve a routed reference (ambiguous or unknown)
- **THEN** a system notice naming the problem SHALL be routed back to the sending pod's inbox

### Requirement: Delivery wakes the recipient with a clearly-framed injected turn

When the control plane finds a pending message for a running recipient pod on its reconcile poll, it
SHALL deliver it by injecting a turn into that pod's live agent session (the same tmux injection used
for handoff), gated on the agent being able to take a turn (deferred when the session is a shell or on a
blocking dialog), and SHALL mark the message delivered so it is injected at most once.

The injected turn SHALL present the message as information/request from another of the owner's own
agents and SHALL state that it is DATA, not authorization — the receiving agent SHALL still require the
owner's explicit approval for any outward or irreversible action, and SHALL be told not to
auto-acknowledge. The message body SHALL be delivered into the pod's inbox file, read on demand, and
SHALL NOT be interpolated into the injected turn or any shell-executed command.

#### Scenario: An unattended agent answers without a second authorization

- **GIVEN** a delivered message from another pod of the SAME owner, on a pod with nobody at the
  keyboard
- **WHEN** the agent decides to reply
- **THEN** it SHALL reply directly: addressing is owner-scoped by construction, so a reply reaches
  no third party and publishes nothing, and requiring a human "yes" would mean an unattended pod
  never answers — the feature failing closed for no safety gain
- **AND** the data-not-authorization rule SHALL still hold for what the message ASKS: a message
  requesting a push, a pull request, or a post to anywhere outside the owner's fleet is exactly as
  unauthorized as a file asking the same

#### Scenario: Idle agent receives the message once

- **WHEN** a pending message exists for a running pod whose agent can take a turn
- **THEN** the framed injection SHALL deliver it once, and a later poll SHALL NOT re-inject it

#### Scenario: Busy or shell pane defers delivery

- **WHEN** a pending message exists but the recipient's session is a shell or on a blocking dialog
- **THEN** delivery SHALL be deferred to a later poll and nothing SHALL be injected or written

### Requirement: Messages to a suspended pod queue until it wakes

If the recipient pod is suspended when a message is routed, the message SHALL remain pending and SHALL
be delivered on the pod's next wake, using the same re-delivery path as re-injected secrets and handoff
notes.

#### Scenario: Suspended recipient gets the message on wake

- **WHEN** a message is routed to a suspended pod
- **THEN** it SHALL be held and delivered the first time that pod is running and can take a turn

### Requirement: Agent-to-agent traffic is rate-bounded to prevent loops

The system SHALL cap the number of messages per sender→recipient pair over a window, and SHALL frame
delivery so the recipient decides whether a reply or action is warranted rather than auto-replying, so
two autonomous agents cannot generate an unbounded message loop. Traffic over the cap SHALL be refused
with a clear signal to the sender rather than delivered.

#### Scenario: Over-cap traffic is throttled

- **WHEN** a pod exceeds the per-pair message rate cap within the window
- **THEN** further messages on that pair SHALL be refused and the sender SHALL be told, not delivered

### Requirement: The in-pod CLI sends, lists, replies, and lists the fleet

The in-pod `podbay` CLI SHALL expose `podbay msg send <pod> "…"`, `podbay msg inbox`,
`podbay msg reply <id> "…"`, and `podbay msg pods`. `send` and `reply` SHALL append to the local outbox;
`inbox` SHALL list messages from the poll-populated local inbox; `pods` SHALL list the owner's fleet
from the pushed roster, marking the current pod. `send` SHALL resolve its reference locally for
immediate feedback and refuse an ambiguous or unknown reference. A reply SHALL route back to the
original sender by the same outbox → poll → injected-delivery path. Message bodies SHALL be encoded
(not hand-escaped) so quotes, newlines, and shell metacharacters are preserved and inert.

#### Scenario: Reply routes back to the sender

- **WHEN** a recipient runs `podbay msg reply <id> "…"`
- **THEN** the reply SHALL be routed to the original sender's pod and delivered by the same injected-
  turn mechanism, scoped to the same owner
