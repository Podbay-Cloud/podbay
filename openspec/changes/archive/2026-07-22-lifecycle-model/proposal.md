## Why

Pods have one lifecycle knob today — a `keepAwake` boolean (idle-sleep vs never-sleep). The
decided model ([compute-strategy.md](../../../docs/compute-strategy.md)) is four named policies:
`auto` (default: sleep after idle + a weekly maintenance wake), `awake-hours` (scheduled online
window), `always-on` (paid: serving-size-idle, boost-on-steer), `scheduled` (cron wake→run→
sleep). Envs need to **declare** a default (a Discord-bot env is `always-on`; the `automation`
env is `scheduled`), and pods need to carry the policy so the idle sweep — and later the wake
scheduler — can act on it. This change lands the **policy model + the auto/always-on behavior**;
the schedulers (weekly wake, scheduled-wake, awake-hours windows) and always-on size-shift build
on it as their own changes.

## Decisions

- **`lifecycle` is a first-class field.** Env `podbay.yaml` declares a default
  `lifecycle: auto | awake-hours | always-on | scheduled` (default `auto`); the pod record gets a
  `lifecycle` column (default `auto`), set at launch from the env's default.
- **Behavior this change:** `always-on` ⇒ never idle-sleep (`keepAwake` derived true).
  `auto` ⇒ idle-sleep at the configured threshold. `awake-hours` and `scheduled` are **accepted
  and stored** but behave as `auto` for now (idle-sleep) — their schedulers are follow-ups;
  documented so nothing silently pretends to work.
- **`keepAwake` becomes derived, not primary.** `lifecycle` is the source of truth; setting
  `always-on` sets `keepAwake` true (and calls the provider), any other policy sets it false. The
  existing `sleepIdlePods` "skip keepAwake" logic is unchanged, so always-on keeps working.
- **Per-pod override.** `setLifecycle(ownerId, id, mode)` changes a pod's policy (owner-scoped),
  syncing `keepAwake`. Replaces the raw `setKeepAwake` in the UI later (kept for now).
- **DB migration applied to prod** idempotently (direct SQL, as with prior migrations):
  `ALTER TABLE pods ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'auto'`.

## What Changes

- **shared**: `lifecycle` in the env schema (enum, default `auto`) + carried on `ResolvedPod`.
- **db**: `pods.lifecycle` column + migration (generated + applied to prod Neon).
- **control-plane**: `PodRecord.lifecycle`; `launchPod` sets it from the env (and derives
  `keepAwake`); `setLifecycle(ownerId, id, mode)`; `sleepIdlePods` unchanged (keepAwake-driven).
- **web**: surface a pod's lifecycle on the dashboard card (read-only label this change);
  `setLifecycle` server action.
- **tests**: env resolve carries lifecycle; launch sets lifecycle + keepAwake from the env;
  setLifecycle toggles both; always-on isn't idle-slept.

## Deferred (own follow-up changes)

- **Weekly maintenance wake** (wake dormant pods → refresh creds/keepalive + re-run
  `/remote-control` → sleep) — needs last-wake tracking + a wake-settle-sleep cycle on the timer.
- **`scheduled-wake`** (cron for the `automation` env) and **awake-hours** window evaluation.
- **always-on serving↔dev size-shift on steer** — needs provider guest-size support.
- **True single-active credential holder** (M2 full) — now has a `lifecycle` signal to build on.
- **pod-peek agent-busyness** in the idle definition.
