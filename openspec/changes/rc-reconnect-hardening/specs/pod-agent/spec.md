## ADDED Requirements

### Requirement: Claude Remote Control lifecycle state is current and classified

The pod-agent SHALL classify each Claude interactive session's Remote Control lifecycle as `active`,
`recovering`, `down`, `login-required`, or `unknown` from current evidence produced by the pinned
official CLI. A previously captured session URL SHALL NOT by itself prove that RC is live.

The health payload SHALL expose the classification additively as `rcState`. For compatibility,
`rcActive` SHALL be true only for `active`; `recovering` and `unknown` SHALL NOT be promoted to active.
Health reporting, automatic recovery, and doctor SHALL consume the same classifier. Current blocking
login/OAuth UI SHALL outrank a still-present credential file: a recognized login failure or retry
dialog is `login-required`, not a valid login with RC `down`.

#### Scenario: A stale URL is not reported as active

- **GIVEN** a Claude session URL was captured earlier but the current TUI reports that RC is down
- **WHEN** the pod-agent emits health
- **THEN** it SHALL report `rcState: "down"` and SHALL NOT report `rcActive: true`

#### Scenario: Missing liveness evidence remains unknown

- **GIVEN** the current pinned CLI exposes neither a live nor failed RC signal
- **WHEN** the pod-agent emits health
- **THEN** it SHALL report `rcState: "unknown"` rather than guessing from a process, URL, or prior
  successful connection

#### Scenario: Login failure is distinct from bridge failure

- **GIVEN** the agent login is expired or the Claude TUI is in its login flow
- **WHEN** the pod-agent classifies RC
- **THEN** it SHALL report `rcState: "login-required"`, not `down`, and SHALL NOT start RC recovery

#### Scenario: A stale credential does not hide a blocking OAuth error

- **GIVEN** the Claude credential file still appears valid but the live pane shows a recognized OAuth
  failure dialog such as invalid-code plus “Press Enter to retry”
- **WHEN** the pod-agent emits health
- **THEN** it SHALL report `login-required`, surface owner action, and SHALL NOT report the agent as
  merely signed-in with RC down

### Requirement: RC recovery is bounded and preserves the local conversation

After a cold Claude launch, the pod-agent SHALL allow the native `--continue` RC reconnect outcome to
settle before driving a recovery command. If RC is `down` while the login is valid and control was not
deliberately yielded, it SHALL run only the documented interactive recovery sequence verified for the
pinned CLI version. Recovery SHALL be capped and backed off, SHALL reclassify the observed state after
each attempt, and SHALL never start a fresh local conversation merely to repair RC.

The recovery implementation SHALL use the official CLI's documented interactive interfaces and
surfaced session URL. It SHALL NOT depend on server-mode bridge pointers, private HTTP endpoints, or
debug-log wording. Every attempt SHALL reclassify current pane state before typing and SHALL refuse to
submit an RC command into a recognized blocking login dialog or menu.

#### Scenario: Native reattach needs no Podbay recovery

- **GIVEN** Claude resumes the prior local conversation and natively reattaches its RC session
- **WHEN** the pod-agent observes `active`
- **THEN** it SHALL skip the recovery sequence and preserve the conversation and session title

#### Scenario: A valid login with RC down is repaired within a cap

- **GIVEN** the local conversation resumed, the login is valid, RC is `down`, and RC was not yielded
- **WHEN** automatic recovery or `podbay doctor --fix` runs
- **THEN** the pod-agent SHALL execute the matrix-verified interactive recovery within the attempt cap
  and SHALL report success only after the classifier observes `active`

#### Scenario: Recovery failure is surfaced

- **GIVEN** bounded recovery exhausts its attempts without observing active RC
- **WHEN** health and doctor report the result
- **THEN** they SHALL expose `down` or `unknown` with a diagnostic outcome and SHALL NOT loop, clear
  credentials, or claim success from submitting a command

#### Scenario: Recovery never types through blocked authentication UI

- **GIVEN** RC recovery is pending but the current pane is a recognized login menu, OAuth error, or
  retry dialog
- **WHEN** automatic recovery, the restore endpoint, or doctor fix runs
- **THEN** no `/remote-control` input SHALL be sent, the state SHALL become `login-required`, and the
  owner SHALL be directed to Reconnect

#### Scenario: Local history survives a replacement RC session

- **GIVEN** Claude cannot reattach the prior RC registration but can create a replacement
- **WHEN** recovery completes
- **THEN** the resumed local conversation SHALL remain intact, the replacement SHALL be identified as
  such, and Podbay SHALL NOT claim that earlier remote history moved to the replacement

### Requirement: Doctor diagnoses RC state without competing logic

`podbay doctor` SHALL report `down`, `login-required`, and `unknown` distinctly using the pod-agent's
shared RC classifier. `doctor --fix` SHALL invoke the shared bounded recovery primitive only for a
valid login whose RC is not deliberately yielded, and SHALL never modify agent credentials.

#### Scenario: Doctor fixes a confirmed bridge failure

- **GIVEN** Claude is signed in, RC is `down`, and T3 has not taken control
- **WHEN** `podbay doctor --fix` runs
- **THEN** doctor SHALL invoke bounded RC recovery, re-read the classifier, and report the observed
  final state

#### Scenario: Doctor cannot fix an expired login

- **GIVEN** RC is `login-required`
- **WHEN** `podbay doctor --fix` runs
- **THEN** doctor SHALL direct the owner to Reconnect and SHALL NOT clear, replace, or attempt to renew
  the credential

#### Scenario: Doctor is honest when state is unknown

- **GIVEN** the pinned CLI does not expose enough current evidence to classify RC
- **WHEN** doctor runs
- **THEN** it SHALL report that RC could not be verified and SHALL NOT translate a historical session
  URL into a healthy result
