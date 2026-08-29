## Context

Grounded in the code audit (file:line below). Three mechanisms interact to produce the afisha class
of failure:

1. **Refresh is activity-only.** Claude Code refreshes its OAuth token in memory only when *used*,
   rewriting `~/.claude/.credentials.json`; a bare wake does not refresh it
   (`docs/plans/agent-auth-plan.md:159-170`). The refresh token has a hard ~27–30-day expiry.
2. **Only suspended pods get a keepalive.** `maintenanceWakePods` (`service.ts:2983-3015`) filters
   `status !== "suspended"` (`:2995`) and is off by default (`dormantMs` gated). After waking it runs
   `forceTokenRefresh` → `timeout 45 claude -p 'ok'` (`service.ts:3017-3031`) — the *only* real
   refresh trigger anywhere. Running pods are never refreshed. And the go-forward Incus/`local` fleet
   **never idle-sleeps** (`sleepIdlePods` skips them, `service.ts:2934`), so it stays running and
   falls straight into the hole.
3. **Detection now exists, prevention/recovery don't.** `credentialState` is token-aware
   (`signals.ts:9-53`) → `loginExpired` on `/healthz` (`server.ts:1767-1776`) → the
   `agent-login-expired` health issue (`health-checks.ts:164-173`) → the card chip
   (`pod-visual-state.ts:56-64`) + cockpit Reconnect. That closed the *blind spot*, not the *refresh*.

Two downstream failures the same root cause created:
- The greeter's RC-enable paths gate on credential-file **presence**, not validity
  (`server.ts:2174,2209,2351`), so a logged-out agent burns the bounded 3×/30s RC budget
  (`greeter.ts:490-506`) on every suspend/resume via `startResumeWatch` (`greeter.ts:85-100`).
  `runGreeter` has no negative/refusal detection (no counterpart to `RC_ACTIVE_RE`, `greeter.ts:468`).
- The update view shows "Stopping the pod" motionless (`pod-updating.tsx:17-25,54-55`) for up to
  ~2 min of bounded, legitimate waiting: the handoff (`HANDOFF_TIMEOUT_MS = 60_000`,
  `handoff.ts:22`) + the graceful stop (Incus `timeout: 60`, `http-client.ts:210`, before force at
  `provider.ts:379`). The `handoff` stage isn't even in the frontend `STAGES` list, so it renders as
  index 0 ("Stopping"), and the bar is index-based so it never moves.

## Goals / Non-Goals

**Goals:**
- A running, actively-usable pod never lets its agent login silently pass hard expiry.
- The owner is warned *before* expiry on a running pod, and sees the correct "sign-in expired" state
  *after* it on any pod (already handled on wake; verify the path).
- No RC greeter effort is spent against a known-logged-out agent.
- Bounded maintenance waits read as progress, not as a hang.
- Claude and Codex are treated identically (agent-agnostic).
- Cloud (Incus) **and** self-host (`local`/Docker) both covered — same running-idle gap.

**Non-Goals:**
- Reviving M1/M2 vault credential-writeback — obsolete (`marketplace-playbooks.md:186-190`); the token
  lives on the pod's own volume, rotated in place. This change does not reintroduce a capture step.
- Warning on suspended pods (expected to lapse; correct-on-wake covers it).
- Changing the ~30-day rotation itself (upstream CLI behavior we don't control).
- Rebuilding the already-shipped detection (token-aware `authed`/`loginExpired`, health issue,
  Reconnect, card chip).

## Decisions

**D1 — Refresh running-idle pods, reusing the proven `forceTokenRefresh` trigger.**
Extend the maintenance sweep to also select **running** pods whose *agent idle time* exceeds a
refresh threshold well inside the ~27-day window (e.g. refresh when `agentIdleMs` — the true
session-file idle, `PodLiveSignals.agentIdleMs` — exceeds ~7 days, capped per sweep). For each,
run the existing `forceTokenRefresh` (`timeout 45 claude -p 'ok'`) which is *verified* to force
Claude's on-demand refresh. Add a codex-equivalent trivial invocation so codex refreshes too
(today `forceTokenRefresh` only runs `claude`, `service.ts:3025`).
- *Alternatives:* (a) a background timer inside the pod-agent that self-refreshes — rejected: spreads
  the logic onto every image, harder to change, and the control-plane already owns the sweep cadence;
  (b) refresh purely on a wall-clock schedule ignoring idle — rejected: wastes a model call on pods
  that are already being used (their token is fresh by definition). Gating on `agentIdleMs` refreshes
  only the at-risk ones.
- *Threshold rationale:* refresh-token window is ~27–30d; refreshing at ~7d idle gives ~3 refresh
  opportunities before expiry — robust against a missed sweep — while staying cheap.

**D2 — No routine "expires soon" nudge; surface only a FAILING keepalive as a fault.**
(Revised per owner feedback: nudging the owner to reconnect before expiry contradicts keep-it-fresh —
it asks them to babysit a token we maintain.) So there is no routine "expires in N days" reminder.
Instead: keep-fresh (D1) is the mechanism, and an approaching expiry on a *running* pod is treated as
evidence the keepalive is **failing** — a fault. Expose `expiresInDays` as an input, but render it
only when the pod is running AND expiry is approaching DESPITE the keepalive (e.g. refresh has failed
to move it), as a "couldn't keep the sign-in fresh — fix it" fault, not a soft nudge. In the normal
case D1 keeps it fresh and nothing is ever shown. Terminal expiry stays on `loginExpired` + Reconnect.
- *Alternatives:* a routine countdown nudge — rejected (owner feedback: babysitting). A silent
  keepalive with no fault surface — rejected: if refresh is silently failing we must show it, or the
  pod dies exactly like afisha with no signal.

**D3 — Gate every RC-enable path on `credentialState(...).expired`.**
Add an expiry check at the four entry points (`startGreeter` boot gate `server.ts:2351`,
`reenableRemoteControl` `server.ts:2174`, added-agent greeter `server.ts:2209`, `ensureCodexDaemon`
`server.ts:2209`) so a known-expired agent short-circuits with a clear log instead of spawning a
doomed greeter. This is cheap, authoritative (the hard-expiry field), and symmetric across agents.
- *Secondary (optional) — in-pane refusal detection:* add a `RC_REFUSED_RE` (the "Login expired" /
  "available with Claude for Enterprise" wording) to the greeter poll loop (`greeter.ts:495-506`) to
  break early if a *live* logout happens mid-session that the file check missed. Lower priority — the
  file gate catches the hard-expiry case, which is the one we've actually seen.

**D4 — Surface the bounded maintenance wait as real progress.**
Add `handoff` to the frontend `STAGES` list (`pod-updating.tsx:17-25`) with the friendly copy
"Handing off to the agent". Extend `podUpdateProgress` (`service.ts:2453-2471`) to return a per-stage
`maxSec` (handoff 60, stopping 60) and a `stageStartedAt`, so the cockpit can render "waiting for a
clean shutdown — Ns of 60" and move a determinate sub-bar. The graceful-stop budget already exists
(`http-client.ts:210`); it just needs to reach the client.
- *Alternatives:* a fake indeterminate shimmer — rejected: it hides the real, honest fact that a
  data-safety wait is happening; better to *name* it (the ext4-zeroing rationale, `provider.ts:352-368`,
  is a feature worth communicating, not masking).

**D5 — Codex parity is a verify-and-solidify, not a rebuild.**
`credentialExpired` already reads codex's `refresh_token_expires_at`/`expires_at`/`expiry`
(`signals.ts:42-45`). Confirm against a real `~/.codex/auth.json` shape (API-key form must stay
`expired:false` — never expires), and ensure D1's refresh + D3's gate both include codex.

## Risks / Trade-offs

- **[A false refresh call disturbs a busy pod]** → gate strictly on `agentIdleMs` (only long-idle
  agents) and keep the `timeout 45 … || true` best-effort shape; never refresh an agent reporting
  `busy`/`shell`.
- **[`claude -p` cost / rate on every sweep]** → cap per-sweep (reuse `maxPerSweep`), only fire past
  the idle threshold; a pod in active use is skipped entirely.
- **[Refresh silently fails (e.g. already hard-expired)]** → then D2's warning + the shipped
  `loginExpired` detection + Reconnect are the safety net; refresh is prevention, detection is the
  floor. Log refresh outcome so a persistently-failing pod is visible in the fleet view.
- **[Codex `-p` equivalent differs / has no headless prompt]** → verify the exact non-interactive
  codex invocation on a real pod before shipping; if none is safe, fall back to detect+warn for codex
  and document the gap honestly rather than shipping a refresh that wedges it.
- **[Edition parity]** → the sweep runs in the shared control-plane for both editions; confirm the
  running-idle selection isn't accidentally scoped to a cloud-only provider. Self-host `local` pods
  never idle-sleep either, so they need the same refresh.

## Migration Plan

Image + apps, standard order. The pod-agent greeter/signals changes are **image-baked** (pod-base
rebuild + digest bump); the sweep + progress changes are control-plane/web (gateway before web — but
this change adds no schema unless we persist `stageStartedAt`, in which case gateway-before-web is
mandatory). Backward-compatible: older images simply don't report `expiresInDays` and the warning is
absent (degrade to today's behavior); the refresh sweep no-ops on a pod that doesn't answer. Verify
end-to-end on a scratch/test pod (plant a near-expiry cred → observe warn + refresh; plant an expired
cred → observe RC short-circuit) before relying. Rollback = re-point the pod-base alias + redeploy
prior app release; no data rollback (additive).

## Open Questions

- **Idle-refresh threshold:** ~7 days idle the right trigger, or tie it to `refreshTokenExpiresAt`
  (refresh when <14 days remain) rather than idle time? The latter is more precise but needs the
  remaining-days signal (D2) as an input — leaning toward "refresh when <14d remain AND agent idle".
- **Proactive-warning threshold:** ≤5 days the right nudge point? (With D1 working it should almost
  never fire.)
- **Codex non-interactive refresh:** confirmed-safe invocation TBD on a real pod (D5 risk).
