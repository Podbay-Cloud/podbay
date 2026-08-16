# Design notes

## Why runtime-rules.md, not the _shared/universal rules layer

There are two rule-delivery paths on a pod:

- `packages/provider/pod-base/runtime-rules.md` → baked to `/opt/podbay/runtime-rules.md` → assembled
  into `~/.claude/CLAUDE.md` (Claude) and `~/.codex/AGENTS.md` (Codex) on **every** boot, on **every**
  pod (`init.sh` blocks `podbay:runtime-rules-refresh` ~264 and the codex block ~296).
- `environments/_shared/universal/.claude/rules/*.md` → assembled into `~/work/CLAUDE.md`, but
  **skipped for BYO-repo pods** (`init.sh:655`, guarded on `[ -z "$GH_REPO" ]`).

The agent that triggered this change was on a BYO repo. Cross-cutting "don't lie about persistence"
guidance must reach BYO pods, so it belongs in `runtime-rules.md` — a single source, no duplication.

## Scheduler generalization is small by design

`main.ts:141` already calls `startScheduler` on every pod; `runSchedulerTick` returns `no-config`
when `~/work/.podbay/ops-jobs.json` is absent (`scheduler.ts:246`). The only env-coupling is the
**default trigger text**, which is already an override point:

```ts
runTrigger?: (job: OpsJob, runId: string) => string;   // SchedulerOptions, scheduler.ts:90
stallTrigger?: (run: {...}) => string;                 // scheduler.ts:92
```

`defaultRunTrigger`/`defaultStallTrigger` (scheduler.ts:97–112) hardcode `POST /api/runs`, "digest",
and "alert me per the alerting rule". We rewrite the defaults to be neutral (carry the job's
`instructions`, and defer reporting to "any scheduled-run rules in your environment"). `morning-ops-
robot` keeps its exact behavior because its `.claude/rules/scheduled-runs.md` already tells the agent
to POST `/api/runs` — the behavior lives in the rule, not the trigger. No per-env override plumbing is
added.

`instructions?: string` is added to `OpsJob` (scheduler.ts:43). The dashboard
(`app/src/lib/types.ts:21`) and `podbay.yaml` already define it; only the scheduler type omitted it.

## Startup hook mirrors start_dev_server exactly

`run_startup_commands()` reuses the `start_dev_server` idiom (init.sh:726–740): per enabled entry,
skip if its pidfile is live (`kill -0`), else
`su - dev -c "cd '$WORK' && nohup <cmd> >> <log> 2>&1 & echo \$! > <pid>"`, then `chown dev:dev`. It
is called at the same two sites as `start_dev_server`: the wake path (init.sh:842) and the end of the
first-boot background subshell (init.sh:943). Both are required — wake covers warm boots; the
first-boot site covers the very first boot after `~/work` is populated.

- **Config:** `~/.podbay/startup.json` (home, **not** `~/work/.podbay/`) so it never lands in a
  BYO user's committed repo. Shape `{ commands: [{ slug, command, enabled }] }`.
- **Per-command pid/log:** `~/.podbay/startup/<slug>.{pid,log}`, `chown dev:dev` (init runs as root).
- **Double-start guard:** pidfile + `kill -0` only (no universal port to probe for arbitrary
  commands).

## In-pod CLI: first writing subcommands

`packages/provider/pod-base/podbay` is a self-documenting "read-only v0" bash CLI. `podbay schedule`
and `podbay startup` are the first subcommands that *write* volume state (via `jq`, already used
throughout). They follow the `cmd_secrets` sub-dispatch template (podbay:225–233), a top-level case
arm (~257), and a help line (~263). This is a deliberate scope change from read-only; CLI-surface
tests in `packages/provider/test/podbay-cli-*.test.ts` are extended to cover them.

## Deployment

All touched files are image-baked (`runtime-rules.md`, `init.sh`, `pod-agent` bundle, the `podbay`
CLI), so the change reaches pods only via an **Incus pod-base image rebuild + promote** — no web
deploy. Existing pods pick it up on Update; new pods at launch. Verify on a scratch pod before
promoting (`docs/runbooks/agent-ops-access.md`).
