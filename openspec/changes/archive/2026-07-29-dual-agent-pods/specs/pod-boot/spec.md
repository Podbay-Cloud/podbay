## ADDED Requirements

### Requirement: The Codex remote-control session is identified by the pod's chosen name

A pod's Codex remote-control session SHALL be identifiable in the user's Codex app by the pod's
user-chosen name rather than an opaque identifier, so a user with several pods can tell them apart.
Where the CLI offers no direct naming flag, the pod SHALL set whatever identity the CLI reports (its
hostname) to the sanitized pod name. If no supported mechanism makes the chosen name visible, the
limitation SHALL be documented rather than worked around.

#### Scenario: Named pod appears in the Codex app

- **WHEN** a pod with a user-chosen name registers a Codex remote-control session
- **THEN** the session SHALL be identifiable by that name in the app

#### Scenario: No supported naming mechanism

- **WHEN** no supported mechanism can set the displayed identity
- **THEN** the pod SHALL keep its default identity and the limitation SHALL be recorded, rather than
  applying an unsupported workaround
