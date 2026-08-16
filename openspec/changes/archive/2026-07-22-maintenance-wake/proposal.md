## Why

A dormant pod's agent login **expires** (~30 days) if the pod never runs, and long-suspended
pods risk deep-archive. The decided fix (compute-strategy.md) is a maintenance wake: periodically
wake dormant pods so the CLI can refresh its rotating token (persisted by M1 write-back on the
re-sleep) and the pod stays reachable. This adds the **wake mechanism**, opt-in.

## Decisions

- **Opt-in / off by default.** Waking pods spends compute, so it does nothing unless the gateway
  sets `PODBAY_MAINTENANCE_DORMANT_DAYS`. No surprise cost.
- **`maintenanceWakePods(dormantMs, maxPerSweep)`** (control-plane, system op): wakes sleeping,
  non-`keepAwake` pods whose `lastActiveAt` is older than `dormantMs`, capped per sweep. Waking
  resets `lastActiveAt`, so each pod wakes at most once per `dormantMs`.
- **Runs on the gateway idle timer** alongside `sleepIdlePods`. A maintenance-woken pod re-sleeps
  via the normal idle sweep, which M1-captures its refreshed token.
- **Best-effort.** A failed wake is retried next sweep.

## What Changes

- **control-plane**: `maintenanceWakePods`; tests (dormant vs fresh, cap, keepAwake skip, disabled).
- **gateway**: config `maintenanceDormantMs`/`maintenanceMaxPerSweep`; `sweepMaintenance` on the
  timer; `PODBAY_MAINTENANCE_DORMANT_DAYS` env wiring.

## Deferred / to verify

- **Does a wake reliably trigger a token refresh?** The mechanism gives the CLI the chance; whether
  a resumed pod refreshes within its awake window needs real-pod verification. If not, a follow-up
  can force a refresh on wake.
- **Auto re-run `/remote-control` on wake** (native-app reconnect) — pod-side, its own change.
- **`scheduled-wake`** (automation env cron) and **awake-hours** windows — sibling lifecycle changes.
