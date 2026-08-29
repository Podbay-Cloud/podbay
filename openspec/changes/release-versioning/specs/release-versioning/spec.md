## ADDED Requirements

### Requirement: A release has a semantic version that owners can name

Podbay SHALL identify what an owner runs by a semantic version (`MAJOR.MINOR.PATCH`), beginning at
`0.1.0`. The version SHALL be presented alongside — never instead of — the build digest, because a
version is not unique per build (see the rebuild scenario) and support must still be able to
disambiguate two builds carrying the same version.

#### Scenario: An owner can name what they are running

- **WHEN** an owner looks at a pod that is up to date
- **THEN** the cockpit SHALL show the version and the short digest together (e.g. `Up to date · v0.4.2
  (a1b2c3)`), rather than a digest alone

#### Scenario: A build that is not a release inherits the current version

- **WHEN** a pod image is built without cutting a release (an ad-hoc rebuild or a hotfix build)
- **THEN** the image SHALL be recorded with a new digest and the CURRENT version, and SHALL NOT
  advance the version — a version that churned on every rebuild would carry less meaning than the
  digest it is meant to make readable

#### Scenario: An unversioned build predates versioning

- **WHEN** an image was recorded before versions existed (no version stored)
- **THEN** the UI SHALL fall back to the digest presentation and SHALL NOT invent, derive, or infer a
  version for it

### Requirement: A release is described for owners, and the description reaches both editions

Each release SHALL carry a human-written description of what changed for an owner. That description
SHALL be the text an owner sees when deciding whether to take an update, in BOTH the cloud and
self-host editions, and SHALL lead the auto-derived commit changelog rather than replace it.

#### Scenario: The release description is what the update prompt shows

- **WHEN** an update is available and the target build belongs to a release
- **THEN** the update prompt and dialog SHALL lead with the release description, with the commit-derived
  changelog available but demoted

#### Scenario: A self-host install sees the description, not just digests

- **WHEN** a self-host owner is offered an update
- **THEN** they SHALL see the release version and description for the build they would move to —
  obtained from a published static release manifest, without contacting the Podbay cloud service

#### Scenario: The release manifest is unreachable

- **WHEN** a self-host install cannot fetch the published release manifest (offline, air-gapped, or
  the fetch fails)
- **THEN** it SHALL degrade to the from→to digest presentation and SHALL still allow the update —
  update availability SHALL NOT depend on reaching a network service

#### Scenario: A description is not invented when absent

- **WHEN** a build has no release description
- **THEN** the auto-derived changelog SHALL be shown instead, including its honest empty case ("the
  same software, rebuilt"), and no placeholder description SHALL be synthesised

### Requirement: A release is tagged on both the private repo and the public mirror

Cutting a release SHALL create the tag and published release notes on the private repository AND on
the public mirror. Because the mirror is a squashed one-way export, tags SHALL be created against the
mirror's own history rather than assumed to transfer.

#### Scenario: Release notes are published to both repositories

- **WHEN** a release is cut
- **THEN** a version tag and release notes SHALL exist on both the private repo and the public mirror

#### Scenario: Notes published publicly respect the mirror's exclusions

- **WHEN** release notes are derived from commit subjects and published to the public mirror
- **THEN** entries referring to paths the mirror deliberately excludes SHALL NOT be published, so the
  public changelog cannot describe private tooling that the public repository does not contain

### Requirement: Release notes are written for owners, not derived from commit subjects

Release notes SHALL describe what is different for the owner. The written release description SHALL be
the primary text; the commit-derived changelog SHALL be provenance shown beneath it, never the primary
text for a build that belongs to a release.

Derived entries SHALL be cleaned before they are stored or published: commits whose type marks them as
internal churn (`chore`, `test`, `ci`, `build`, `refactor`, `style`, `docs`) SHALL be dropped, and
issue/PR references SHALL be removed — they resolve against a PRIVATE repository, so an owner who
follows one reaches nothing.

Entries SHALL be grouped by what the change means to an owner (New / Fixed / Improved) rather than
presented as an undifferentiated list, and an entry whose type is unrecognised SHALL remain ungrouped
rather than be guessed into a group.

Cleaning is a floor, not the goal: a derived changelog can only be as good as the commit subjects it
came from, and a single commit carrying several unrelated changes cannot be split by any parser
(observed 2026-08-29). That is precisely why the description is authored.

#### Scenario: Internal churn never reaches an owner

- **WHEN** a build's commit range contains chore, test, CI, build, refactor, style or docs commits
- **THEN** those entries SHALL NOT appear in the owner-facing changelog

#### Scenario: A build containing only internal churn is reported honestly

- **WHEN** every commit in a build's range is internal churn
- **THEN** the owner SHALL be told the build contains internal changes only, and it SHALL NOT be
  described as an unchanged rebuild — the build genuinely differs, there is simply nothing to act on

#### Scenario: Changes are grouped by meaning

- **WHEN** an owner views the changelog for a build
- **THEN** entries SHALL be grouped as New / Fixed / Improved, and the one-line prompt SHALL state the
  kinds of change present rather than only a count

#### Scenario: Private references are not published

- **WHEN** a commit subject contains an issue or pull-request reference
- **THEN** that reference SHALL NOT appear in the owner-facing changelog or the published release
  manifest
