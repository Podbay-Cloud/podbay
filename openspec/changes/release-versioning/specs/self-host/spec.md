## MODIFIED Requirements

### Requirement: Self-host presents build identity for updates

A self-host install SHALL tell the owner what an available update contains. When a published release
manifest is reachable, the UI SHALL present the release version and description for the build being
offered. When it is not reachable, the UI SHALL present the concrete from→to build digests, which
remains the honest fallback.

This replaces the previous behaviour of presenting digests as the ONLY update information. Digests are
unorderable by eye — an owner cannot tell from two hex strings which is newer, or whether the update
is a security fix or a rebuild — so digests alone are a floor, not the intended experience.

#### Scenario: An update is described by its release

- **WHEN** a self-host owner is offered an update and the release manifest is reachable
- **THEN** the version and description of the target build SHALL be shown

#### Scenario: The manifest is unreachable

- **WHEN** the release manifest cannot be fetched
- **THEN** the from→to build digests SHALL be shown instead and the update SHALL remain available —
  self-host SHALL NOT require any network service to update

#### Scenario: Self-host does not phone home to obtain release information

- **WHEN** a self-host install obtains release information
- **THEN** it SHALL do so from a published public artifact and SHALL NOT contact the Podbay cloud
  service, so an install remains independent of the hosted product
