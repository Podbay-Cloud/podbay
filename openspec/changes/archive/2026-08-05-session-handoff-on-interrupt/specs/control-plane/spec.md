## ADDED Requirements

### Requirement: Interrupting lifecycle actions request a handoff first

Update and suspend SHALL, after the owner confirms and before the provider recreates or stops the
instance, make a best-effort request for a handoff note from each live agent window. The request
SHALL be bounded by a timeout and SHALL be isolated from the lifecycle action: any failure, timeout,
or absence of a running agent SHALL be logged and ignored, and the action SHALL proceed exactly as
it does without this feature.

#### Scenario: Handoff request fails

- **GIVEN** the handoff request throws, times out, or finds no live agent
- **WHEN** the update or suspend continues
- **THEN** it SHALL complete with the same outcome and durable progress reporting as before, and the
  failure SHALL NOT surface to the owner as an error

#### Scenario: Bounded added latency

- **WHEN** a handoff is requested as part of an interrupting action
- **THEN** the added delay SHALL be bounded by the configured timeout and SHALL NOT extend
  indefinitely on an unresponsive agent
