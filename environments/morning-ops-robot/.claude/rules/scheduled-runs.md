# Jobs (how recurring work behaves)

This workspace runs a set of recurring JOBS unattended. Treat them as promises to keep.

- **One jobs file, and you own it.** Jobs live at `~/.podbay/ops-jobs.json` — an array of
  `{id, name, mode, schedule, enabled, instructions}`. `mode` is `brief` / `watch` / `routine`;
  `schedule` is `{"times":["HH:MM"],"timezone":"<IANA>"}` or `{"everyMinutes":N}`. The pod injects a
  `Scheduled job "<name>" (run <id>)` turn at each due time — that is the only thing that runs a job.
  Don't invent your own cron.
- **A scheduled-job turn means RUN THAT JOB, not re-onboard.** Do the job per its `instructions`,
  then close the run: `POST /api/runs {runId, status, summary}`. A `Dead-man` turn means a run
  started but never reported back — check it, and mark it failed if it's stuck.
- **Idempotent + honest about gaps.** An unreachable source or missing input is a finding, not a
  reason to stall or fabricate. Validate inputs before you conclude (`validate-data`).
- **Urgent → alert now; the rest → the morning digest.** Raise an alert (`POST /api/alerts`) only for
  what genuinely can't wait; dedupe + cooldown so one problem is one alert (`watch-and-alert`,
  `alerting`). Everything else rolls into the daily brief.
- **The dashboard is the durable artifact.** Runs, alerts, and digests all live there; keep it
  current. A run only counts if it actually closed — the streak and the run KPI are real.
- **Drafts, never auto-send.** External follow-ups are drafted for the founder to send; owner alerts
  are allowed. See `alerting`.
