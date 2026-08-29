## Why

Two problems on the cockpit's Control tab:

1. **The Codex "(i)" info modal is wrong.** It currently reads "Open the session" and describes a single, desktop-only flow with steps that don't match reality (an earlier hallucinated draft). It also calls the app the "Codex app" — but the flow now lives in the **ChatGPT app** (Codex was merged in). Owners following it get lost.
2. **Agent sign-in / reconnect and Codex pairing are cramped inline blocks** inside the agent card. `ui-patterns.md` already names these as the next flows to move to the full-page takeover pattern (the same one used for pod update / T3-enable): a slow, multi-step flow deserves the whole view, not a few lines squeezed beside a status dot.

Owner (velsa) has reviewed and approved the exact copy + layout (mockup: `scratchpad/agent-ux-review.html`). This change implements it.

## What Changes

- **Corrected Codex info modal** (`agent-cards.tsx`) — retitled **"Continue this Codex session"**, split into **On mobile** and **On desktop** sections with the approved step lists, referencing the **ChatGPT app** (not "Codex app"). `[pod name]` is interpolated from the pod.
- **One shared "Continue this Codex session" copy block** — the mobile + desktop instructions become a single component rendered VERBATIM by BOTH the (i) modal AND the Codex pairing wizard's "Open your session" step, so the two can never drift.
- **Codex pairing → full-page wizard** (`codex-pair-panel.tsx` promoted) — the cockpit early-returns into it (gated on a pairing UI state, mirroring how `PodUpdating` / `T3Enabling` gate on durable state). Step-1 Phone/Desktop **pairing instructions are preserved exactly**; the "Codex app" wording switches to "ChatGPT app"; the "Remote control needs the pod awake…" footer line is **removed**.
- **Claude sign-in / reconnect → full-page wizard** — the inline sign-in block is promoted to a full-page takeover: header (dot + pod name + "Claude sign-in" pill), body "Sign this pod in to Claude so you can drive it from the Claude app or browser.", Step 1 "Open the Claude sign-in page ↗" (opens the OAuth `authValue`), Step 2 paste-code + Submit, then the existing "Signing in…" progress. **No** reassurance line, **no** "safe to close this tab" box (removed per owner). Reconnect reuses the same screen titled "Reconnect Claude".

No server/API/schema changes — this is a web-only, cockpit-presentation change. Agent state, pairing, and sign-in mechanics are untouched; only their presentation moves from inline to full-page, and the Codex modal copy is corrected.

## Capabilities

### New Capabilities
<!-- none — this is presentation of existing dashboard behavior -->

### Modified Capabilities
- `dashboard`: the cockpit's agent sign-in/reconnect and Codex pairing are specified as full-page takeover flows (like update/T3-enable), and the Codex "continue your session" guidance is specified (ChatGPT app, mobile + desktop, shared between the info modal and the pairing wizard).

## Impact

- **Code:** `apps/web/components/agent-cards.tsx` (Codex info modal; Claude sign-in/reconnect + Codex-on card states → full-page gating), `apps/web/components/codex-pair-panel.tsx` (promote to full-page; footer removal; ChatGPT-app wording), a new shared copy component (e.g. `components/codex-continue-session.tsx`), possibly a new `components/claude-signin-wizard.tsx`, and `apps/web/components/pod-cockpit.tsx` (early-return gating for the two new full-page states, alongside the existing `PodUpdating`/`T3Enabling` returns).
- **Spec:** `openspec/specs/dashboard/spec.md`.
- **No** control-plane / provider / db / gateway changes. Ships on a web deploy.
- **Verification gap:** the step-1 pairing menu paths (ChatGPT app) can't be verified from a pod — owner confirms against the live app; the copy is otherwise owner-approved.
