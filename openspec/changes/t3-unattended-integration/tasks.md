# Tasks — T3 unattended integration

Some foundations shipped this session (marked). Deploys of shipped-but-undeployed control-plane bits are
batched.

## 1. Auth foundation (setup-token actually works)
- [x] 1.1 `completeSetupToken` relocates `.credentials.json` → `.pre-setuptoken` on switch to setup-token
      (else the token is a silent no-op — `claude` prefers the cred). `3757993`, deployed.
- [x] 1.2 Revert to subscription: `revertToSubscription` control-plane method + web action done (restores
      `.pre-setuptoken`, sets `agentAuth=subscription`, respawns Claude). Called from T3-off (D) and the
      renew flow. The standalone setup-token+Podbay dead-end is PREVENTED by coupling setup-token with T3
      (design), not recovered with a bespoke card.
- [ ] 1.3 Verify end-to-end with the owner's real OAuth: token minted, cred relocated, `claude -p` runs
      on the 1-year token with no `.credentials.json`.

## 2. T3 enable uses the 1-year token
- [x] 2.1 `runT3Enable`: on a setup-token pod, launch `t3 serve` with `env CLAUDE_CODE_OAUTH_TOKEN="$PODBAY_AGENT_CLAUDE_OAUTH_TOKEN" …` in the startup `--do` (verified: expands to the var NAME at run time, never the value). Gated on setup-token; subscription pods unchanged.
- [x] 2.2 Enable-decision (`onEnable` from T3ConnectPanel → cockpit): already-setup-token → enable
      directly; otherwise route through the setup-token OAuth (`renew-then-t3`) → mint token + relocate
      cred → then `enableT3Code` (which launches t3 on the token, 2.1). agentAuth threaded page→cockpit.
      **Needs live verify.**
- [x] 2.3 Parallelize handoff ∥ download; full 60s handoff budget. `e04f39f` (committed, undeployed).
- [ ] 2.4 Cold-`npx t3` download reliability — robust/retrying download with real progress, keeping
      `t3@latest` (no baked version). (Tracked; the 300s hard-poll failed on test:1.)

## 3. Launch toggle (T3 at pod creation)
- [x] 3.1 `LaunchConfigure` Settings step: multi-provider **Agents** picker (≥1, chips) + **Control**
      segment (Podbay / T3 Code, owner-approved copy + t3.codes link). Wired: `agents: providers` →
      `launchPod`; `control` param accepted (3.2 acts on it). Draft persists both. Settings step now
      always shows. **Needs live create-pod verification.**
- [x] 3.2 Launch-into-T3: a t3-control pod redirects to the cockpit with `?enableT3=1`; the cockpit
      auto-starts the same OAuth-then-enable flow (beginT3Enable, shared with the button) once the pod is
      READY. Reuses 2.2. **Needs live verify.**
- [x] 3.3 `AgentLogo` gains a T3 Code mark ("T3" in a sky→indigo gradient; official SVG can drop in), used in the launch Control segment.

## 4. One-tap pairing (deep link)
- [x] 4.1 `appPairUrl` = `app.t3.codes/pair?host=<backendUrl>#token=<code>` (documented T3 format; token in
      the HASH so it's never sent to T3's server). In `regenerateT3Pairing`. VERIFY live against the app.
- [x] 4.2 Cockpit "Open in T3" primary button (blue asChild `<a>`, T3 logo) opens the deep link; QR + code
      remain below as manual fallback. `t3-connect-panel.tsx`.
- [x] 4.3 Copy: "adds this pod to your T3 account — synced across your devices. No QR or code needed."

## 4b. ONE reusable provider-auth flow (no dup wizards — D6)
- [x] 4b.1 `computeAuthSteps(providers, mode, current) → AuthStep[]`: the single source of truth for
      which per-provider auth steps are missing for the target mode (claude subscription-login /
      setup-token / codex device-auth), emitting nothing for already-correct providers. Pure + unit-tested
      (7 cases incl. partial-wizard, add-provider, setup-token-not-adequate-under-Podbay). `apps/web/lib/provider-auth-steps.ts`.
- [x] 4b.2 `ProviderAuthWizard` runs the Step[] in sequence with a stepper header ("Step N of M" + provider
      dots), rendering each step with the existing wizards embedded. Advances on each step's success.
      `apps/web/components/provider-auth-wizard.tsx`. **Needs live click-through.**
- [~] 4b.3 Wire entry points: cockpit signin / reconnect / renew now route through `ProviderAuthWizard`
      (single-step). REMAINING: launch (picks + mode), switch-to-T3, cockpit "add a provider" — the
      MULTI-step + URL-backed stepIndex, built with Phase B/C.
- [x] 4b.4 Refactored the standalone wizards into embeddable step bodies (`embedded` + `onComplete` +
      `providerLabel` — the signin body now serves Codex device-auth too). No per-entry-point wizard dup.

## 5. Reconnect / renew affordance (safe)
- [x] 5.1 DONE: the cockpit re-auth affordance (agent-cards) now routes by auth MODE via claudeReauthMode:
      setup-token → non-destructive RENEW wizard (no session-interrupt warning); subscription → confirmed
      RECONNECT wizard. Both the expiring-soon prompt and the expired Reconnect button branch. Pure helper
      unit-tested; dashboard spec updated. e2e of the wizard-open flow deferred (fake-stack setup-token pod).

## 6. Edition parity + specs + verify
- [ ] 6.1 Self-host (`LocalProvider`): `:3000` transport + a deep link that resolves to a user-reachable
      backend URL; verify with `editionOss()` on.
- [ ] 6.2 Update specs in-commit: `launch-config`, `dashboard`, `agent-credentials` (this change's deltas).
- [ ] 6.3 Verify BOTH editions before "done" (cloud smoke + a self-host pod).

## 7. Records
- [x] 7.1 `docs/strategy/provider-auth-control-flows.md` — full per-provider auth/control decision map
      (Claude/Codex/T3 + new-provider checklist), corrected re the T3 cloud account.
