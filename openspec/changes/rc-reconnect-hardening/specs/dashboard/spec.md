## MODIFIED Requirements

### Requirement: A Codex pod's ready state offers a pairing wizard

Because Codex has no clickable session URL, a ready Codex row SHALL offer an explicit **Pair a
device** action (the Codex analog of Claude's hand-off link). It SHALL NOT open the wizard merely
because the row becomes ready or because Podbay remembers no confirmed device labels. When the owner
chooses the action, the full-page wizard SHALL explain the different in-app paths to the pair screen
for phone and desktop via a platform picker that shows one platform's steps at a time, show the device
name the pod registers under, and let the owner generate a short-lived pairing code on demand with a
live expiry countdown and a fresh-code action. It SHALL surface a readable, retryable error when a
code cannot be minted.

The UI SHALL NOT claim the pod is connected: pairing is recorded server-side by OpenAI and nothing on
the pod reveals it. The daemon's self-enrollment is not a device-pairing signal. The wizard SHALL say
where the code lands, while the card's pills SHALL remain explicitly owner-confirmed labels.

#### Scenario: Opening a ready Codex pod is stable

- **WHEN** the cockpit shows a ready Codex pod
- **THEN** the normal Control tab SHALL show a **Pair a device** action and SHALL NOT open the pairing
  wizard without owner input

#### Scenario: The owner explicitly starts pairing

- **WHEN** the owner chooses **Pair a device**
- **THEN** the full-page wizard SHALL present the selected platform's pair-screen guidance, the pod's
  device name, and a control to generate a pairing code

#### Scenario: The owner generates a code

- **WHEN** the owner generates a pairing code
- **THEN** the code SHALL appear as a one-click copy control with a countdown and a fresh-code action;
  a failure SHALL show a retryable error instead

#### Scenario: QR for the phone flow on a wide viewport

- **WHEN** a code is shown, Phone is selected, and the cockpit is on a desktop-sized viewport
- **THEN** a QR encoding `https://chatgpt.com/codex/pair?pairing_code=<code>` SHALL be shown; Desktop
  or a narrow viewport SHALL show only the code

### Requirement: The Codex card owns pairing and the remote-control switch

The Codex card's status line SHALL name the confirmed paired devices (self-reported at pair time —
pairing is recorded server-side by OpenAI and is not observable from the pod). Removing a device from
that list edits ONLY Podbay's record: the Codex CLI exposes `start`/`stop`/`pair` and no revoke, so the
pod CANNOT disconnect a paired device. The control SHALL therefore confirm first and state plainly
that the device stays connected and must be removed in the ChatGPT app — it SHALL NOT present as a
disconnect.

Pairing SHALL open only after an explicit owner action from the Codex row. Podbay SHALL NOT auto-open
pairing from an empty, loading, or unavailable remembered-device list, because that list records only
owner-supplied labels and cannot prove whether an OpenAI-side pairing exists. A reload, a delayed
Codex-live signal, or completion of another provider's onboarding SHALL NOT navigate the owner into
pairing.

A Codex card with at least one confirmed device SHALL show its device pills and one **Pair another
device** action. A card with no confirmed devices SHALL show **Pair a device**. There is deliberately
NO “turn remote control off” control — switching it off only breaks the owner's own devices, and
forgetting a device is the actual remedy. “Turn remote control on” exists solely as recovery from a
stopped/dead daemon. Claude's remote control has no external switch; its card SHALL expose the
state-specific recovery defined below instead of a fake toggle.

#### Scenario: Removing a device is honest about what it does

- **WHEN** the owner removes a device from the card's confirmed list
- **THEN** they SHALL be told, before it happens, that this only updates Podbay's record and that the
  device stays connected until they remove this pod in the ChatGPT app

#### Scenario: Devices appear in the status line

- **WHEN** Codex remote control is on and devices have been confirmed
- **THEN** the card's status line SHALL list them by name, each with an inline forget control, and
  SHALL offer one **Pair another device** action

#### Scenario: An empty remembered-device list never takes over the cockpit

- **GIVEN** Codex remote control is on and the loaded remembered-device list is empty
- **WHEN** the cockpit loads, reloads, or receives a delayed live-agent update
- **THEN** the Control tab SHALL remain visible and pairing SHALL open only if the owner chooses
  **Pair a device**

#### Scenario: Recovering a stopped daemon

- **WHEN** the daemon is down while Codex is signed in
- **THEN** the card SHALL show the off state with its consequence and one **Turn on** recovery action

#### Scenario: Pairing an additional device

- **WHEN** the owner chooses **Pair another device** from the card
- **THEN** the cockpit SHALL open the full-page pairing wizard with a fresh code and an explicit Back
  control

### Requirement: Codex pairing runs as a full-page wizard

Connecting the ChatGPT app to a pod's Codex agent SHALL be presented as a full-page takeover wizard
(like update/T3-enable), not an inline card block. It SHALL keep the existing Phone/Desktop step-1
pairing instructions (how to reach the pair screen and enter the code, with a QR for the Phone flow on
a wide viewport), a step 2 **Open your session** that renders the shared continue-session guidance, and SHALL
refer to the **ChatGPT app**. It SHALL NOT show a “Remote control needs the pod awake…” footer line.

The wizard SHALL await and inspect the owner-confirmation action. On success it SHALL invalidate or
refetch the shared confirmed-device query and return to the cockpit, where the new device pill is
visible. On failure it SHALL stay open, retain the entered device label, and show the action error.
Back SHALL return to the cockpit without recording a device, and a later refresh SHALL respect that
choice because pairing has no ambient auto-open trigger.

#### Scenario: Pairing takes over the cockpit and keeps the pairing steps

- **WHEN** the owner explicitly opens Codex pairing on a running pod
- **THEN** the cockpit SHALL show the full-page pairing wizard with the Phone/Desktop step-1 pairing
  instructions intact, step-2 shared continue-session guidance, and no pod-awake footer

#### Scenario: Successful confirmation completes the full-page transition

- **WHEN** the owner enters a device label and the “I've paired this” action succeeds
- **THEN** the wizard SHALL return to the cockpit and the refreshed Codex row SHALL show that label as
  a confirmed-device pill

#### Scenario: Confirmation failure does not mimic success

- **WHEN** the “I've paired this” action returns an error
- **THEN** the wizard SHALL remain open with the entered label intact, show the error, and SHALL NOT
  add or display a confirmed-device pill

#### Scenario: Back is durable through ordinary navigation

- **WHEN** the owner chooses Back without confirming a device and later reloads the cockpit
- **THEN** the normal cockpit SHALL remain visible until the owner explicitly opens pairing again

## ADDED Requirements

### Requirement: The Control tab exposes actionable Claude RC recovery

The Claude row SHALL render the shared `rcState` classification rather than deriving bridge health
from `authed` plus a historical session URL. `active` SHALL offer the live session; `recovering` SHALL
show bounded progress; `down` with a valid login SHALL offer **Restore remote control**;
`login-required` SHALL offer **Reconnect Claude**; and `unknown` SHALL say that RC could not be
verified and offer diagnosis rather than claiming success. The restore action SHALL call the same
bounded recovery primitive as doctor, prevent concurrent attempts, and render the observed state after
reclassification rather than assuming command submission succeeded.

#### Scenario: Valid login plus RC-down is actionable

- **GIVEN** Claude reports `rcState: "down"` with a valid login and control is not yielded to T3
- **WHEN** the Control tab renders
- **THEN** it SHALL show **Restore remote control**, and invoking it SHALL show bounded recovery
  progress followed by the reclassified result

#### Scenario: Blocked authentication offers Reconnect

- **GIVEN** current Claude state is `login-required`, including a recognized blocking OAuth retry
  dialog despite a still-present credential file
- **WHEN** the Control tab renders
- **THEN** it SHALL offer **Reconnect Claude**, SHALL NOT offer RC restore, and SHALL NOT remain on
  “Signed in — turning on remote control…”

#### Scenario: Unknown is not an endless transition

- **GIVEN** current CLI evidence cannot establish whether RC is live or down
- **WHEN** the Control tab renders
- **THEN** it SHALL report that RC could not be verified and offer diagnosis without claiming active,
  repeatedly restoring, or showing an unbounded turning-on state

### Requirement: Multi-agent readiness does not require device enrollment

Provider authentication and Codex app device enrollment SHALL remain distinct. Completing a new
Claude+Codex pod's authentication SHALL enter the normal ready cockpit. A secondary Codex agent later
reporting RC-on with no remembered device labels SHALL NOT reopen setup or replace the cockpit;
pairing remains available from the explicit Codex-row action.

#### Scenario: Claude plus Codex launch reaches a stable cockpit

- **GIVEN** a new pod was configured with Claude and Codex and required provider authentication has
  completed
- **WHEN** the pod becomes ready and later Codex health updates arrive
- **THEN** the cockpit SHALL remain stable and SHALL NOT enter Codex pairing without an explicit owner
  action
