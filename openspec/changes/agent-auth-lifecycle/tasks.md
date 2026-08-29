# Tasks

Phased: **P1 renewal + reminders** (needed regardless of the 1-year mode), then **P2 the 1-year unattended
mode**. Some copy/detection is already shipped this session (marked). Strategy: `docs/strategy/agent-auth-lifecycle.md`.

## 0. Decisions — CONFIRMED (velsa, 2026-08-23)

- [x] 0.1 **Scope: P1 + P2 together.** Default stays **RC**; the 1-year setup-token+T3 mode is an **opt-in**
      "unattended pod" toggle. Email reminders are **batched per owner** + in-app. Thresholds RC 7d/1d,
      1-year 21d/3d. T3 accepted as the 1-year mode's control layer.

## 1. Detection + honest copy (pod-agent) — mostly shipped

- [x] 1.1 `agent-login-expiring` fires per-agent within N days of hard expiry; copy fixed (names the ~monthly
      limit; "Control → Reconnect", not Settings). (Shipped; reaches pods on the next image build.)
- [ ] 1.2 Tiered thresholds by auth mode (RC 7d/1d, setup-token 21d/3d) instead of one 5-day window.
- [ ] 1.3 healthz reports the active login's **next hard expiry** + auth mode so the control-plane can drive
      email/fleet UI without re-deriving it.

## 2. Cockpit + pods-list surfacing (web)

- [ ] 2.1 Pods-list: amber "Reconnect needed / Expiring Nd" chip on the affected pod (reuse the ribbon whose
      copy is fixed) + a fleet-header "N pods need reconnect →" summary linking to the first.
- [ ] 2.2 Cockpit agent card: days-remaining + the primary reconnect (RC) / renew-token (setup-token) action
      routes into the full-page wizard.

## 3. Email reminders (control-plane)

- [ ] 3.1 A scheduled control-plane job finds pods whose active login is in the warning window, groups by
      owner, and sends ONE batched email per owner per window-crossing (list every expiring pod + a per-pod
      renew deep-link). Reuse the Gmail-API send path.
- [ ] 3.2 Dedup marker (`login_reminder_sent_at` per pod+window) so a pod isn't emailed twice for the same
      window; cap ~2 per window (early + final). Honest copy (names the limit, one link per pod).
- [ ] 3.3 Migration for the marker column (nullable, backward-compatible; gateway-before-web).

## 4. Deprecate the no-op sweep (pod-agent / control-plane)

- [x] 4.1 Remove (or neuter to a non-renewing heartbeat) `refreshRunningIdlePods` — it does NOT renew logins
      (verified). Update `0audit` + the agent-login-resilience note. Ensure no code path reports a near-expiry
      login as "kept alive".

## 5. P2 — the 1-year unattended mode (web + pod-agent + control-plane)

- [ ] 5.1 `pods.agentAuth` gains/uses a `setup-token` value (the column already exists from api-key mode);
      LocalProvider + incus seed `CLAUDE_CODE_OAUTH_TOKEN` for such pods (pod-managed, mode 600, not `~/work`).
- [ ] 5.2 Launch/settings: an opt-in "Unattended (1-year login, driven by T3)" auth mode, explicit that native
      "Open in Claude" is unavailable and control comes from T3. Default remains subscription/RC.
- [ ] 5.3 Full-page **setup-token renew wizard** (cockpit takeover, mirrors the reconnect wizard): run
      `claude setup-token`, surface the `scope=user:inference` approval URL, capture the code, store the token
      durably, restart agent/T3. Handle the URL-wrap gotcha (capture the whole URL).
- [ ] 5.4 A `setup-token` pod hides native RC surfaces (Open-in-Claude) and points at T3; the expiry
      thresholds use the yearly cadence.

## 6. Verify + spec + ship

- [ ] 6.1 `tsc`/`build` green; control-plane tests for the reminder job (batching + dedup); a real-pod check of
      the setup-token renew flow end-to-end (owner approves once → token stored → agent runs).
- [ ] 6.2 Email deliverability check via the Gmail-API path (batched email lands, links resolve).
- [ ] 6.3 Update `openspec/specs/dashboard` + `openspec/specs/agent-credentials`; `openspec archive
      agent-auth-lifecycle`. Ship: web + gateway (+ migration) + a pod-base image build (thresholds, healthz
      expiry, setup-token seed, sweep removal).
