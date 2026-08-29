## Why

An agent's subscription login can silently die on a **running** pod. Claude Code (and Codex) refresh
their OAuth token only **on activity**; the refresh token has a hard ~27–30-day expiry. The
go-forward Incus fleet never idle-sleeps, so a pod that stays running but whose Claude is idle (e.g.
Codex is the active agent) is touched by **no** refresh path — `maintenanceWakePods` only wakes
**suspended** pods. This is exactly how the afisha crawler's Claude login lapsed: it ran continuously
for weeks with Codex active, Claude never got used, its refresh token passed expiry, and then
`/remote-control` broke while the cockpit and doctor reported the pod as perfectly healthy. The
detection half of this was shipped this session (token-aware `authed`/`loginExpired`); this change
adds the **prevention, recovery, and honest progress** half so the class of failure is closed.

## What Changes

- **No routine expiry nudge — surface a FAILING keepalive as a fault (revised per owner feedback):**
  keeping the token fresh is the mechanism, so the owner is never routinely asked to reconnect a
  running pod. An approaching expiry on a *running* pod is treated as evidence the keepalive is
  failing — a "couldn't keep the sign-in fresh" fault to fix — not a countdown nudge. Suspended pods
  are not warned (expected lapse; handled correct-on-wake by the shipped `loginExpired` detection).
- **Refresh a running-but-idle agent's token:** extend the maintenance sweep to run the trivial
  `claude -p` (and a codex equivalent) keepalive against **running** pods whose agent has been idle
  long enough to risk expiry — not just suspended pods. This is the fix for the afisha root cause.
- **Stop the greeter looping `/remote-control` into a logged-out agent:** the RC enable paths
  (`startGreeter`, `reenableRemoteControl`, added-agent greeter, `ensureCodexDaemon`) gate only on
  credential-file **presence**. Gate them on `credentialState(...).expired` too, so a logged-out
  agent short-circuits instead of burning the greeter's 3×/30s budget on every suspend/resume — the
  loop that also wedged afisha's update graceful-shutdown.
- **Honest maintenance progress:** the update/resize "Stopping the pod" view sits motionless for up
  to ~2 min of legitimate, bounded handoff + graceful-shutdown waiting (60s + 60s), reading as a
  hang. Communicate the bounded wait ("waiting for a clean shutdown — up to Ns") and add the missing
  `handoff` stage so the bar and label move.
- **Codex expiry-field parity:** verify/solidify the `~/.codex/auth.json` expiry path in
  `credentialExpired` so Codex gets the same detect/warn/refresh treatment as Claude, agent-agnostic.
- *(Already shipped this session, recorded here for spec-truth, not rebuilt):* token-aware `authed` +
  `loginExpired` on `/healthz`, the `agent-login-expired` health issue, the cockpit Reconnect action,
  and the dashboard-card "Sign-in expired" chip.

## Capabilities

### New Capabilities
<!-- none — this hardens existing capabilities -->

### Modified Capabilities
- `agent-credentials`: a running pod's login is kept fresh (running-idle refresh keepalive) and its
  approaching expiry is warned proactively; a lapsed login is recovered on wake and via an explicit
  reconnect; expiry detection is agent-agnostic (Claude + Codex).
- `pod-agent`: the greeter and RC-enable paths must not attempt `/remote-control` against an agent
  whose credential is known-expired — they consult the expiry signal, not just file presence.
- `session-handoff`: an owner-initiated maintenance interrupt communicates its bounded graceful-wait
  as progress, so a legitimate up-to-2-min clean-shutdown never reads as a stuck pod.

## Impact

- **packages/control-plane/src/service.ts** — `maintenanceWakePods`/`forceTokenRefresh` extended to
  running-idle pods; a running-idle refresh sweep; `updateStage: "handoff"` surfaced with a deadline;
  proactive-expiry warning source.
- **packages/pod-agent/src/{greeter.ts,server.ts,signals.ts}** — RC-enable paths consult
  `credentialState(...).expired`; optional in-pane logged-out refusal detection; codex expiry parity.
- **packages/provider/src/incus/{provider.ts,http-client.ts}** — surface the 60s graceful-stop budget
  as a per-stage deadline to the progress callback.
- **packages/control-plane/src/types.ts** + **packages/db** — `podUpdateProgress` gains a per-stage
  deadline/`maxSec`; possibly a persisted stage-started timestamp.
- **apps/web/components/{pod-updating.tsx,pod-cockpit.tsx}** — render the `handoff` stage + a
  "waiting for clean shutdown (Ns of Nmax)" line; **apps/web** dashboard — the proactive-expiry
  warning surface.
- **Edition parity:** the refresh keepalive + detection run for both cloud (Incus) and self-host
  (`local`/Docker) — LocalProvider pods also never idle-sleep, so they share the running-idle gap.
