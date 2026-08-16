## Context

`control-plane` defines `PodStore` and ships only `InMemoryPodStore`. `auth` added
`@podbay/db` (Drizzle + Neon/pglite) and real user identities. This change adds the Postgres
implementation so pods persist and are owned by accounts. It is intentionally small: no
interface or service changes, just a table + a store implementation + tests.

## Goals / Non-Goals

**Goals:**
- A `pods` table in `@podbay/db` (+ committed migration), `ownerId` → `user.id`.
- `DrizzlePodStore` implementing `PodStore` with behavior identical to the in-memory store.
- Contract tests against pglite + a `PodService` integration test over the Drizzle store.

**Non-Goals:**
- Wiring `PodService` into `apps/web` routes (dashboard / gateway changes).
- The terminal gateway; a scheduler for the idle policy.
- Any change to `PodStore` / `PodService`.

## Decisions

- **`pods` table lives in `@podbay/db`.** All schema stays in one package so migrations are
  generated and applied in one place. _Alternative:_ define it in control-plane — splits schema
  ownership and migration tooling; rejected.
- **`DrizzlePodStore` lives in `@podbay/control-plane`.** control-plane owns the `PodStore`
  interface, so its Postgres implementation belongs there; control-plane gains a dependency on
  `@podbay/db`. This keeps `@podbay/db` free of a dependency on control-plane (no cycle).
- **`PodRecord` timestamps stay ISO strings; the table uses `timestamp` columns.** The store
  maps on read/write (Date ↔ ISO). Keeps `PodRecord` a plain serializable type for the API
  layer while using proper DB types. _Alternative:_ change `PodRecord` to `Date` — ripples into
  control-plane and its tests; rejected for a store-local mapping.
- **`ownerId` FK to `user.id` with `onDelete: cascade`.** Deleting a user removes their pod
  rows; matches the ownership model. (Provider teardown of the actual pods is separate — a
  user-deletion cleanup flow is a later concern, noted.)
- **Reuse the existing contract tests.** Factor the store scenarios so both `InMemoryPodStore`
  and `DrizzlePodStore` run the same assertions — proves parity, not just "it compiles."

## Risks / Trade-offs

- **FK requires a real user row.** Tests must insert a `user` before a `pod` (or the FK rejects
  it) — the tests seed a user, which also exercises the auth schema seam. Documented.
- **pglite vs Neon nuance** — keep the table portable Postgres; the same migration ran on Neon
  for the auth tables already, giving confidence.
- **Timestamp mapping bugs** → covered by a round-trip assertion (write ISO → read ISO equal).
- **Orphaned provider pods on user delete** (cascade removes rows, not cloud pods) → out of
  scope here; flagged for a user-deletion/cleanup change.

## Migration Plan

Add the `pods` table, generate the migration, apply on deploy (and to Neon, which already has
the auth tables). Rollback = revert; `InMemoryPodStore` remains for tests/dev. No running
surface depends on `DrizzlePodStore` until the dashboard/gateway wires it in.

## Open Questions

- Indexing: add an index on `pods.owner_id` (and maybe `status`) now or when query volume
  appears? Leaning: add the `owner_id` index now since `listByOwner` is the hot path.
