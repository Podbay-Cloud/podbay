## ADDED Requirements

### Requirement: Owner-scoped add-agent action

The control plane SHALL expose an owner-scoped action to add an agent to an existing pod. It SHALL
validate that the agent is declared by the pod's environment and is not already present, persist it
to the pod's agent list, and cause it to start on the running pod without recreating the instance or
interrupting an existing agent. The action SHALL be idempotent: adding an agent the pod already runs
SHALL leave state unchanged rather than starting a duplicate.

#### Scenario: Add succeeds

- **WHEN** an owner adds a valid, not-yet-present agent to their running pod
- **THEN** the pod record SHALL list it, it SHALL start on the pod, and the existing agent's session
  SHALL be unaffected

#### Scenario: Not the owner

- **WHEN** a non-owner attempts to add an agent
- **THEN** the request SHALL be refused as not found, consistent with other pod actions

#### Scenario: Repeated request

- **WHEN** the same add request is made twice
- **THEN** the second SHALL be a no-op rather than spawning a second instance of that agent
