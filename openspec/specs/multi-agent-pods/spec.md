# multi-agent-pods Specification

## Purpose
Defines how a pod runs more than one coding agent: adding a second, different-type agent to an already-running pod without recreating it (so the working agent keeps its session), giving each agent its own window so platform operations target the right one, and how the cockpit presents one-or-two agents connection state. The shared workspace makes switching-first the intended model, stated rather than assumed.
## Requirements
### Requirement: A secondary agent is configured as fully as a primary one

Per-agent setup — runtime binaries, skills, and the agent's own instructions file — SHALL be applied
for EVERY agent a pod declares, not only the first one.

"The pod's agent" is not a single value on a multi-agent pod, and keying setup on the primary agent
silently produces a half-configured secondary: it launches and answers, so nothing looks broken, while
running without the environment's skills and without the platform's runtime rules — including the rule
requiring confirmation before anything leaves the pod. Every two-agent environment the platform ships
declares its second agent this way.

Setup for an agent a pod does NOT declare SHALL still be skipped, so a single-agent pod does not
receive another agent's configuration.

#### Scenario: Codex declared as the second agent

- **WHEN** a pod declares `[claude-code, codex]`
- **THEN** codex SHALL receive its runtime, the environment's skills, and its instructions file with the
  platform's runtime rules

#### Scenario: A single-agent pod

- **WHEN** a pod declares only one agent
- **THEN** no other agent's configuration SHALL be written

#### Scenario: An agent added at RUNTIME becomes as literate as a declared one

- **GIVEN** a pod that gains a second agent after first boot (the runtime add path), so the
  first-boot seed has already run and will not run again
- **WHEN** the pod next boots
- **THEN** that agent SHALL have the environment's skills and its instructions file, exactly as a
  declared agent does — per-agent setup that only ever runs in the first-boot seed leaves a
  runtime-added agent permanently half-configured, which a restart does NOT heal

### Requirement: A pod may gain a second agent of a different type

An owner SHALL be able to add an agent to an existing pod without relaunching it. The added agent
MUST be a different type from those already present (at most one `claude-code` and one `codex` per
pod) and MUST be within the set the pod's environment declares. Adding SHALL NOT interrupt a running
agent's session.

#### Scenario: Adding Codex to a Claude pod

- **WHEN** the owner adds `codex` to a pod already running `claude-code`, and the env declares both
- **THEN** the pod SHALL run both, the existing Claude session SHALL survive uninterrupted, and the
  pod record SHALL list both agents

#### Scenario: Duplicate type refused

- **WHEN** the owner attempts to add an agent type the pod already runs
- **THEN** the request SHALL be refused — two agents of one type share that CLI's config and the
  workspace, and would race

#### Scenario: Agent not allowed by the environment

- **WHEN** the requested agent is not in the environment's declared agents
- **THEN** the request SHALL be refused

### Requirement: Each agent occupies its own window and is targeted individually

An added agent SHALL run in its own terminal window, and platform operations that drive an agent
(remote-control enablement, kickoff/resume prompts, handoff requests) SHALL target that agent's own
window — never whichever window happens to be focused.

#### Scenario: Operations reach the right agent

- **WHEN** the platform drives one agent while the user is viewing the other's window
- **THEN** the operation SHALL be delivered to the intended agent's window

### Requirement: An added agent survives restarts and image updates

Adding an agent SHALL be persisted in the POD's own spec (`spec.agents`), not only the control
plane's record, and boot SHALL respawn a window for every agent the spec lists beyond the primary
(idempotent by window name). The DB and the pod must never disagree about who runs on it — an image
update recreates the instance from the preserved spec, and before this requirement the recreate
silently dropped every added agent (found live 2026-07-29, pod "ttt").

Re-adding an agent the record already lists SHALL remain a DB no-op but SHALL still reach the
provider: pod-side the spawn is idempotent by window name, so the repeated call is a no-op on a
healthy pod and a REPAIR when the window was lost. The dashboard SHALL surface a lost window as an
explicit "not running" state with a start/repair action, never an indefinite "starting" spinner.

#### Scenario: Image update keeps the added agent

- **WHEN** a pod running a primary and an added agent is updated to a new image
- **THEN** after the recreate both agents' windows exist and the added agent took the resume path

#### Scenario: A lost window is repairable from the dashboard

- **WHEN** the pod's live report lacks an agent the record lists (beyond a short spawn grace)
- **THEN** the agent's card SHALL show "not running" with a Start action, and that action SHALL
  respawn the window via the same add path

### Requirement: An added agent resumes rather than re-onboards

An agent added to a pod that is already in use SHALL NOT run the environment's first-run onboarding,
which assumes an empty workspace and would re-greet and re-ask what the user is building. It SHALL
instead orient from existing durable context — the workspace, the plan of record, and any handoff
notes left by the other agent.

#### Scenario: Second agent starts in a worked-in pod

- **WHEN** an agent is added to a pod whose workspace already holds work in progress
- **THEN** its first turn SHALL orient from the existing context rather than starting the
  environment's onboarding from the beginning

### Requirement: The shared workspace is stated, not silently assumed

Both agents share one workspace and one preview port. When a second agent is added, the interface
SHALL state that they share the workspace and that switching between them is the intended model, so
concurrent editing is a choice the user makes knowingly rather than a surprise.

#### Scenario: Adding the second agent

- **WHEN** the second agent is added
- **THEN** the interface SHALL state the shared-workspace model at that moment

### Requirement: Connect guidance matches the agent, and covers reaching the session — not just pairing

The cockpit's first-run guidance SHALL be specific to the agent a pod actually runs, and SHALL
carry the user all the way to a working session rather than stopping at the platform's own
hand-off step.

Claude hands off with a single link, so one button completes it. Codex has no such link: the
user pairs an app with a code AND then adds the pod as a remote project inside their own app —
a separate navigation the platform cannot perform or shorten (the daemon takes no project
argument). Guidance that stops at "paired" therefore strands the user at the point where they
believe setup succeeded and nothing has opened, which reads as a broken pod.

#### Scenario: A Codex pod's first-run step is about Codex

- **WHEN** the first-run walkthrough runs on a pod whose agent is Codex
- **THEN** its connect step SHALL describe pairing the Codex app and point at that panel — and
  SHALL NOT reference, wait on, or silently skip a Claude-only hand-off control

#### Scenario: Post-pairing guidance follows the app, which differs by platform

- **WHEN** the user has entered a pairing code
- **THEN** the guidance SHALL reflect what THAT app actually does next: the phone app adds the
  pod itself, so it SHALL be told there is nothing more to do, while the desktop app SHALL be
  given explicit ordered steps to add the pod as a remote project — including that the source
  folder defaults to the HOME folder and must be pointed at the workspace
- **AND** neither platform SHALL be shown the other's steps: instructing a phone user through a
  navigation their app already performed is as misleading as omitting it on desktop

#### Scenario: The tour can always be left

- **WHEN** the first-run walkthrough is showing, at any step, on ANY pod including the user's first
- **THEN** a visible control SHALL end it — the keyboard already dismisses it, so withholding the
  affordance hides an existing exit from exactly the users least likely to guess it
- **AND** that control SHALL be separated from the step-advancing controls, so a mis-click while
  moving through the tour cannot end it

#### Scenario: What can be pre-empted, is

- **WHEN** a Codex pod is provisioned
- **THEN** the workspace SHALL already be a trusted project on the pod, so the user is not asked
  to approve trust on top of the navigation they must already perform
