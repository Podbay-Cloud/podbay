# dashboard — delta

## ADDED Requirements

### Requirement: One-tap T3 pairing via a deep link

The cockpit SHALL offer a one-tap "Open in T3" action that opens a T3 pairing deep link
(`https://app.t3.codes/pair?…`) built from the pod's backend URL and a freshly minted, short-lived pairing
token. The user's signed-in T3 app/web SHALL add the pod to the user's **T3 account** (which syncs the
environment across their devices). Podbay SHALL hold no T3 account credentials and call no T3 account API —
the T3 app owns its own sign-in. The QR code and manual pairing code SHALL remain available as a fallback.

#### Scenario: One-tap add to the user's T3 account

- **WHEN** the owner taps "Open in T3" on a T3-controlled pod
- **THEN** the system SHALL open the pairing deep link, and the pod SHALL be added to the user's T3
  account without scanning a QR or typing a code

#### Scenario: Fallback remains

- **WHEN** the deep link cannot be used (no app installed, or the user prefers it)
- **THEN** the cockpit SHALL still show the pairing QR + manual code

### Requirement: One reusable provider-auth flow across every entry point

Provider sign-in SHALL be a single, reusable flow — NOT a separate wizard per entry point. The system
SHALL compute the missing auth steps from `(pod, target providers, target mode)` and run only those,
skipping any provider already in the correct state. A "provider" is an agent CLI (Claude, Codex, and
later Cursor/Grok/OpenCode). The SAME flow SHALL serve: pod launch, switching an existing pod to T3,
adding a provider from the cockpit, and renew/expiry — differing only by the computed step list. Selection
SHALL require at least one provider. Each step SHALL render with the existing per-provider wizard as its
body (no duplicated sign-in UI).

#### Scenario: Switch to T3 with a provider already signed in

- **GIVEN** a pod where Codex is signed in and Claude has a subscription login
- **WHEN** the owner switches the pod to T3 (unattended)
- **THEN** the flow SHALL run ONLY the missing steps — Claude's setup-token OAuth (the 1-year token T3
  uses) — and SHALL skip Codex (its login is kept), showing a partial wizard rather than re-authing
  everything

#### Scenario: Add a provider to a pod already under T3

- **GIVEN** a pod already under T3 running Claude
- **WHEN** the owner adds Codex from the cockpit
- **THEN** the same flow SHALL run ONLY Codex's device-auth step — not a new bespoke wizard

#### Scenario: At least one provider required

- **WHEN** the owner deselects providers at launch or in the cockpit
- **THEN** the system SHALL prevent an empty provider set (a pod must run at least one agent CLI)

### Requirement: A T3-controlled pod reads as T3 on the dashboard, agents stay signed in

A pod under T3 control SHALL show its T3 state and SHALL NOT present Podbay's native Open-in-Claude /
Codex-pairing actions (T3 owns the agents). Turning T3 off SHALL restore Podbay's controls and the
subscription login. The agent card SHALL provide a discoverable, SAFE reconnect/renew trigger: a
setup-token pod → the renew wizard (non-destructive); an expiring subscription login → the reconnect
wizard behind a confirm (never a silent credential wipe).

#### Scenario: Renew is reachable, and safe

- **WHEN** a pod's login is nearing expiry
- **THEN** the cockpit SHALL surface a reconnect/renew action that leads to the correct wizard for the
  pod's auth mode, and SHALL confirm before any action that ends the current session or removes a cred
