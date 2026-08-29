## Context

Verified this session (`docs/strategy/agent-auth-lifecycle.md`): subscription `/login` has a hard ~monthly
expiry nothing on the pod extends; `claude setup-token` gives a ~1-year inference-only token that runs CLI
turns (proven) but can't do native Remote Control — T3 drives the CLI instead. The pod-agent already has a
per-agent `agent-login-expiring` health check and a (now-corrected) reconnect card; this session shipped the
full-page reconnect wizard. What's missing: proactive off-pod notice (email), fleet-level surfacing, a
setup-token renewal path, and an explicit 1-year "unattended" mode.

## Goals / Non-Goals

**Goals**
- The owner never gets silently logged out without a heads-up they can act on from anywhere (email + in-app).
- Renewing is a ≤1-minute, obvious action from the cockpit — for both `/login` (monthly) and setup-token (yearly).
- Offer a 1-year unattended mode for pods that don't need "Open in Claude".
- Stop implying logins stay alive on their own (remove the no-op sweep).

**Non-Goals**
- Automated/headless renewal — impossible (needs the owner's browser OAuth). We optimize *reminding*, not automating.
- Batch re-auth across pods — each pod's OAuth is independent; out of scope (and not possible today).
- Replacing T3 with our own long-lived-token remote control — RC needs the full-scope session by design.

## Decisions

- **Two modes, RC is the default.** `dashboard`/launch keeps subscription `/login` as default (native
  "Open in Claude" is the pitch). The 1-year mode is an **opt-in** per-pod auth mode (`agentAuth` already
  exists on `pods`) — reuse/extend it: `subscription` (default) vs `setup-token`. A `setup-token` pod is
  explicit that RC comes from **T3**, not the Claude app.
- **Detection stays in the pod-agent** (`agent-login-expiring`, per agent) — it reads the real credential
  expiry. Add tiered thresholds by mode. The control-plane learns "next expiry per pod" from healthz to drive
  email/fleet UI without re-deriving it.
- **Email is a control-plane job, batched per owner.** A scheduled sweep finds pods whose active login is in
  the warning window, groups by owner, and sends ONE email per owner per window-crossing (dedup via a
  `login_reminder_sent_at` marker so a pod isn't emailed twice for the same window). Reuses the Gmail-API path.
- **Renewal wizards are full-page cockpit takeovers** (the pattern shipped for reconnect). The setup-token
  wizard mirrors it: mint → owner approves the `scope=user:inference` URL once → capture code → store
  `CLAUDE_CODE_OAUTH_TOKEN` durably (pod-managed, mode 600, never `~/work`, never logged) → restart agent/T3.
- **Pods-list uses the existing ribbon/chip signal** (copy fixed); add a fleet-header count that links to the
  first affected pod.
- **Remove `refreshRunningIdlePods`** (or reduce it to a no-cost heartbeat that does NOT claim to renew logins).

## Risks / Trade-offs

- **Setup-token is inference-only** → a `setup-token` pod has no native RC; the mode's UX must make T3 the
  control path unmistakable, or owners will think RC is broken. (This is exactly the confusion the shelved
  api-key mode hit — so the mode copy must be explicit.)
- **T3 dependency** (third-party) for the 1-year mode's remote control. If T3 changes its pairing/serve
  contract, the mode breaks — keep the T3 integration isolated (it already is: `t3-connect-panel` + the
  yield seam).
- **Email deliverability / noise** — batching + a 2-per-window cap + a dedup marker keep it from becoming
  spam; still, get the copy right (honest, actionable, one link per pod).
- **Owner-away worst case** — a pod can still lapse if the owner ignores every reminder. The UI must fail
  loud (expired banner + fleet chip) and recover cleanly on reconnect (already does).
- **Can't verify the exact 1-year lifetime** from the opaque token — documented as ~1 year; add a runtime
  check that reads the token's expiry if/when it's exposed, else trust the credential-file expiry the health
  check already reads.
- **Scope creep:** email + fleet + a new mode + schema is a lot. Phase it (see tasks): renewal/reminder UX
  first (needed regardless), 1-year mode second.
