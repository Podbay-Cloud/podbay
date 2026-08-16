## 1. Schema & migration (@podbay/db)

- [x] 1.1 Add a `pods` table (id pk, owner_id → user.id cascade, environment_name, status,
  region, keep_awake, created_at, last_active_at) with an index on `owner_id`
- [x] 1.2 Export the table; generate + commit the migration (drizzle-kit)
- [x] 1.3 Test: migration applies on pglite and the `pods` table is present

## 2. DrizzlePodStore (@podbay/control-plane)

- [x] 2.1 Add `@podbay/db` as a dependency of `@podbay/control-plane`
- [x] 2.2 Implement `DrizzlePodStore implements PodStore` (create/get/listByOwner/list/update/
  delete), mapping `PodRecord` ISO strings ↔ `timestamp` columns
- [x] 2.3 Export it from the package

## 3. Tests

- [x] 3.1 Shared contract tests run against BOTH `InMemoryPodStore` and `DrizzlePodStore`
  (create/read round-trip incl. timestamps, listByOwner scoping, update, delete)
- [x] 3.2 Seed a `user` row first (FK) — exercises the auth schema seam
- [x] 3.3 `PodService` integration over `DrizzlePodStore` + mock provider: launch → sleep →
  destroy persists/updates/removes rows

## 4. Docs

- [x] 4.1 Note `DrizzlePodStore` in the control-plane README (in-memory for dev/tests, Drizzle
  for production)
- [x] 4.2 Note in docs/roadmap.md that pods now persist (Postgres PodStore implemented)
