## Context

T3 Code is woven through every layer (audit 2026-08-30: ~500 matches, ~50 files), but the coupling is
shallow: the durable state (`t3_control`/`t3_since`/`t3_stage`/`t3_connected`, all default false/null)
is written only by the control-plane enable path, and the pod-agent yield marker only by that same
path. So the effective surface to disable T3 is small — the places a user or a request can START an
enable. Everything downstream is conditional on state that never becomes truthy once starting is
blocked.

Two existing patterns bound the design:
- **The `oss` prop** — `editionOss()` (`apps/web/lib/session.ts`) computed server-side, threaded as a
  boolean, consumed as `!oss && (...)`. This is the idiom for hiding a whole feature block behind a
  server-decided flag. Fastest fit for a single global toggle.
- **The env `capabilities` map** — `packages/shared/src/schema.ts` (`browserTesting`, `webFetch`),
  resolved in `resolve.ts`, surfaced via `apps/web/lib/environments.ts`. Per-environment, and the
  correct long-term home for a per-harness capability.

## Goals / Non-Goals

**Goals**
- Turn T3 off everywhere a user or request can reach it, with one flag, re-enablable instantly.
- Default ON, so deploying this change alone changes nothing until the owner flips it.
- Shape the flag so grok/opencode/cursor are additive, not a rewrite.
- Never strand an existing T3 pod; always leave it an off-switch.

**Non-Goals**
- Deleting or refactoring T3 code.
- Gating anything in pod-agent, the DB, or the provider.
- Building other CLIs.

## Decisions

### 1. A per-harness flag, shaped as `agentHarness.t3`, threaded like `oss`

Introduce a server-computed boolean — `harnessEnabled(harness)` — read from an env var
(`PODBAY_AGENT_HARNESS`, e.g. a comma list of enabled harnesses; T3 absent ⇒ off; DEFAULT includes
`t3` so behaviour is unchanged until the owner removes it). Compute it in the shared session/edition
layer next to `editionOss()` and thread it into the two server pages, exactly like `oss`.

The value is keyed by harness (`t3`) from day one. When grok/opencode/cursor arrive, the flag moves
into the env `capabilities` schema as `agentHarness: { t3, grok, opencode, cursor }` (mirroring
`webFetch`), resolved and surfaced identically — an additive change, not a rewrite. The immediate
implementation can back it with the env var and expose it as `agentHarness.t3`; the schema promotion
is deferred until a second harness exists.

**Rejected:** deleting T3 or a global `NEXT_PUBLIC_T3=off`. Deleting loses instant re-enable and the
generalization; a `NEXT_PUBLIC_*` client flag can't guard the server actions (below), so the toggle
would be UI-only and forgeable.

### 2. Four UI choke points, not 183 matches

Gate exactly these, and every other T3 surface goes inert because it is conditional on `t3_control`/
`t3_since` which no longer become truthy:
1. `launch-configure.tsx` Control picker — hide it and pin `control = "podbay"` (kills launch-into-T3;
   `t3Suffix` never triggers).
2. `pod-cockpit.tsx` `<T3ConnectPanel>` mount — `{harnessEnabled && (...)}`.
3. `pod-cockpit.tsx` the three T3 wizard early-returns (`T3Enabling`, `t3connect`,
   `renew-then-t3`) — guard so a hand-typed `?wiz=` cannot re-open them. `renew-token` (generic
   setup-token renew, T3-adjacent) is LEFT reachable — it is not T3-only.
4. `pod-cockpit.tsx` the `?enableT3=1` auto-enable effect — guard so a stale/forged URL can't start an
   enable.

### 3. Six server actions guarded server-side

The UI being hidden is not sufficient — Next server actions are directly invokable. Add an early
`if (!harnessEnabled("t3")) return { error }` to: `enableT3Code`, `startT3Connect`,
`submitT3ConnectCode`, `regenerateT3Pairing`, the auto-enable branch inside `completeSetupToken`, and
reject `control === "t3"` in `createPod`. **`disableT3Code` is deliberately NOT guarded** — an owner
must be able to turn OFF a pod already in T3 control after the flag flips.

### 4. The pod-agent side stays untouched — on purpose

`CLAUDE_RC_OFF` yield/resume and `healOrphanedRcYield` are SHARED (they cover Codex too) and are the
recovery path for a pod stranded by a T3 enable. After the flag flips off, a pod that was mid-T3 or
left an orphaned marker must still self-heal — gating the pod-agent would re-introduce the
2026-08-29 stranding bug. The marker is only WRITTEN by the (now-gated) control-plane enable path, so
no new markers appear; the heal for old ones must remain live. Same for `reconcileStuckT3Enables` on
the gateway — a safe no-op when nothing is in flight; leave it.

### 5. Let row-state drive the "Managed by T3" affordances

`externalControl` (which dims Codex pairing + Claude controls) is driven by `t3_control`. Once
enabling is gated, no new pod becomes `t3_control=true`, so it is inert automatically. Do NOT
hard-force `externalControl=false` — that would wrongly un-dim a pod that is genuinely in T3 control.

## Risks / Trade-offs

- **Edition parity.** Cockpit + launch are shared cloud/OSS surfaces; the flag must thread through
  both server pages and coexist with `editionOss()` (OSS already refuses T3 via `t3BackendUrl`).
- **Already-T3 pods.** Policy: keep `disableT3Code` reachable (decision 3). A running T3 pod is not
  migrated; it works and can be turned off.
- **Spec load.** T3 is heavily spec'd (dashboard, pod-agent, launch-config, self-host,
  session-handoff). The spec-driven rule requires updating the affected specs in-commit; this change
  edits the T3-offering requirements to be conditional on the harness capability. The pod-agent yield
  and orphan-heal specs are UNCHANGED (that behaviour stays).
- **e2e.** `t3-flows.spec.ts` exercises the enable/connect flows; it needs a flag-off variant (assert
  absence) and to keep the flag-on path (so re-enabling stays covered).

## Migration Plan

1. Add the flag (default ON) + thread it. Ship — no behaviour change yet.
2. Verify BOTH editions with the flag ON (T3 present, unchanged) and OFF (T3 absent from launch +
   cockpit + wizards; the six actions refuse; an already-T3 pod can still be turned off).
3. Flip the default/env to OFF for T3 when the owner is ready — the actual "disable" moment, reversible
   by flipping it back.

## Open Questions

- **Where the flag reads from initially:** an env var (`PODBAY_AGENT_HARNESS`) vs a hardcoded
  default-map in `capabilities`. Recommend the env var now (so the owner flips it without a deploy of
  new code), promote to `capabilities` when a second harness lands.
- **Does OSS get T3 at all going forward?** OSS already refuses T3 (no `t3BackendUrl`); the flag makes
  that explicit. Confirm we want T3 off for OSS by default regardless of the cloud flag.
