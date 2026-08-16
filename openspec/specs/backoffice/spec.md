# backoffice Specification

## Purpose
The admin-only backoffice surface: its shared sidebar navigation (reused from the user
dashboard), the menu of admin destinations with active-state, and layout-level admin gating
for every `/admin/*` route. Covers how the backoffice is reached and framed, not the
approve/revoke behavior of individual admin tools (see `access-control`).

## Requirements
### Requirement: An operator may repair, but not replace, a user's files

Doctor from the backoffice SHALL support checking freely and applying SAFE repairs (audited), and
SHALL NOT offer the invasive mode. Replacing a user's environment layer or reinstalling their
dependencies is the owner's decision even though the repair keeps a backup — an operator should be
able to get a pod working again without making choices about the contents of someone's workspace.

#### Scenario: Operator repairs a pod

- **WHEN** an operator runs doctor with safe fixes on a user's pod and something is repaired
- **THEN** the repair SHALL be recorded as a Podbay action visible to the owner

#### Scenario: Invasive repair from the backoffice

- **WHEN** a finding can only be fixed by replacing files
- **THEN** the backoffice SHALL report it and leave the decision to the owner

### Requirement: A pod row is clickable without breaking the table

Every cell of a pod row SHALL link to that pod, so a tap anywhere in the row navigates. The link
SHALL NOT be an overlay stretched across the row: `position: relative` on a table row is not a
reliable containing block, so such an overlay can resolve against an outer element and make ONE row's
link cover the entire table — and it sits above the horizontally-scrolling container, preventing
touch scrolling on a phone (both observed live, 2026-07-29).

Only one link per row SHALL be reachable by keyboard, so a screen-reader or tab user gets one target
per row rather than one per column.

#### Scenario: Tapping a far cell on a phone

- **WHEN** the operator taps a cell at the far end of a row on a narrow screen
- **THEN** that row's pod SHALL open, not another row's

#### Scenario: Scrolling the table on a phone

- **WHEN** the table is wider than the screen
- **THEN** it SHALL scroll horizontally

### Requirement: The pod drill-in is ordered for the operator

The owner's cockpit answers "is my pod working?"; the drill-in answers "why is this user's pod
broken, and what changed?" — the same data, a different spine. It SHALL therefore lead with what is
WRONG (the pod's reported problems, and whether self-repair gave up) and the live per-agent state,
before the record's descriptive rows. Reading the pod's own report SHALL NOT be something the
operator has to infer from the rows below.

#### Scenario: A pod reporting problems

- **WHEN** an operator opens a pod that reports issues
- **THEN** those issues and any give-up state SHALL appear first, above the pod's details

#### Scenario: A healthy pod

- **WHEN** the pod reports nothing wrong
- **THEN** no problems section SHALL be rendered

### Requirement: Drift is reported per KIND, with the remedy that fits it

Ghosts, orphans and duplicates are three different conditions with three different remedies and
SHALL NOT be reported as one. In particular, an ORPHAN has no pod record, so advice to "open the pod"
is unactionable — it is leftover infrastructure on the host. Instances that are deliberately not pods
SHALL be excluded, because a drift banner that never clears is one operators learn to ignore.

#### Scenario: An orphaned instance

- **WHEN** the host runs an instance with no pod record
- **THEN** it SHALL be reported as leftover infrastructure to remove on the host, NOT as a pod to open

#### Scenario: A scratch instance

- **WHEN** an instance follows the documented non-pod naming convention
- **THEN** it SHALL NOT be reported as drift

### Requirement: The fleet says which pod needs attention

The pods view SHALL surface the pods currently reporting problems, worst severity first, above the
full table. The per-pod drill-in can only answer questions about a pod the operator has ALREADY
decided to open; without this, finding a broken pod means clicking through them.

A pod that is running but does not answer SHALL be listed as a problem, not omitted — an unreachable
pod is the state most worth seeing, and silence must never read as health. Informational findings
SHALL be excluded: this view exists to be acted on.

The sweep SHALL be cached briefly, since it reads every running pod, and SHALL NOT take the table
down when it fails.

#### Scenario: Some pods are unhealthy

- **WHEN** pods report problems
- **THEN** they SHALL be listed worst-first with their findings, each linking to its drill-in

#### Scenario: A quiet fleet

- **WHEN** every pod is healthy
- **THEN** the section SHALL be absent — a quiet fleet is the normal case, not a status to display

#### Scenario: A pod stops answering

- **WHEN** a running pod's agent cannot be reached
- **THEN** it SHALL appear as a critical problem rather than being dropped from the sweep

### Requirement: Admin-gated backoffice layout

Every backoffice route under `/admin` SHALL be gated to admins by a shared layout, so that
authentication is enforced once rather than per page. A non-admin who reaches any `/admin/*`
route SHALL be redirected away from the backoffice.

#### Scenario: Non-admin is redirected from any backoffice route

- **WHEN** a signed-in non-admin user opens any `/admin` or `/admin/*` route
- **THEN** they SHALL be redirected out of the backoffice (to the user dashboard)

#### Scenario: Unauthenticated visitor is redirected to sign-in

- **WHEN** an unauthenticated visitor opens any `/admin` route
- **THEN** they SHALL be redirected to sign-in

#### Scenario: Admin reaches the backoffice

- **WHEN** a signed-in admin opens an `/admin` route
- **THEN** the backoffice SHALL render with its shared shell

### Requirement: Shared backoffice navigation shell

The backoffice SHALL render inside a persistent sidebar shell (brand, vertical nav menu,
bottom account menu) that is shared with the user dashboard, so the two surfaces present the
same chrome and rhythm. The shell SHALL persist across backoffice routes without each page
re-rendering it.

#### Scenario: Sidebar persists across backoffice pages

- **WHEN** an admin navigates between backoffice routes
- **THEN** the same sidebar shell SHALL remain and only the page content SHALL change

#### Scenario: Shell is reused, not duplicated

- **WHEN** the shell renders for the backoffice versus the user dashboard
- **THEN** it SHALL be the same component parameterized by its nav menu and home link, not a
  separate copy

### Requirement: Backoffice menu of destinations

The backoffice sidebar SHALL present each backoffice destination as a menu item — at minimum
**Access requests** (`/admin`) and **Fleet** (`/admin/fleet`) — plus a **Back to app** item
returning to the user dashboard. The item matching the current route SHALL be shown as active.

#### Scenario: Menu lists the backoffice destinations

- **WHEN** an admin views any backoffice page
- **THEN** the sidebar SHALL list Access requests, Fleet, and Back to app as menu items

#### Scenario: Current destination is highlighted

- **WHEN** an admin is on the Fleet page
- **THEN** the Fleet menu item SHALL be shown active and Access requests SHALL not

#### Scenario: Index route is matched exactly

- **WHEN** an admin is on `/admin/fleet`
- **THEN** the Access requests item (`/admin`) SHALL NOT be marked active despite the shared
  path prefix

#### Scenario: Return to the user app

- **WHEN** an admin activates the Back to app item
- **THEN** they SHALL be taken to the user dashboard

