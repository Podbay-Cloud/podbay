## Why

T3 Code control shipped as a one-shot prototype: a single blue button in a Settings card that, on
click, **synchronously** blocks the server action for up to ~150s while it downloads t3, starts the
backend, and mints a pairing token — with **no explanation of what it does**, no warning that it
restarts the running Claude/Codex sessions, **no way to turn it off**, and Podbay's own remote-control
still fighting T3 for the agents underneath. It also can't work on self-host (the backend URL is built
only from the cloud `PODBAY_PREVIEW_BASE`). To make T3 a first-class, trustworthy pod-control mode we
need the enable to be an explained, confirmed, async wizard; a clean reversible disable; a real
ownership hand-off so Podbay yields the agents while T3 drives them (keeping them signed in); and
edition parity. The UX was reviewed and approved by the owner (mockup, with owner-edited copy).

## What Changes

- **Confirm before enabling.** Enabling opens a confirm modal (shared cockpit `AlertDialog` pattern)
  that states what T3 takes over, that running sessions restart, that files/sign-ins are preserved,
  and that it's reversible — instead of silently firing on click.
- **Enable runs as an async, refresh-safe wizard.** Replace the blocking server action + spinner with
  the durable full-page setup flow (the `PodUpdating` early-return pattern): steps Preparing →
  Downloading T3 → Starting backend → Creating code → Ready, polled to completion, surviving refresh.
- **Ownership hand-off (#6).** While T3 is in control, Podbay stops driving Claude and Codex
  remote-control (a Claude-greeter off switch symmetric to the existing `CODEX_RC_OFF`), so the two
  don't fight. Credentials are left untouched — **the agents stay signed in** (T3 uses the same
  on-disk logins) — and Podbay's control is restored on turn-off.
- **Disable / turn-off (the missing path).** A "Turn off T3 control" action (its own confirm) that
  stops `t3 serve`, removes the `t3-code` startup slug, flips `previewAppAuth` back to owner-auth,
  re-enables the Podbay dev server, and restarts Podbay's own remote-control.
- **In-control surfacing.** A persistent "T3 Code is in control" banner on the cockpit, and while T3
  is on the Open-in-Claude / Codex-pairing controls are hidden (they'd be dead anyway).
- **House button conventions.** The enable/disable triggers become tinted-outline actions, not blue
  (blue is house-reserved for "opens a new window").
- **Self-host parity (#7).** Build the T3 backend URL from the edition-correct published address
  (`LocalProvider.publishedAddress`), not only cloud's `PODBAY_PREVIEW_BASE`, so T3 works (or refuses
  honestly) on self-host.
- **Agent-update lockstep note (#9).** Document that a T3-backend pod should run `podbay agent update
  codex` to keep the npm codex and Podbay's pinned standalone RC daemon in lockstep (T3's in-app
  provider-update bumps only the npm one). No behavior change required — a documented guardrail.
- *Scope:* Claude + Codex only (per owner: finish claude/codex/t3 before Cursor/Grok/OpenCode).

## Capabilities

### New Capabilities
<!-- none — hardens existing capabilities -->

### Modified Capabilities
- `dashboard`: the "Connect a pod to the T3 Code app" requirement gains a confirmed, async wizard
  enable; a reversible turn-off; an in-control banner + hidden conflicting controls; house button
  conventions.
- `pod-agent`: Podbay yields its own agent remote-control (Claude + Codex) to an external harness
  while that harness is in control, without logging the agents out, and restores it on hand-back.
- `self-host`: the T3 Code backend URL is derived from the edition-correct published address so the
  feature works on the OSS/`local` edition, not only cloud.

## Impact

- **packages/control-plane/src/service.ts** — `enableT3Backend` split into async provision + poll;
  new `disableT3Backend`; wire the greeter/RC yield; use `setPreviewAppAuth` (currently uncalled) for
  the reverse flip.
- **packages/pod-agent/src/server.ts** — a Claude-greeter/RC off switch (e.g. `CLAUDE_RC_OFF`)
  honored by `startGreeter`/`reenableRemoteControl`/resume-watch, symmetric to `CODEX_RC_OFF`;
  a combined "yield all RC" state for the T3-in-control mode.
- **apps/web** — `t3-connect-panel.tsx` reworked into a Settings row + confirm modal; a
  `<T3Enabling>` full-page flow (cockpit early-return); the in-control banner; `t3BackendUrl` made
  edition-aware; `enableT3Code`/`disableT3Code` actions with polling.
- **packages/provider** — `LocalProvider.publishedAddress` consulted for the OSS backend URL;
  possibly a durable `t3Control` field for refresh-safe wizard state.
- **openspec/specs/{dashboard,pod-agent,self-host}** — updated in the same commits.
