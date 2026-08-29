## Why

Podbay pods run 24/7, but a Claude subscription `/login` has a hard **~monthly** expiry that nothing on the
pod can extend (verified 2026-08-23: a `claude -p` turn and the access-token refresh both left
`refreshTokenExpiresAt` unmoved; only a full re-login resets it). When it lapses, the agent silently stops
and the owner — usually elsewhere — finds out too late. The existing `refreshRunningIdlePods` sweep that
claims to "renew the login before expiry" is a **no-op** for this and gives false confidence.

There is a second, verified path: **`claude setup-token` mints a ~1-year, inference-only token**
(`CLAUDE_CODE_OAUTH_TOKEN`). A Claude turn ran on it with `/login` removed → `TOKEN_WORKS`. It can't do
Claude's native Remote Control (inference-only), but **T3 Code** drives the CLI over its own channel, so a
**T3 + setup-token** pod gets phone control AND ~a year between re-auths. So the fix is two-fold: (1) make the
inevitable monthly re-login *legible and easy* (detection + cockpit + pods-list + **email reminders**), and
(2) offer a **1-year "unattended" pod mode** for agent/autonomous pods that don't need "Open in Claude".

Full analysis + UX: `docs/strategy/agent-auth-lifecycle.md`.

## What Changes

- **Detection (pod-agent):** keep the per-agent `agent-login-expiring` check; add tiered thresholds (RC
  ~7d/1d, 1-year ~21d/3d). Copy already corrected (names the ~monthly limit; Control not Settings).
- **Cockpit renewal action:** RC pods use the shipped reconnect wizard; add a full-page **setup-token "Renew
  token" wizard** (mint `setup-token` → owner approves once → store `CLAUDE_CODE_OAUTH_TOKEN` durably, mode
  600, never in `~/work`).
- **Pods-list surfacing:** amber "Reconnect needed / Expiring Nd" chip per affected pod + a fleet-header "N
  pods need reconnect" summary.
- **Email reminders:** batched **per owner** (one email lists all expiring pods, deep-linked), ~2 per window,
  via the existing Gmail-API path. Honest copy.
- **1-year unattended mode (opt-in):** a pod auth mode using the setup-token + T3 as the control layer, for
  pods that don't need native RC. Mode is explicit about the inference-only tradeoff.
- **Deprecate `refreshRunningIdlePods`** (verified no-op) — remove or neuter it so it stops implying logins
  stay alive on their own.

## Capabilities

### New Capabilities
<!-- none — extends existing dashboard + agent-credentials behavior -->

### Modified Capabilities
- `dashboard`: cockpit + pods-list surfacing of login expiry, the reconnect/renew-token wizards, the fleet
  reminder summary, and email reminders for expiring logins.
- `agent-credentials`: a pod auth mode using a long-lived `setup-token` (inference-only, T3-driven) alongside
  the subscription `/login`; and the correction that the idle-refresh sweep does not renew subscription logins.

## Impact

- **Code:** `packages/pod-agent` (thresholds; setup-token mint helper; deprecate the sweep), `apps/web`
  (setup-token renew wizard; pods-list chips + fleet summary; email trigger), `packages/control-plane`
  (email reminder job + a per-pod auth-mode field), `packages/db` (auth-mode / next-expiry columns if needed,
  backward-compatible), the Gmail-API send path.
- **Spec:** `openspec/specs/dashboard`, `openspec/specs/agent-credentials`.
- **External constraint:** renewal always needs the owner's browser OAuth (no headless renewal). N pods = N
  approvals. The 1-year mode depends on T3 (third-party) for remote control.
- **Ships:** web (wizard/chips/email), gateway (reminder job/schema), and a pod-base image build (thresholds +
  setup-token helper + sweep removal).
