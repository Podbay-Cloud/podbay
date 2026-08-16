## ADDED Requirements

### Requirement: A handoff is requested before an owner-initiated interrupt

The system SHALL request a handoff note from each live agent window after the owner confirms an
interrupting lifecycle action (update, suspend) and before the provider recreates or stops the
instance. The request SHALL be best-effort and bounded by a timeout: on timeout, error, an
unresponsive agent, or a dead pane, the system SHALL proceed with the lifecycle action unchanged.
A failed or missing handoff SHALL NEVER block, delay beyond the timeout, or fail the action.

#### Scenario: Agent responds in time

- **GIVEN** a pod with a live, responsive agent
- **WHEN** the owner confirms Update or Suspend
- **THEN** the system SHALL request a handoff, wait for it to complete within the timeout, and only
  then start the recreate or stop

#### Scenario: Agent is busy or unresponsive

- **GIVEN** an agent that does not complete the handoff within the timeout
- **WHEN** the timeout expires
- **THEN** the system SHALL abandon the request and continue the lifecycle action, leaving any
  previous note in place

#### Scenario: No agent is running

- **GIVEN** a pod whose agent pane is dead, at a blocking gate, or was never started
- **WHEN** an interrupting action is confirmed
- **THEN** the system SHALL NOT type into that pane and SHALL continue the lifecycle action

#### Scenario: Interrupt the platform did not initiate

- **GIVEN** the pod stops through a crash, host reboot, or any path with no pre-flight moment
- **WHEN** the pod restarts
- **THEN** no new note is expected, and the most recent existing note SHALL remain readable

### Requirement: The handoff note is durable, human-readable, and per agent window

The note SHALL be written to the pod's persistent home volume so it survives the recreate, as one
file per agent window, in a documented location. It SHALL be plain readable prose the owner can open
directly — not a transcript, log, or serialized session. Writing a note for one window SHALL NOT
overwrite another window's note.

#### Scenario: Note survives the interrupt

- **WHEN** a note is written and the pod is then updated or suspended and resumed
- **THEN** the note SHALL still be present and readable after the pod comes back

#### Scenario: Multiple agents in one pod

- **GIVEN** a pod running more than one agent window
- **WHEN** a handoff is requested
- **THEN** each window SHALL write its own note and SHALL NOT clobber another window's note

#### Scenario: Owner reads the note

- **WHEN** the owner opens the note
- **THEN** it SHALL state what the agent was doing, why, what was in flight, and what the next
  session should do first — without requiring any tooling to interpret

### Requirement: A handoff note records verifiable state and its own uncertainty

The note SHALL prefer verifiable facts (branch, commit, whether changes are committed or pushed,
test or build status) over recollection, and SHALL state explicitly when the agent is unsure whether
an in-flight step succeeded. It SHALL NOT assert that work completed when the agent cannot confirm
it.

#### Scenario: In-flight step of unknown outcome

- **GIVEN** the agent was interrupted during an operation whose result it never observed
- **WHEN** it writes the note
- **THEN** it SHALL record the step as unconfirmed and say how the next session can check, rather
  than reporting it as done or as failed

#### Scenario: Uncommitted work exists

- **GIVEN** the working tree has uncommitted or unpushed changes at interrupt time
- **THEN** the note SHALL say so explicitly, since that is the work the interrupt actually puts at
  risk

### Requirement: The resumed session reads the handoff before acting

A resumed agent SHALL read any handoff note left for its window before it starts new work, and SHALL
prefer the note over its own recollection where the two disagree. This instruction SHALL be
delivered through the deploy-shipped configuration layer, so it applies to every agent without
depending on a value compiled into the pod image.

#### Scenario: A note exists on resume

- **GIVEN** a note exists for the resumed window
- **WHEN** the agent takes its first turn after the restart
- **THEN** it SHALL read the note first and orient from it

#### Scenario: No note exists

- **GIVEN** no note exists (first boot, or a handoff that never completed)
- **WHEN** the agent resumes
- **THEN** it SHALL fall back to existing behavior with no error surfaced to the owner

#### Scenario: The note contradicts the transcript

- **GIVEN** a resumed agent whose transcript disagrees with the note
- **THEN** the note SHALL be treated as authoritative about what was in flight at interrupt time

### Requirement: Handoff is agent-agnostic

The capability SHALL work for every supported agent CLI without agent-specific control-plane code,
reusing the existing per-agent configuration translation. Adding a supported agent SHALL NOT require
changes to the interrupt path.

#### Scenario: Non-Claude agent

- **GIVEN** a pod running Codex rather than Claude
- **WHEN** an interrupting action is confirmed
- **THEN** the handoff SHALL be requested and consumed through the same path, with no
  Claude-specific branch in the lifecycle code
