## ADDED Requirements

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
