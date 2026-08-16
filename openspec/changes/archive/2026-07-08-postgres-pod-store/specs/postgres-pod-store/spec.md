## ADDED Requirements

### Requirement: Durable pods table

A `pods` table SHALL persist pod records with the fields of `PodRecord` (id, ownerId,
environmentName, status, region, keepAwake, createdAt, lastActiveAt). `ownerId` SHALL reference
the authenticated user, so pods are owned by real accounts.

#### Scenario: Migration creates the table

- **WHEN** the database migrations are applied
- **THEN** a `pods` table SHALL exist with the columns backing every `PodRecord` field

#### Scenario: Owner reference

- **WHEN** a pod row is written
- **THEN** its `ownerId` SHALL correspond to a user identity (the same id the control plane uses
  as `ownerId`)

### Requirement: Drizzle PodStore implements the store contract

`DrizzlePodStore` SHALL implement the existing `PodStore` interface
(create/get/listByOwner/list/update/delete) over Postgres, with the same observable behavior as
`InMemoryPodStore`.

#### Scenario: Create and read back

- **WHEN** a record is created via `DrizzlePodStore` and then fetched by id
- **THEN** the returned record SHALL equal what was written (fields round-trip, timestamps
  preserved)

#### Scenario: List by owner is scoped

- **WHEN** records for two owners exist and `listByOwner` is called for one
- **THEN** only that owner's records SHALL be returned

#### Scenario: Update and delete

- **WHEN** a record is updated (e.g. status/keepAwake/lastActiveAt) then deleted
- **THEN** the update SHALL be reflected on read, and after delete the record SHALL be absent

### Requirement: PodService works unchanged over the Drizzle store

`PodService` SHALL operate correctly when constructed with `DrizzlePodStore` instead of
`InMemoryPodStore`, with no change to `PodService` or the `PodStore` interface.

#### Scenario: Launch and lifecycle over Postgres

- **WHEN** `PodService` is given a `DrizzlePodStore` and a provider, and a pod is launched then
  slept then destroyed
- **THEN** the pod SHALL be persisted, updated, and removed in the database via the store
