# uix-e2e-tests Specification

## Purpose
Provides a hermetic, one-command end-to-end test stack with a production-inert test login that exercises the core user journeys — access gating and admin approval, and the pod lifecycle from launch to live terminal, login-chip surfacing, and deletion. It exists to keep these critical flows verified and to require every new flow to ship with its own flow test.
## Requirements
### Requirement: Hermetic e2e stack

The e2e suite SHALL run the real web app, gateway, and pod-agent against a local database and a
fake sandbox provider, with no external network dependencies (no GitHub OAuth, no Fly API).

#### Scenario: One-command run

- **WHEN** a developer runs `pnpm e2e`
- **THEN** the stack boots, all flow specs run headless in a real browser, and the stack tears
  down, with a non-zero exit on any failure

#### Scenario: Test login is production-inert

- **WHEN** the app runs without `PODBAY_TEST_LOGIN=1` (production)
- **THEN** no test sign-in route or credentials provider exists

### Requirement: Access flows are covered

The suite SHALL cover sign-in, the pending gate, admin approval, and sign-out.

#### Scenario: Unapproved user is gated

- **WHEN** a new user signs in without approval
- **THEN** they land on the pending page and cannot reach dashboard, launcher, or pods

#### Scenario: Admin approves a user

- **WHEN** an admin approves a pending user on the admin page
- **THEN** that user can reach the dashboard on next navigation

### Requirement: Pod lifecycle flows are covered

The suite SHALL cover launch, terminal attach, link chips, sleep/wake, and delete.

#### Scenario: Launch to live terminal

- **WHEN** an approved user launches an environment from the launcher
- **THEN** they are routed to the pod workspace, the terminal reaches connected, and typing a
  command shows its output (real gateway → real pod-agent → tmux)

#### Scenario: Login URL surfaces as a chip

- **WHEN** the pod's tmux buffer prints a URL
- **THEN** a link chip appears above the terminal

#### Scenario: Delete shows pending state and completes

- **WHEN** the user confirms deleting a pod
- **THEN** the card shows a removing state (disabled) and the pod is gone from the dashboard
  after completion; a failing delete surfaces an error and re-enables the card

### Requirement: Future flows ship with flow tests

Project conventions SHALL require any change that adds or alters a user flow to add or update a
corresponding e2e flow spec in the same change.

#### Scenario: New flow lands

- **WHEN** an opsx change introduces a new user-facing flow
- **THEN** its tasks include an e2e flow spec and the suite passes before archive

