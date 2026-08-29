# T3 Code as a first-class, unattended agent control surface

## Why

T3 Code (t3.codes) is an agent-harness control surface: a phone/desktop/web app that drives Claude and
Codex on a machine. Podbay already supports enabling T3 on an existing pod, but three things are missing
to make it a real product option:

1. **The monthly re-login kills the "24/7 managed pod" promise.** A Claude *subscription* login hard-
   expires ~monthly and nothing on the pod extends it (verified). T3 drives the CLI over its OWN
   channel — it never needs Claude's native remote-control — so an **inference-only 1-year
   `setup-token`** is exactly enough and removes the monthly re-login. T3 pods should run on it.
2. **T3 should be choosable at pod creation**, not only enabled after the fact — as a third "agent"
   option that *replaces* Podbay's built-in Claude/Codex controls with one app driving both.
3. **Pairing is clumsy** (scan a QR / type a code). T3 has a **cloud account** (app.t3.codes, verified
   2026-08-24) that syncs a user's environments across their devices — so pairing should be a **one-tap
   deep link** that adds the pod to the user's T3 account.

This change also records the full per-provider auth/control decision map so a NEW provider (Grok,
OpenCode, Cursor) can be added by filling the same rows (see `docs/strategy/provider-auth-control-flows.md`).

## What changes

- **Launch toggle:** T3 Code appears as a third **Agent** option on the create-pod Settings step
  (opt-in, off by default). Selecting it provisions the pod into T3 unattended mode.
- **1-year unattended auth (Claude):** enabling T3 (at launch or after) mints a 1-year `setup-token`
  via one owner OAuth, relocates the subscription `.credentials.json` (it otherwise wins over the token),
  and launches `t3 serve` with `CLAUDE_CODE_OAUTH_TOKEN` in its env so T3's Claude runs on it. Reversible:
  turning T3 off restores the subscription cred.
- **Codex:** keeps its self-refreshing ChatGPT device login (no 1-year-token equivalent). Signed in →
  kept; not signed in → device-auth during setup.
- **One-tap pairing via deep link:** the cockpit offers "Open in T3" → `app.t3.codes/pair?token=…`; the
  user's (signed-in) T3 app adds the environment to their **T3 account**, synced across devices. Podbay
  holds **no** T3 credentials. QR/manual code remain as a fallback.
- **Enable is parallelized** (handoff ∥ t3 download) and the handoff keeps the full 60s budget.
- **A T3 Code logo** is added to `AgentLogo` (the app currently has none).

## Impact

- Specs: `launch-config` (the toggle), `dashboard` (cockpit T3 panel + pairing deep link + agent card),
  `agent-credentials` (setup-token mode + cred relocation + Codex), `session-handoff` (already updated),
  `self-host` (edition parity for the above).
- Editions: cloud + self-host both. The `t3 serve` transport is the pod's `:3000` preview forward, gated
  by `previewAppAuth`; must work under `LocalProvider` too.
- Non-goals: reworking the delegated-auth transport; a T3 account API we control (we hand off the deep
  link, T3 owns its account/sign-in); env-level T3 defaults (per-pod toggle only for now).
