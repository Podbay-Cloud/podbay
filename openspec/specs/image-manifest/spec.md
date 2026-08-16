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
