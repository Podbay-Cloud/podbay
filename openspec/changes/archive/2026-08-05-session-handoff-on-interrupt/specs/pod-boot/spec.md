## ADDED Requirements

### Requirement: A resumed agent orients from the handoff note before its transcript

When a pod restarts and an agent resumes an existing session, the agent SHALL read any handoff note
left for its window before starting new work. The instruction SHALL live in the deploy-shipped
universal configuration layer rather than in a value compiled into the pod-agent bundle, so it
reaches existing pods on their next seed without requiring a new pod-base image.

#### Scenario: Resume trigger fires with a note present

- **GIVEN** a pod that was updated or suspended while an agent was working, leaving a note
- **WHEN** the greeter sends the resume trigger and the agent takes its turn
- **THEN** the agent SHALL read the note for its window and orient from it before acting

#### Scenario: Universal layer carries the instruction

- **WHEN** the universal `.claude` layer is seeded onto a pod
- **THEN** it SHALL include the read-on-resume instruction, so no change to the compiled resume
  trigger text is required for the behavior to apply
