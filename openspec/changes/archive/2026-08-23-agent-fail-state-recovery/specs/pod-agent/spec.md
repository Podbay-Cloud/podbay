## ADDED Requirements

### Requirement: Auth failure is detected from live signals, not only the credential file

The pod SHALL detect that an agent needs re-authentication from LIVE signals — the CLI's own
auth-failure output in the terminal ("login expired", "please run /login", "worker auth expired", the
remote-control "sign in again" message) — in addition to the credential file's hard-expiry field. A
mid-session refresh failure that leaves the credential file's expiry still in the future SHALL still
be reported as needing attention, so the pod never reports healthy while the owner is locked out. The
live signal SHALL be debounced (present across a short interval) so a transient, self-healing state is
not flagged, and SHALL clear as soon as the agent is authenticated again.

#### Scenario: A mid-session logout is detected despite a valid-looking credential file

- **WHEN** the agent's terminal shows an auth-failure message but the credential file's hard-expiry is
  still in the future
- **THEN** the pod reports that agent as needing re-authentication, and the cockpit/doctor reflect it
  — rather than reporting the pod healthy

#### Scenario: A transient auth blip is not flagged

- **WHEN** an auth-failure message appears for less than the debounce interval and then clears on its
  own
- **THEN** the pod does not raise a needs-reauth state for it

### Requirement: Remote-control liveness is reported from the current bridge, not a stale capture

The pod SHALL report remote-control as active only when the bridge is CURRENTLY live, derived from the
present bridge/session state — not from the mere fact that a session URL was captured at some earlier
point. A remote-control worker that has died mid-session SHALL read as inactive.

#### Scenario: A dead remote-control worker reads as inactive

- **WHEN** the remote-control bridge has died (e.g. its worker auth expired) after a session URL was
  once captured
- **THEN** the pod reports remote control as inactive, and the cockpit/doctor no longer show it active

### Requirement: The pod auto-restores remote control when it dies while the login is valid

When an agent is authenticated (its login is valid) but remote control is not live — including
immediately after the owner re-runs `/login` mid-session — the pod SHALL re-establish remote control
itself, without the owner having to run `/remote-control` manually. This SHALL be bounded (a capped
number of attempts with backoff) and SHALL NOT fire while the agent is logged out or sitting at a
login/menu prompt. If it cannot restore remote control within the cap, the pod SHALL surface that
rather than retry indefinitely.

#### Scenario: Remote control is restored after a mid-session re-login

- **WHEN** the owner runs `/login` to recover a mid-session logout and the agent becomes authenticated
  again while remote control is dead
- **THEN** the pod re-establishes remote control on its own and a fresh session becomes available,
  without the owner running `/remote-control`

#### Scenario: Auto-restore does not fire into a logged-out or mid-login agent

- **WHEN** the agent is not authenticated, or is sitting at a login/method menu
- **THEN** the pod does not attempt to re-establish remote control (the login/menu path is handled
  first), so it never drives remote control into a session that cannot accept it

#### Scenario: A bridge that will not come back is surfaced, not looped

- **WHEN** remote control cannot be re-established within the attempt cap
- **THEN** the pod surfaces that remote control could not be restored, rather than retrying forever or
  reporting it active
