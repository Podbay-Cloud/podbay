# morning-ops-robot

**Playbook C** (docs/marketplace-playbooks.md) — *"The operations robot."* An always-on workspace
whose agent runs recurring **jobs** — watch, check, reconcile, prepare — and **briefs the founder
every morning** on what changed and what needs them. If something can't wait, it **alerts
immediately**. The morning brief is the default interface, not the boundary.

**Outcome:** routine ops handled unattended; a daily brief the founder acts on; nothing urgent missed.
**KPI (in the dashboard):** successful runs / expected + alerts acknowledged. A delivered-digest
**streak** is the motivating secondary.

## How jobs run

No cron. Pods are 24/7, so a scheduled run is a turn the **pod-agent scheduler**
(`packages/pod-agent/src/scheduler.ts`) injects into the live agent session when a job is due and the
agent is idle. Jobs are user data on the persistent volume:

```
~/.podbay/ops-jobs.json   [{id,name,mode:"brief|watch|routine",schedule:{times|everyMinutes,timezone},enabled}]
~/.podbay/ops-state.json  scheduler bookkeeping (per-job last run)
~/.podbay/ops-runs.jsonl  append-only run event log (started → succeeded/failed)
```

Each job fires on daily **times** OR a repeating **interval** (`everyMinutes` — "watch" without
wake-machinery). The scheduler appends a `started` event carrying a `runId`; the agent closes the run
via `POST /api/runs`. A **dead-man** check alerts on a run that started but never reported back within
a grace window (the in-pod half; a whole-pod death is a platform concern).

## Structure

- `podbay.yaml` — manifest + the guided kickoff (the reliable always-on channel).
- `.claude/rules/` — assembled into `~/work/CLAUDE.md` at boot: `scheduled-runs` (jobs),
  `alerting` (owner alerts allowed, external comms draft-only), `assisted-research` (datacenter
  reachability).
- `.claude/skills/` — pinned: `status-report`, `validate-data`, `sql-queries`, `runbook`,
  `incident-response` (Anthropic, prompt-only) + first-party `watch-and-alert` (the monitoring core)
  + `reconciliation` (preset). See `skills/registry.yaml`.
- `app/` — the prebuilt Next.js ops dashboard: **Jobs · Runs · Alerts · Digests**, JSON stores on the
  volume, auto-started at boot.

## Status

**Draft — code-complete, not yet dogfooded.** Done: the ops-bot rebuild — jobs-model scheduler + run
lifecycle + dead-man (pod-agent, tested); the skill set + split alerting rule; the jobs/runs/alerts
dashboard (`pnpm build`-verified + browser click-tested); the kickoff/rules/manifest. Remaining:

1. **Image rebuild + live-pod dogfood** — ship the scheduler-carrying pod-agent (make-payload →
   build-image → publish), ensure the image pre-installs this app's deps (like nextjs-starter),
   launch a real pod, verify jobs fire → runs tracked → findings/alerts/digest → survives wake, then
   dogfood the KPI over several days. **Needs box access.**
