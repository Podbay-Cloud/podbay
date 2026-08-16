## Why

`control-plane` persists pods through a `PodStore`, but the only implementation is in-memory —
pods vanish on restart and can't be shared across processes. Now that `auth` stood up the
Neon + Drizzle database (and a real `user.id` to own pods), we can back the store with Postgres.
This is the small, deliberately-deferred follow-on that makes "Your pods will appear here" real:
a `pods` table and a Drizzle `PodStore` that the existing `PodService` uses unchanged.

## What Changes

- Add a **`pods` table** to `@podbay/db` (matching `PodRecord`: id, ownerId, environmentName,
  status, region, keepAwake, createdAt, lastActiveAt), with `ownerId` referencing `user.id`.
- Generate and commit the migration.
- Implement **`DrizzlePodStore`** in `@podbay/control-plane` (adding `@podbay/db` as a
  dependency) — the Postgres implementation of the existing `PodStore` interface.
- Tests: `DrizzlePodStore` satisfies the same `PodStore` contract as `InMemoryPodStore`, run
  against **pglite** (no cloud); plus a `PodService` integration test using `DrizzlePodStore` +
  a mock provider to prove the service works unchanged over the real store.

No interface changes: `PodService` and `PodStore` are untouched; this only adds an
implementation and its table.

## Capabilities

### New Capabilities
- `postgres-pod-store`: the `pods` table and the Drizzle `PodStore` implementation, giving
  durable, owner-linked pod persistence.

### Modified Capabilities
<!-- None. control-plane's PodStore interface is unchanged; this adds an implementation. -->

## Impact

- `@podbay/db`: new `pods` table + migration.
- `@podbay/control-plane`: new `DrizzlePodStore`; adds a dependency on `@podbay/db`.
- Unblocks the dashboard and terminal gateway using durable pods tied to signed-in users.
- Non-goals (explicit): wiring `PodService` into `apps/web` routes (that comes with the
  dashboard / terminal gateway); the gateway itself; any change to the `PodStore` interface or
  `PodService` behavior; a background scheduler for the idle policy.
