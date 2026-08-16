## ADDED Requirements

### Requirement: The cockpit ready-state leads with remote-control status, not per-agent panels

Once a pod is ready, the cockpit SHALL answer "is remote control live?" first, with ONE status
block naming which agents are connected — regardless of whether the pod runs one agent or two. It
SHALL NOT render two competing per-agent panels side by side.

#### Scenario: One agent connected

- **WHEN** a pod runs a single agent whose remote control is active
- **THEN** the cockpit SHALL show one connected state naming that agent

#### Scenario: Both agents connected

- **WHEN** a pod runs both agents and remote control is active
- **THEN** the cockpit SHALL show ONE connected state naming both, not a panel per agent

### Requirement: The Codex connect/pair flow is progressive disclosure

Codex's multi-step flow (device-code login, pairing code, QR, confirmed devices) SHALL sit behind an
explicit affordance that expands it in place — "Connect Codex" when not yet connected, and "Pair
another device" once it is — rather than occupying the cockpit permanently. It is transactional:
needed intensely for a minute, then not again until a new device. An agent with a direct hand-off
(a session URL) SHALL keep its one-click action rather than being hidden behind a disclosure.

#### Scenario: Codex connected, no action needed

- **WHEN** Codex remote control is already active
- **THEN** the cockpit SHALL report it as connected and SHALL NOT display the pairing wizard;
  pairing an additional device SHALL be reachable behind one explicit control

#### Scenario: Owner pairs an additional device

- **WHEN** the owner activates the pair-another-device control
- **THEN** the pairing flow SHALL expand in place with a fresh pairing code

#### Scenario: Claude's hand-off stays direct

- **WHEN** a Claude session URL is available
- **THEN** the cockpit SHALL offer it as a direct one-click action
