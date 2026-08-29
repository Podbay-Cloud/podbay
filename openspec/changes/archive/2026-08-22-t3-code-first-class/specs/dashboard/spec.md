## MODIFIED Requirements

### Requirement: Connect a pod to the T3 Code app

The pod cockpit SHALL offer a T3 Code control action that turns the pod into a backend for the T3 Code
app (iOS/Android/desktop), as a **confirmed, reversible, first-class control mode** — not a silent
one-shot. Enabling SHALL first present a confirm dialog (the shared cockpit `AlertDialog` pattern)
that states what T3 takes over, that currently-running Claude/Codex sessions will end and restart
under T3, that files and sign-ins are preserved (nothing is logged out), and that it can be turned off
at any time. On confirm, enabling SHALL: run `t3 serve` on the pod's forwarded port (:3000) DURABLY
(via `podbay startup`, surviving restarts), set the preview to delegated-auth (`previewAppAuth`) so
the app reaches the pod without a podbay cookie, and mint a T3 pairing token scoped to the pod's
edition-correct public backend URL. Because provisioning downloads T3 and can take a minute or two,
enabling SHALL run as an **asynchronous, refresh-safe full-page setup flow** that replaces the cockpit
(the same pattern as an image update), showing progress through its stages, rather than a blocking
action. When ready the cockpit SHALL display a pairing QR and link (openable in a browser or scannable
from the app's Add-Environment flow) plus the backend URL, and offer a "regenerate code" action that
mints a fresh token without re-provisioning. The pairing token is the gate (delegated auth); podbay
issues it only to the authenticated owner in the dashboard.

While T3 Code is in control, the cockpit SHALL show a persistent "T3 Code is in control" indication
and SHALL hide the Open-in-Claude and Codex-pairing controls (which are inert while T3 owns the
agents). The enable and turn-off triggers SHALL follow the cockpit's button conventions — tinted
outline actions, not the blue/primary style reserved for opening an external window. The cockpit SHALL
offer a "Turn off T3 control" action (its own confirm dialog) that fully reverses the mode: stops
`t3 serve`, removes the durable startup entry, returns the preview to owner-auth, restores the Podbay
dev server on :3000, and restores Podbay's own agent controls — leaving the agents signed in.

#### Scenario: Enabling T3 Code control returns a pairing QR

- **WHEN** the owner enables T3 Code control on a running pod
- **THEN** `t3 serve` SHALL be provisioned durably, the preview SHALL become delegated-auth, and the
  cockpit SHALL show a pairing QR + link the T3 app can use to connect

#### Scenario: Enabling is confirmed before anything changes

- **WHEN** the owner clicks the T3 Code enable action
- **THEN** a confirm dialog explains the hand-off (T3 takes control, running sessions restart,
  files/sign-ins preserved, reversible) and nothing is provisioned until the owner confirms

#### Scenario: Enabling runs as an async, refresh-safe setup flow

- **WHEN** the owner confirms enabling T3 Code control on a running pod
- **THEN** the cockpit shows a full-page setup flow with progress stages while `t3 serve` is
  provisioned durably and the preview becomes delegated-auth, the flow survives a page refresh, and it
  resolves to a pairing QR + link the T3 app can use to connect

#### Scenario: The cockpit shows who is in control

- **WHEN** T3 Code is in control of a pod
- **THEN** the cockpit shows a persistent "T3 Code is in control" indication and hides the
  Open-in-Claude and Codex-pairing controls

#### Scenario: Turning off T3 control restores Podbay control

- **WHEN** the owner turns off T3 control and confirms
- **THEN** `t3 serve` is stopped and its startup entry removed, the preview returns to owner-auth, the
  Podbay dev server and Podbay's own agent controls are restored, and the agents remain signed in
