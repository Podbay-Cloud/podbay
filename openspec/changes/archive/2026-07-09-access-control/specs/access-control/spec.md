## ADDED Requirements

### Requirement: Persisted approval flag

A user SHALL have a persisted `approved` flag, defaulting to not-approved on account creation.

#### Scenario: New accounts start unapproved

- **WHEN** a new user account is created
- **THEN** its `approved` flag SHALL default to false

### Requirement: Access rules

A user SHALL be granted product access if any of: their `approved` flag is set, their email is in
the admin list, or their email is in the pre-approve allowlist. Otherwise they SHALL be treated as
pending.

#### Scenario: Approved flag grants access

- **WHEN** a signed-in user has `approved = true`
- **THEN** access SHALL be granted

#### Scenario: Admin and pre-approved emails are always allowed

- **WHEN** a signed-in user's email is in the admin list or the pre-approve allowlist
- **THEN** access SHALL be granted even if their `approved` flag is false

#### Scenario: Everyone else is pending

- **WHEN** a signed-in user is neither approved, admin, nor pre-approved
- **THEN** they SHALL be treated as pending

### Requirement: Product is gated to approved users

The product surfaces (`/dashboard`, the launcher, and the pod workspace) SHALL require an approved
user. Signed-in but unapproved users SHALL be shown a pending state, not the product.

#### Scenario: Pending user is diverted

- **WHEN** a signed-in but unapproved user opens a product page
- **THEN** they SHALL be shown a "you're on the list" pending page instead of the product

#### Scenario: Approved user proceeds

- **WHEN** an approved user opens a product page
- **THEN** they SHALL see the product

### Requirement: Admin approval page

An admin-only page SHALL list users (pending first) and let an admin approve or revoke access.
Non-admins SHALL NOT reach it.

#### Scenario: Admin approves a user

- **WHEN** an admin approves a pending user
- **THEN** that user's `approved` flag SHALL be set and they SHALL gain access on their next request

#### Scenario: Non-admin is denied

- **WHEN** a non-admin user opens the admin page
- **THEN** access SHALL be denied (redirected / not-found)

#### Scenario: Revoke removes access

- **WHEN** an admin revokes a user
- **THEN** that user's `approved` flag SHALL be cleared and they SHALL be pending again (unless
  admin/pre-approved)

### Requirement: Signup notification

When a new user account is created and a notification channel is configured, the system SHALL send
an alert identifying the new signup. When no channel is configured, account creation SHALL proceed
normally without error.

#### Scenario: Alert on new signup

- **WHEN** a new user signs up and a Telegram channel is configured
- **THEN** an alert identifying the new user SHALL be sent to that channel

#### Scenario: Unconfigured channel is a no-op

- **WHEN** a new user signs up and no notification channel is configured
- **THEN** sign-up SHALL succeed without attempting to notify

### Requirement: Sign-in is the access request

The landing page SHALL present sign-in as the way to request access (no separate email waitlist as
the primary path), and SHALL provide a way to reach sign-in.

#### Scenario: Landing routes to sign-in

- **WHEN** a visitor acts on the landing's primary call to action
- **THEN** they SHALL be taken to GitHub sign-in (which creates a pending account)
