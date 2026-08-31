# image-manifest Specification

## Purpose
Make pod-base image updates legible and prunable. Each published image is recorded in a manifest
(digest, git range it was built from, auto-derived release notes, size, status) so an admin can see
what every image brought, which one is current, and which are safe to delete — replacing the bare
`PODBAY_INCUS_IMAGE_DIGEST` env string that carried no record of contents.

## Requirements

### Requirement: A recorded image describes itself in the owner's terms

An image row SHALL carry a size the UI can render (the provider prints it WITH a unit, which must be
stripped before arithmetic — leaving it in recorded ~3168 bytes and the cockpit showed "0 MB") and
release notes whose empty case states what it MEANS for the owner ("the same software, rebuilt"),
not the tooling's reason ("no image-affecting commits in range"). Every build mints a new digest, so
a no-change rebuild is a normal outcome that the cockpit must be able to explain.

#### Scenario: Size survives recording

- **WHEN** an image reporting `Size: 3168.53MiB` is recorded
- **THEN** the stored byte count SHALL be ~3.32 GB, and the cockpit SHALL render it as such

#### Scenario: A rebuild with no changes

- **WHEN** no image-affecting commit exists between the previous image and this one
- **THEN** the notes SHALL say the pod's software is unchanged, and the cockpit SHALL tell the owner
  that updating gains them nothing rather than showing an empty or cryptic list

### Requirement: The owner sees a user-facing summary first, the commit changelog second

An image row MAY carry a hand-written `summary` — a short "what's new for you" written from the
owner's point of view (an outcome, not a code change). When present, the cockpit's update view SHALL
lead with the `summary` and demote the git-derived commit `notes` to a secondary, collapsed
"technical changes" disclosure. When an image has no `summary` (e.g. recorded before summaries were
adopted), the cockpit SHALL fall back to the parsed commit changelog so nothing is left blank. The
one-line update prompt SHALL likewise prefer the `summary` over the commit-derived line.

#### Scenario: Summary leads, commits are secondary

- **WHEN** an image with a `summary` and commit `notes` is shown in the update view
- **THEN** the `summary` SHALL be the prominent text and the commit `notes` SHALL be presented only
  as a demoted/collapsed "technical changes" list, not as the headline

#### Scenario: No summary falls back to the changelog

- **WHEN** an image without a `summary` is shown
- **THEN** the cockpit SHALL show the parsed commit changelog rather than an empty summary

### Requirement: The derived changelog is cleaned and grouped for owners

The commit-derived changelog is DEVELOPER text and SHALL be cleaned before an owner sees it or it is
published. Commits whose conventional-commit type marks them internal (`chore`, `test`, `ci`, `build`,
`refactor`, `style`, `docs`) SHALL be dropped, and issue/pull-request references SHALL be removed —
they resolve against a private repository, so an owner following one reaches nothing.

Entries SHALL be grouped by what the change means to an owner — New / Fixed / Improved, derived from
the commit type — rather than shown as an undifferentiated list; an entry whose type is unrecognised
SHALL remain ungrouped rather than be guessed into a group. The one-line prompt SHALL state the kinds
of change present rather than only a count.

Cleaning SHALL be applied at generation (so stored and published text is already clean) as well as at
presentation. It is a floor and not the goal: a derived changelog can be no better than the commit
subjects behind it, and a single commit bundling several unrelated changes cannot be split by any
parser — which is why a written release description leads it (see the summary-first requirement).

#### Scenario: Internal churn is not shown to an owner

- **WHEN** a build's range contains chore, test, CI, build, refactor, style or docs commits
- **THEN** those entries SHALL NOT appear in the owner-facing changelog

#### Scenario: A build of only internal churn is not called a rebuild

- **WHEN** every commit in a build's range is internal churn
- **THEN** the owner SHALL be told the build contains internal changes only, distinctly from the
  "same software, rebuilt" case — the build genuinely differs, there is simply nothing to act on

#### Scenario: Private references never reach an owner

- **WHEN** a commit subject carries an issue or pull-request reference
- **THEN** it SHALL NOT appear in the owner-facing changelog or in published release text

#### Scenario: Changes are grouped by meaning

- **WHEN** an owner views a build's changelog
- **THEN** entries SHALL be grouped New / Fixed / Improved, with unrecognised entries ungrouped

### Requirement: Each published image is recorded with a git-derived changelog
The system SHALL record one manifest row per published pod-base image, keyed by its image digest,
capturing the git commit range it was built from (`fromSha..toSha`) and release `notes` auto-derived
from that range's commit messages, plus the incus alias, size, and build time. The `env` field SHALL
default to `pod-base` (the current monolith) so the manifest generalizes to per-env images later.

#### Scenario: Recording a newly built image
- **WHEN** an image is recorded with a digest, its `toSha` (the git HEAD it was built from), and notes
- **THEN** a manifest row SHALL be stored with those fields and a `recordedAt` timestamp
- **AND** the row's `fromSha` SHALL be the previous current image's `toSha` when one exists

#### Scenario: Notes are derived where git lives, written where the DB lives
- **WHEN** the record request is submitted through the admin-authenticated path
- **THEN** the release notes SHALL be the commit summaries of `fromSha..toSha` (computed by the caller,
  which has the git checkout) and the row SHALL be persisted by the server (which has the database)

### Requirement: A recorded image may carry a release version, additive to its digest

A manifest row MAY carry a release version label. The canonical 64-char digest SHALL remain the
image's identity for every decision about what boots or what is compared — the launch alias, the
pinned digest, digest normalization, and prune protection. The version SHALL affect presentation
only, SHALL be stored per row, and SHALL be optional: a row without one is valid and renders with the
existing digest-and-date presentation (every pre-versioning row is in this state, so it is the common
path, not an edge case). Version is stored per row rather than derived so a re-promoted (rolled-back)
image shows its OWN earlier version rather than the newest ever recorded.

#### Scenario: A row without a version stays valid

- **WHEN** a manifest row has no version
- **THEN** it SHALL remain valid and SHALL render with the existing digest-and-date presentation

#### Scenario: Recording accepts a version, or inherits the current one

- **WHEN** an image is recorded (or re-recorded) with a version supplied
- **THEN** the version SHALL be stored on that row (the release-cutting path)

#### Scenario: A build with no version inherits the current version

- **WHEN** a promoting build is recorded with NO version and a current image already carries one
- **THEN** the new row SHALL inherit that current version and SHALL NOT advance it — an ad-hoc rebuild
  (a CLI-pin bump, a hotfix build) shows the live version, not a bare digest (release-versioning);
  advancing the version is the deliberate, separate release-cutting step
- **WHEN** no version is supplied and there is no current version to inherit (a pre-versioning fleet)
- **THEN** the row SHALL keep a null version and render with the existing digest-and-date presentation

#### Scenario: A partial re-record preserves fields it does not supply

- **WHEN** an already-recorded image is re-recorded with only some fields (e.g. attaching just a
  version)
- **THEN** the fields the caller did NOT supply — summary, build time, size, alias, changelog — SHALL
  retain their stored values rather than being cleared, so a partial update never destroys the rest of
  the row
- **AND** a field arriving as `null` because the caller omitted it (the record API coerces every
  omitted field to `null`) SHALL be treated as NOT supplied — never as an instruction to clear the
  stored value — so cutting a release (which sends only the digest + version) preserves the whole row

#### Scenario: Version never displaces the digest as identity

- **WHEN** an image carries a version
- **THEN** pinning, promotion, comparison and prune protection SHALL continue to use the canonical
  digest, and the version SHALL affect presentation only

#### Scenario: The version is shown WITH the digest, never instead of it

- **WHEN** a build's identity is shown to an owner or an admin (the cockpit's up-to-date line, the
  update dialog, the bulk-update dialog, the admin image and pod views)
- **THEN** the version SHALL be shown together with the short digest (e.g. `v0.4.2 (a1b2c3)`), and the
  digest SHALL NOT be dropped — a version is not unique per build, so the digest remains needed to
  disambiguate two builds that share a version

### Requirement: Canonical digest form

An image digest SHALL be stored and compared in ONE canonical form: the full 64-character
lowercase-hex fingerprint (no `sha256:` prefix, never a truncated prefix). The manifest is the source
of truth for digests, so recording SHALL reject a digest that is not a full fingerprint. The pod-base
pin (`PODBAY_INCUS_IMAGE_DIGEST`) SHALL likewise be the full fingerprint, because the provider echoes
the pin as each pod's recorded `image_digest`; a short pin would store short digests that cannot be
compared against the full manifest form. Because history may still hold mixed forms, any digest
COMPARISON SHALL normalize to a common form rather than compare raw strings, so a lingering
short/full mismatch never yields a false "up to date" or false "update available".

#### Scenario: Recording rejects a non-canonical digest

- **WHEN** an image is recorded with a digest that is not a full 64-char lowercase-hex fingerprint
- **THEN** the recording SHALL be refused rather than storing a short or prefixed digest

#### Scenario: Comparison tolerates legacy mixed forms

- **WHEN** a pod's stored digest and the current pin are compared and one is a short prefix of the other
- **THEN** they SHALL be treated as equal (normalized comparison), never as a spurious difference

### Requirement: Exactly one image is current; recording promotes
Recording a new image SHALL mark it `current` and demote the previously-current image to `superseded`,
so at most one manifest row per `env` is `current` at a time. The current image's digest is the one
pods launch from.

#### Scenario: Promotion on record
- **WHEN** a new image is recorded while another is `current`
- **THEN** the new row SHALL become `current` and the prior `current` row SHALL become `superseded`

#### Scenario: Rollback marks status
- **WHEN** a previously-superseded image is re-promoted (rollback)
- **THEN** it SHALL become `current`, the displaced image SHALL be marked `rolled-back`, and both
  transitions SHALL be visible in the history

#### Scenario: Historical backfill does not promote
- **WHEN** a pre-manifest image is recorded with `promote: false` (backfill)
- **THEN** it SHALL be stored as `superseded` and the existing `current` image SHALL be unchanged,
  and no prune SHALL run

### Requirement: Admins can view the image history
The system SHALL expose an admin-only view listing all recorded images newest-first with digest,
alias, built-at, status, size, and notes, so image updates are auditable and reversible.

#### Scenario: History is admin-gated
- **WHEN** a non-admin requests the image history
- **THEN** access SHALL be denied

#### Scenario: History shows the changelog
- **WHEN** an admin opens the image history
- **THEN** each image SHALL show its digest, status (current/superseded/rolled-back), build time, and
  its release notes

### Requirement: Prune old images safely
The system SHALL prune published images from the image store beyond a retention count, but SHALL
NEVER delete the `current` image nor any image still referenced by a live pod (a pod whose
`imageDigest` equals it). Retention keeps the most recent N images (default 5) plus those two
protected classes. N is sized to the build host, not to taste: a pod-base image is ~2.6GB, so a
20-deep store is ~52GB on a 79GB disk shared with the build cache and live pod volumes — the store
must not be able to fill the host it builds on. The MANIFEST rows are the durable history and SHALL be retained even for pruned
images (so the changelog outlives the image store); prune frees disk, not history.

#### Scenario: Prune respects protection
- **WHEN** prune runs with more than N images present
- **THEN** it SHALL delete from the image store only images that are neither current, nor referenced
  by any pod, nor within the newest N — and SHALL leave the manifest rows intact

#### Scenario: A referenced old image is kept
- **WHEN** an image older than the retention window is still a live pod's `imageDigest`
- **THEN** prune SHALL NOT delete it

#### Scenario: Recording auto-prunes
- **WHEN** a new image is recorded
- **THEN** prune SHALL run afterward with the new image protected, keeping the image store tidy
