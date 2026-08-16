## MODIFIED Requirements

### Requirement: Outcome-led landing narrative
The `outcomes` control SHALL preserve the stable headline "Build the idea. Skip the setup." and
SHALL describe Podbay for people building with Claude or Codex in outcome language before
introducing workspace, terminal, infrastructure, or lifecycle details. The
`agent-computer` treatment SHALL instead lead with Podbay as an always-on computer for a coding
agent and explain continuity, off-device execution, and multi-device reach before presenting
prepared outcomes.

#### Scenario: Visitor reads the control first viewport
- **GIVEN** the `outcomes` variant is rendered
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL identify the build outcome, removed setup burden, primary
  access CTA, and representative conceptual visual proof

#### Scenario: Visitor reads the treatment first viewport
- **GIVEN** the `agent-computer` variant is rendered
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL identify Podbay as an always-on cloud computer for the visitor's
  coding agent, state that work continues away from the visitor's laptop, include the primary
  access CTA, and make bring-your-own-subscription behavior visible without scrolling

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
The `outcomes` control SHALL preserve its existing six-card starter catalog for the duration of the
experiment. The `agent-computer` treatment SHALL present only launchable or explicitly labeled
pilot playbooks derived from the current environment catalog and SHALL distinguish a prepared
playbook from a blank cloud machine.

#### Scenario: Visitor evaluates treatment starting points
- **GIVEN** the `agent-computer` variant is rendered
- **WHEN** the visitor reaches its prepared-work section
- **THEN** the page SHALL present the available Bring Your Project, Ask Your Docs, First 10
  Customers, and launch-ready Morning Ops Robot playbooks with truthful descriptions of what is
  prebuilt, which skills are included, and what the visitor can customize

#### Scenario: Playbook has not passed its launch gate
- **GIVEN** a treatment playbook has not passed its required kill test or dogfood gate
- **WHEN** the treatment catalog is assembled
- **THEN** the playbook SHALL be omitted or visibly identified as unavailable without linking to a
  launch action

### Requirement: Truthful product proof
Primary landing graphics SHALL be visibly distinguishable as real product captures, real playbook
outputs, or conceptual examples. All public claims SHALL match behavior available at release. The
page SHALL NOT fabricate customer proof, usage metrics, client support, session retention,
malicious-skill prevention, egress protection, or starter availability.

#### Scenario: Conceptual outcome is displayed
- **GIVEN** an illustrative mockup rather than captured product output is used
- **WHEN** a visitor views the visual
- **THEN** the visual SHALL include a persistent readable cue that it is conceptual and SHALL NOT
  attribute the outcome to a customer

#### Scenario: Real treatment proof is displayed
- **GIVEN** the treatment shows continuity, remote control, browser terminal, live preview, or a
  prepared playbook
- **WHEN** the visual is published
- **THEN** it SHALL be captured from production-ready Podbay behavior and SHALL identify simulated
  data when the depicted content is not a real user's project

#### Scenario: A named capability is unavailable
- **GIVEN** Codex parity, native-client reach, arbitrary terminal access, always-on behavior, or a
  named playbook is not production-ready
- **WHEN** landing copy and availability language are reviewed
- **THEN** the unavailable claim SHALL be removed, explicitly qualified, or the treatment release
  SHALL remain blocked

### Requirement: Subscription positioning
Both variants SHALL state that users bring their own supported Claude or Codex subscription and
that Podbay adds no token markup. The `agent-computer` treatment SHALL make this distinction visible
in the first viewport. Neither variant SHALL imply pooled subscriptions, modified official CLIs,
model-auth proxying, or control over vendor billing.

#### Scenario: Treatment visitor reads the first viewport
- **GIVEN** the `agent-computer` variant is rendered
- **WHEN** the first viewport is displayed
- **THEN** it SHALL state that Podbay hosts the computer while the visitor uses the supported
  subscription they already pay for

#### Scenario: Runtime application requires separate model credentials
- **GIVEN** a playbook's deployed application requires an API key in addition to the coding-agent
  subscription
- **WHEN** that playbook is described
- **THEN** the page SHALL NOT imply that application runtime usage is included in the coding-agent
  subscription

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
adapter. Event delivery SHALL remain safe for navigation when the ingestion backend is absent or
unavailable.

#### Scenario: Analytics backend is unavailable
- **GIVEN** the landing event endpoint cannot accept an event
- **WHEN** a visitor triggers an instrumented interaction
- **THEN** navigation and interaction SHALL complete normally without surfacing an error

#### Scenario: Instrumented interaction occurs
- **GIVEN** an eligible assigned visitor activates a primary CTA, selects a control example, or
  selects a presented playbook
- **WHEN** the adapter submits the event
- **THEN** it SHALL include the stable event name, experiment identifier, semantic variant, and
  selected item identifier when applicable
