## Why

`lifecycle-model` gave envs a **default** lifecycle, but the user can't pick one at launch, and
an env can't **require** one. Some envs genuinely need a policy: a Discord-bot env needs
`always-on` (letting a user downgrade it to `auto` breaks the bot). This adds: an env-declared
**default + optional lock**, a lifecycle **picker at launch**, and an **editable control on the
pod** after launch — with the lock enforced everywhere.

## Decisions (confirmed 2026-07-14)

- **Env declares `default + locked`.** `podbay.yaml` `lifecycle` accepts either a bare policy
  (unlocked default, back-compat with today's `lifecycle: auto`) **or**
  `{ default: always-on, locked: true }`. Resolved to `{ default, locked }`.
- **Locked ⇒ fixed.** A locked env's pods must use the env's policy; the launch picker is
  disabled and `setLifecycle` rejects a change. Unlocked ⇒ the user picks any policy at launch
  (default preselected) and can change it later.
- **Picker at launch AND change-later.** A lifecycle picker in the launch dialog (preselected to
  the env default, disabled when locked). On the pod card, an editable control → `setLifecycle`
  (already built), hidden/disabled when locked.
- **Server enforces the lock** (UI can be bypassed): `launchPod` and `setLifecycle` resolve the
  env and reject a policy that violates a lock.

## What Changes

- **shared**: `lifecycle` schema accepts policy | `{ default, locked }`; `ResolvedPod.lifecycle`
  becomes `{ default, locked }`.
- **control-plane**: `LaunchOptions.lifecycle`; `launchPod` computes the effective policy
  (locked ⇒ env default; else opts ?? default) and rejects a locked override; `setLifecycle`
  resolves the pod's env and rejects when locked; `PodRecord.lifecycle` unchanged (stores the
  effective policy).
- **web**: catalog carries `{ default, locked }`; launch dialog lifecycle picker; pod card
  lifecycle control (dropdown) → `setLifecycle`, disabled when locked.
- **tests**: resolve normalizes both forms; locked env forces policy at launch + blocks
  setLifecycle; unlocked env accepts a launch override + later change.

## Deferred

- Surfacing awake-hours/scheduled as *usable* picks (they behave as auto until their schedulers
  land) — shown but labelled "coming soon", or hidden; decided in the UI task.
- Cost/tier gating of `always-on` (paid tier) — the alpha promo handles this for now.
