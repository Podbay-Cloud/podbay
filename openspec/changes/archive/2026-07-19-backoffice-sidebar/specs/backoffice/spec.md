## ADDED Requirements

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
