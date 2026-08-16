## ADDED Requirements

### Requirement: Environment catalog

The dashboard SHALL list the available first-party environments, reading each environment's
definition and surfacing its display metadata (name, description, tags). Invalid definitions SHALL
be skipped, not crash the catalog.

#### Scenario: Catalog lists valid environments

- **WHEN** the catalog is built from the environments directory
- **THEN** each environment with a valid `podbay.yaml` SHALL appear with its name and description

#### Scenario: Invalid environment is skipped

- **WHEN** a directory has no valid `podbay.yaml`
- **THEN** it SHALL be omitted from the catalog without failing the others

### Requirement: Owner-scoped pod list

The dashboard SHALL show the signed-in user's pods with their status and last-active time, and
SHALL NOT show pods owned by other users.

#### Scenario: Lists only the user's pods

- **WHEN** a signed-in user opens the dashboard
- **THEN** it SHALL display that user's pods (status + last active) and no others

#### Scenario: Unauthenticated visitor is redirected

- **WHEN** an unauthenticated user opens the dashboard
- **THEN** they SHALL be redirected to sign-in

### Requirement: Launch a pod from the launcher

The launcher page (`/new`) SHALL present the catalog with a launch action; on success the pod
SHALL be provisioned and persisted to the user, and the user SHALL be taken to that pod's
workspace. The launcher SHALL accept an `env` query parameter that preselects an environment,
and that parameter SHALL survive the sign-in round-trip for unauthenticated visitors.

#### Scenario: Launch provisions and navigates

- **WHEN** the user launches a valid environment and provisioning is enabled
- **THEN** a pod SHALL be created and stored under the user, and they SHALL be routed to
  `/pods/[slug]`

#### Scenario: Launch link preselects

- **WHEN** a user opens `/new?env=nextjs-starter`
- **THEN** that environment SHALL be preselected/highlighted in the launcher

#### Scenario: Provisioning not yet enabled

- **WHEN** the user attempts to launch while pod provisioning is not configured
- **THEN** the action SHALL surface a clear "not yet enabled" state and SHALL NOT create a record

### Requirement: Memorable pod slugs

Pods SHALL be identified by memorable slugs (`adjective-noun-4hex`) used as the record id and in
URLs, rather than UUIDs.

#### Scenario: Launched pod gets a slug

- **WHEN** a pod is launched
- **THEN** its id SHALL match the `adjective-noun-4hex` shape and its workspace URL SHALL be
  `/pods/<that-slug>`

### Requirement: Pod lifecycle actions

The dashboard SHALL provide owner-scoped Wake, Sleep, and Delete actions for a pod, delegating to
the control plane. A user SHALL NOT act on a pod they do not own.

#### Scenario: Owner acts on their pod

- **WHEN** a user triggers Wake/Sleep/Delete on their own pod
- **THEN** the control plane SHALL perform it and the list SHALL reflect the new state

#### Scenario: Cross-owner action is denied

- **WHEN** a user targets a pod they do not own
- **THEN** the action SHALL be denied as not-found
