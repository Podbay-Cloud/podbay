## ADDED Requirements

### Requirement: A mid-session auth or remote-control failure is a surfaced incident

A pod whose agent has lost its login or remote-control mid-session SHALL surface that as a health
issue the owner can see in the cockpit and doctor — it SHALL NOT report "everything fine" while the
agent is signed out or its remote session is dead. The issue SHALL be distinct from the credential
file's hard-expiry signal, so a live failure (a refresh that failed while the stored expiry is still
in the future) is caught.

#### Scenario: The cockpit and doctor reflect a live logout

- **WHEN** the agent is signed out mid-session (detected from live signals) even though the credential
  file's hard-expiry has not passed
- **THEN** the cockpit shows the agent as needing re-authentication and doctor reports the issue —
  instead of showing the pod healthy

#### Scenario: A stale "remote control active" is not shown

- **WHEN** remote control has died mid-session
- **THEN** neither the cockpit nor doctor reports remote control as active, so the owner is not misled
  into thinking the remote session works
