## Why

A pod can be broken and **nothing notices**. Two failures this week made the class concrete:

1. An image update silently dropped an added agent. The DB said two agents, the pod ran one, and it
   was caught only because a human happened to look.
2. Verified on a live pod (`correct-jackal-c6bf`, 2026-07-29): `tmux kill-server` is **terminal**.
   `/healthz` reports `ready: false` and keeps reporting it (checked at 10s, 60s, 90s) — the pod
   *knows* it is dead. systemd does not restart it (`NRestarts=0`, unchanged `MainPID`): the
   pod-agent PROCESS is alive, only its PTY child died, so the unit's restart policy never fires.
   The pod has no terminal and no agents until a human intervenes.

That is the whole product promise inverted. Podbay sells "a pod you can leave alone", and we
actively steer users away from the terminal (it is the Admin surface) — which raises the obligation:
if we hide the terminal, we owe them recovery without it. Today the only repair path is an operator
with SSH to the box.

The same live test proved the recovery: `systemctl restart podbay-agent` rebuilt the session AND
restored both agents from `spec.agents` (codex window 0, claude-code window 1, both authed, both
`rcActive`). So the boot path already knows how to reconstruct a pod correctly — nothing calls it.

## What Changes

- **A watchdog in the pod-agent tick** that asserts the pod's declared shape (`spec.agents`) and
  repairs drift: a dead session, a missing agent window, a window whose agent process has exited,
  sidecar daemons that should be up. Repairs are **capped and backed off** (3 per target per rolling
  hour) and **every repair emits a pod event** — silent self-healing is how a pod ends up
  mysteriously wrong, and the cap is what stops us fighting a user who quit deliberately or looping
  on a CLI that crashes at start.
- **Session recovery reuses the proven boot path** rather than a second in-process rebuild: when the
  session is unrecoverable the agent exits and systemd restarts the unit, which is exactly the
  sequence measured to restore a pod completely. Guarded by the same cap.
- **Health becomes reportable**: `/healthz` gains `issues[]` (id, severity, title, detail, fixable),
  so the cockpit can say what is wrong instead of the owner inferring it from a stuck card.
- **The cockpit surfaces health only when it is bad** — a strip in the ready state when something is
  wrong, invisible when green; the full check list and manual run live in the Admin tab, consistent
  with terminal-is-admin.
- **`podbay doctor`**: a checklist CLI in the image (`probe()` + optional `fix()` per check,
  `--json`), exposed by the pod-agent as transport and runnable by the pod's own agent. Fixes
  escalate by blast radius — safe repairs applied on request, invasive ones behind an explicit
  confirm that backs up before replacing, and "restart/update the pod" as the honest last resort
  (the rootfs is disposable, so a restart IS the reinstall).

Out of scope for this change: admin exec into user pods; reading secret values, terminal buffers or
chat content (they stay impossible, not merely hidden); fleet-level health (belongs to
`observability`); and any modification of `~/work` content — doctor may report on it, never touch it.

## Impact

- Affected specs: `pod-agent` (watchdog, session recovery, health reporting, doctor transport),
  `dashboard` (health strip + Admin doctor panel).
- Affected code: `packages/pod-agent` (tick, session lifecycle, new routes), the pod image (doctor
  CLI + runtime-rules entry), `packages/provider` + `packages/control-plane` (passthrough + events),
  `apps/web` (strip, Admin panel).
- Risk: a watchdog that fights the user. Mitigated by the cap, the events, and a dogfood pass — if
  friction shows up, the default flips from "respawn" to "surface only" for user-initiated quits.
- Risk: doctor as a footgun on the home volume. Mitigated by the tiering and a non-negotiable
  back-up-before-replace rule.
