## ADDED Requirements

### Requirement: RC lifecycle orchestration is covered without faking external proof

The e2e fake stack SHALL expose deterministic Claude RC outcomes for reattached, replacement, down,
login-required, and unknown states. Playwright SHALL verify Podbay's user-visible state, recovery
orchestration, and doctor integration for those outcomes. Test names and assertions SHALL identify
the outcomes as simulated and SHALL NOT claim that Anthropic's broker or Claude app actually
reattached.

#### Scenario: Simulated reattach preserves the existing title

- **GIVEN** the fake stack reports the same prior and current RC identity with an owner-set title
- **WHEN** a restart flow completes
- **THEN** e2e SHALL verify that Podbay reports active RC and does not issue or display a replacement
  rename

#### Scenario: Simulated replacement receives the pod title

- **GIVEN** the fake stack reports a different current RC identity after restart
- **WHEN** recovery completes
- **THEN** e2e SHALL verify that Podbay classifies a replacement and applies the pod title without
  claiming the prior app session reattached

#### Scenario: Simulated failure reaches doctor recovery

- **GIVEN** the fake stack reports valid login plus RC down
- **WHEN** doctor fix is invoked through the tested product path
- **THEN** e2e SHALL verify the bounded restore request and the resulting active or surfaced-failure
  state

#### Scenario: Login-required never triggers RC repair

- **GIVEN** the fake stack reports `login-required`
- **WHEN** the cockpit and doctor render the pod
- **THEN** e2e SHALL verify that Reconnect is surfaced and no automatic RC restore is requested

#### Scenario: Fake e2e does not stand in for real broker acceptance

- **GIVEN** all simulated RC e2e scenarios pass
- **WHEN** a Claude CLI pin is considered for promotion
- **THEN** the authenticated real-pod lifecycle matrix SHALL still be required

### Requirement: Cockpit RC recovery states are covered end to end

The e2e fake stack SHALL drive the Control tab through Claude `active`, `recovering`, `down`,
`login-required`, and `unknown` states. Playwright SHALL verify the action and copy for each state and
SHALL verify that only `down` can invoke bounded RC restore.

#### Scenario: A blocked OAuth dialog offers Reconnect, not RC restore

- **GIVEN** the fake pane reports the captured invalid-code retry dialog while a credential file still
  appears valid
- **WHEN** the owner opens the Control tab
- **THEN** e2e SHALL show Reconnect Claude, SHALL NOT show an endless “turning on remote control” state,
  and SHALL verify that no RC restore request is made

#### Scenario: Confirmed RC-down can be restored from the cockpit

- **GIVEN** the fake stack reports a valid Claude login with `rcState: "down"`
- **WHEN** the owner invokes Restore remote control
- **THEN** e2e SHALL verify one shared bounded restore request, progress while it runs, and the observed
  active or surfaced-failure result after reclassification

### Requirement: Codex pairing completion and dismissal are covered end to end

Playwright SHALL cover the full-page Codex pairing wizard as an explicit Control-tab action. The suite
SHALL verify success, action failure, Back, query refresh, and a page reload with no remembered
devices. An empty owner-confirmed device list SHALL NOT be used as an automatic navigation trigger.

#### Scenario: Confirmed device closes the wizard and appears on the card

- **GIVEN** the owner explicitly opens Codex pairing and generates a code
- **WHEN** they enter `Work Desktop` and choose “I've paired this” successfully
- **THEN** the wizard SHALL close, the cockpit SHALL remain visible, and the Codex row SHALL show a
  `Work Desktop` pill without requiring a manual exit or page refresh

#### Scenario: Pair confirmation failure stays recoverable

- **GIVEN** the device-confirmation action fails
- **WHEN** the owner chooses “I've paired this”
- **THEN** the wizard SHALL remain open, retain the entered device label, show the error, and SHALL NOT
  display a false paired-device pill

#### Scenario: Back remains respected after reload

- **GIVEN** Codex RC is on and Podbay remembers no confirmed device labels
- **WHEN** the owner leaves the explicitly opened pairing wizard and reloads the cockpit
- **THEN** the cockpit SHALL remain on the Control tab and SHALL NOT automatically reopen pairing

#### Scenario: A secondary Codex agent does not interrupt completed onboarding

- **GIVEN** a new pod selected both Claude and Codex and provider authentication has completed
- **WHEN** the cockpit becomes ready and Codex RC later reports on
- **THEN** the normal cockpit SHALL remain visible and pairing SHALL be available only from the Codex
  row's explicit action
