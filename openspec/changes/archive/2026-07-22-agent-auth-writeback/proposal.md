## Why

Confirmed 2026-07-13 ([agent-auth-plan.md](../../../docs/agent-auth-plan.md)): Claude Code
**rotates its refresh token on every refresh**. The credential vault captures a login **once**
(on unauth→auth) and never again, so the stored refresh token goes stale the moment the holding
pod refreshes — and a new pod injected from the vault fails to refresh ("Login expired"). M3
(shipped) stops injecting a *provably* dead blob; it can't fix a token that still looks valid
but was rotated out. That needs **write-back** (M1): keep the vault's copy current.

## Decisions

- **M1 — Write-back on sleep.** Before a pod suspends (`sleep`, `sleepIdlePods`) — while it's
  still running and exec works — capture its live agent credentials to the vault. The stored
  refresh token then reflects the pod's latest rotation, so the next pod launched gets a valid
  one. Reuses `captureCredentials` (which already refuses to store a stale/empty blob, M3).
- **M2-lite — Drain-before-inject on launch.** Before injecting saved credentials into a new
  pod, capture the latest credentials from any of the user's **currently-running** pods for the
  same agent(s). So even if the previous holder is still awake (hasn't slept), the new pod gets
  its freshest rotated token, not the stale login snapshot.
- **Best-effort, never blocks a launch/sleep.** Capture failures (unreachable pod, no creds
  file) are swallowed; the DB stays the source of truth for the next boot.
- **Agent-scoped, owner-scoped.** Sleep write-back tries the known agents (`claude-code`,
  `codex`) — each no-ops if that agent's creds file is absent. Drain is scoped to the launching
  env's agents. All owner-checked.

## What Changes

- **control-plane**: `writeBackCredentials(ownerId, podId, agents)` helper; call it before
  `provider.sleep(...)` in `sleep` and `sleepIdlePods`; `drainRunningHolders(ownerId, agents)`
  called in `launchPod` before `credentialsForLaunch`.
- **tests**: sleep captures the pod's current creds to the vault; launch drains a running
  holder so the injected creds are the freshest; failures don't break sleep/launch.

## Deferred (true M2 → pod-lifecycle)

- **Single active holder / hard hand-off.** Drain-before-inject keeps the vault fresh but does
  **not** prevent two pods from sharing one login and rotating each other out if used
  concurrently. True single-active enforcement (block/queue a second active pod, or move the
  credential) lands with the lifecycle/concurrency policy in `pod-lifecycle`.
- **Write-back on wake / weekly keepalive** — the refresh-token also *expires* (~30 days) if a
  pod never runs; the weekly maintenance wake refreshing + writing back is a `pod-lifecycle`
  concern (it owns the wake schedule).
