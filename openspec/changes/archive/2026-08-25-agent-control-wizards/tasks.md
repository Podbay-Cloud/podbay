# Tasks

Web-only, cockpit presentation. Reuse existing sign-in/pairing mechanics; move them to full-page. Build order: shared copy → Codex modal → Codex wizard → Claude wizard → gating → spec/verify. Owner-approved mockup: `scratchpad/agent-ux-review.html`.

## 1. Shared "Continue this Codex session" copy

- [x] 1.1 New `apps/web/components/codex-continue-session.tsx`: exports the approved **mobile** (3 steps) + **desktop** (6 steps + "Next time, just select the project from the sidebar") guidance as one component, `props: { podName: string }`, interpolating `[pod name]`. References the **ChatGPT app**. Small building blocks (a `Section` for mobile/desktop) so both the modal and the wizard render it identically.

## 2. Correct the Codex info "(i)" modal

- [x] 2.1 In `agent-cards.tsx`, replace the wrong "Open the session" Dialog (currently `DialogTitle` "Open the session" + the hallucinated `<ol>`): retitle **"Continue this Codex session"**, subtitle "Use the ChatGPT app on your phone or computer to continue working in this pod.", body = `<CodexContinueSession podName=… />`. Keep the standard Info-in-Dialog trigger + a11y.

## 3. Codex pairing → full-page wizard

- [x] 3.1 Promote `codex-pair-panel.tsx` to a full-page layout (or a thin `CodexPairing` wrapper reusing it): `PhaseHeader` (dot + pod name + "Pair Codex" pill + `env · Codex`), intro "Sign into the ChatGPT app with your account — your pod appears as [device].". KEEP the step-1 `STEPS` (Phone/Desktop) verbatim; switch "Codex app" → "ChatGPT app" wording. QR on wide + Phone as today.
- [x] 3.2 Step "2 · Open your session" renders `<CodexContinueSession>` (the SAME shared copy as the modal) instead of the current `OPEN_STEPS`/phone blurb; delete the now-duplicated `OPEN_STEPS` + phone one-liner. REMOVE the "Remote control needs the pod awake — it stays connected while the pod is running." footer.
- [x] 3.3 Cockpit early-return: in `pod-cockpit.tsx`, render the pairing wizard as a full-page takeover gated on the pairing UI state (mirror the `if (updating) return <PodUpdating/>` / `t3Enabling` pattern), with a close/cancel back to the cockpit. The card's "Pair a device" button enters it.

## 4. Claude sign-in / reconnect → full-page wizard

- [x] 4.1 New `apps/web/components/claude-signin-wizard.tsx` reusing the existing `SigninBox` OAuth-link + paste + submit + "Signing in…" logic (lift it out of the inline card, don't rewrite the mechanics). Layout: `PhaseHeader` (dot + pod name + "Claude sign-in" pill + `env · Claude Code`), body "Sign this pod in to Claude so you can drive it from the Claude app or browser." (NO reassurance line, NO "safe to close this tab" box), Step 1 "Open the Claude sign-in page ↗" (opens `authValue`) + caption "Approve it, then Claude shows you a code to paste back.", Step 2 paste input + Submit, then the "Signing in…" progress.
- [x] 4.2 `mode: "reconnect"` variant → title "Reconnect Claude" (reuses the same screen; the reconnect action wipes the token + respawns into `/login`, unchanged).
- [x] 4.3 Cockpit early-return gating: render the Claude wizard full-page when a Claude agent is in sign-in/reconnect (gate off the existing `authValue`/`submittingFor`/reconnect signals in agent-cards), alongside the update/T3 early-returns; return to the cockpit automatically on `authed`.

## 5. Verify + spec + ship

- [x] 5.1 `pnpm --filter @podbay/web exec tsc --noEmit` clean + `pnpm --filter @podbay/web build` green; grep confirms no remaining "Codex app" / "Open the session" / "pod awake" footer / the two removed Claude lines.
- [x] 5.2 Confirm the shared copy renders identically in the (i) modal and the pairing wizard step 2 (same component).
- [ ] 5.3 Update `openspec/specs/dashboard` (folds on archive); `openspec archive agent-control-wizards`. Deploy web; owner click-through: Claude sign-in + reconnect takeover→return, Codex pairing takeover + step-1 paths correct against the live ChatGPT app, the (i) modal copy.
