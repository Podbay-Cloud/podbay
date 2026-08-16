## MODIFIED Requirements

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
  subscription they already pay for

#### Scenario: Runtime application requires separate model credentials
- **GIVEN** a playbook's deployed application requires an API key in addition to the coding-agent
  subscription
- **WHEN** that playbook is described
- **THEN** the page SHALL NOT imply that application runtime usage is included in the coding-agent
  subscription

#### Scenario: Visitor reads subscription differentiation
- **GIVEN** the visitor reaches differentiation content
- **WHEN** subscription behavior is described
- **THEN** the copy SHALL distinguish the Podbay workspace from the user's existing AI subscription
  without making an unverified vendor claim

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
