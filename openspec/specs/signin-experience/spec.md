# signin-experience Specification

## Purpose
Defines the branded sign-in page: a focused, responsive surface that explains the private-alpha access context and the scope of GitHub authentication, with accessible OAuth action states including failure handling. It preserves a safe internal post-sign-in destination, rejects unsafe redirects, and offers return navigation to the landing page.
## Requirements
### Requirement: Focused branded sign-in surface
The `/signin` page SHALL present a substantial, branded authentication surface that clearly
continues the public Podbay experience without reproducing the full landing page. It SHALL use a
generously sized, focused sign-in panel on larger viewports and become a full-height authentication
surface on narrow viewports.

#### Scenario: Visitor opens sign-in on desktop
- **GIVEN** the visitor is signed out on a desktop-sized viewport
- **WHEN** the visitor opens `/signin`
- **THEN** the page SHALL show Podbay identity, clear private-alpha context, and a visually prominent
  authentication action without a small isolated card in an empty viewport

#### Scenario: Visitor opens sign-in on a phone
- **GIVEN** the viewport is 320px wide
- **WHEN** the visitor opens `/signin`
- **THEN** the sign-in heading, access explanation, GitHub action, and return navigation SHALL remain
  readable and reachable without horizontal overflow or competing decorative content

### Requirement: Clear private-alpha access context
The sign-in surface SHALL explain that the same GitHub action lets a returning user sign in and a
new visitor request private-alpha access. It SHALL describe the post-authentication path without
promising immediate approval.

#### Scenario: New visitor evaluates the GitHub action
- **GIVEN** the visitor does not yet have approved Podbay access
- **WHEN** the visitor reads the sign-in panel
- **THEN** the page SHALL make clear that GitHub authentication submits the access request and that
  unapproved accounts continue to the existing pending state

#### Scenario: Returning user evaluates the GitHub action
- **GIVEN** the visitor already has a Podbay account
- **WHEN** the visitor reads the sign-in panel
- **THEN** the same GitHub action SHALL be clearly usable to return to the requested Podbay surface

### Requirement: Accessible GitHub OAuth action states
The GitHub OAuth action SHALL use a semantic button with a descriptive accessible name, visible
keyboard focus, a touch target at least 44 CSS pixels high, and distinct idle, redirecting, and
recoverable failure states. Repeated activation SHALL be prevented while redirect initiation is in
progress.

#### Scenario: Visitor starts GitHub authentication
- **GIVEN** the GitHub action is idle
- **WHEN** the visitor activates it with a pointer or keyboard
- **THEN** the action SHALL identify redirect progress, prevent duplicate activation, and start the
  existing better-auth GitHub OAuth flow

#### Scenario: OAuth initiation fails
- **GIVEN** GitHub OAuth initiation returns an error or throws before navigation
- **WHEN** the failure is received
- **THEN** the page SHALL show a readable error, restore the action to an operable state, and allow
  the visitor to retry

### Requirement: Destination and return navigation
The sign-in experience SHALL preserve an internal requested destination through GitHub OAuth,
default to `/dashboard` when no valid destination exists, and provide a clear route back to the
Podbay landing page. External or protocol-relative destinations SHALL NOT be accepted.

#### Scenario: Internal destination survives sign-in
- **GIVEN** the visitor opens `/signin` with a valid internal `next` destination
- **WHEN** GitHub OAuth is initiated
- **THEN** that internal destination SHALL be passed as the callback destination

#### Scenario: Unsafe destination is supplied
- **GIVEN** the `next` value is external, protocol-relative, or otherwise not a safe local path
- **WHEN** the sign-in page resolves its callback destination
- **THEN** the callback destination SHALL fall back to `/dashboard`

#### Scenario: Visitor returns to the landing page
- **GIVEN** the visitor decides not to authenticate
- **WHEN** the visitor activates the return navigation
- **THEN** the visitor SHALL be taken to `/`

### Requirement: Clear authentication scope
Sign-in copy SHALL describe GitHub as the Podbay account identity provider and SHALL NOT imply that
GitHub OAuth authenticates Claude Code, Codex, repositories, or model subscriptions.

#### Scenario: Visitor reads the identity explanation
- **GIVEN** the GitHub sign-in action is visible
- **WHEN** the visitor reads its supporting note
- **THEN** GitHub SHALL be described only as the Podbay account sign-in method, separate from code
  access and Claude or Codex authentication

### Requirement: Sign-in does not depend on analytics

The sign-in control SHALL start authentication regardless of whether the analytics client is
present, initialised, or functional. Instrumentation placed BEFORE the redirect makes an
adblocker, a missing token or a browser extension indistinguishable from a broken button —
the user clicks "Continue with GitHub" and nothing happens, with no error to report.

#### Scenario: Analytics is blocked or absent

- **WHEN** the user clicks the GitHub sign-in control and the analytics client throws
- **THEN** the OAuth redirect SHALL still occur
