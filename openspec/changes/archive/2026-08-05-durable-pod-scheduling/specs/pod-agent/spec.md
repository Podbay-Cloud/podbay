## MODIFIED Requirements

### Requirement: In-pod operations-job scheduler

The agent SHALL run a scheduler loop that periodically evaluates user-defined jobs and fires the ones
that are due. The scheduler SHALL start unconditionally at agent boot on EVERY pod and SHALL no-op on
any tick where no jobs config exists, so a pod schedules work only once a jobs config is present —
authored by an agent, by the `podbay schedule` command, or by an environment. Ticks SHALL be
single-flight so a slow tick does not overlap the next. All durable state SHALL live on the pod's
persistent work volume under `~/work/.podbay/` so jobs, scheduling bookkeeping, and run history
survive a restart.

Jobs SHALL be read from `~/work/.podbay/ops-jobs.json`, an object with a `jobs` array whose entries
are `{ id, name, mode, schedule, enabled, instructions? }` where `mode` is one of `brief`, `watch`,
or `routine`; `schedule` is either daily `times` (`"HH:MM"`) with an optional IANA `timezone`
(defaulting to UTC) OR a repeating `everyMinutes` interval; and `instructions` is optional free text
describing what the job should do when it runs. The jobs config is user-owned; the scheduler only
reads it.

#### Scenario: No config means no scheduling

- **WHEN** a pod has no `~/work/.podbay/ops-jobs.json` (or it defines no jobs)
- **THEN** each scheduler tick SHALL no-op and inject nothing

#### Scenario: Any pod can schedule durable work

- **WHEN** a jobs config with at least one enabled job is present on any pod, regardless of
  environment
- **THEN** the scheduler SHALL evaluate and fire that job on its schedule

#### Scenario: State survives a restart

- **WHEN** the agent restarts after jobs have run
- **THEN** the jobs config, per-job scheduling bookkeeping, and run-event history SHALL be read
  back from `~/work/.podbay/` unchanged

#### Scenario: Disabled jobs never fire

- **WHEN** a job has `enabled: false`
- **THEN** the scheduler SHALL never consider it due

### Requirement: Run-turn injection gated on agent readiness

When a job is due, the scheduler SHALL start a run by INJECTING a turn into the pod's persistent
session (the same `main` tmux session the terminal uses) rather than spawning a separate headless
agent process. The injected turn SHALL name the job, carry a unique run id, carry the job's
`instructions` when present, and instruct the agent to run the job and follow any scheduled-run rules
in its environment for reporting the result. The injected turn SHALL NOT hardcode any single
environment's reporting mechanism. Injection SHALL be performed by sending the literal text to the
session followed by Enter.

The scheduler SHALL only inject when the agent can take a turn: it SHALL defer to a later tick
when the session is busy or in a shell, or when it is waiting on a dialog. At most one turn SHALL
be injected per tick.

#### Scenario: Due job injects a run turn

- **WHEN** a job is due and the agent is idle
- **THEN** the scheduler SHALL inject a turn into the `main` session naming the job, a unique run id,
  and the job's instructions, directing the agent to run it and report per its environment's rules

#### Scenario: Busy agent defers the run

- **WHEN** a job is due but the session is busy, in a shell, or waiting on a dialog
- **THEN** the scheduler SHALL inject nothing and re-evaluate the job on a later tick

#### Scenario: At most one turn per tick

- **WHEN** multiple jobs are due on the same tick
- **THEN** the scheduler SHALL inject only one run turn that tick and leave the rest for later
  ticks

### Requirement: Run lifecycle tracking and dead-man detection

The scheduler SHALL record run lifecycle events in an append-only log
(`~/work/.podbay/ops-runs.jsonl`). When it starts a run it SHALL append a `started` event with the
run id; the agent reports the terminal `succeeded`/`failed` event through whatever reporting path its
environment defines (for example, an operations dashboard's `/api/runs`). The scheduler SHALL reduce
the event log to per-run state to know which runs are still open.

On a tick where no job is due, the scheduler SHALL check for a DEAD-MAN condition: a run that
appended a `started` event, has no terminal event, and has been open longer than a stall grace
period. For such a run it SHALL inject a `Dead-man` turn asking the agent to check or close the
run, and SHALL record that the stall was alerted so the dead-man fires once per run rather than
every tick. The dead-man check SHALL respect the same one-turn-per-tick and readiness gating as
run injection.

#### Scenario: Started run is logged

- **WHEN** the scheduler injects a run turn
- **THEN** it SHALL append a `started` event with that run id to `ops-runs.jsonl`

#### Scenario: Stalled run raises a dead-man once

- **WHEN** a run has a `started` event, no terminal event, and has been open longer than the
  stall grace period, and no job is due
- **THEN** the scheduler SHALL inject a `Dead-man` turn for that run and SHALL NOT inject another
  dead-man for the same run on later ticks

#### Scenario: Reported run is not flagged

- **WHEN** a run has a terminal `succeeded` or `failed` event in the log
- **THEN** the scheduler SHALL NOT raise a dead-man for it
