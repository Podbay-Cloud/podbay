## Why

Update and Suspend both restart the pod, which kills the running agent where it stands. Today the
only continuity is transcript-based: `boot.ts` passes `--continue` when a session file exists, and
the greeter sends `RESUME_TRIGGER` ("Resuming — where are we?") so the resumed agent orients rather
than sitting silent. That covers Claude resuming *itself*, and it is the weakest exactly where it
matters most:

- **Nothing is captured before the kill.** Intent the agent had not written down survives only as
  long as the transcript does — and long sessions get summarized.
- **It does not cross agents.** Codex cannot read Claude's `~/.claude/projects/*.jsonl`. Switching
  agents loses everything.
- **It does not cross windows.** With multi-agent cheap-tabs, each window resumes independently and
  nothing records what the *pod* was doing.
- **The user cannot read it.** A JSONL transcript is not a status the owner can open.

The cockpit now warns that "work in progress that isn't saved or committed can be lost" — this makes
that warning less true.

## What Changes

- A new **`handoff` skill** in the universal shared `.claude` layer: given a request, the agent
  writes a short, durable, human-readable note (what it was doing, why, what is in flight, what the
  next session should do first) to the persistent home volume.
- The **control plane requests a handoff before an interrupting lifecycle action** (update, suspend),
  after the owner confirms and before the provider recreates or stops the instance. Best-effort with
  a hard timeout: a slow or busy agent SHALL NOT delay or block the action.
- **Resumed sessions read the note first.** Delivered through the universal *rules* layer, so it
  needs no change to the hardcoded `RESUME_TRIGGER` (and therefore no image rebuild).
- **One note per agent window**, so a multi-agent pod hands off per agent rather than clobbering a
  single file.
- Notes are **owner-readable** on the volume and survive the recreate.

Explicitly NOT in this change: process/VM checkpointing, changing `--continue` behavior, or a new
transport — `provider.exec()` already exists and the control plane already uses it.

## Capabilities

### New Capabilities
- `session-handoff`: capturing a durable, agent-agnostic handoff note before an interrupting
  lifecycle action, and surfacing it to the resumed session and the owner.

### Modified Capabilities
- `pod-boot`: the resumed agent's orientation now includes reading any handoff note left by the
  interrupted session, and the universal rules layer carries that instruction.
- `control-plane`: update and suspend gain a best-effort pre-flight handoff request that never
  blocks or fails the lifecycle action.

## Impact

- **Ships without an image rebuild.** The skill and rules live in
  `environments/_shared/universal/.claude/`, which `buildInitFiles` pushes to the pod at creation —
  they are not baked into the pod-base image. The trigger is control-plane code. Both reach
  production via a web + gateway deploy.
- `packages/control-plane/src/service.ts` — pre-flight hook on the update and suspend paths.
- `environments/_shared/universal/.claude/skills/handoff/` — **first skill in the universal layer**
  (it currently ships `rules/` only); the skills registry and its drift-guard cover it.
- `environments/_shared/universal/.claude/rules/` — the read-on-resume instruction.
- Codex pods receive it through the existing skill/AGENTS.md translation, so no separate path.
- Risk is bounded: if the handoff fails, times out, or the agent is dead, the lifecycle action
  proceeds exactly as it does today and the resumed session falls back to `--continue`.
