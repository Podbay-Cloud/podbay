# landing-experience Specification

## Purpose
Defines the public landing page: an outcome-led narrative with distinct sections, rotating illustrative build examples, a starter catalog, and subscription positioning, presented truthfully without overstating unavailable capabilities. It ensures the page is responsive, respects reduced-motion and keyboard navigation, carries proper metadata, and emits interaction analytics that degrade gracefully when no backend is present.
## Requirements
### Requirement: A signed-in visitor is shown the way back to their machines

When a signed-in user views the landing page, the primary navigation SHALL present their account mark
— their avatar, or their initial when they have no image — as part of the link to the dashboard.

A plain "Dashboard" text link reads as site navigation rather than as *their* account, so a returning
user hunts for the way back into their own pods. The mark is also the signal that they are already
signed in, which the page otherwise states nowhere.

The mark SHALL be part of the same link, not adjacent to it, and SHALL NOT increase the height of the
navigation row.

#### Scenario: Signed-in visitor on the landing page

- **WHEN** a signed-in user loads the landing page
- **THEN** the navigation SHALL show their avatar or initial within the dashboard link, and the
  navigation row SHALL be no taller than it is for an anonymous visitor

### Requirement: Outcome-led landing narrative
The `outcomes` bundle SHALL preserve the stable headline “Build the idea. Skip the setup.” while
describing removed infrastructure burden without promising literally zero setup. The
`agent-computer` bundle SHALL lead with the benefit that work continues after the visitor's laptop
closes and explain the always-on computer that enables it. The `agent-home` bundle SHALL lead with
a capable home the agent knows how to use and immediately decode that metaphor into project,
services, recurring work, and a live address. Each bundle SHALL expose its primary access CTA in
the first viewport.

#### Scenario: Visitor reads the outcomes first viewport
- **GIVEN** the `outcomes` variant is rendered
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL identify the build outcome, handled infrastructure setup,
  primary access CTA, and representative conceptual proof without claiming that every user action
  or credential step disappears

#### Scenario: Visitor reads the agent-computer first viewport
- **GIVEN** the `agent-computer` variant is rendered
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL state that the coding agent keeps working after the visitor's
  laptop closes, identify native Claude desktop and mobile apps as the normal control surfaces,
  identify the always-on cloud computer that connects them, include the primary access CTA, and
  make bring-your-own-subscription behavior visible without scrolling

#### Scenario: Visitor interprets the Agent Computer hero visual
- **GIVEN** the `agent-computer` first viewport is displayed
- **WHEN** the visitor scans the continuity walkthrough
- **THEN** Claude Desktop and Claude Mobile SHALL carry all task narrative, questions, and results,
  the pod SHALL communicate only real lifecycle and Remote Control state, and terminal access SHALL
  NOT appear as a peer or primary workflow

#### Scenario: Continuity sequence remains legible across viewports
- **GIVEN** the `agent-computer` continuity walkthrough is displayed
- **WHEN** the visitor follows the desktop, pod, and phone sequence
- **THEN** “Start on desktop”, “Laptop closes”, and “Continue on phone” SHALL appear as external
  narrative steps rather than simulated window titles, the pod SHALL be the visually emphasized
  center stage without obscuring either Claude surface, wide three-column layouts SHALL angle both
  Claude surfaces subtly inward and mute only their descendant text rather than dimming the entire
  surface, the center stage SHALL explain capabilities the agent can use instead of repeating the
  hero's cloud-VM definition, and narrow viewports SHALL keep each label attached to its flat surface
  in the same order

#### Scenario: Simulated Claude work crosses devices
- **GIVEN** the Agent Computer hero uses an invented conversation
- **WHEN** Claude investigates work on desktop and later asks for a decision on mobile
- **THEN** the conversation SHALL be labeled as simulated, the center substrate SHALL be named a
  pod, and Podbay SHALL NOT claim to observe tests, task completion, or preview changes

#### Scenario: Visitor reads the agent-home first viewport
- **GIVEN** the `agent-home` variant is rendered
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL promise a home the agent knows how to use and SHALL visualize
  one request becoming a running application with local data, prepared recurring work, and a
  private live address

### Requirement: Distinct section responsibilities
The landing page SHALL use a lean narrative in which the hero, starter catalog, concrete capability
proof, differentiation, and closing CTA each add new information rather than restating the hero
promise.

#### Scenario: Visitor scans the full page
- **GIVEN** the landing page is rendered
- **WHEN** the visitor moves from one section to the next
- **THEN** each section SHALL answer a distinct question about relevance, product substance,
  differentiation, or next action

### Requirement: Rotating build examples
The `outcomes` control hero SHALL preserve its deterministic sequence of useful-app, automation,
and bot examples while keeping the headline, supporting copy, layout dimensions, and CTA stable.
The sequence SHALL provide manual selection and SHALL NOT randomize the initial example. The
`agent-computer` treatment SHALL NOT reuse this conceptual rotation as its primary proof.

#### Scenario: Automatic control example progression
- **GIVEN** the `outcomes` variant is rendered, motion is allowed, and the visitor has not
  interacted with the example
- **WHEN** the hero remains visible for the configured hold period
- **THEN** the example SHALL progress in a fixed order and its matching outcome visual SHALL appear
  without moving or obscuring surrounding content

#### Scenario: Visitor selects a control example
- **GIVEN** the `outcomes` example controls are visible
- **WHEN** the visitor selects the app, automation, or bot control
- **THEN** the chosen copy and matching outcome visual SHALL appear and automatic progression SHALL
  pause

#### Scenario: Control example is not a launch input
- **GIVEN** prompt-first project launch is unavailable
- **WHEN** the visitor sees the typed control example
- **THEN** it SHALL be presented as an example of directing an agent and SHALL NOT appear to submit
  or launch a project from the landing page

### Requirement: Starter catalog
Landing bundles that present playbooks SHALL derive availability from the current catalog plus an
explicit release-readiness gate. A launchable card SHALL represent a playbook that is both present
and release-ready; a pilot SHALL be visibly unavailable and SHALL NOT link to a launch action. The
`outcomes` and `agent-computer` bundles SHALL use consistent readiness for the same playbook.

#### Scenario: Visitor evaluates launchable starting points
- **GIVEN** Bring Your Project and Ask Your Docs are present and release-ready
- **WHEN** either catalog-bearing landing bundle renders their cards
- **THEN** the cards SHALL be identified as ready and SHALL link to the applicable sign-in or launch
  action

#### Scenario: Visitor evaluates pilot starting points
- **GIVEN** First 10 Customers or Morning Ops Robot has not passed its release gate
- **WHEN** either catalog-bearing landing bundle renders that playbook
- **THEN** it SHALL be visibly identified as a pilot or unavailable and SHALL NOT link to a launch
  action

### Requirement: Truthful product proof
Primary landing graphics SHALL be visibly distinguishable as real product captures, real playbook
outputs, conceptual examples, or simulated walkthroughs. Repeated imagery SHALL not be used merely
to inflate proof density. All public claims SHALL match behavior available at release. The page
SHALL NOT fabricate customer proof, usage metrics, managed production infrastructure, client
support, session retention, malicious-skill prevention, egress protection, or starter availability.

#### Scenario: Conceptual outcome is displayed
- **GIVEN** an illustrative mockup rather than captured product output is used
- **WHEN** a visitor views the visual
- **THEN** the visual SHALL include a persistent readable cue that it is conceptual and SHALL NOT
  attribute the outcome to a customer

#### Scenario: Simulated workspace walkthrough is displayed
- **GIVEN** a landing shows continuity, local services, recurring work, or live-preview behavior
  with invented project content
- **WHEN** the visual is published
- **THEN** shipped Podbay behavior SHALL support the depicted capability and the visual SHALL
  identify the project data as simulated

#### Scenario: A named capability is unavailable
- **GIVEN** Codex parity, native-client reach, arbitrary terminal access, always-on behavior,
  scheduling, local Postgres, public/private preview, or a named playbook is not production-ready
- **WHEN** landing copy and availability language are reviewed
- **THEN** the unavailable claim SHALL be removed, explicitly qualified, or the affected bundle
  SHALL remain blocked from measured delivery

### Requirement: Subscription positioning
All three variants SHALL state that users bring their own supported agent subscription and that
Podbay uses the official CLI without token markup. The `agent-computer` and `agent-home` bundles
SHALL make this distinction visible in the first viewport. No variant SHALL imply pooled
subscriptions, modified official CLIs, model-auth proxying, or control over vendor billing.

#### Scenario: Agent-computer or agent-home visitor reads the first viewport
- **GIVEN** the `agent-computer` or `agent-home` variant is rendered
- **WHEN** the first viewport is displayed
- **THEN** it SHALL state that Podbay hosts the workspace while the visitor uses the supported
  subscription they already pay for; the `agent-computer` reassurance SHALL visually group that
  message with official-CLI, no-token-markup, and any qualified agent-support status without making
  the qualification look like a competing action

#### Scenario: Runtime application requires separate model credentials
- **GIVEN** a playbook's deployed application requires an API key in addition to the coding-agent
  subscription
- **WHEN** that playbook is described
- **THEN** the page SHALL NOT imply that application runtime usage is included in the coding-agent
  subscription

#### Scenario: Visitor reads subscription differentiation
- **GIVEN** the visitor reaches the differentiation content
- **WHEN** subscription behavior is described
- **THEN** the copy SHALL distinguish the Podbay workspace from the user's existing AI
  subscription without making an unverified vendor claim

### Requirement: Responsive and accessible motion
The landing page SHALL remain usable and visually coherent from 320px mobile through wide desktop,
with keyboard-accessible controls, visible focus, stable media dimensions, meaningful alternative
text, and a reduced-motion experience that disables typing and autoplay.

#### Scenario: Visitor prefers reduced motion
- **GIVEN** the browser reports `prefers-reduced-motion: reduce`
- **WHEN** the landing page loads
- **THEN** one stable example SHALL be shown without typing or autoplay and manual selection SHALL
  remain available

#### Scenario: Visitor uses keyboard navigation
- **GIVEN** the visitor navigates without a pointer
- **WHEN** focus reaches example or CTA controls
- **THEN** each control SHALL expose its purpose and state, show visible focus, and operate from the
  keyboard

#### Scenario: Visitor opens a narrow viewport
- **GIVEN** the viewport is 320px wide
- **WHEN** the landing page renders and examples change
- **THEN** text, controls, visuals, and CTA SHALL remain readable without horizontal overflow or
  incoherent overlap

### Requirement: Landing metadata
The canonical landing page SHALL publish one stable, truthful metadata description independent of
random experiment assignment. Forced-preview routes SHALL not compete with the canonical landing
page in search indexes.

#### Scenario: Canonical landing metadata is rendered
- **GIVEN** a crawler or link preview requests `/`
- **WHEN** title, description, and canonical metadata are produced
- **THEN** they SHALL identify Podbay as an always-on cloud workspace for coding agents, mention the
  supported bring-your-own-subscription model, and use `/` as the canonical URL

#### Scenario: Preview metadata is rendered
- **GIVEN** a crawler requests a semantic preview route
- **WHEN** metadata is produced
- **THEN** it SHALL include `noindex` and identify `/` as canonical

### Requirement: Landing interaction event contract
The landing experience SHALL expose stable, variant-aware analytics events for experiment exposure,
primary CTA activation, and variant-specific interactions through a non-blocking same-origin
adapter. Every primary CTA in all three measured bundles SHALL be instrumented. Event delivery SHALL
remain safe for navigation when the ingestion backend is absent or unavailable.

#### Scenario: Analytics backend is unavailable
- **GIVEN** the landing event endpoint cannot accept an event
- **WHEN** a visitor triggers an instrumented interaction
- **THEN** navigation and interaction SHALL complete normally without surfacing an error

#### Scenario: Instrumented interaction occurs
- **GIVEN** an eligible assigned visitor activates a primary CTA, selects an outcomes example, or
  selects a presented playbook
- **WHEN** the adapter submits the event
- **THEN** it SHALL persist the active experiment identifier, semantic variant, stable event name,
  and selected item identifier when applicable

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

