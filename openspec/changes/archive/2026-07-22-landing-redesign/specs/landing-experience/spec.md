## ADDED Requirements

### Requirement: Outcome-led landing narrative
The landing page SHALL lead with the stable headline "Build the idea. Skip the setup." and SHALL
describe Podbay for people building with Claude or Codex in outcome language before introducing
workspace, terminal, infrastructure, or lifecycle details.

#### Scenario: Visitor reads the first viewport
- **GIVEN** the planned pre-alpha capabilities are available
- **WHEN** a visitor opens the landing page
- **THEN** the first viewport SHALL identify the outcome, the removed setup burden, the primary
  access CTA, and representative visual proof without using a terminal as the primary visual

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
The hero SHALL present a deterministic sequence of useful-app, automation, and bot examples while
keeping the headline, supporting copy, layout dimensions, and CTA stable. The sequence SHALL provide
manual selection and SHALL NOT randomize the initial example.

#### Scenario: Automatic example progression
- **GIVEN** motion is allowed and the visitor has not interacted with the example
- **WHEN** the hero remains visible for the configured hold period
- **THEN** the example SHALL progress in a fixed order and its matching outcome visual SHALL appear
  without moving or obscuring surrounding content

#### Scenario: Visitor selects an example
- **GIVEN** the example controls are visible
- **WHEN** the visitor selects the app, automation, or bot control
- **THEN** the chosen copy and matching outcome visual SHALL appear and automatic progression SHALL
  pause

#### Scenario: Example is not a launch input
- **GIVEN** prompt-first project launch is outside this change
- **WHEN** the visitor sees the typed example
- **THEN** it SHALL be presented as an example of directing an agent and SHALL NOT appear to submit
  or launch a project from the landing page

### Requirement: Starter catalog
The landing page SHALL present the six planned demand starters: Telegram bot, AI assistant, SaaS
app, game jam, bring your project, and automation. Each starter SHALL use an outcome-led name and a
concise description of what the visitor can make, without requiring stack or infrastructure
knowledge.

#### Scenario: Visitor evaluates available starting points
- **GIVEN** the six demand starters have passed their pre-alpha kill tests
- **WHEN** the visitor reaches the starter catalog
- **THEN** all six SHALL be scannable and distinguishable by outcome on desktop and mobile

### Requirement: Truthful product proof
Primary landing graphics SHALL use polished conceptual outcome mockups that are visibly framed as
examples rather than customer projects, live product captures, or evidence of shipped capability.
All public claims SHALL match behavior available at release. The page SHALL NOT fabricate customer
proof, usage metrics, always-on behavior, native-app control, or starter availability.

#### Scenario: Conceptual outcome is displayed
- **GIVEN** an illustrative app, automation, or bot mockup is used in the landing hero
- **WHEN** a visitor views the visual
- **THEN** the visual SHALL include a persistent readable cue that it is an example and SHALL NOT
  attribute the outcome to a customer or imply it is a live product capture

#### Scenario: A planned dependency is unavailable
- **GIVEN** a named starter capability or dependency is not available at release
- **WHEN** landing copy and availability language are reviewed
- **THEN** the unavailable claim SHALL be removed or the landing release SHALL remain blocked

### Requirement: Subscription positioning
The landing page SHALL state that users bring their own Claude or Codex subscription and that Podbay
adds no token markup, without implying pooled subscriptions, modified official CLIs, model-auth
proxying, or control over vendor billing.

#### Scenario: Visitor reads subscription differentiation
- **GIVEN** the visitor reaches the differentiation content
- **WHEN** subscription behavior is described
- **THEN** the copy SHALL distinguish the Podbay workspace charge from the user's existing AI
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
The page metadata SHALL use the outcome-led positioning and SHALL describe apps, bots, and
automations without developer-only environment terminology.

#### Scenario: Landing metadata is rendered
- **GIVEN** a crawler or link preview requests the landing page
- **WHEN** title and description metadata are produced
- **THEN** they SHALL identify Podbay, the build outcome, and the reduced setup burden

### Requirement: Landing interaction event contract
The landing experience SHALL expose stable analytics events for primary CTA activation, manual
example selection, and starter selection through an adapter that remains safe when no analytics
backend is configured.

#### Scenario: Analytics backend is absent
- **GIVEN** no landing analytics backend is configured
- **WHEN** a visitor triggers an instrumented interaction
- **THEN** navigation and interaction SHALL complete normally without an error or network request
  requirement

#### Scenario: Instrumented interaction occurs
- **GIVEN** an analytics consumer is configured
- **WHEN** the visitor activates a primary CTA or selects an example or starter
- **THEN** the adapter SHALL receive a stable event name and the selected item identifier
