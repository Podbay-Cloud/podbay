# Design — T3 unattended integration

Verified facts this design rests on (all checked 2026-08-24 unless noted):
- **Port :3000** is the pod's ONLY internet-forwarded port (the preview). `t3 serve` binds it so the T3
  app can reach the pod; the gateway forwards it gated by `previewAppAuth` (T3's own pairing-token auth).
- **T3 has a cloud account** (app.t3.codes: sign-in + sync). Backend (`t3 serve`) is accountless
  (`~/.t3/userdata/environment-id` is its identity); the **app/account** stores + syncs the env list
  across the user's devices.
- **`claude` prefers `.credentials.json` over `CLAUDE_CODE_OAUTH_TOKEN`** (test:1) — so setup-token mode
  MUST relocate the cred or the token is a silent no-op.
- **T3 spawns its OWN `claude`/`codex`** (not via Podbay's `agentInvocation`) — so the token must be in
  the env `t3 serve` launches with, not just the reserved-secret mapping.
- **Codex** = ChatGPT device-auth (`~/.codex/auth.json`, self-refreshing); no 1-year-token analog. Hard
  cap unconfirmed (TODO).

## Decisions

**D1 — T3 is a third Agent option at launch (a control surface, not a fourth CLI).** The Settings step
gains `Claude Code | Codex | T3 Code`. Selecting T3 provisions the pod so T3 drives BOTH agents; Podbay's
own Open-in-Claude / Codex pairing step aside. Copy is owner-approved (see the launch mock). Rationale:
matches the user's mental model ("one app for both agents") and reuses the existing segmented picker.

**D2 — 1-year unattended auth for Claude; cred backed-up + relocated (reversible).** On switching a pod
to T3-unattended: mint `setup-token` via one owner OAuth (`startSetupToken`/`completeSetupToken`), store
as the reserved secret, `mv .credentials.json .credentials.json.pre-setuptoken`, set
`agentAuth=setup-token`. Launch `t3 serve` with `env CLAUDE_CODE_OAUTH_TOKEN="$PODBAY_AGENT_CLAUDE_OAUTH_TOKEN"`
so T3's Claude inherits it (the value expands at run time — never stored in the startup declaration).
Turning T3 off restores `.credentials.json` and reverts `agentAuth`.
- *Codex:* unchanged — keep its device login; if absent, device-auth during setup.

**D3 — One-tap pairing via deep link; T3 app owns sign-in (owner decision 2026-08-24).** The cockpit
offers "Open in T3" → `https://app.t3.codes/pair?…` built from the pod's backend URL + a fresh pairing
token. The user's signed-in T3 app saves the env to their **account** (synced). Podbay holds NO T3
credentials and calls NO T3 account API. QR + manual code stay as fallback. (Exact deep-link param shape
to confirm against the app when building — the current QR encodes `.../pair?pairing_code=…`; the hosted
variant is `app.t3.codes/pair?…`.)

**D4 — Enable is parallel + honest.** Handoff (needs live agents, precedes the yield) runs concurrently
with the t3 download/launch; yield after the handoff. Full 60s handoff budget (matches updates). Cold
`npx t3` download reliability is a known risk (exceeded 300s on test:1) — tracked separately; the fix is
a robust/retrying download keeping `t3@latest` (NOT pinning a baked version — owner rejected staleness).

**D5 — Launch-into-T3 provisioning.** A pod created with the T3 toggle runs the D2 setup as part of
provisioning (one OAuth during launch), then boots already under T3. Reuses the same enable path.

**D6 — ONE reusable provider-auth flow, not per-entry-point wizards (owner ask 2026-08-24: no dup code).**
Sign-in is not "a T3 thing" or "a launch thing" — it is *"bring each chosen provider to the auth state
this pod's mode needs."* Model it once:

- **Provider = an agent CLI** (T3's term): `claude`, `codex`, and later `cursor`, `grok`, `opencode`. A
  pod has a SET of providers (≥1 required; each optional otherwise — the owner picks which they want).
- **`computeAuthSteps(pod, targetProviders, targetMode) → Step[]`** — the single source of truth. For each
  target provider it emits the auth step that's actually MISSING for the target mode, and nothing if the
  provider is already in the right state:
  - `claude`, mode `podbay`/subscription, not signed in → **subscription `/login`** step.
  - `claude`, mode `t3`/unattended, not already `setup-token` → **setup-token OAuth** step (even if a
    subscription login exists — it gets relocated; the 1-year token is what T3 uses).
  - `codex`, not signed in → **device-auth** step. Already signed in → no step (kept as-is under any mode).
  - already-correct provider → **no step** (this is the "partial wizard" — it only shows what's missing).
- **`ProviderAuthWizard`** — one URL-backed (`?wiz=…`, refresh-safe) component that runs the computed
  Step[] in sequence, rendering each step with the EXISTING per-provider pieces (`claude-signin-wizard`,
  the setup-token/renew wizard, `codex-pairing-wizard`) as the step bodies. It advances step→step and
  finishes when the list is empty.

**Every entry point calls the same flow with different inputs — zero duplicate wizards:**
| Entry point | targetProviders | targetMode | Typical steps run |
|---|---|---|---|
| **Launch** | the owner's picks (≥1) | podbay or t3 | full auth for each unsigned provider |
| **Switch an existing pod to T3** | the pod's providers (+ any new) | t3 | ONLY what's missing: e.g. Claude→setup-token; Codex already signed in → skipped |
| **Add a provider in the cockpit** | existing + the new one | pod's current mode | ONLY the new provider's step |
| **Renew/expiry** | the affected provider | pod's current mode | just that provider's re-auth |

So "already signed in → partial wizard" and "add a provider later → same wizard" fall out for free: they
are just different `computeAuthSteps` results feeding the one `ProviderAuthWizard`. No new wizard per case.

**At-least-one-required** is enforced at selection: the launch picker and the cockpit "add provider"
control both require the resulting provider set to be non-empty.

## Risks / edge cases

- **Cred relocation on a pod with a running Claude session** — relocate before the agent restarts on the
  token; back up (never delete) so a revert restores it.
- **Deep-link param drift** — T3 is early and fast-moving; confirm the `app.t3.codes/pair` param shape at
  build time and keep the QR/code fallback.
- **Self-host** — `LocalProvider` must expose `:3000` the same way; verify the deep link resolves to a
  backend URL reachable by the user's T3 app (LAN/tunnel), not a cloud-only preview URL.
- **T3 logo asset** — none in-app; add the official mark to `AgentLogo` or fall back to a "T3" text mark.
