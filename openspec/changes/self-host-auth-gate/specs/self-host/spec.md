## MODIFIED Requirements

### Requirement: Single-tenant OSS edition

When `PODBAY_EDITION=oss`, the app SHALL run single-tenant with exactly one owner and SHALL NOT
present cloud account surfaces (marketing landing, waitlist/approval, billing). All ownership-scoped
operations use the fixed local owner id. The owner SHALL be authenticated by a session (see "The OSS
edition requires an authenticated owner") rather than assumed — there is one owner, but reaching the
dashboard still requires signing in.

#### Scenario: The root is the app, not a marketing page

- **WHEN** a request hits `/` in the OSS edition
- **THEN** it SHALL redirect to the dashboard (the self-host install has no marketing funnel), and an
  authenticated owner SHALL see the dashboard while an unauthenticated request SHALL be sent to sign-in

#### Scenario: Cloud-only surfaces are gated off

- **WHEN** the OSS edition renders the dashboard or handles a launch
- **THEN** it SHALL NOT run cloud analytics/experiment tracking, SHALL NOT show a cookie-consent
  banner, and SHALL NOT show or enforce an account slot budget (the only limit is the host's
  hardware); admin backoffice routes remain inaccessible to the non-admin local owner

## ADDED Requirements

### Requirement: The OSS edition requires an authenticated owner

The OSS edition SHALL gate the dashboard and the terminal behind an authenticated owner session, so a
self-host install is safe to expose on a VPS. Authentication SHALL use the same session mechanism as
the cloud edition (a signed, DB-backed session cookie), enabled with email + password rather than
GitHub OAuth. An unauthenticated request to any dashboard route SHALL be redirected to sign-in, and an
unauthenticated terminal (WebSocket) connection SHALL be rejected. The credential check SHALL be
delegated to the shared auth library (no bespoke password comparison), and credentials SHALL never be
logged.

The session-signing secret SHALL be generated and persisted on first boot on the install's data
volume when the owner has not provided one, so sessions survive restarts with no owner configuration
(mirroring the pod-secret vault key). OSS auth SHALL be considered configured from the database plus
that secret plus email/password being enabled — GitHub OAuth credentials SHALL NOT be required.

#### Scenario: An unauthenticated request cannot reach the dashboard or terminal

- **WHEN** a request without a valid owner session hits a dashboard route or opens the terminal
  WebSocket in the OSS edition
- **THEN** the dashboard route SHALL redirect to the sign-in page and the terminal connection SHALL be
  refused — neither SHALL serve owner data to an unauthenticated caller

#### Scenario: A signed-in owner is the single approved owner

- **WHEN** the owner has signed in
- **THEN** `getCurrentUser()` SHALL resolve to the one owner (approved), all ownership-scoped
  operations SHALL use that owner id, and the owner SHALL be able to sign out (which clears the session)

### Requirement: First-run owner setup

Before an owner credential exists, the OSS edition SHALL present a one-time setup step to create the
owner: the owner sets a password (and email), or requests a strong password to be generated for them to
copy. Once an owner credential exists, the setup step SHALL be closed — subsequent visits SHALL show a
normal sign-in, and the setup path SHALL NOT allow creating or replacing the owner. The owner MAY
instead pre-seed the credential via an environment variable so that no setup window exists on a public
VPS; when pre-seeded, the first-run setup SHALL be treated as already complete.

#### Scenario: First visit creates the owner, later visits require login

- **WHEN** the OSS install is opened for the first time with no owner credential and no pre-seeded
  password
- **THEN** the sign-in page SHALL offer owner setup (choose a password or generate one), SHALL create
  exactly one owner from it, and SHALL sign that owner in; a subsequent visit SHALL present only the
  login form and SHALL reject any attempt to re-run setup

#### Scenario: Pre-seeded password closes the setup window

- **WHEN** the owner sets the owner password via environment before first boot
- **THEN** the install SHALL start with the owner credential already in place, the first-run setup step
  SHALL be unavailable, and the owner SHALL sign in with that password
