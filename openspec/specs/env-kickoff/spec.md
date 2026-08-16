# env-kickoff Specification

## Purpose
Lets an environment declare an optional kickoff prompt that is delivered into the pod so an authenticated pod can boot straight into agent-led work. It keeps first-boot login separate from the kickoff session and carries the kickoff text as a file so login and prompt never mix.
## Requirements
### Requirement: Environments can declare a kickoff prompt

The environment spec SHALL accept an optional `kickoff` string that resolves into the pod
spec; environments without it SHALL behave exactly as before.

#### Scenario: Kickoff resolves into the pod

- **WHEN** an environment declares `kickoff`
- **THEN** the resolved pod carries it and the pod receives it at first boot

#### Scenario: No kickoff, no change

- **WHEN** an environment declares no `kickoff`
- **THEN** the boot behavior is byte-identical to today (login flow, then plain agent)

### Requirement: Authenticated pods boot agent-led

A pod with agent credentials present SHALL start the agent CLI with the kickoff prompt, so the
agent speaks first without any user input.

#### Scenario: Pre-authenticated boot

- **WHEN** a pod boots with credentials on the volume and a kickoff configured
- **THEN** the tmux session starts `claude "<kickoff>"` and the agent initiates the conversation

### Requirement: Login is separated from the kickoff session

On first boot without credentials, the pod SHALL run the login flow; once the pod-agent
observes the authenticated transition it SHALL restart the tmux window into the kickoff
session — the login process is killed, not typed into.

#### Scenario: First-boot handoff

- **WHEN** the user completes the CLI login in a kickoff-configured pod
- **THEN** within one status tick the window respawns into the agent-led kickoff session

#### Scenario: Kickoff text travels as a file

- **WHEN** the kickoff is delivered to the pod
- **THEN** it is written to a file and passed to the CLI via command substitution — never
  interpolated into shell source (no escaping/injection hazards)

