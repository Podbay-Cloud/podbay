## ADDED Requirements

### Requirement: A recorded image may carry a release version, additive to its digest

A manifest row MAY carry a release version. The canonical 64-char digest SHALL remain the image's
identity for every purpose that decides what boots or what is compared — the launch alias, the pinned
digest, digest normalization, and prune protection. A version SHALL be a label for humans, stored per
row, and SHALL NOT participate in any identity or comparison decision.

Version is stored ON THE ROW rather than derived at read time specifically so that rollback is
correct: re-promoting a superseded image must display that image's own (lower) version, which a
version derived from the current HEAD or newest tag could never do.

#### Scenario: Version never displaces the digest as identity

- **WHEN** an image carries a version
- **THEN** pinning, promotion, comparison and prune protection SHALL continue to use the canonical
  digest, and the version SHALL affect presentation only

#### Scenario: Rolling back shows the version going backwards

- **WHEN** an operator re-promotes a previously superseded image that carries an earlier version
- **THEN** the owner-facing version SHALL show that earlier version, reflecting what is actually
  running rather than the newest version ever recorded

#### Scenario: Rows recorded before versioning stay valid

- **WHEN** a manifest row has no version
- **THEN** it SHALL remain valid and SHALL render with the existing digest-and-date presentation

## MODIFIED Requirements

### Requirement: The owner sees a user-facing summary first, the commit changelog second

The update view SHALL lead with the user-facing summary and demote the git-derived `notes` to a
collapsed "technical changes" section; when no summary exists it SHALL fall back to the parsed
changelog so the view is never blank, and the one-line prompt SHALL likewise prefer the summary.

The summary SHALL be sourced from the release description when the build belongs to a release. The
`notes` SHALL remain auto-derived from the commit range and SHALL NOT be replaceable by hand-written
text — they are the honesty layer that reports a no-change rebuild as such, and a written description
may only lead them.

Re-recording an image that is already recorded SHALL NOT recompute its changelog from an empty commit
range. Doing so produced notes that claimed "the same software, rebuilt" for a build that did change
what pods run (observed 2026-08-29 while adding a missing summary), which is precisely the false
statement the honest-empty-case rule exists to prevent.

#### Scenario: A release description leads the update view

- **WHEN** an image belonging to a release is offered as an update
- **THEN** the view SHALL lead with the release description and demote the commit changelog

#### Scenario: Re-recording preserves the original changelog

- **WHEN** an already-recorded image is recorded again (for example to attach a description that was
  missing)
- **THEN** its previously derived changelog SHALL be preserved rather than recomputed against an empty
  range, and the image SHALL NOT be described as an unchanged rebuild
