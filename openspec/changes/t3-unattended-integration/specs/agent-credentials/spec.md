# agent-credentials — delta

## ADDED Requirements

### Requirement: Setup-token (1-year) mode drives the agent on the token, not the subscription cred

When a pod's `agentAuth` is `setup-token`, Claude SHALL run on the 1-year `CLAUDE_CODE_OAUTH_TOKEN`
(inference-only), NOT on a subscription `.credentials.json`. Because `claude` prefers an existing
`.credentials.json` over the env token, switching a pod to setup-token SHALL relocate the subscription
credential (`mv .credentials.json .credentials.json.pre-setuptoken`) — backed up, never deleted — so the
token actually takes effect. Reverting to subscription SHALL restore the backup.

#### Scenario: Switch to setup-token relocates the cred

- **WHEN** the system mints a setup-token and sets `agentAuth=setup-token`
- **THEN** it SHALL back up + relocate `.credentials.json` to `.credentials.json.pre-setuptoken` before
  the agent restarts, so the restarted Claude authenticates with the 1-year token

#### Scenario: Revert to subscription restores the cred

- **WHEN** a setup-token pod reverts to subscription (e.g. T3 turned off)
- **THEN** the system SHALL restore `.credentials.json.pre-setuptoken` → `.credentials.json` and set
  `agentAuth=subscription`, so native subscription remote-control works again

### Requirement: An externally-spawned agent (T3) receives the setup-token via its launch env

An external harness that spawns its OWN `claude` (T3 Code) does not go through Podbay's agent invocation,
so the reserved-secret→`CLAUDE_CODE_OAUTH_TOKEN` mapping does not reach it. When such a harness is
launched for a setup-token pod, the system SHALL launch it with `CLAUDE_CODE_OAUTH_TOKEN` mapped into its
environment from the reserved secret, with the value expanded at run time so the token never appears in a
stored startup declaration or any file under `~/work`.

#### Scenario: t3 serve inherits the 1-year token

- **GIVEN** a setup-token pod enabling T3
- **WHEN** the system registers/launches `t3 serve`
- **THEN** its launch command SHALL carry `CLAUDE_CODE_OAUTH_TOKEN` from the reserved secret so T3's
  spawned Claude runs on the 1-year token, and the token value SHALL NOT be written into the startup
  declaration

### Requirement: Codex under T3 keeps its self-refreshing login

Codex has no 1-year-token equivalent. A pod under T3 SHALL keep Codex's existing ChatGPT device login
(`~/.codex/auth.json`, self-refreshing); if Codex is not signed in, sign-in SHALL be offered during setup.
The system SHALL NOT relocate or wipe the Codex credential when switching auth modes.

#### Scenario: Codex login untouched by the T3 switch

- **WHEN** a pod switches to or from T3-unattended mode
- **THEN** the system SHALL leave `~/.codex/auth.json` in place (never relocate or delete it), and Codex
  SHALL continue on its self-refreshing login
