## Context

Continuity across an interrupting lifecycle action is currently transcript-based:

- `packages/pod-agent/src/boot.ts:114` passes `--continue` when `~/.claude/projects/<pwd>/*.jsonl`
  exists, so Claude resumes its own transcript.
- `packages/pod-agent/src/boot.ts:35` defines `RESUME_TRIGGER = "Resuming — where are we?"`, sent by
  the greeter instead of the kickoff on a cold restart so the resumed agent takes a turn.
- `/home/dev` is a separate volume the provider preserves across `updateImage`, so anything written
  there survives.

Two existing mechanisms shape the design:

- `provider.exec(id, cmd)` exists and the control plane already uses it against a live pod
  (`service.ts:1279` runs a headless `claude -p 'ok'`), so no new transport is needed.
- `buildInitFiles` (`packages/provider/src/fly/init.ts`) packages the resolved `.claude` layer as
  files pushed at pod creation. The universal layer is therefore **deploy-shipped, not image-baked** —
  which is what lets this change avoid an image rebuild.

## Goals / Non-Goals

**Goals:**
- Capture what the agent was doing *before* it is killed, in a form the next session and the owner
  can both read.
- Work for any agent (Claude, Codex) and for multiple agents in one pod, without agent-specific code.
- Never delay, block, or fail an update/suspend the owner asked for.
- Ship without rebuilding or promoting a pod-base image.

**Non-Goals:**
- Process or VM checkpointing (CRIU, tmux scrollback capture). The VM is recreated; this is not a
  snapshot feature.
- Replacing `--continue`. Transcript resume stays exactly as it is; this is the durable, portable
  layer on top.
- Continuous journaling on every agent turn (considered and rejected below).
- Capturing handoffs for interrupts the platform does not initiate (crash, OOM, host reboot). Those
  have no pre-flight moment; the note simply stays as stale as the last one written.

## Decisions

**1. Trigger after the owner confirms, before the provider acts — not on SIGTERM.**
`pod-agent/src/main.ts:97` has a SIGTERM handler and is the tempting hook, but at SIGTERM the VM is
already going down and the agent dies with it: asking an LLM for a considered summary in the last
seconds of the pod's life is unreliable precisely when it matters. The update/suspend path is
owner-initiated, so there is a moment where the pod is healthy, the agent is alive, and a few
seconds of latency is acceptable and already visible in the durable update-progress UI.

**2. Reach the agent by typing into its live window, not by a second headless process.**
A headless `claude -p --continue` is easier to orchestrate (exit code, stdout), but it resumes from
the *transcript* rather than the live agent's in-flight state — which is the very thing we are trying
to capture — and risks two processes writing one session file. The greeter's existing
`submitLine()` already types into the live pane (`/remote-control`, `/rename`), so the handoff is
delivered the same way: type `/handoff`, wait for completion, move on.

**3. Best-effort with a hard timeout; the lifecycle action is never blocked.**
The agent may be mid-tool-call, waiting on a gate, or dead. The pre-flight request gets a bounded
window (default ~15s); on timeout, error, or a dead pane it is abandoned and the update/suspend
proceeds. A missing or stale note is an acceptable outcome — a hung update is not. This mirrors the
greeter's existing posture of refusing to type into a dead or gated pane.

**4. One note per agent window, under a known directory.**
`~/.podbay/handoff/<window>.md` on the persistent volume. Multi-agent slice 2 already targets
`main:<agentWindow>`, so the per-window addressing exists. A single shared file would have agents
clobbering each other.

**5. Consume via the universal rules layer, not by changing `RESUME_TRIGGER`.**
`RESUME_TRIGGER` is hardcoded in the pod-agent bundle, so changing it would require an image rebuild
and promote. The existing trigger already makes the agent orient; the *rules* layer (deploy-shipped)
tells it where to look. This keeps the whole change to a web + gateway deploy. Editing the trigger
text remains available as polish on whatever image is built next, but is not required.

**6. A skill, not a rule, for the writing side.**
The content logic ("what a good handoff contains") belongs in a skill: versioned, registry-tracked,
covered by the skills drift-guard, and translated to Codex through the existing path. Rules stay for
the one-line "read it on resume" instruction. This is the first skill in
`_shared/universal/.claude/` — the layer currently ships `rules/` only — so the universal skills
directory is a new slot.

**Rejected: continuous journaling.** Having the agent keep the note current every turn removes the
pre-flight timing problem entirely and would also cover crashes. Rejected for v1 because it taxes
every turn in every pod for a benefit that only materialises at interrupt time. Worth revisiting if
best-effort capture proves to miss too often.

## Risks / Trade-offs

- **The note can be missing or stale.** A busy agent may not answer within the timeout, and
  unplanned interrupts have no pre-flight at all. Mitigated by `--continue` still being the primary
  path for Claude; the note is additive, never load-bearing.
- **An agent mid-task may write a misleading note.** Writing "I was doing X" when X had just failed
  is worse than silence. The skill must instruct the agent to record uncertainty explicitly and to
  prefer verifiable state (branch, commit, test status) over recollection.
- **Latency on a user-visible action.** Update/suspend gains up to the timeout. Bounded and shown by
  the existing progress UI, but it is a real regression in perceived speed for a feature that only
  pays off later.
- **Typing into a live pane is inherently racy.** The greeter already carries this risk and has
  hardened detection (`BLOCKING_GATE_RE`, dead-pane refusal) after a prior incident where a modal
  was mistaken for an input prompt. This change must reuse that hardening rather than re-implement
  it — typing a handoff request into a shell or a gate is the failure mode to avoid.
- **First universal skill.** Adds a directory the seeding path has not exercised; the env `.claude`
  layer has regressed before (2026-07-24: seeded-marker bug meant skills never landed on Incus pods).
  Verify on a real pod, not just in tests.
