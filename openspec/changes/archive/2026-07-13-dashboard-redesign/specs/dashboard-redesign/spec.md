## ADDED Requirements

### Requirement: The dashboard uses a sidebar shell with a bottom user menu

The dashboard SHALL present a persistent sidebar with a clickable logo (→ `/dashboard`), primary
nav, and a user menu pinned to the bottom that holds Saved logins and Sign out.

#### Scenario: User menu holds account actions

- **WHEN** the user opens the bottom user menu
- **THEN** it shows Saved logins and a Sign out action (not in the top-right or a page footer)

### Requirement: Pods render as a responsive card grid

Pods SHALL render as cards in a grid that reflows to the viewport, one column on mobile, with no
horizontal overflow and no button wrapping.

#### Scenario: Cards reflow on mobile

- **WHEN** the dashboard is viewed at a mobile width
- **THEN** the cards stack in a single column and no controls overflow or wrap awkwardly

#### Scenario: Card exposes a primary action and an overflow menu

- **WHEN** a pod card renders
- **THEN** it shows a primary action (Open when running, Wake when sleeping) and a `⋯` menu with
  Sleep/Wake, Preview + public toggle, and Delete

### Requirement: A pod has an editable name

A pod SHALL have an optional name (falling back to its slug) that the owner can rename inline.

#### Scenario: Rename persists

- **WHEN** the owner renames a pod on its card
- **THEN** the new name persists and is shown on reload; clearing it falls back to the slug

#### Scenario: Rename is owner-scoped

- **WHEN** a non-owner attempts to rename a pod
- **THEN** the operation is rejected

### Requirement: The dashboard surfaces an environment gallery

The dashboard SHALL show a gallery of launchable environments (tiles from the catalog) that
doubles as the empty state, so zero pods never renders an empty page.

#### Scenario: Empty state is the gallery plus one CTA

- **WHEN** the user has zero pods
- **THEN** the environment gallery is shown with exactly one launch call-to-action (no duplicate)

#### Scenario: Gallery is present with pods too

- **WHEN** the user has one or more pods
- **THEN** the environment gallery still offers launching a new environment

### Requirement: Pod cards reserve mission-control slots

Each pod card SHALL reserve a mini-terminal-preview slot and an agent-state dot, rendered as
static placeholders in this change (live data is delivered by the `pod-peek` change).

#### Scenario: Card shows an agent-state indicator

- **WHEN** a pod card renders
- **THEN** it shows an agent-state dot and a preview slot placeholder (env icon)
