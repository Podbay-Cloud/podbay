## ADDED Requirements

### Requirement: First login is captured to the vault

After a user authenticates an agent CLI inside a pod, the platform SHALL capture that agent's
credentials and store them encrypted at rest, keyed by user and agent.

#### Scenario: Login transition triggers capture

- **WHEN** a pod's agent reports the unauthenticated→authenticated transition
- **THEN** the credentials are captured and stored encrypted for that user and agent

#### Scenario: Refreshed tokens propagate

- **WHEN** the credentials file changes in a running pod (token refresh)
- **THEN** the vault copy is updated, so future pods receive working credentials

### Requirement: New pods boot pre-authenticated

A launched pod SHALL boot with vault credentials in place whenever the environment declares an
agent for which the user has stored credentials, and the CLI SHALL start authenticated with no
login step.

#### Scenario: Second pod skips login

- **WHEN** a user with captured Claude credentials launches an env with `agents: [claude-code]`
- **THEN** the terminal opens with the CLI at a usable prompt, already signed in

#### Scenario: No vault entry falls back to login

- **WHEN** the user has no stored credentials for the env's agent
- **THEN** the pod boots into the login flow exactly as today

### Requirement: Users can forget saved logins

The dashboard SHALL show which agent logins are saved and let the user delete each; deletion
takes effect for all future pods.

#### Scenario: Forget removes stored credentials

- **WHEN** the user clicks Forget for an agent
- **THEN** the vault row is deleted and the next pod for that agent requires a fresh login

### Requirement: Credentials never leak beyond the vault path

Credentials SHALL appear only encrypted in the database and as root-inaccessible-to-other-users
files inside the user's own pod; they SHALL never appear in logs, in the environment format, or
in any marketplace-visible surface.

#### Scenario: Logs are clean

- **WHEN** capture or injection runs
- **THEN** no log line contains credential material

#### Scenario: Environment format still refuses credentials

- **WHEN** an environment file attempts to carry credential-bearing keys
- **THEN** validation hard-fails exactly as before this change
