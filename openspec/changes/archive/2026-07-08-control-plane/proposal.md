## Why

We now have three foundations — `environment-spec` (definitions), `sandbox-provider` (pods),
`pod-agent` (in-pod terminal) — but nothing ties them together or remembers anything. Launching
a pod, knowing which pods a user owns, deciding when to sleep them, and reconciling their status
all need a **control plane**: a service that orchestrates the provider against persisted pod
records. This is the backend spine every user-facing surface (dashboard, terminal gateway, auth)
will call. Building it as a standalone, mock-tested service package keeps it verifiable now
(no cloud, no DB required) and unblocks those surfaces.

## What Changes

- New package `packages/control-plane` (`@podbay/control-plane`): a `PodService` that owns pod
  **lifecycle and persistence**, orchestrating `SandboxProvider` (`@podbay/provider`) against a
  `PodStore`.
- **`PodStore` abstraction** (create/get/list-by-owner/update/delete pod records) with an
  in-memory implementation now; a Postgres/Drizzle implementation is a later wiring change. Same
  dependency-injection pattern as `SandboxProvider`, so the service is testable without a DB.
- **Launch flow**: `launchPod(ownerId, environmentName)` resolves a first-party environment via
  `@podbay/shared`, provisions a pod via the provider, and persists the record.
- **Ownership isolation**: queries are scoped to an owner; one user never sees another's pods.
- **Lifecycle**: `wake`, `sleep`, `setKeepAwake`, `destroy` delegate to the provider and update
  the record (incl. `lastActiveAt`).
- **Idle→sleep policy**: identify pods idle beyond a threshold and sleep them, **skipping
  `keepAwake`** (which protects active Remote Control sessions).
- **Status reconciliation**: refresh a stored record's status from provider truth.
- Tests: a mock `SandboxProvider` + the in-memory `PodStore` exercise launch, isolation,
  lifecycle, idle policy, keepAwake, and reconciliation. No cloud, no database.

ToS note: the control plane never handles model credentials; it orchestrates infrastructure and
records only. Per-user CLI auth still happens inside the pod.

## Capabilities

### New Capabilities
- `control-plane`: pod lifecycle orchestration + persistence — the `PodService`/`PodStore`
  contract, launch-from-environment, ownership isolation, lifecycle ops, idle policy, and status
  reconciliation.

### Modified Capabilities
<!-- None. Consumes environment-spec, sandbox-provider; changes neither. -->

## Impact

- New package `packages/control-plane` (`@podbay/control-plane`), depending on `@podbay/shared`
  and `@podbay/provider`.
- Establishes the service consumed next by: **auth/accounts** (owner identity), the **terminal
  gateway** (authenticated WS/HTTP proxy to `pod-agent`), and the **web dashboard**.
- Non-goals (explicit): user authentication/accounts (next change — `ownerId` is an opaque
  string here); the HTTP/WebSocket terminal gateway and cookie auth (next change); the web
  dashboard UI; the Postgres/Drizzle `PodStore` (later wiring — in-memory now); real Fly
  provisioning (mock provider in tests). A background scheduler that *runs* the idle policy on a
  timer is out of scope — this change provides the policy method; the gateway/host invokes it.
