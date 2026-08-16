## Context

Three foundations exist (`environment-spec`, `sandbox-provider`, `pod-agent`) but nothing
orchestrates them or persists state. This change adds the service spine: a `PodService` over a
`PodStore` and the `SandboxProvider`. It mirrors the provider's dependency-injection style so it
is fully testable without cloud or database. Auth, the terminal gateway, and the UI consume it
next.

## Goals / Non-Goals

**Goals:**
- A `PodService` owning launch, lifecycle, ownership isolation, idle policy, reconciliation.
- A `PodStore` interface + in-memory implementation (Postgres later, same interface).
- Mock-provider + in-memory-store tests covering every spec scenario. No cloud, no DB.

**Non-Goals:**
- Auth/accounts (next; `ownerId` is opaque here).
- HTTP/WebSocket terminal gateway + cookie auth (next).
- Web dashboard UI.
- Postgres/Drizzle store impl; a timer/scheduler that runs the idle policy (host's concern).
- Real Fly provisioning (mock provider).

## Decisions

- **Service + store as a package (`@podbay/control-plane`), not app routes.** Keeps the spine
  framework-agnostic and unit-testable; `apps/web` will import it. _Alternative:_ put logic
  directly in Next.js route handlers — couples core logic to the framework and to auth.
- **`PodStore` interface with in-memory impl now.** Same pattern as `SandboxProvider`: the
  service depends on the interface, tests inject in-memory, production injects Drizzle later.
  Avoids standing up Neon just to build the spine.
- **`ownerId` is an opaque string.** No user model here; auth supplies real identities later.
  Every read/write takes `ownerId` and enforces it, so isolation is built in from the start.
- **Record vs provider truth are distinct.** The store holds `PodRecord`
  (id, ownerId, environmentName, status, region, keepAwake, createdAt, lastActiveAt). Provider
  is the source of truth for live status; `reconcile()` syncs record ← provider. This avoids
  trusting a possibly-stale record for lifecycle decisions.
- **Idle policy is a pure method, not a loop.** `sleepIdlePods(thresholdMs)` scans records,
  skips `keepAwake`, sleeps the rest. The host (gateway/cron) decides cadence — keeps the
  package free of timers and testable synchronously. Matches the pod-agent idle *signal* feeding
  this decision.
- **Isolation = "not found" on cross-owner access.** Denying by returning not-found (rather than
  forbidden) avoids leaking existence of other owners' pods.

## Risks / Trade-offs

- **Record/provider drift** (a pod stopped or vanished out-of-band) → `reconcile()` and lifecycle
  ops re-read provider status; the record is never the sole authority for a live decision.
- **In-memory store is not durable** → explicitly a dev/test impl; production swaps the Drizzle
  store behind the same interface. Documented.
- **Idle policy correctness** depends on `lastActiveAt` being fed by real activity → the
  service updates it on lifecycle ops; the gateway will update it from pod-agent's activity
  signal (next change).
- **launchPod partial failure** (provider created but store write fails) → wrap so a store
  failure after provisioning attempts a best-effort provider cleanup, or surfaces a clear error;
  covered by a test.

## Migration Plan

New package; nothing to migrate. Deploy = import it from `apps/web` once auth + gateway exist.
Rollback = revert; no user surface depends on it yet.

## Open Questions

- Whether `PodRecord.environmentName` should later become a richer reference (version, source)
  once the marketplace exists — v0 keeps a plain name into `environments/`.
- Where the idle threshold lives (per-plan? global?) — v0 takes it as a parameter to
  `sleepIdlePods`; policy home is decided when billing/plans arrive.
