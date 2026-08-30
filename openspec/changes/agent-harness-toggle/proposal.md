## Why

T3 Code (an external agent harness that takes control of a pod's Claude/Codex CLI over its own relay)
adds a whole decision-and-control surface: a launch-screen Control picker, a cockpit Enable/Connect/
Turn-off panel, an account-connect wizard, a full-page enable/disable flow, and the "Managed by T3"
agent state. It is powerful but it **complicates onboarding and the cockpit** for the majority of pods
that never use it, and it is the source of several fragile flows this project has repeatedly paid for
(stuck enables, orphaned RC-off markers, the T3 download poll).

We want to **turn T3 off behind a switch** — hidden from every user flow and every logic path, but
re-enablable by flipping one flag — as the first step in simplifying UX, internal logic, and
onboarding. This is also the mechanism we will reuse to enable/disable **future agent CLIs** (grok,
opencode, cursor): a per-harness capability, off by default, that a flag turns on.

A full read-only audit (2026-08-30) established that T3 is **well-isolated despite its ~500-match
footprint**: every durable T3 signal (`t3_control`/`t3_since`/`t3_stage`/`t3_connected`) defaults
false/null, and the pod-agent yield marker (`CLAUDE_RC_OFF`) is written ONLY by the control-plane
enable path. So gating the **entry points** makes the backend, pod-agent, DB, provider, and all the
status chips go inert on their own. This is a **flag-in-place change, no refactor first** — hide ~4 UI
choke points, guard ~6 server actions, update the specs. Effort: **Medium**.

## What Changes

- **A per-harness capability flag, off for T3.** A server-computed `agentHarnessEnabled` (from an env
  var, default ON so existing behaviour is unchanged until the owner turns T3 off), threaded through
  the shared surfaces exactly like the existing `oss` prop. Structured from day one as
  `agentHarness.t3` so grok/opencode/cursor are an ADDITIVE change later, not a rewrite — the natural
  home is the env `capabilities` map (same shape as `webFetch`/`browserTesting`).
- **Hide T3 from every user flow** by gating the four choke points: the launch Control picker, the
  cockpit `T3ConnectPanel` mount, the three T3 wizard early-returns (so a hand-typed
  `?wiz=t3connect|renew-then-t3` cannot re-open them), and the `?enableT3=1` auto-enable effect.
- **Guard the T3 server actions** (`enableT3Code`, `startT3Connect`, `submitT3ConnectCode`,
  `regenerateT3Pairing`, the auto-enable inside `completeSetupToken`, and `createPod`'s
  `control:"t3"`) so they refuse when the flag is off — the UI being hidden is not sufficient, these
  are directly-invokable.
- **Deliberately DO NOT gate the pod-agent side.** The `CLAUDE_RC_OFF` yield and `healOrphanedRcYield`
  are SHARED (they also cover Codex) and must stay live — that is what reclaims a pod stranded by a
  PREVIOUSLY enabled T3 pod after the flag flips off. Gating them would strand pods (the exact bug
  class from 2026-08-29).
- **Keep `disableT3Code` reachable** so an owner can turn OFF a pod that is already in T3 control after
  the flag flips. Turning T3 ON is what the flag blocks; turning it OFF must remain possible.

### Explicit non-goals
- **Not deleting T3 code.** It stays, dormant, behind the flag — re-enablable instantly.
- **Not migrating existing T3 pods.** A pod currently in T3 control keeps working; it just can't be
  newly enabled, and can still be turned off.
- **Not building grok/opencode/cursor** — only shaping the flag so they slot in additively.
- **Not the broader UX-simplification pass** (cockpit split, copy trimming, mobile) — tracked
  separately; this change only removes the T3 surface, which is its first, free win.

## Capabilities

### New Capabilities
- `agent-harness-toggle`: a per-harness capability flag (off-by-default for a harness) that gates
  whether that harness's enable flow is offered anywhere in the product, in both editions.

### Modified Capabilities
_None as delta files._ The gating is captured as a new cross-cutting requirement in the
`agent-harness-toggle` capability. The existing `dashboard` ("Connect a pod to the T3 Code app"),
`launch-config`, `pod-agent` (yield/orphan-heal) and `self-host` T3 requirements are UNCHANGED — they
describe T3's behaviour WHEN enabled, which still holds. The new capability adds the "only when
enabled" gate on top, so nothing existing is being modified, only conditioned.

## Impact

**Code**
- New: the server-computed flag + a thread-through (mirrors `apps/web/lib/session.ts`'s `editionOss`).
- `apps/web/components/launch-configure.tsx` — hide the Control picker, pin `control="podbay"`.
- `apps/web/components/pod-cockpit.tsx` — gate the `T3ConnectPanel` mount, the three wizard
  early-returns, and the `?enableT3=1` effect.
- `apps/web/lib/actions.ts` — early-refuse the six T3 server actions when disabled.
- Both server pages (`dashboard/pods/[slug]/page.tsx`, `pods/new/page.tsx`) — compute + thread the flag.
- `apps/web/e2e/t3-flows.spec.ts` — a flag-off variant (asserts T3 is absent) + keep the flag-on path.

**Untouched on purpose** (they go inert automatically or must stay live): pod-agent, the DB columns,
the provider, `pod-visual-state.ts` chips, `agent-cards.tsx` "Managed by T3" (row-state-driven).

**Risks to design against**
- Edition parity: cockpit + launch are shared cloud/OSS — thread the flag through both.
- Don't hard-override `externalControl`; let `t3_control` drive it (a forced false would un-dim a
  genuinely T3-controlled pod).
- Gate only the T3 `?wiz=` values, never the `wiz` router (shared with Codex/Claude wizards).
- Default the flag ON so this change is a no-op until the owner sets it off — no surprise behaviour
  change on deploy.
