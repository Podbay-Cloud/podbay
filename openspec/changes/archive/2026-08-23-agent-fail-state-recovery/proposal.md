## Why

A pod cannot recover from a fail state it cannot see. Two live incidents (afisha, then velsa's own
session 2026-08-23) exposed that the pod's health signals are **file-derived and sticky**, so a
mid-session auth/RC failure is invisible and self-heals nothing:

- **Auth is detected only from the credential FILE.** `credentialState(...).expired` checks
  `refreshTokenExpiresAt < now`. But a mid-session refresh *failure* (the CLI prints "Login expired ·
  Please run /login", the RC worker reports `worker_auth_expired`) happens while that field is still
  in the **future** — so `loginExpired` stays `false`, no issue is raised, and the cockpit/doctor
  report the pod healthy while the owner is locked out. We match **zero** live auth-failure text from
  the terminal (confirmed: no "Login expired"/"worker_auth_expired"/"run /login" match anywhere).
- **`rcActive` is sticky, not live.** It is `Boolean(the sessionUrl we once captured)`
  (`server.ts:1826-1829`) — so once remote control connects, it reports **active forever**, even after
  the bridge worker dies. The cockpit showed RC alive while it was dead, and nothing re-established it.
- **Nothing re-runs `/remote-control` after a re-login.** The resume watcher only fires on a
  suspend/resume time gap. So after the owner runs `/login` mid-session, RC stays dead until they
  manually run `/remote-control` — which is exactly what velsa had to do.

The pod should **know its own fail states from live signals and auto-recover the recoverable ones**
(re-establishing RC) while **honestly surfacing the ones it can't** (a login that needs the owner's
browser). This is the same self-healing principle as the menu-watchdog, applied to auth/RC.

## What Changes

- **Detect auth failure from the LIVE terminal, not just the file.** Add markers for the CLI's own
  auth-failure output ("Login expired", "Please run /login", "worker_auth_expired", the RC "sign in
  again" message). When the pane shows one (static for a short debounce, so a transient self-heal
  isn't flagged), the pod reports the agent as needing attention **even if the credential file field
  is still in the future** — closing the "cockpit says fine while broken" hole.
- **Make `rcActive` a live liveness check.** Derive it from the *current* bridge state, not a
  once-captured URL, so a dead RC worker reads as inactive and the cockpit/doctor tell the truth.
- **Auto-restore RC.** When the agent is authed (creds valid) but RC is detected dead — including
  right after a mid-session re-login — the pod re-runs `/remote-control` itself (bounded, idempotent),
  so the owner never has to. This is the fully-automatable half of the incident.
- **Surface, don't guess, what it can't fix.** A genuine login expiry (needs the owner's OAuth in a
  browser) is surfaced immediately as "needs you" + the existing Reconnect path; the pod does not
  pretend to auto-login.
- Composes with the menu-watchdog (same per-tick self-healing loop) and the shipped
  detect/refresh/greeter-gate work — this closes the LIVE-signal gap they left.

## Capabilities

### New Capabilities
<!-- none — hardens the existing pod-agent + pod-observability capabilities -->

### Modified Capabilities
- `pod-agent`: the agent's auth and remote-control state are derived from LIVE signals (terminal +
  current bridge state), and the pod auto-restores remote control when it dies while the login is
  valid — rather than reporting a stale, sticky "healthy" and requiring a manual `/remote-control`.
- `pod-observability`: a mid-session auth/RC failure is a detected, surfaced incident (not a silent
  "everything fine"), so the cockpit and doctor reflect the pod's true state.

## Impact

- **packages/pod-agent/src/server.ts** — a per-tick fail-state check (beside the menu-watchdog):
  live auth-failure detection, live `rcActive`, RC auto-restore when authed-but-RC-dead; healthz
  reflects the live signals.
- **packages/pod-agent/src/signals.ts** / **packages/shared/src/pane.ts** — auth-failure + RC-dead
  pane markers (one place, testable).
- **packages/pod-agent/src/health-checks.ts** — an issue for "signed out / needs re-login (live)" and
  optionally "RC recovering", distinct from the file-based `agent-login-expired`.
- **apps/web** (cockpit/doctor) — reflect live RC state + the live "needs re-login" signal.
