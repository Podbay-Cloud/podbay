## Why

A pod agent "armed a cron" for a weekly report and told the owner it would survive restarts. It
won't. It used **`CronCreate`**, Claude Code's *session* scheduler, whose own contract is explicit:
jobs "live only in this Claude session — nothing is written to disk… gone when Claude exits,"
`durable` "has no effect," recurring jobs auto-expire after 7 days, and they only fire while the REPL
is idle. A pod **restarts on Update, Suspend, and Resize** — each kills the Claude process — so the
job is dead, and the owner was told the opposite.

Two gaps this exposes:

- **Agents make false durability claims.** They reach for `CronCreate`, see it "succeed," and tell
  the owner a recurring job or startup service is set up — when it categorically is not. Nothing on
  the pod warns them it is session-only.
- **No general durable primitive.** The one restart-surviving scheduler
  (`packages/pod-agent/src/scheduler.ts`) is real and already runs on every pod, but its injected
  turns are hardcoded for the `morning-ops-robot` environment, and there is no neutral way for a pod
  to author a durable job. Likewise, the only process that survives a restart is the special-cased
  `:3000` dev server (`init.sh:start_dev_server`); an agent that starts anything else with `nohup … &`
  loses it on the next restart, and cannot self-install a systemd unit (`/etc` resets, only `~`
  persists).

Key fact that bounds the work: the scheduler loop is **already pod-generic**. `main.ts` starts it on
every pod; activation is simply the presence of `~/work/.podbay/ops-jobs.json`. So this change
*neutralizes and exposes* an existing mechanism — it does not build a scheduler.

## What Changes

- **Anti-`CronCreate` guidance** in the always-on runtime rules (`runtime-rules.md`, assembled into
  `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` on every boot). It reaches **every** pod, including
  BYO-repo pods (the `_shared/universal` rules layer is skipped for BYO repos, so it is the wrong
  home). Tells agents `CronCreate` is session-only, forbids telling the owner an armed job is
  persistent, and points at the two durable primitives below.
- **Generalize the scheduler.** Add the optional `instructions` field the dashboard and `podbay.yaml`
  already imply, and make the injected run/dead-man turns **environment-neutral** — carry the job's
  own `instructions` instead of the hardcoded `POST /api/runs` / digest / alerting text. The
  `morning-ops-robot` environment keeps its dashboard behavior through its existing
  `.claude/rules/scheduled-runs.md` (the run/stall triggers are already override points).
- **A neutral authoring path:** `podbay schedule` (list/add/remove/enable/disable) writes a
  well-formed job to `~/work/.podbay/ops-jobs.json`, so agents never hand-roll the config.
- **Agent-declared startup commands that survive restarts.** `init.sh` gains
  `run_startup_commands()` — mirroring the proven `start_dev_server` idiom — that re-launches each
  enabled command in `~/.podbay/startup.json` on every boot, skipping any already alive. Authored via
  `podbay startup`.

Explicitly NOT in this change: a dashboard/UI surface for generic scheduled runs (they log to
`ops-runs.jsonl` on the volume only), process/VM checkpointing, or relocating the existing
`ops-jobs.json` path.

## Capabilities

### Modified Capabilities
- `pod-agent`: the in-pod scheduler is a general durable-recurring-turn primitive for any pod, its
  jobs carry optional `instructions`, and its injected turns are environment-neutral.

### New Capabilities
- `pod-boot`: agent-declared startup commands are re-launched on every boot so a long-running process
  survives a pod restart.
