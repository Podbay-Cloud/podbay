# @podbay/control-plane

The backend spine: a `PodService` that orchestrates a `SandboxProvider` (`@podbay/provider`)
against a `PodStore`, adding persistence, ownership isolation, lifecycle, an idle policy, and
status reconciliation. Framework-agnostic and unit-testable without cloud or database.

## Shape

```ts
const service = new PodService(provider, store, { environmentsRoot, region });

await service.launchPod(ownerId, "nextjs-starter"); // resolve env → provision → persist
await service.listPods(ownerId);                     // owner-scoped
await service.getPod(ownerId, id);                   // cross-owner → not-found
await service.wake(ownerId, id);
await service.sleep(ownerId, id);
await service.setKeepAwake(ownerId, id, true);       // protects Remote Control sessions
await service.destroy(ownerId, id);
await service.reconcile(id);                          // record.status ← provider truth
await service.sleepIdlePods(thresholdMs);             // sleep idle, skip keepAwake
```

## Design notes

- **Dependency injection.** `PodService` takes any `PodStore` and any `SandboxProvider`. Tests
  inject `InMemoryPodStore` + a mock provider; production injects a Postgres/Drizzle store +
  `FlyProvider`. The DB store is a later wiring change — not needed to build or test the spine.
- **`ownerId` is opaque.** No user model here; auth supplies real identities later. Every
  read/write is owner-scoped, and cross-owner access returns **not-found** (doesn't leak
  existence).
- **Provider is the source of live status.** The `PodRecord` caches status; `reconcile()` and
  lifecycle ops re-read the provider, so a live decision never trusts a stale record.
- **The idle policy is a method, not a loop.** `sleepIdlePods(thresholdMs)` scans records, skips
  `keepAwake`, sleeps the rest. The host (gateway/cron) chooses cadence — the package stays
  timer-free and synchronously testable. `lastActiveAt` is fed by lifecycle ops now and, later,
  by pod-agent's activity signal via the gateway.
- **Launch is transactional-ish.** If the store write fails after provisioning, the provider pod
  is destroyed best-effort so no untracked pod leaks.

## Stores

- **`InMemoryPodStore`** — dev/tests.
- **`DrizzlePodStore`** — production, backed by the `pods` table in `@podbay/db` (Neon). Same
  `PodStore` contract; the shared contract test runs against both to guarantee parity. Records'
  ISO-string timestamps map to `timestamp` columns.

## Not here (later changes)

Auth/accounts, the authenticated HTTP/WebSocket terminal gateway to `pod-agent`, the dashboard
UI, the Postgres `PodStore`, and a scheduler that runs `sleepIdlePods` on a timer.
