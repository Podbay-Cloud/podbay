## Context

Grounded in the code audit (file:line). Current state:
- **Enable is one blocking exec.** `enableT3Backend` (`service.ts:1756-1768`) runs `T3_SETUP_SCRIPT`
  (`service.ts:78-85`): `podbay dev disable` → `podbay startup add --slug t3-code --port 3000 … npx
  t3@latest serve …` → wait loop `seq 1 50 × sleep 3` (≤150s) → mint token via regex
  (`service.ts:1745-1749`) → flip `previewAppAuth=true`. The web action `enableT3Code`
  (`actions.ts:370-383`) just `await`s it — no polling; the button shows "Setting up… (first run
  downloads T3)".
- **No disable exists.** Exhaustive grep: nothing stops `t3 serve`, removes the slug, flips
  `previewAppAuth` back (the setter `setPreviewAppAuth` at `service.ts:1736` has zero callers),
  re-enables `podbay dev`, or restarts Podbay RC.
- **No Claude ownership-yield.** `CODEX_RC_OFF` (`server.ts:94`) turns Codex's daemon off, but there
  is **no Claude equivalent** — `startGreeter` (`server.ts:2154`), `reenableRemoteControl`
  (`server.ts:2170`), and the resume watcher (`server.ts:2357-2362`) keep typing `/remote-control`
  into Claude regardless. Creds live at `/home/dev/.claude/.credentials.json` +
  `/home/dev/.codex/auth.json` on the persistent volume; `t3 serve` runs as the same `dev` user, so
  it shares them — agents stay signed in with no re-auth.
- **Self-host URL gap.** `t3BackendUrl` (`actions.ts:365-368`) only builds
  `https://<slug>.<PODBAY_PREVIEW_BASE>`; `LocalProvider.publishedAddress` (`provider.ts:410-421`)
  returns `http://127.0.0.1:<port>` for `local` mode. So OSS either errors ("Preview base URL isn't
  configured") or yields a non-routable subdomain.
- Existing spec: `dashboard/spec.md:1511-1526` covers enable + regenerate only.

## Goals / Non-Goals

**Goals:**
- Enabling T3 is explained, confirmed, and runs as an honest async wizard — never a silent long block.
- T3 control is fully reversible with one clean turn-off.
- Podbay and T3 never fight for the agents: exactly one is in control at a time; the agents stay
  signed in across the hand-off in both directions.
- The feature works on cloud AND self-host, or refuses honestly where it can't.
- Match the reviewed+approved mockup and the cockpit's own conventions (tinted-outline triggers,
  shared confirm modal, `PodUpdating`-style full-page flow).

**Non-Goals:**
- Cursor/Grok/OpenCode breadth (owner: after claude/codex/t3).
- Changing T3's own app or its provider-update commands (we document the lockstep, not patch T3).
- Reworking the delegated-auth transport itself (`previewAppAuth` gateway path is fine; we just make
  it reversible and edition-correct).

## Decisions

**D1 — Async enable via the durable `PodUpdating` pattern, not a blocking action.**
Split `enableT3Backend` into (a) a fast action that records "t3 provisioning" durable state + kicks
off the setup detached (mirroring `startPodImageUpdate` → `void runPodImageUpdate().catch(...)`), and
(b) a `t3Progress(slug)` poll the cockpit reads every ~3s. The cockpit early-returns a `<T3Enabling>`
full-page flow while provisioning (gated on the durable flag, seeded from the pod row so it's
refresh-safe), then falls back to the cockpit + pairing panel when done. Stages: `preparing` →
`downloading` → `starting` → `pairing` → `ready`.
- *Alternative:* keep it synchronous but raise the HTTP timeout — rejected: still a spinning button,
  still times out on a slow download, and can't survive a refresh.

**D2 — A single "T3 in control" mode that yields BOTH agents' RC, via an off-switch symmetric to `CODEX_RC_OFF`.**
Introduce a Claude-side off switch (e.g. `CLAUDE_RC_OFF`, mirroring `CODEX_RC_OFF` at `server.ts:94`)
honored by `startGreeter`, `reenableRemoteControl`, and the resume watcher; combine with the existing
`CODEX_RC_OFF` under one control-plane action so enabling T3 sets both and disabling clears both. On
enable, also `pkill` the live greeter/daemon (as the codex toggle already does, `server.ts:638-666`).
Credentials are never touched — only the *driving* stops — so the agents stay signed in and T3 picks
them up. This is the concrete guarantee behind the owner's #6 question.
- *Alternative:* a brand-new `t3Control` boolean that the greeter reads — rejected: reuses less, and
  the `CODEX_RC_OFF` file-flag pattern already exists, is doctor-aware (`podbay-doctor:180`), and is
  restart-durable. Symmetry beats a parallel mechanism.

**D3 — Disable is the exact inverse, and also confirmed.**
`disableT3Backend`: stop `t3 serve` + `podbay startup remove t3-code`, `podbay dev enable` (restore
the :3000 dev server), `setPreviewAppAuth(false)` (the existing unused setter), clear
`CLAUDE_RC_OFF`+`CODEX_RC_OFF` and restart Podbay's greeter/daemon. Its own confirm modal (restarting
the agents back under Podbay is consequential). Idempotent + safe to re-run.
- *Ordering:* free the port and flip auth back BEFORE restarting the dev server, so :3000 isn't
  double-bound.

**D4 — In-control surfacing + hidden conflicting controls.**
A durable `t3Control` state on the pod row drives: a "T3 Code is in control" cockpit banner, hiding
Open-in-Claude / Codex-pairing (dead while T3 owns the agents), and the Settings "Turn off" row. This
is the render source of truth (refresh-safe), like `updatingSince`.

**D5 — Edition-correct backend URL.**
`t3BackendUrl` consults the same source the pod's browser preview uses: cloud →
`<slug>.<PODBAY_PREVIEW_BASE>`; self-host → `LocalProvider.publishedAddress(slug, 3000)`
(`pod-service.ts:53-55` already uses it for the browser link). If neither yields a routable URL (plain
`local` loopback with no public base), refuse with an honest message rather than mint a broken token.
- *Edition split:* branch on `editionOss()` (`session.ts:8-10`) in the action, matching the rest of
  `actions.ts`.

**D6 — Agent-update lockstep is documentation, not code.**
Record (runbook + the in-control banner help, and keep the `0audit.md` note) that on a T3-backend pod
`podbay agent update codex` moves the npm codex and Podbay's pinned standalone RC daemon together;
T3's in-app update bumps only the npm one and init.sh re-pins the standalone on reboot. No code change
this change — just prevent the surprise.

## Risks / Trade-offs

- **[Enable succeeds but pairing token mint fails]** → the wizard's `pairing` step surfaces a retry
  (reuse `mintT3Pairing`, the no-reprovision fast path) rather than tearing everything down; the
  durable state stays "provisioned, needs code".
- **[Disable leaves a half-torn state]** (t3 stopped but preview still delegated) → make each step
  idempotent and re-runnable; `disableT3Backend` re-asserts the full Podbay-in-control target state,
  so a re-run converges. Verify :3000 is the dev server again before clearing the wizard.
- **[Greeter races the yield]** (a resume fires `reenableRemoteControl` just as T3 turns on) → the
  off-switch is a file flag checked at the top of each RC path, so a race resolves to "skip" on the
  next check; also `pkill` on enable.
- **[Self-host refuses]** — acceptable and honest: a plain loopback `local` pod genuinely can't expose
  a backend URL a phone can reach; say so (and point at the public deployment modes) rather than mint
  a dead token.
- **[Two primitive libraries / house style]** — reuse the existing `AlertDialog` (radix-ui in this
  app) + `PodUpdating` components; introduce no new dialog/primitive.

## Migration Plan

Image + apps. The `CLAUDE_RC_OFF` switch is **image-baked** (pod-agent → pod-base rebuild + digest
bump). The wizard/disable/parity are control-plane + web. If a durable `t3Control`/wizard-stage field
is added to the pod row, it's a schema add → **gateway before web**, backward-compatible (nullable;
older code treats absent as "not in T3 control"). Verify on a test pod: enable (watch the wizard,
confirm Claude+Codex stop being driven by Podbay yet stay signed in, confirm pairing), then disable
(confirm Podbay RC + dev server + controls all come back). Reason through self-host with `editionOss()`
on. Rollback = re-point pod-base alias + redeploy prior app release; the reverse flip is idempotent.

## Open Questions

- **Durable wizard stage vs. derive from probes?** Persist a `t3Control`/stage on the row (simplest,
  refresh-safe, mirrors `updateStage`) vs. derive live from "is :3000 t3? is the slug present?" —
  leaning persisted for refresh-safety and a schema add.
- **One combined RC-off flag vs. two?** Reuse `CODEX_RC_OFF` + new `CLAUDE_RC_OFF` set together, vs. a
  single `AGENTS_RC_OFF`. Leaning two-flags (least new surface, keeps the codex toggle independent).
