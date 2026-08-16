## MODIFIED Requirements

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

