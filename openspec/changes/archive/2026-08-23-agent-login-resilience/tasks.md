# Tasks

Order: verify signals → refresh (root cause) → greeter gate → proactive warn → progress UX → codex
parity → edition/verify. Each behavior-changing commit updates its spec + `0audit.md`.

## 1. Confirm the signal surface (no rebuild — this shipped this session)

- [ ] 1.1 Re-confirm `credentialState`/`credentialExpired` (`signals.ts:9-53`), `loginExpired` on
      `/healthz` (`server.ts:1767-1776`), the `agent-login-expired` issue (`health-checks.ts:164-173`),
      the card chip (`pod-visual-state.ts:56-64`), and the cockpit Reconnect action are all present
      and consistent — this change builds ON them.
- [ ] 1.2 Add `expiresAt` / `expiresInDays` to the credential signal alongside `expired` (Claude
      `refreshTokenExpiresAt`, codex expiry field) — the input for the proactive warning (D2).

## 2. Refresh a running-but-idle agent's token (the afisha root cause — D1)

- [ ] 2.1 Extend the maintenance selection in `maintenanceWakePods`/a sibling sweep
      (`service.ts:2983-3015`) to also select **running** pods whose `agentIdleMs` exceeds the refresh
      threshold AND whose login has time left (refresh when <~14d remain AND agent idle) — not just
      `status === "suspended"`. Keep the per-sweep cap; skip `busy`/`shell`.
- [ ] 2.2 Run the proven `forceTokenRefresh` (`service.ts:3017-3031`, `timeout 45 claude -p 'ok'`)
      against the selected running pods; log the refresh outcome per pod (for fleet visibility).
- [ ] 2.3 Add a codex-equivalent non-interactive refresh invocation (today `forceTokenRefresh` only
      runs `claude`) — confirmed-safe form verified on a real pod (D5); if none is safe, skip codex
      refresh and fall back to detect+warn, documented in `0audit.md`.
- [ ] 2.4 Confirm the selection runs for both editions (cloud Incus + self-host `local`) — neither
      idle-sleeps, both share the gap. No accidental cloud-only provider scoping.
- [ ] 2.5 Unit-test the selection predicate (running + idle + time-left → selected; busy/fresh/expired
      → not selected).

## 3. Stop the greeter looping RC into a logged-out agent (D3)

- [ ] 3.1 Gate the four RC-enable paths on `credentialState(...).expired`: `startGreeter` boot
      (`server.ts:2351`), `reenableRemoteControl` (`server.ts:2174`), added-agent greeter
      (`server.ts:2209`), `ensureCodexDaemon` (`server.ts:2209`) — short-circuit with a clear log
      when expired, instead of the file-presence-only gate.
- [ ] 3.2 Ensure the resume watcher (`startResumeWatch`, `greeter.ts:85-100`) does not re-arm a doomed
      RC attempt for an expired agent on each resume.
- [ ] 3.3 (Optional, lower priority) Add `RC_REFUSED_RE` (the "Login expired" / Enterprise-only
      wording) to the greeter poll loop (`greeter.ts:495-506`) to break early on a live mid-session
      logout the file check missed.
- [ ] 3.4 Verify an update on a logged-out pod is not held open by a stuck RC attempt (pod-agent spec
      scenario) — proceeds to bounded handoff/shutdown.

## 4. Surface a FAILING keepalive as a fault — NO routine nudge (D2, revised per owner)

- [ ] 4.1 Thread `expiresInDays` through `PodLiveSignals` (`control-plane/src/types.ts:194-222`) +
      `ownerLiveSignals` as an INPUT only (mirror `loginExpired` plumbing) — not a countdown UI.
- [ ] 4.2 Raise a fault ("couldn't keep the sign-in fresh") ONLY when a running/reachable pod is
      approaching hard expiry DESPITE the keepalive (refresh failed to move it) — never for a healthy
      pod, never for a suspended pod, never as a routine "reconnect soon" reminder.
- [ ] 4.3 Confirm the normal case shows nothing (D1 keeps it fresh); the fault is the exception path,
      wired so a silently-failing refresh can't reproduce afisha without a signal.

## 5. Honest maintenance progress (D4)

- [ ] 5.1 Add `handoff` to the frontend `STAGES` list (`pod-updating.tsx:17-25`) with friendly copy so
      it stops rendering as index-0 "Stopping the pod".
- [ ] 5.2 Extend `podUpdateProgress` (`service.ts:2453-2471`) + the persisted row to return a per-stage
      `maxSec` (handoff 60, stopping 60) and a `stageStartedAt` (schema addition → gateway-before-web
      if persisted).
- [ ] 5.3 Render "waiting for a clean shutdown — Ns of 60" with a determinate sub-bar in
      `pod-updating.tsx` (active-stage row `:103-131`, replace the index-frozen `pct` for timed stages).
- [ ] 5.4 Name the data-safety reason briefly in the copy (the ext4-flush wait is a feature, not a bug).

## 6. Codex expiry parity (D5)

- [ ] 6.1 Verify `credentialExpired` codex path (`signals.ts:42-45`) against a real `~/.codex/auth.json`
      (OAuth form → expires; API-key form → never `expired`). Add a fixture test.
- [ ] 6.2 Ensure codex is included in the refresh (§2.3), the RC gate (§3.1), the warning (§4), and
      Reconnect.

## 7. Verify end-to-end + ship

- [ ] 7.1 `pnpm -r build` green; targeted unit tests (`signals`, health-checks, the selection
      predicate) green.
- [ ] 7.2 Scratch/test pod: plant a **near-expiry** cred → observe the proactive warning + a refresh
      that pushes expiry out; plant an **expired** cred → observe RC short-circuit (no loop) + the
      "sign-in expired" state + a working Reconnect.
- [ ] 7.3 Trigger an update on a pod with a wedged/logged-out agent → observe the progress UI show a
      distinct handoff step + a moving "clean shutdown — Ns of 60", not a frozen "Stopping".
- [ ] 7.4 Reason through / test self-host (`editionOss()` on, a `local` pod) for the refresh + warning
      paths — "works on cloud" is not evidence for OSS.
- [ ] 7.5 Update the touched `openspec/specs/**` in the same commits; `0audit.md` on every push; image
      rebuild via `build-and-record.sh` + digest bump; gateway-before-web if §5.2 adds schema.
- [ ] 7.6 `openspec archive agent-login-resilience` once shipped.
