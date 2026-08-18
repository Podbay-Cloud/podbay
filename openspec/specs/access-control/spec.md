# access-control Specification

## Purpose
Gates the product to approved users during private alpha: accounts start unapproved, access is granted by an approval flag or an admin/pre-approved allowlist while everyone else stays pending, and sign-in itself serves as the access request. It provides an admin page to approve or revoke users and notifies a configured channel on new signups.
## Requirements
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

#### Scenario: Provisioning enforces approval server-side, not just via the page gate

- **WHEN** a signed-in but unapproved user invokes the pod-provisioning action directly (a Server
  Action is a directly-invocable endpoint that the page-level pending redirect does not protect)
- **THEN** the action itself SHALL require an approved user and refuse to provision — the approval
  check SHALL NOT rely solely on the page gate

### Requirement: Admin approval page

An admin-only page SHALL list users (pending first) and let an admin approve or revoke access.
Non-admins SHALL NOT reach it.

#### Scenario: Admin approves a user

- **WHEN** an admin approves a pending user
- **THEN** that user's `approved` flag SHALL be set and they SHALL gain access on their next request

#### Scenario: Non-admin is denied

- **WHEN** a non-admin user opens the admin page
- **THEN** access SHALL be denied (redirected / not-found)

#### Scenario: Admin requires a verified email, not just an allowlist match

- **WHEN** a signed-in user's email matches the admin allowlist but the auth provider has NOT verified
  that email
- **THEN** the admin gate SHALL deny them — an allowlist match alone SHALL NOT clear it

#### Scenario: A fleet-wide loader re-checks admin server-side

- **WHEN** a backoffice loader reads across every owner's pods (e.g. the fleet view)
- **THEN** it SHALL re-assert admin inside the loader, not rely solely on an outer layout/route gate a
  refactor could bypass

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

### Requirement: An approved user is told they are in

The pending page promises a waitlisted user that they will be emailed when their spot opens; the
system SHALL keep that promise. When an admin approves a user who was NOT previously approved, and
an email provider is configured, the system SHALL send that user an approval email. Approving a user
who is already approved SHALL NOT send another email, so a re-approval or a double-click never spams
them. When no email provider is configured, approval SHALL still succeed — the email is best-effort
and never blocks or fails the approval.

#### Scenario: First approval notifies the user

- **WHEN** an admin approves a user whose `approved` flag was false and an email provider is configured
- **THEN** an approval email SHALL be sent to that user's address

#### Scenario: Re-approval does not re-notify

- **WHEN** an admin approves a user who is already approved
- **THEN** no further approval email SHALL be sent

#### Scenario: Approval succeeds without an email provider

- **WHEN** an admin approves a user and no email provider is configured
- **THEN** the approval SHALL still take effect, and no error SHALL surface

### Requirement: Sign-in is the access request

The landing page SHALL present GitHub sign-in as the way for a signed-out visitor to request access
(no separate email waitlist as the primary path), SHALL provide a plain route to sign-in, and SHALL
present an authenticated visitor with a route to their dashboard instead of another access request.

#### Scenario: Signed-out landing CTA routes to sign-in

- **GIVEN** the visitor has no authenticated session
- **WHEN** they act on the landing's primary call to action
- **THEN** they SHALL be taken to GitHub sign-in, which creates a pending account

#### Scenario: Signed-in landing CTA routes to dashboard

- **GIVEN** the visitor has an authenticated session
- **WHEN** they open the landing page or act on its primary call to action
- **THEN** the landing SHALL identify the dashboard as their next action and route them there

### Requirement: Deferred ("Later") requests

An admin SHALL be able to set a pending request aside for later without approving or losing it. A
deferred request carries a persisted `deferredAt` timestamp, remains unapproved (pending access), and
SHALL be listed separately from the still-to-triage queue so the admin can return to it. Approving a
request SHALL clear its deferred state.

#### Scenario: Admin defers a pending request

- **WHEN** an admin sets a pending user aside for later
- **THEN** that user SHALL be marked deferred (a `deferredAt` timestamp is recorded), SHALL remain
  unapproved, and SHALL move out of the primary pending list into a separate "Later" list

#### Scenario: Deferred request can be moved back

- **WHEN** an admin moves a deferred user back
- **THEN** the deferred mark SHALL be cleared and the user SHALL reappear in the primary pending list

#### Scenario: Approving clears the deferred mark

- **WHEN** an admin approves a user who was deferred
- **THEN** the user SHALL become approved and the deferred mark SHALL be cleared

### Requirement: New-request operator email with one-click actions

When a new access request arrives and an email provider is configured, the system SHALL email the
configured operator address an alert identifying the requester that carries two one-click links —
approve, and set-aside-for-later. Each link SHALL embed an unforgeable, server-minted, expiring
capability token that encodes exactly one action for exactly one requester; the link SHALL require
no admin session because the token itself is the authorization, and SHALL be usable only to action
the single requester it encodes. Following the approve link SHALL approve that requester (and email
them their invite, per the approval-email rules); following the later link SHALL defer them. A
tampered, expired, or wrong-key token SHALL perform no action. This email is best-effort — when no
operator address or no email provider is configured, sign-up SHALL still succeed with no error.

#### Scenario: Operator is emailed with approve + later links on a new request

- **WHEN** a new user signs up, an operator address is configured, and an email provider is configured
- **THEN** the operator SHALL receive an email identifying the requester with a one-click approve link
  and a one-click later link

#### Scenario: One-click approve link approves without a session

- **WHEN** the operator follows the approve link (carrying a valid token) while not signed in as an admin
- **THEN** the encoded requester SHALL be approved (and emailed their invite on the first approval)

#### Scenario: One-click later link defers the requester

- **WHEN** the operator follows the later link carrying a valid token
- **THEN** the encoded requester SHALL be marked deferred

#### Scenario: A tampered or expired token does nothing

- **WHEN** a one-click link is followed with a token that is tampered, expired, or minted under a
  different key
- **THEN** no approval or deferral SHALL occur and the request SHALL be left unchanged

#### Scenario: Unconfigured operator email is a no-op

- **WHEN** a new user signs up and either no operator address or no email provider is configured
- **THEN** sign-up SHALL succeed without attempting to email the operator

