## ADDED Requirements

### Requirement: Stable landing experiment assignment
The system SHALL assign each eligible visitor to exactly one semantic landing variant for the
`landing-positioning-2026-07` experiment and SHALL persist that assignment across visits.
Assignment SHALL occur before rendering, SHALL NOT redirect the visitor, and SHALL NOT produce a
client-render content swap.

#### Scenario: New eligible visitor opens the landing page
- **GIVEN** a signed-out human visitor has no assignment for the active landing experiment
- **WHEN** the visitor requests `/`
- **THEN** the system SHALL assign either `outcomes` or `agent-computer` using the configured equal
  allocation, persist the assignment in a first-party cookie, and render the assigned variant in
  the initial response

#### Scenario: Assigned visitor returns
- **GIVEN** a visitor has a valid assignment for the active landing experiment
- **WHEN** the visitor requests `/` again
- **THEN** the system SHALL render the same variant without reassigning the visitor

#### Scenario: Assignment format is invalid
- **GIVEN** a visitor presents a missing, expired, or unrecognized assignment
- **WHEN** the visitor requests `/`
- **THEN** the system SHALL create a valid current assignment without failing the landing request

### Requirement: Experiment eligibility and isolation
The system SHALL exclude forced-preview requests and recognized automated crawlers from experiment
measurement. Authenticated visitors MAY receive a landing variant, but their visits SHALL be
distinguishable from acquisition traffic and excluded from the primary signed-out analysis.

#### Scenario: Automated crawler requests the canonical landing
- **GIVEN** the request is recognized as an automated crawler
- **WHEN** it requests `/`
- **THEN** the system SHALL render the configured canonical variant without creating a measured
  experiment participant

#### Scenario: Authenticated user opens the landing
- **GIVEN** the visitor is already authenticated
- **WHEN** the visitor requests `/`
- **THEN** the rendered CTA SHALL lead to the dashboard and any exposure SHALL be marked ineligible
  for primary acquisition analysis

### Requirement: Semantic forced-preview routes
The system SHALL expose `/preview/landing/outcomes` and
`/preview/landing/agent-computer` as deterministic review surfaces. Preview requests SHALL NOT
create or mutate assignment cookies and SHALL NOT emit experiment events.

#### Scenario: Reviewer opens a forced preview
- **GIVEN** a reviewer requests one of the semantic preview routes
- **WHEN** the route renders
- **THEN** the requested variant SHALL render regardless of any existing experiment assignment
  without changing that assignment

#### Scenario: Search crawler sees a preview route
- **GIVEN** a crawler requests a forced-preview route
- **WHEN** metadata is returned
- **THEN** the route SHALL be marked `noindex` and SHALL declare `/` as its canonical URL

### Requirement: Durable experiment event recording
The system SHALL provide a same-origin ingestion path that durably records eligible experiment
events with experiment identifier, variant, opaque anonymous visitor identifier, event name, event
time, and available campaign attribution. Event delivery failures SHALL NOT block navigation,
authentication, or product actions.

#### Scenario: Assigned landing finishes loading
- **GIVEN** an eligible assigned visitor receives a landing variant
- **WHEN** the page becomes viewable
- **THEN** the client SHALL submit one deduplicated `landing_exposure` event for that visitor and
  experiment assignment

#### Scenario: Visitor activates the primary CTA
- **GIVEN** an eligible assigned visitor is viewing the landing
- **WHEN** the visitor activates the primary CTA
- **THEN** the system SHALL attempt to record `landing_primary_cta` with the current experiment and
  variant before or concurrently with navigation

#### Scenario: Event ingestion is unavailable
- **GIVEN** the experiment event endpoint fails or cannot be reached
- **WHEN** an instrumented interaction occurs
- **THEN** the requested user action SHALL still complete normally

### Requirement: Anonymous-to-user attribution
The system SHALL preserve an eligible visitor's experiment attribution through authentication and
SHALL associate subsequent activation events with both the original assignment and the
authenticated user without changing the assigned variant.

#### Scenario: Assigned visitor completes sign-in
- **GIVEN** an eligible assigned visitor starts authentication from the landing page
- **WHEN** authentication completes successfully
- **THEN** the system SHALL record `signin_completed` for the original experiment assignment and
  associate the anonymous visitor identifier with the authenticated user

#### Scenario: Attributed user activates a pod
- **GIVEN** an authenticated user has landing experiment attribution
- **WHEN** the user creates a pod, connects its agent, or first opens its project
- **THEN** the system SHALL record the corresponding `pod_created`, `agent_connected`, or
  `first_project_opened` event against that attribution

### Requirement: Privacy-minimal experiment data
Landing experiment attribution SHALL use opaque identifiers, SHALL NOT require raw IP storage, and
SHALL accept only allowlisted experiment identifiers, variants, and event names.

#### Scenario: Event contains unrecognized values
- **GIVEN** a client submits an unknown experiment, variant, or event name
- **WHEN** the ingestion endpoint validates the payload
- **THEN** the system SHALL reject or ignore the event without persisting arbitrary client data

#### Scenario: Event is accepted
- **GIVEN** a valid event is submitted
- **WHEN** it is persisted
- **THEN** the stored record SHALL omit raw IP address and arbitrary free-form metadata

### Requirement: Experiment operational controls
The experiment SHALL define its identifier, enabled state, allocation, canonical crawler variant,
analysis window, and metric definitions in server-controlled configuration. Runtime state SHALL
allow an authorized administrator to stop assignment or pin one configured variant without editing
the immutable experiment definition. Changing allocation, variants, metrics, or the tested
narrative after measurement begins SHALL require a new experiment identifier.

#### Scenario: Experiment is disabled
- **GIVEN** an authorized administrator stops the landing experiment
- **WHEN** a visitor requests `/`
- **THEN** the pinned or configured fallback variant SHALL render without enrolling a new
  participant and existing measurements SHALL remain available

#### Scenario: Administrator pins a variant
- **GIVEN** the experiment is stopped and an authorized administrator selects a configured variant
- **WHEN** the administrator confirms the pin action
- **THEN** `/` SHALL render that variant for unassigned visitors without new enrollment and the
  system SHALL preserve existing assignments and measurements

#### Scenario: Variant changes materially
- **GIVEN** headline, narrative, offer, or visual proof changes after measurement begins
- **WHEN** operators publish that change as a new test
- **THEN** the system SHALL use a new experiment identifier so old and new observations are not
  combined

### Requirement: Admin experiment overview
The admin dashboard SHALL expose an experiments overview restricted by the existing admin access
control. It SHALL show active, stopped, and completed experiments with status, configured
allocation, runtime pin, start/stop times, eligible visitor count, exposure count, and the declared
primary metric.

#### Scenario: Administrator opens the experiments overview
- **GIVEN** an authorized administrator is signed in
- **WHEN** the administrator opens `/admin/experiments`
- **THEN** the page SHALL list every known experiment with its immutable definition, runtime state,
  sample size, and primary outcome summary

#### Scenario: Non-administrator requests experiment administration
- **GIVEN** a signed-out or non-admin visitor
- **WHEN** the visitor requests an experiment admin route or action
- **THEN** the existing admin access control SHALL deny access without exposing experiment data

### Requirement: Admin experiment detail and funnel
The admin dashboard SHALL expose a detail view for each experiment with per-variant counts and
conversion rates for eligible exposure, primary CTA, completed sign-in, pod creation, agent
connection, and first project open. It SHALL also show bounded referrer/UTM breakdowns, assignment
balance, duplicate/exclusion health, ingestion failures, rejected-event counts, and a sanitized
recent event stream.

#### Scenario: Administrator evaluates variant performance
- **GIVEN** an authorized administrator opens an experiment detail page
- **WHEN** experiment data exists
- **THEN** the page SHALL show raw denominators and numerators beside rates for every funnel stage
  and SHALL NOT declare a winner solely from click-through rate

#### Scenario: Experiment has little or no data
- **GIVEN** the experiment has no events or an insufficient sample
- **WHEN** the detail page renders
- **THEN** it SHALL show an explicit low-data state without fabricated rates, significance, or
  winner language

#### Scenario: Administrator inspects recent events
- **GIVEN** experiment events have been recorded
- **WHEN** the administrator views the sanitized event stream
- **THEN** events SHALL omit or mask anonymous visitor identifiers, raw IP addresses, and arbitrary
  payloads while retaining time, variant, event type, bounded item, and attribution state

### Requirement: Guarded and audited admin controls
Experiment configuration SHALL be read-only in the admin dashboard except for confirmed Stop and
Pin variant actions. Every successful action SHALL record the administrator, action, prior runtime
state, resulting runtime state, and timestamp in an immutable audit record.

#### Scenario: Administrator stops an active experiment
- **GIVEN** an authorized administrator is viewing an active experiment
- **WHEN** the administrator confirms Stop
- **THEN** new enrollment SHALL cease, the fallback or existing pin SHALL become the canonical
  runtime variant, and an audit record SHALL be written

#### Scenario: Administrator attempts to pin an invalid variant
- **GIVEN** an authorized administrator submits a variant not declared by the immutable experiment
  definition
- **WHEN** the server validates the action
- **THEN** the action SHALL be rejected without changing runtime state or writing a success audit
  record

#### Scenario: Administrator views the audit trail
- **GIVEN** experiment control actions have occurred
- **WHEN** the administrator opens the experiment detail
- **THEN** the page SHALL show the chronological action, actor, prior state, resulting state, and
  timestamp
