## MODIFIED Requirements

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
