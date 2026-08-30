# landing-experimentation Specification

## Purpose
Defines how Podbay runs a measured landing-positioning experiment: assigning each eligible visitor to exactly one semantic variant before render (no redirect, no client swap), excluding previews and crawlers from measurement, and durably recording a privacy-minimal acquisition funnel from exposure through sign-in, pod creation, agent connection, and first project open. It also defines the server-controlled experiment definition, the admin overview/detail surfaces that report per-variant counts and rates, and the guarded, audited Stop/Pin controls used to end or roll back a run.
## Requirements
### Requirement: Stable landing experiment assignment
The system SHALL assign each eligible visitor to exactly one arm of the ACTIVE landing experiment and
SHALL persist that assignment across visits in an experiment-specific cookie. Assignment SHALL occur
before rendering, SHALL NOT redirect the visitor, and SHALL NOT produce a client-render content swap.
Prior experiments' assignment data and cookies SHALL remain historically distinct.

In a `validation` delivery mode the system SHALL RENDER the experiment's `validationVariant` to EVERY
eligible visitor regardless of their assigned arm — the split validates the pipeline without a
content difference (an A/A); only a `measured` mode renders the assigned arm. The active experiment
(2026-08) is `landing-agent-computer-2026-08-real-home-cloud`: a two-arm A/A whose `validationVariant` is
`agent-computer`, so every visitor sees the agent-computer landing; `outcomes` is the second arm, kept
for a future test but never rendered; `agent-home` is retained only for history. The preceding
`landing-agent-computer-2026-08-taxonomy` and `landing-agent-computer-2026-08` definitions SHALL
remain registered as historical so their assignments and events stay queryable.

#### Scenario: New eligible visitor opens the landing page
- **GIVEN** a signed-out human visitor has no assignment for the active experiment
- **WHEN** the visitor requests `/`
- **THEN** the system SHALL assign one of the active experiment's arms using the configured allocation,
  persist that assignment, and — in validation mode — render the `validationVariant` (agent-computer)
  regardless of the assigned arm

#### Scenario: Assigned visitor returns
- **GIVEN** a visitor has a valid active real-home/cloud assignment
- **WHEN** the visitor requests `/` again
- **THEN** the system SHALL retain the same semantic assignment without reassigning the visitor

#### Scenario: Visitor from a preceding experiment enters the active experiment
- **GIVEN** a visitor has a valid assignment for a historical experiment but no active assignment
- **WHEN** the visitor requests `/` after the real-home/cloud experiment begins
- **THEN** the system SHALL create an independent active assignment and SHALL NOT rewrite or reuse
  the historical variant as active experiment data

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
The system SHALL expose `/preview/landing/outcomes`, `/preview/landing/agent-computer`, and
`/preview/landing/agent-home` as deterministic review surfaces. Preview requests SHALL NOT create
or mutate assignment cookies and SHALL NOT emit experiment exposure or interaction events.
`agent-home` SHALL NOT become an assignable variant of `landing-positioning-2026-07` merely by
being available as a preview.

#### Scenario: Reviewer opens a forced preview
- **GIVEN** a reviewer requests one of the semantic preview routes
- **WHEN** the route renders
- **THEN** the requested landing composition SHALL render regardless of any existing experiment
  assignment without changing that assignment

#### Scenario: Reviewer interacts with the agent-home preview
- **GIVEN** a reviewer has a valid assignment cookie from the canonical landing experiment
- **WHEN** they activate a link on `/preview/landing/agent-home`
- **THEN** the requested navigation SHALL occur without recording a landing experiment event

#### Scenario: Search crawler sees a preview route
- **GIVEN** a crawler requests a forced-preview route
- **WHEN** metadata is returned
- **THEN** the route SHALL be marked `noindex` and SHALL declare `/` as its canonical URL

#### Scenario: Canonical visitor is assigned during the current experiment
- **GIVEN** `landing-positioning-2026-07` remains active
- **WHEN** an eligible visitor requests `/`
- **THEN** the system SHALL assign only `outcomes` or `agent-computer` and SHALL NOT assign
  `agent-home`

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
The system SHALL preserve an eligible visitor's active experiment attribution through
authentication and SHALL associate subsequent activation events with both the original assignment
and authenticated user without changing the variant. Historical experiments SHALL remain
queryable, but new downstream product events SHALL attach to the current active experiment only.

#### Scenario: Assigned visitor completes sign-in
- **GIVEN** an eligible August visitor starts authentication from the landing page
- **WHEN** authentication completes successfully
- **THEN** the system SHALL record `signin_completed` for the original August assignment and
  associate the anonymous visitor identifier with the authenticated user

#### Scenario: Attributed user activates a pod
- **GIVEN** an authenticated user has active August landing attribution
- **WHEN** the user creates a pod, connects its agent, or first opens its project
- **THEN** the system SHALL record the corresponding event against the August attribution without
  adding the event to the historical July run

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
Each landing experiment SHALL define its immutable identifier, semantic variant subset, allocation,
delivery mode, validation variant, canonical crawler variant, analysis window, and metric
definitions in a server-controlled registry. Exactly one definition SHALL be active for new public
assignment and event attribution. Runtime state SHALL allow an authorized administrator to stop
the active experiment or pin one of its configured variants. Historical definitions and data SHALL
remain read-only and inspectable.

#### Scenario: August experiment runs validation mode
- **GIVEN** the active definition uses A/A/A validation mode
- **WHEN** new visitors request `/`
- **THEN** middleware SHALL assign approximately 34/33/33 across the three semantic variants while
  root rendering serves the configured validation variant for every assignment

#### Scenario: August experiment runs measured mode
- **GIVEN** the active definition uses measured delivery mode
- **WHEN** an assigned visitor requests `/`
- **THEN** root rendering SHALL serve that visitor's assigned semantic variant

#### Scenario: Administrator stops the active experiment
- **GIVEN** an authorized administrator stops the active landing experiment
- **WHEN** a visitor requests `/`
- **THEN** the pinned or configured fallback variant SHALL render without enrolling a new
  participant and existing measurements SHALL remain available

#### Scenario: Historical experiment is requested
- **GIVEN** the July definition exists in the registry
- **WHEN** an administrator opens its detail page
- **THEN** the July allocation, variants, runtime, events, and audit history SHALL render without
  permitting new mutations

#### Scenario: Variant changes materially
- **GIVEN** headline, narrative, offer, proof, allocation, or variant set changes after August
  measurement begins
- **WHEN** operators publish that change as a new test
- **THEN** the system SHALL use another experiment identifier so observations are not combined

### Requirement: Admin experiment overview
The admin dashboard SHALL expose an experiments overview restricted by existing admin access
control. It SHALL list every registered historical and active experiment with status, configured
allocation, delivery mode, runtime pin, start/stop times, eligible visitor count, exposure count,
declared primary metric, and whether mutation controls are available.

#### Scenario: Administrator opens the experiments overview
- **GIVEN** an authorized administrator is signed in
- **WHEN** the administrator opens `/admin/experiments`
- **THEN** the page SHALL list both July and August definitions with their own immutable metadata
  and measured results

#### Scenario: Non-administrator requests experiment administration
- **GIVEN** a signed-out or non-admin visitor
- **WHEN** the visitor requests an experiment admin route or action
- **THEN** the existing admin access control SHALL deny access without exposing experiment data

### Requirement: Admin experiment detail and funnel
The admin dashboard SHALL expose a definition-driven detail view with preview links and per-variant
counts, rates, and Wilson 95% intervals for eligible exposure, primary CTA, completed sign-in, pod
creation, agent connection, and first project open. It SHALL also show per-variant bounded
referrer/UTM breakdowns, assignment balance against configured allocation, sample progress,
duplicate/exclusion health, ingestion failures, rejected-event counts, and a sanitized recent event
stream. It SHALL describe validation, exploratory, and insufficient-evidence states without
automatically declaring a winner.

#### Scenario: Administrator evaluates three variants
- **GIVEN** an authorized administrator opens the August experiment
- **WHEN** experiment data exists
- **THEN** the page SHALL render all three configured variants, their allocation, preview links,
  raw funnel numerators and denominators, rates, intervals, and sample progress

#### Scenario: Assignment balance is materially unexpected
- **GIVEN** sufficient August assignments exist to evaluate configured allocation
- **WHEN** observed assignment counts differ materially from the declared weights
- **THEN** the detail page SHALL display an assignment-balance warning for instrumentation review

#### Scenario: Experiment has little or validation-only data
- **GIVEN** the experiment has insufficient measured exposure or remains in validation mode
- **WHEN** the detail page renders
- **THEN** it SHALL show an explicit state that prevents interpreting displayed rates as a winner

#### Scenario: Administrator inspects recent events
- **GIVEN** experiment events have been recorded
- **WHEN** the administrator views the sanitized event stream
- **THEN** events SHALL omit or mask anonymous identifiers, raw IP addresses, and arbitrary
  payloads while retaining time, variant, event type, bounded item, and attribution state

### Requirement: Guarded and audited admin controls
Experiment definitions SHALL be read-only in the admin dashboard. Confirmed Stop and Pin actions
SHALL be available only for the active definition, SHALL validate against that definition's
declared variants, and SHALL write the administrator, action, prior state, resulting state, and
timestamp to an immutable audit record.

The self-host homepage promotion SHALL be an independently mutable control in the same admin area,
not a variant added to the active acquisition experiment. It SHALL allow an administrator to show
the self-host landing at `/` or remove that promotion while leaving `/selfhost` available, and both
changes SHALL be audited without altering acquisition assignments or measurements.

Promotion and removal SHALL mutate the runtime state and insert its audit row atomically. A failed
audit write SHALL leave the prior homepage state unchanged. When an anonymous visitor starts sign-in
from the self-host landing, the site SHALL clear active-acquisition attribution cookies before the
sign-in flow so a self-host conversion cannot appear without an acquisition exposure.

#### Scenario: Administrator stops the active experiment
- **GIVEN** an authorized administrator is viewing the active experiment
- **WHEN** the administrator confirms Stop
- **THEN** new enrollment SHALL cease, the fallback or existing pin SHALL become the canonical
  variant, and an audit record SHALL be written

#### Scenario: Administrator attempts to mutate a historical experiment
- **GIVEN** an authorized administrator is viewing the historical July experiment
- **WHEN** the administrator attempts a Stop or Pin action
- **THEN** the server SHALL reject the mutation without changing runtime state or writing a success
  audit record

#### Scenario: Administrator attempts to pin an invalid variant
- **GIVEN** an authorized administrator submits a variant not declared by the active definition
- **WHEN** the server validates the action
- **THEN** the action SHALL be rejected without changing runtime state or writing a success audit
  record

#### Scenario: Administrator promotes the self-host landing
- **GIVEN** the self-host landing is available only at `/selfhost`
- **WHEN** an administrator confirms Show on homepage
- **THEN** `/` SHALL render the self-host landing, the acquisition experiment SHALL remain unchanged,
  and an audit record SHALL identify the administrator and resulting promotion state

#### Scenario: Administrator removes the self-host homepage promotion
- **GIVEN** the self-host landing currently renders at `/`
- **WHEN** an administrator confirms Keep only at `/selfhost`
- **THEN** the acquisition landing SHALL return at `/`, `/selfhost` SHALL remain available, and an
  audit record SHALL identify the administrator and restored state

#### Scenario: Homepage audit write fails
- **GIVEN** the current homepage state is known
- **WHEN** a promotion or removal cannot insert its audit record
- **THEN** the homepage state SHALL remain unchanged and the action SHALL report failure

#### Scenario: Self-host visitor starts sign-in
- **GIVEN** an anonymous visitor is viewing the self-host landing at `/selfhost` or promoted at `/`
- **WHEN** they choose a Podbay access action
- **THEN** active-acquisition visitor and variant cookies SHALL be cleared before `/signin` loads, so
  later sign-in and activation events are not attributed to the acquisition experiment
