## MODIFIED Requirements

### Requirement: Stable landing experiment assignment
The system SHALL assign each eligible visitor to exactly one semantic landing variant for the
active `landing-positioning-2026-08-agent-home` experiment and SHALL persist that assignment across
visits in a new experiment-specific cookie. Assignment SHALL occur before rendering, SHALL NOT
redirect the visitor, and SHALL NOT produce a client-render content swap. July assignment data and
cookies SHALL remain historically distinct.

#### Scenario: New eligible visitor opens the landing page
- **GIVEN** a signed-out human visitor has no assignment for the active August experiment
- **WHEN** the visitor requests `/`
- **THEN** the system SHALL assign `outcomes`, `agent-computer`, or `agent-home` using the configured
  approximately equal allocation, persist that assignment, and render according to the configured
  validation or measured delivery mode

#### Scenario: Assigned visitor returns
- **GIVEN** a visitor has a valid August assignment
- **WHEN** the visitor requests `/` again
- **THEN** the system SHALL retain the same semantic assignment without reassigning the visitor

#### Scenario: July visitor enters the August experiment
- **GIVEN** a visitor has a valid July assignment but no August assignment
- **WHEN** the visitor requests `/` after August enrollment begins
- **THEN** the system SHALL create an independent August assignment and SHALL NOT rewrite or reuse
  the July variant as August data

#### Scenario: Assignment format is invalid
- **GIVEN** a visitor presents a missing, expired, or unrecognized August assignment
- **WHEN** the visitor requests `/`
- **THEN** the system SHALL create a valid current assignment without failing the landing request

### Requirement: Semantic forced-preview routes
The system SHALL expose `/preview/landing/outcomes`, `/preview/landing/agent-computer`, and
`/preview/landing/agent-home` as deterministic review surfaces. Preview requests SHALL NOT create or
mutate assignment cookies and SHALL NOT emit experiment events.

#### Scenario: Reviewer opens a forced preview
- **GIVEN** a reviewer requests one of the three semantic preview routes
- **WHEN** the route renders
- **THEN** the requested variant SHALL render regardless of any existing experiment assignment
  without changing that assignment or recording a primary CTA event

#### Scenario: Search crawler sees a preview route
- **GIVEN** a crawler requests a forced-preview route
- **WHEN** metadata is returned
- **THEN** the route SHALL be marked `noindex` and SHALL declare `/` as its canonical URL

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
- **THEN** existing admin access control SHALL deny access without exposing experiment data

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
- **THEN** events SHALL omit or mask anonymous identifiers, raw IP addresses, and arbitrary payloads
  while retaining time, variant, event type, bounded item, and attribution state

### Requirement: Guarded and audited admin controls
Experiment definitions SHALL be read-only in the admin dashboard. Confirmed Stop and Pin actions
SHALL be available only for the active definition, SHALL validate against that definition's
declared variants, and SHALL write the administrator, action, prior state, resulting state, and
timestamp to an immutable audit record.

#### Scenario: Administrator stops the active experiment
- **GIVEN** an authorized administrator is viewing the active experiment
- **WHEN** the administrator confirms Stop
- **THEN** new enrollment SHALL cease, the fallback or existing pin SHALL become canonical, and an
  audit record SHALL be written

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

