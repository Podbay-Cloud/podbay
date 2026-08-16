## ADDED Requirements

### Requirement: Agent-home landing narrative
The `agent-home` landing concept SHALL lead with Podbay as a persistent, capable place the coding
agent understands and can operate. It SHALL explain the metaphor with concrete workspace
capabilities before introducing always-on infrastructure, prepared playbooks, or marketplace
content.

#### Scenario: Visitor reads the agent-home first viewport
- **GIVEN** the `agent-home` landing is rendered
- **WHEN** a visitor opens the page
- **THEN** the first viewport SHALL contain the “A home your agent knows how to use” promise, name
  concrete capabilities available in that home, present one primary access CTA, and show one
  request becoming a running system

#### Scenario: Visitor scans beyond the hero
- **GIVEN** the visitor continues through the `agent-home` page
- **WHEN** each section enters the reading order
- **THEN** the sections SHALL separately establish capability, reduced assembly work,
  differentiation, ownership, and the final action without adding a playbook catalog

### Requirement: Agent-home conversion hierarchy
The `agent-home` page SHALL make “Give my agent a home” the dominant signed-out action and SHALL
reduce uncertainty near that action with accurate access, authentication, and subscription cues.
Signed-in visitors SHALL receive the existing dashboard action.

#### Scenario: Signed-out visitor evaluates the primary action
- **GIVEN** a signed-out visitor sees the first viewport
- **WHEN** they evaluate the primary CTA
- **THEN** the CTA SHALL visually dominate secondary navigation and SHALL be accompanied by a clear
  private-alpha, GitHub-sign-in, own-subscription, and official-CLI expectation

#### Scenario: Signed-in visitor evaluates the primary action
- **GIVEN** an authenticated visitor sees the `agent-home` page
- **WHEN** they evaluate the primary CTA or account navigation
- **THEN** both SHALL lead back to the dashboard rather than presenting an alpha-access request

### Requirement: Agent-home capability proof
The primary `agent-home` graphic SHALL use one coherent simulated project to demonstrate an
application, local Postgres, prepared recurring work, and an owner-only live URL in the same
workspace. The page SHALL visually and textually identify the demonstration as simulated product
data.

#### Scenario: Visitor interprets the hero graphic
- **GIVEN** the visitor sees the request-to-running-system graphic
- **WHEN** they scan its statuses and result
- **THEN** they SHALL be able to identify what the visitor requested, what the agent configured,
  the access boundary of the URL, and the completed result without relying on animation

#### Scenario: Visitor interprets infrastructure scope
- **GIVEN** the page describes Postgres, recurring work, or a live URL
- **WHEN** the visitor reads the associated proof or differentiation content
- **THEN** the page SHALL NOT describe the local database as managed production infrastructure,
  the preview as a production deployment, or scheduling as universally configured for every pod

### Requirement: Agent-home responsive and accessible presentation
The `agent-home` layout SHALL remain coherent from 320px through wide desktop, preserve a visible
primary CTA and readable proof hierarchy, provide visible keyboard focus, and communicate all
status without depending on color or motion.

#### Scenario: Visitor uses a narrow mobile viewport
- **GIVEN** the viewport is 320px wide
- **WHEN** the `agent-home` page renders
- **THEN** the hero copy, CTA, request, capability statuses, URL, and section content SHALL remain
  readable without horizontal page overflow

#### Scenario: Visitor prefers reduced motion
- **GIVEN** the browser reports `prefers-reduced-motion: reduce`
- **WHEN** the `agent-home` page loads
- **THEN** nonessential animation SHALL be disabled while every capability and completion state
  remains visible

#### Scenario: Visitor navigates with a keyboard
- **GIVEN** the visitor uses keyboard navigation
- **WHEN** focus reaches navigation or CTA links
- **THEN** each link SHALL show a visible focus indicator and expose a meaningful accessible name
