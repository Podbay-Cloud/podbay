## ADDED Requirements

### Requirement: The greeter does not attempt remote-control against a logged-out agent

Enabling remote control types `/remote-control` into the agent and waits for a success signal. When
the agent's login is known-expired, that command is refused and can never succeed, so every
remote-control enable path SHALL consult the credential expiry signal (not merely the credential
file's presence) and short-circuit — logging the skip — rather than spending its retry budget on a
doomed attempt. This applies to the boot greeter, the resume re-enable, the added-agent greeter, and
the codex daemon start.

#### Scenario: Boot/resume RC enable skips a logged-out agent

- **WHEN** a remote-control enable path runs for an agent whose credential is known-expired
- **THEN** it does not type `/remote-control`, records that it skipped because the login is expired,
  and leaves the pod free to surface the "sign-in expired" state instead of appearing to retry

#### Scenario: A logged-out agent does not re-arm the RC attempt on every resume

- **WHEN** a pod whose agent login is expired is suspended and resumed repeatedly
- **THEN** the resume watcher does not re-run the full remote-control attempt each cycle for that
  agent, so it never loops typing a refused command

#### Scenario: A signed-in agent still enables remote control normally

- **WHEN** a remote-control enable path runs for an agent whose credential is present and not expired
- **THEN** it proceeds exactly as before, attempting `/remote-control` and confirming the session

### Requirement: An expired login does not stall an owner-initiated interrupt

A wedged remote-control attempt against a logged-out agent SHALL NOT delay a maintenance interrupt
(update/resize) — the platform proceeds to its bounded handoff and graceful-shutdown path regardless
of a stuck RC attempt.

#### Scenario: Update proceeds despite a logged-out agent

- **WHEN** an update is requested for a pod whose agent login is expired
- **THEN** the update's handoff and shutdown proceed within their bounded timeouts and are not held
  open by a remote-control attempt that cannot succeed
