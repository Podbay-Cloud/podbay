# session-handoff Specification

## Purpose
Defines how a pod captures a durable, agent-agnostic handoff note before an owner-initiated interrupt (update, resize, or suspend) restarts it and kills the running agent, and how the resumed session and the owner consume that note. Transcript resume (`--continue`) remains the primary continuity path for a single agent resuming itself; this capability covers what a transcript cannot carry — state across agents, across windows, and to the human — and is best-effort by construction so it can never delay or fail the lifecycle action it precedes.
## Requirements
### Requirement: A handoff is requested before an owner-initiated interrupt

The system SHALL request a handoff note from each live agent window after the owner confirms an
interrupting lifecycle action — **update, resize, or suspend** (each cold-restarts the pod and kills
the running agent) — and before the provider recreates, resizes, or stops the instance. The request
SHALL be best-effort and bounded by a timeout: on timeout, error, an unresponsive agent, or a dead
pane, the system SHALL proceed with the lifecycle action unchanged. A failed or missing handoff SHALL
NEVER block, delay beyond the timeout, or fail the action.

A resize of a SUSPENDED pod SHALL skip the handoff request — there is no live agent, and it already
handed off when it was suspended.

#### Scenario: Agent responds in time

- **GIVEN** a pod with a live, responsive agent
- **WHEN** the owner confirms Update, Resize, or Suspend
- **THEN** the system SHALL request a handoff, wait for it to complete within the timeout, and only
  then start the recreate, resize, or stop

#### Scenario: A resize tells the resumed agent its new resources

- **WHEN** a running pod is resized
- **THEN** the system SHALL leave a one-time note in the handoff directory stating the pod's new tier
  and resources — vCPU, RAM, and disk (the pod's actual disk, which is grow-only, so a resize-down
  keeps the larger disk) — so the resumed agent learns what changed rather than guessing; writing the
  note SHALL be best-effort and SHALL NEVER fail the resize

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

### Requirement: A handoff is exchanged when control passes to or from an external harness

Handing this pod's agents to an external harness (T3 Code) and reclaiming them are also continuity
boundaries, so the system SHALL exchange a handoff across both — with the honest, asymmetric guarantee
the two directions actually permit.

**Enabling (Podbay → T3):** before the system yields remote control, it SHALL request a handoff from
each live Podbay agent window (the same best-effort, timeout-bounded mechanism as an interrupt, phrased
for a control hand-off rather than a restart) AND leave a one-time pointer note in the handoff directory
telling the fresh session T3 starts to read those per-window notes and continue. A failed or missing
handoff SHALL NEVER block, delay beyond the timeout, or fail the enable.

**Disabling (T3 → Podbay):** the harness ran its OWN sessions, which are not in Podbay's tmux and cannot
be asked for a note, so the system SHALL NOT request a per-window handoff on this path (it would capture
Podbay's stale idle window, not T3's work). Instead, before it hands control back, the system SHALL leave
a one-time pointer note directing the resumed Podbay agent to the real evidence of T3's work — the edited
working tree (`git diff`) and T3's own session history — rather than promising a transcript it cannot move.
Writing the note SHALL be best-effort and SHALL NEVER fail the disable.

#### Scenario: Control is yielded to T3 Code

- **GIVEN** a running pod with live Podbay agents
- **WHEN** the owner enables T3 Code control
- **THEN** the system SHALL request a handoff from each live agent window and write a one-time
  `to-t3` pointer note, both before yielding remote control, and SHALL proceed with the enable
  regardless of whether either succeeds

#### Scenario: Control is reclaimed from T3 Code

- **GIVEN** a pod under T3 Code control
- **WHEN** the owner turns T3 Code control off
- **THEN** the system SHALL write a one-time `to-podbay` pointer note pointing the resumed agent at the
  working tree and T3's history — and SHALL NOT request a per-window handoff — before handing control back

#### Scenario: The hand-off copy does not overpromise continuity

- **WHEN** the cockpit confirms enabling or disabling T3 Code control
- **THEN** the copy SHALL state that T3 starts its own fresh sessions and that continuity is carried by a
  handoff note (not by moving a live session/transcript), and SHALL NOT claim an in-progress conversation
  transfers verbatim in either direction

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

### Requirement: A once-per-owner walkthrough explains how to connect

When a pod first reaches the ready state, the cockpit SHALL offer a short guided walkthrough of how to
connect to the pod's agent. It SHALL explain that the owner can open the session **in the browser or in
their Claude desktop app** to see the agent running on the pod, and — for advanced use — connect via the
**terminal in the Admin tab**. The walkthrough SHALL be presented as anchored coach-marks — a popover
pointing at the relevant control — advanced with Next/Back and dismissed with Done or Skip. It SHALL be
shown at most once **per owner** (not per pod), persisted on the user so that once the owner has finished
or skipped it on ANY pod it does not reappear on a newly created pod, on later visits, or on other
devices. The cockpit's Details tab SHALL offer a **Replay walkthrough** affordance to run it again on
demand.

#### Scenario: First arrival at ready

- **WHEN** the owner first views a ready pod and has never seen the walkthrough on any pod
- **THEN** the walkthrough SHALL run, each step pointing at the control it describes, and it SHALL name
  both the web and Claude-desktop-app ways to open the session

#### Scenario: Already seen — including on a new pod

- **WHEN** the owner has completed or skipped the walkthrough (on any pod) and then opens a pod whose
  walkthrough they have not individually seen — including a brand-new one
- **THEN** the walkthrough SHALL NOT reappear, unless the owner explicitly replays it from Details

### Requirement: Continue-in-Claude opens the web session reliably

The "Continue in Claude" action SHALL open the session's web URL (`https://claude.ai/code/session_…`)
in a new tab, and SHALL remain an ordinary link so keyboard, middle-click, and modified-click behave
normally. On platforms where the OS routes that URL to an installed Claude app (e.g. mobile universal
links), the app opens; the capability SHALL NOT attempt to force a desktop app via an undocumented URL
scheme, because a browser click cannot reliably reach the app and a wrong scheme degrades the
experience (e.g. a browser error dialog). The walkthrough tells the owner they may open the same
session in their desktop app.

#### Scenario: Clicking Continue in Claude

- **WHEN** the owner clicks Continue in Claude
- **THEN** the session's web URL SHALL open in a new tab (the reliable, cross-platform behavior)

### Requirement: A maintenance interrupt communicates its bounded wait as progress

An owner-initiated interrupt (update/resize) waits — by design, for data safety — on a bounded
handoff and a graceful guest shutdown before any force-stop. Those waits are legitimate and
time-boxed, but today render as a motionless "Stopping the pod", indistinguishable from a hang. The
platform SHALL communicate each bounded wait as determinate progress: name the handoff phase
distinctly, and show the graceful-shutdown wait against its known maximum so the owner sees the pod
is safely finishing, not stuck.

#### Scenario: The handoff phase is shown distinctly, not as "Stopping"

- **WHEN** an update is in its handoff phase
- **THEN** the progress UI shows a distinct "handing off" step (not the "Stopping the pod" step) and
  the progress indicator reflects that phase

#### Scenario: The graceful-shutdown wait shows elapsed against its maximum

- **WHEN** the pod is in the graceful-shutdown wait before any force-stop
- **THEN** the progress UI communicates that it is waiting for a clean shutdown and shows the elapsed
  time against the known bounded maximum, rather than a frozen spinner with a caption already exceeded

#### Scenario: A slow-but-bounded shutdown never reads as stuck

- **WHEN** a graceful shutdown legitimately takes close to its full bounded time (e.g. a wedged agent)
- **THEN** the owner sees continuous, honest progress toward the bound and the force-stop that follows,
  and is not led to believe the pod has hung

