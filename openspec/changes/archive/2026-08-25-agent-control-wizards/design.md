## Context

The Control tab renders per-agent cards (`agent-cards.tsx`), each with a state machine: `claude-signin` (OAuth link + paste box), `claude-ready` ("Open in Claude"), `codex-signin` (device code), `codex-on` (paired devices + "Pair a device" + the (i) modal), `codex-off` ("Turn on"), plus a reconnect path. Codex pairing lives in `codex-pair-panel.tsx` (Phone/Desktop tabs, step 1 pair, step 2 "open your session"), rendered inline (`embedded`) inside the card.

The cockpit (`pod-cockpit.tsx`) already uses a **full-page takeover** pattern for slow flows: it early-returns `<PodUpdating>` / `<T3Enabling>` (before the normal cockpit JSX) gated on durable state (`updating`, `t3Enabling`). Those components share a header (now `PhaseHeader`) and own the whole view. `ui-patterns.md` names agent sign-in and Codex pairing as the next flows to adopt this pattern.

The Codex (i) modal copy is wrong (hallucinated desktop-only steps, "Codex app"). Owner has supplied approved replacement copy and reviewed the wizard layouts (mockup `scratchpad/agent-ux-review.html`).

## Goals / Non-Goals

**Goals:**
- Correct the Codex info modal to the approved "Continue this Codex session" copy (ChatGPT app; mobile + desktop).
- Make ONE shared copy source for "continue your session", used by both the (i) modal and the pairing wizard's step 2 — so they never drift.
- Promote Codex pairing and Claude sign-in/reconnect to full-page wizards using the SAME early-return gating as `PodUpdating`/`T3Enabling`, keeping their existing mechanics.
- Preserve the step-1 pairing instructions; remove the "pod awake" footer; drop the two Claude-wizard lines the owner cut.

**Non-Goals:**
- No change to sign-in / pairing / RC mechanics, server actions, control-plane, or schema.
- No fix for the "every mobile project is named work" naming at the source (codex config has no display-name; documented — the modal copy sets the expectation instead).
- Not verifying the live ChatGPT-app menu paths from the pod (owner confirms; step-1 pairing paths kept as-is unless owner says they moved).

## Decisions

- **Full-page gating mirrors T3/update.** Add cockpit UI state (client, not durable — these are user-initiated and short-lived, unlike update/t3 which are durable server states): when the user is signing in / reconnecting an agent, or pairing Codex, the cockpit early-returns the corresponding wizard component before the normal tabs, exactly like `if (updating) return <PodUpdating.../>`. Gate off the existing signals: Claude wizard when an agent needs sign-in / the user hit Reconnect (there's already `authValue` + `submittingFor` state in agent-cards); Codex wizard when the user opens pairing (today `pairOpen`). The wizards reuse `PhaseHeader` for the header row.
- **Shared copy component.** New `components/codex-continue-session.tsx` exports the mobile + desktop step lists (as the approved copy, with a `podName` prop for `[pod name]`). The (i) `Dialog` renders it; the pairing wizard's "2 · Open your session" renders it. One definition.
- **Keep step-1 pairing content in `codex-pair-panel.tsx`.** The `STEPS` (Phone/Desktop pair paths) stay; only the surrounding chrome becomes full-page and "Codex app" → "ChatGPT app". The panel's `embedded` mode can remain for any non-wizard use, but the cockpit path uses the full-page wizard.
- **Claude wizard is a new component** (`components/claude-signin-wizard.tsx`) reusing the existing `SigninBox` logic (OAuth link + paste + submit + "Signing in…"), lifted out of the inline card into a full-page layout. Reconnect passes a `mode: "reconnect"` for the title/intro; the underlying action (`reconnectAgent` then the sign-in link) is unchanged.
- **Copy is locked** to the owner-approved mockup. `[pod name]` interpolates the pod's display name.

## Risks / Trade-offs

- **Full-page takeover hides the other tabs while active.** Acceptable and intentional (same as update/T3) — a sign-in/pairing is a focused task. The wizard must clear its state and return to the cockpit as soon as the agent is authed / the user closes pairing, or the user is stranded. Mitigate by gating on the SAME live signals the inline card used (authed → advance), plus an explicit close/cancel back to the cockpit.
- **Can't browser-verify the deployed result** (no owner auth). Mitigate: build + tsc + the owner-approved mockup as the visual contract; owner does the live click-through post-deploy; the step-1 pairing paths are owner-confirmed.
- **Regressing a working inline flow.** The sign-in/pairing mechanics are reused verbatim (same actions, same state), only relocated — keep the diff to presentation. Verify each card state still reaches its wizard and back.
- **`pairOpen`/`submittingFor` gating interacting with the new react-query polling** — the wizards read the same `qk.agents` live data; ensure the early-return doesn't unmount the polling that advances them.
