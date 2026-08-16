## ADDED Requirements

### Requirement: GitHub OAuth sign-in

Users SHALL authenticate to Podbay via GitHub OAuth. On first sign-in a Podbay user record SHALL
be created and linked to the GitHub account; on later sign-ins the existing user SHALL be
resolved. Podbay SHALL NOT store passwords.

#### Scenario: First sign-in creates a linked user

- **WHEN** a user completes GitHub OAuth for the first time
- **THEN** a Podbay user record SHALL be created, linked to that GitHub account, and a session
  SHALL be established

#### Scenario: Returning sign-in resolves the same user

- **WHEN** a previously-linked GitHub account signs in again
- **THEN** the same Podbay user SHALL be resolved (no duplicate user), with a new session

### Requirement: Session management

An authenticated session SHALL persist across requests and SHALL be endable by sign-out. Session
state SHALL live in the database.

#### Scenario: Session persists

- **WHEN** a signed-in user makes a subsequent request with their session
- **THEN** the request SHALL resolve to the authenticated user

#### Scenario: Sign-out ends the session

- **WHEN** a user signs out
- **THEN** the session SHALL be invalidated and subsequent requests SHALL be unauthenticated

### Requirement: Identity to ownerId bridge

The system SHALL expose a helper that resolves the current session to a user id, and that id SHALL
be the `ownerId` used with the control plane. Unauthenticated requests SHALL resolve to no user.

#### Scenario: Authenticated request yields an ownerId

- **WHEN** `getCurrentUser()` runs within an authenticated request
- **THEN** it SHALL return the user id used as `ownerId` for `PodService` calls

#### Scenario: Unauthenticated request is gated

- **WHEN** `requireUser()` runs without a valid session
- **THEN** it SHALL reject the request as unauthenticated, and no control-plane operation SHALL run

### Requirement: Database foundation with a testable connection

Persistence SHALL use Drizzle over Postgres, behind a connection factory that selects the driver
by environment: Neon serverless in production and an in-process Postgres (pglite) in tests, so
database code is verifiable without an external database.

#### Scenario: Tests run against in-process Postgres

- **WHEN** the test suite constructs the database
- **THEN** it SHALL use the in-process driver and apply the schema without any network access

#### Scenario: Production uses Neon

- **WHEN** the app runs with a Neon connection string configured
- **THEN** the factory SHALL use the Neon serverless driver

### Requirement: Server-only secrets

OAuth client secrets and the auth signing secret SHALL be server-only configuration and SHALL
NOT appear in the repository or reach the browser.

#### Scenario: Secrets are not client-exposed

- **WHEN** the app is built
- **THEN** the GitHub client secret and auth secret SHALL be read only on the server (env /
  platform secrets) and SHALL NOT be bundled into client code
