# dashboard-redesign Specification

## Purpose
The dashboard's shell and pod presentation: a persistent sidebar with a bottom user menu, pods
rendered as a single-column list of full-width row cards, and inline-renamable pod names. Pod cards
expose the highest-value action inline (open, resume, or finish setup) and link to the pod's cockpit
for the full set of controls; launching a new environment lives on a dedicated environments page.
## Requirements
### Requirement: The dashboard uses a sidebar shell with a bottom user menu

The dashboard SHALL present a persistent sidebar with a clickable logo (→ `/dashboard`), primary
nav, and a user menu pinned to the bottom that holds Sign out. There is no account-level login
management here — agent logins live per pod on each pod's own volume.

#### Scenario: User menu holds the sign-out action

- **WHEN** the user opens the bottom user menu
- **THEN** it shows a Sign out action (not in the top-right or a page footer) and no account-level
  login management

### Requirement: Pods render as a single-column list of row cards

Pods SHALL render as a single-column list of full-width row cards. Each card SHALL reflow within
itself to the viewport (a horizontal row on wider widths, stacking vertically on mobile) with no
horizontal overflow and no button wrapping.

#### Scenario: Cards reflow on mobile

- **WHEN** the dashboard is viewed at a mobile width
- **THEN** each card's contents stack vertically and no controls overflow or wrap awkwardly

#### Scenario: Card exposes a primary action and links to the cockpit

- **WHEN** a pod card renders
- **THEN** it shows the highest-value primary action for the pod's state (Open in Claude when
  running, Resume when suspended, Finish setup while onboarding), an optional Preview link, and the
  whole card links to the pod's cockpit where the full controls (Suspend, Resize, Delete) live. The
  card-level cockpit link SHALL be separate from its action buttons so keyboard and
  assistive-technology users do not encounter nested links.

### Requirement: A pod has an editable name

A pod SHALL have an optional name (falling back to its slug) that the owner can rename inline.

#### Scenario: Rename persists

- **WHEN** the owner renames a pod on its card
- **THEN** the new name persists and is shown on reload; clearing it falls back to the slug

#### Scenario: Rename is owner-scoped

- **WHEN** a non-owner attempts to rename a pod
- **THEN** the operation is rejected

### Requirement: The dashboard routes to a dedicated environments page to launch

The dashboard SHALL NOT embed the environment gallery. Instead it SHALL offer a launch entry point
(a "New pod" action, and a "Create your first pod" call-to-action in the empty state) that routes
to the dedicated environments page (`/dashboard/environments`), which hosts the gallery of
launchable environments.

#### Scenario: Empty state offers a single launch CTA

- **WHEN** the user has zero pods
- **THEN** the dashboard shows a "No pods yet" box with exactly one "Create your first pod" CTA
  that routes to `/dashboard/environments`

#### Scenario: Launch entry point is present with pods too

- **WHEN** the user has one or more pods
- **THEN** the dashboard still offers a "New pod" action that routes to the environments page

### Requirement: Pod cards show a live status dot

Each pod card SHALL show a live status dot reflecting the pod's status (running, suspended,
building, and so on). It does not render a mini-terminal-preview slot or a separate agent-state dot.

#### Scenario: Card shows a status indicator

- **WHEN** a pod card renders
- **THEN** it shows a status dot whose colour reflects the pod's current status
