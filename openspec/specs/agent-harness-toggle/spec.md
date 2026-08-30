# agent-harness-toggle Specification

## Purpose
External agent harnesses (apps that take control of a pod's CLIs over their own relay — T3 Code today,
grok/opencode/cursor later) are each gated by a per-harness capability flag, so one can be turned off —
hidden from every enable surface — without deleting its code, and turned back on by flipping the flag.

## Requirements

### Requirement: An agent harness is offered only when its capability is enabled

An external agent harness (T3 Code, and later grok/opencode/cursor) SHALL be gated by a per-harness
capability flag, decided server-side and defaulting so that shipping the gate alone changes nothing
until an operator turns a harness off. When a harness is disabled, the product SHALL NOT offer any way
to ENABLE it — not in launch, not in the cockpit, not via a hand-constructed wizard URL, and not via a
directly-invoked server action. When a harness is enabled, its flows behave exactly as before.

Disabling a harness SHALL NOT delete its data or strand a pod already under its control: a pod
currently controlled by the harness SHALL keep working and SHALL retain a way to turn the harness OFF.
The pod-side recovery that reclaims a pod stranded by a prior enable SHALL remain active regardless of
the flag, so flipping a harness off never leaves a pod unrecoverable.

#### Scenario: A disabled harness is absent from every enable surface

- **WHEN** a harness is disabled and an owner views launch and the cockpit
- **THEN** no control to enable that harness SHALL be shown, and a hand-typed wizard URL for it SHALL
  NOT open its enable/connect flow

#### Scenario: The enable server actions refuse when the harness is disabled

- **WHEN** a harness is disabled and its enable/connect/pairing server actions are invoked directly
- **THEN** each SHALL refuse rather than starting the flow, so hiding the UI is not the only guard

#### Scenario: An already-controlled pod keeps working and can be turned off

- **WHEN** a harness is disabled while a pod is already under its control
- **THEN** that pod SHALL continue to function, its turn-off action SHALL remain available, and the
  pod-side orphan recovery SHALL stay active

#### Scenario: Enabling the harness restores its flows unchanged

- **WHEN** the harness is re-enabled
- **THEN** its launch option, cockpit panel, and wizards SHALL behave exactly as before the gate
