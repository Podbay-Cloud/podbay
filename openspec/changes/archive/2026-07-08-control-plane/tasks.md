## 1. Package scaffold

- [x] 1.1 Create `packages/control-plane` (`@podbay/control-plane`, ESM, tsconfig, vitest);
  depend on `@podbay/shared`, `@podbay/provider`
- [x] 1.2 Wire into the pnpm workspace

## 2. Domain types & store

- [x] 2.1 Define `PodRecord` (id, ownerId, environmentName, status, region, keepAwake, createdAt,
  lastActiveAt) and typed errors (not-found, invalid)
- [x] 2.2 Define `PodStore` interface (create/get/listByOwner/update/delete)
- [x] 2.3 `InMemoryPodStore` implementation

## 3. PodService

- [x] 3.1 Constructor injects `SandboxProvider` + `PodStore`; config (env root dir, default region)
- [x] 3.2 `launchPod(ownerId, environmentName)`: resolve env via `@podbay/shared` → provider
  `createPod` → persist record; reject unknown env with no side effects; best-effort cleanup on
  post-provision store failure
- [x] 3.3 `listPods(ownerId)` / `getPod(ownerId, id)` scoped to owner (cross-owner → not-found)
- [x] 3.4 `wake` / `sleep` / `destroy` delegate to provider + update record (+ `lastActiveAt`)
- [x] 3.5 `setKeepAwake(ownerId, id, bool)` updates provider + record
- [x] 3.6 `reconcile(id)` refreshes record status from provider truth
- [x] 3.7 `sleepIdlePods(thresholdMs)` sleeps idle pods, skips `keepAwake`

## 4. Tests (mock provider + in-memory store)

- [x] 4.1 Launch stores a record; unknown env creates nothing
- [x] 4.2 Ownership isolation: list returns only owner's; cross-owner get/mutate → not-found
- [x] 4.3 wake/sleep/destroy delegate and update record; destroy removes record
- [x] 4.4 keepAwake persisted to provider + record
- [x] 4.5 `sleepIdlePods` sleeps idle, skips keepAwake
- [x] 4.6 `reconcile` updates a stale record from provider status
- [x] 4.7 post-provision store failure triggers best-effort provider cleanup

## 5. Docs

- [x] 5.1 `packages/control-plane/README.md`: service/store contract, DI model, in-memory vs
  Postgres, idle-policy-is-a-method note
- [x] 5.2 Note in docs/roadmap.md that `control-plane` is implemented (Phase 1 backend spine)
