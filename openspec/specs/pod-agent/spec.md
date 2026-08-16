# pod-agent Specification

## Purpose
Runs inside each pod and exposes the agent's terminal over a PTY WebSocket bridge with a persistent session that survives reconnects and mirrors across concurrent clients. It drives first-run login-then-handoff and authenticated boot, reports activity, idle, and health, surfaces extractable link signals, and trusts the control-plane boundary by binding internally with no self-authentication, all over a shared wire protocol. It also runs an in-pod scheduler that fires user-defined operations jobs by injecting run turns into the live session on their schedule and tracks each run's lifecycle.
## Requirements
### Requirement: The pod exposes a control socket the platform dials into

The pod-agent SHALL accept a WebSocket control connection that the gateway opens to it, carrying fetch
memory and relay traffic, and SHALL announce it as a control socket immediately on open so the gateway
can tell it apart from a terminal connection. The pod SHALL NOT initiate this connection — the gateway dials the pod, the
pod only answers — so the pod holds no credential for it and there is nothing on the pod to
authenticate to.

Over this socket the pod SHALL accept the fleet's fetch plan (caching it whole, not merging into a
stale copy) and the owner's relay state, and SHALL push its buffered fetch outcomes, clearing the
buffer only after a successful send. A relay result for a request the pod never made SHALL be
discarded rather than delivered.

A malformed or unknown control message SHALL be ignored without dropping the connection, since one bad
frame must not take down the channel that carries everything else.

The control path SHALL be independent of the HTTP fetch-memory endpoints: with the socket unavailable —
a restart, a network blip, or an older pod image with no control endpoint — fetch memory SHALL still
sync over HTTP, only more slowly.

The fetch plan a pod receives SHALL be scoped to its OWNER: the trusted global baseline plus that
owner's own learned verdicts, and NEVER another owner's. A fetch outcome a pod reports SHALL be
attributed to that pod's owner, so an untrusted tenant can only steer its own fetch ladder, not the
whole fleet (pre-Alpha security M1). Where an owner's own verdict and the baseline disagree on the
same (domain, rung), the FRESHER verdict wins, so a plan is never self-contradictory.

#### Scenario: The gateway pushes the fleet plan

- **WHEN** the gateway sends the current fetch plan over the control socket
- **THEN** the pod SHALL cache it for `podbay fetch plan` to read

#### Scenario: A tenant's fetch verdict cannot poison another owner's plan

- **WHEN** one owner's pod reports a fetch outcome for a domain
- **THEN** that verdict SHALL appear only in that owner's plan (plus the shared trusted baseline),
  and SHALL NOT be pushed to a different owner's pods

#### Scenario: A relay result for an unknown request

- **WHEN** a relay result arrives whose request id the pod is not awaiting
- **THEN** the pod SHALL discard it

#### Scenario: A malformed control frame

- **WHEN** the gateway (or anything) sends an unparseable frame
- **THEN** the pod SHALL ignore it and keep the connection open

### Requirement: PTY WebSocket bridge

The agent SHALL expose a WebSocket endpoint that attaches a client to a real pseudo-terminal in
the pod. It SHALL stream terminal output to the client, forward client input to the terminal,
and apply client-sent resize (cols/rows) to the PTY.

#### Scenario: Round-trip input and output

- **WHEN** a client connects and sends input `echo hi\n`
- **THEN** the agent SHALL forward it to the PTY and stream back output containing `hi`

#### Scenario: Resize is applied

- **WHEN** a client sends a resize message with cols/rows
- **THEN** the agent SHALL resize the PTY to those dimensions

### Requirement: Persistent session across reconnects

The terminal SHALL run inside a persistent tmux session so a client disconnect does not end the
work, and a later connection re-attaches to the same session with its scrollback intact.

#### Scenario: Reconnect resumes the session

- **WHEN** a client disconnects and a new client connects to the same pod
- **THEN** the new client SHALL attach to the existing session and see prior session state

#### Scenario: Multiple concurrent clients mirror one session

- **WHEN** two clients are connected to the same pod at once
- **THEN** both SHALL receive the same terminal output (mirror); grouped/independent views are a
  later capability

### Requirement: Onboarding and regular boot flows

On first connection with no stored credentials, the agent SHALL start the official CLI's login
so the client can complete authentication, and once credentials exist it SHALL hand off to the
persistent session. On subsequent connections it SHALL boot straight into the agent CLI.

#### Scenario: First run drives login then hands off

- **WHEN** a pod has no CLI credentials and a client connects
- **THEN** the agent SHALL start the CLI login flow, and once credentials are present SHALL
  transition the client into the persistent session without a manual step

#### Scenario: Remote control is enabled after login even with no kickoff

- **GIVEN** a Claude pod booted without credentials and its environment declares no kickoff prompt
- **WHEN** credentials appear (the user completes login)
- **THEN** the agent SHALL greet the now-authed session to enable remote control, without requiring
  a kickoff respawn — a kickoff-less pod SHALL NOT remain stuck without remote control after sign-in

#### Scenario: Authenticated run boots into the agent

- **WHEN** a pod already has CLI credentials and a client connects
- **THEN** the agent SHALL attach to the persistent session with the agent CLI running

#### Scenario: Codex login uses the headless device-code flow

- **WHEN** a Codex pod boots without credentials
- **THEN** it SHALL start Codex's device-code login (`codex login --device-auth`), which prints a URL
  and a one-time code the user completes from another device — NOT the default browser/localhost flow,
  which cannot complete on a headless pod

#### Scenario: Codex runs unattended, gated by its instructions rather than by prompts

- **GIVEN** the confirm-before-outbound runtime rule is delivered to Codex via its own instructions
  and VERIFIED to load in an authed session (the agent recites it from memory, and the text exists
  only in the assembled instructions file)
- **WHEN** a Codex session launches
- **THEN** it SHALL run without an interactive approval policy, because a pod has nobody at the
  keyboard: an approval prompt there is a permanent stall, not a safety net — an unattended pod that
  woke on an agent message sat forever on "Would you like to run …? 1. Yes"
- **AND** the gate on outbound actions SHALL be the loaded instruction rule (confirm in chat before
  anything leaves the pod), consistent with the containment security model where the disposable pod
  is the blast radius
- **AND** an approval policy that merely suppresses the prompt without permitting escalation SHALL
  NOT be used, since legitimate work outside the workspace would then fail silently instead of asking

### Requirement: Link extraction signal

The sidecar SHALL extract the most recent URL(s) from the terminal using joined-line capture
(so wrapped URLs are recovered whole) and make them available to the client, enabling link
chips without relying on in-buffer link detection.

#### Scenario: Wrapped URL is recovered whole

- **WHEN** the terminal buffer contains a long URL wrapped across multiple rows
- **THEN** the extracted link SHALL be the complete, unwrapped URL

#### Scenario: A mid-render OAuth URL is not surfaced until complete

- **GIVEN** the sign-in URL is still painting (only its first wrapped row is on screen, so `redirect_uri`
  has not appeared yet)
- **WHEN** the agent captures the sign-in URL for the client
- **THEN** it SHALL NOT surface the truncated OAuth URL, and SHALL keep re-capturing until the URL is
  complete — a partial link that Claude would reject as "Missing redirect_uri" is never presented

### Requirement: Activity and idle reporting

The agent SHALL track terminal activity and expose an idle signal (time since last activity), so
the control plane can decide when to sleep the pod. A configurable idle threshold SHALL be
reported as an idle state.

#### Scenario: Idle after inactivity

- **WHEN** no terminal input or output occurs for longer than the idle threshold
- **THEN** the agent's status SHALL report the session as idle with the elapsed duration

#### Scenario: Activity resets idle

- **WHEN** terminal input or output occurs
- **THEN** the reported idle duration SHALL reset

### Requirement: Health and readiness

The agent SHALL expose a health/readiness signal indicating whether the PTY/session is up, for
the control plane and the provider's `endpoint` check.

The health report SHALL include per-agent state — one entry per CLI the pod hosts (the primary plus
any added agent, derived from the agent-named tmux windows): its window index, whether that CLI's
credentials file exists (`authed`), and whether its remote-control channel is up (`rcActive` —
Codex: daemon running; Claude: session URL captured). This is the truth the cockpit's agent cards
render from; it is derived on the pod, never guessed from pod-level fields.

#### Scenario: Ready when session is up

- **WHEN** the tmux session and PTY bridge are running
- **THEN** the health signal SHALL report ready

#### Scenario: Per-agent state for a dual-agent pod

- **WHEN** a pod hosts Claude (signed in, RC link captured) and an added Codex that has not
  completed its device-code login
- **THEN** the health report SHALL list claude-code as authed with rcActive true, and codex as not
  authed with rcActive false

The health report SHALL also carry the dashboard's live signals: `agentStatus` (the CLI's own
`busy`|`shell`|`idle`|`waiting` state), `agentWaitingFor` (the CLI's "what am I blocked on" detail,
e.g. a blocking dialog), and `appListening` (whether anything is serving the preview port right
now — the same probe the metrics sampler uses, read live without copying the metrics ring).
Consumers MUST treat an ABSENT field as unknown (older image), never as false.

#### Scenario: Live signals for the dashboard card

- **WHEN** the agent CLI reports `busy` and a dev server is listening on the preview port
- **THEN** /healthz SHALL carry `agentStatus: "busy"` and `appListening: true`

### Requirement: No self-auth; trusts the control-plane boundary

The agent SHALL bind to the pod's internal interface and SHALL NOT implement its own end-user
authentication; the authenticated control-plane front door is the security boundary. The agent
SHALL never read or transmit model credentials.

#### Scenario: Binds internally

- **WHEN** the agent starts
- **THEN** it SHALL listen on the pod-internal address (not a public ingress) and SHALL not
  require an end-user credential on the WebSocket itself

### Requirement: Shared wire protocol

The client↔agent messages SHALL be defined as typed messages in `@podbay/shared` (at least:
input, resize, output, links, status, exit) so the agent and the web frontend share one
contract.

#### Scenario: Protocol is the shared contract

- **WHEN** the web frontend and the agent are built
- **THEN** both SHALL import the same message types from `@podbay/shared`

### Requirement: Expose tmux windows as switchable tabs

The agent SHALL report the pod's tmux windows to connected clients as a `windows` message
(index, name, active, and the agent id for the window that hosts one) whenever the window set
or the active window changes, and SHALL switch the active window on a `select-window` client
message. This lets the web terminal render one tab per window (docs/plans/multi-agent-plan.md,
"cheap-tabs") — tmux remains the multiplexer; the single output stream follows the active window.

#### Scenario: Window list is reported and refreshed

- **WHEN** a client connects, or the tmux window set or active window changes
- **THEN** the agent SHALL send a `windows` message listing each window with its index, name,
  active flag, and (for an agent-hosting window) the agent id

#### Scenario: Selecting a window switches the active tab

- **WHEN** a client sends `select-window` with a window index
- **THEN** the agent SHALL make that tmux window active and report the refreshed window list

#### Scenario: An added agent's window is labelled by its agent

- **WHEN** a second agent has been added (its window is named after the agent id)
- **THEN** the `windows` message SHALL carry that window's agent id, so its tab reads as the
  agent's display name rather than the raw id

#### Scenario: Agent operations target the agent's window, not the active one

- **WHEN** the greeter/remote-control, the kickoff respawn, or a scheduled-job injection acts while
  the user has switched to a different (e.g. shell) window
- **THEN** those operations SHALL target the agent's own window, so typed input and the RC handoff
  reach the agent rather than whatever window is currently active

### Requirement: Resource history reaches back without growing the payload

The pod SHALL keep tiered history — full resolution recently, coarser further back — so history
reaches 30 days while the served payload stays small. Keeping a month at full resolution would ship
tens of thousands of samples on EVERY read; the payload, not disk, is the binding constraint.

The endpoint SHALL serve a requested window at that window's resolution, so a wide view costs coarse
points rather than more of them.

Aggregation SHALL preserve what the history is FOR: rates (CPU, network) keep the bucket's PEAK,
because averaging hides the spike that made someone look; levels (memory, disk) keep the last value,
because the average of a level is a number that never existed; and a bucket containing any agent
activity counts as active. Buckets with no samples SHALL NOT be invented — a gap means the pod was
not running, and zero-filling would turn "suspended" into "running and doing nothing".

#### Scenario: A month of history

- **WHEN** thirty days of samples exist
- **THEN** the total retained SHALL be a few thousand points, not tens of thousands

#### Scenario: A spike inside a folded bucket

- **WHEN** samples in one bucket include a CPU spike
- **THEN** the folded sample SHALL carry the peak, not the mean

#### Scenario: The newest sample

- **WHEN** a sample is taken and compaction runs on the same tick
- **THEN** that sample SHALL still be present

### Requirement: The pod repairs drift from its declared shape

The pod-agent SHALL compare what the pod is RUNNING against what its spec declares — a live session,
and a window per agent in `spec.agents` — and repair differences it can repair, on the same tick that
refreshes windows. The declared set MUST come from the spec, never from the windows that happen to
exist: derived from running windows, an agent whose window died disappears from the very list the
check consults, and the failure it exists to catch becomes invisible (caught in live testing). (never before, or it would "repair" a window that is mid-spawn and fight the boot
sequence).

Repairs SHALL be bounded: at most 3 attempts per target per rolling hour with progressive backoff,
after which the target is reported as given-up rather than retried forever. An infinite respawn is
the dangerous failure here — a CLI that crashes at start would burn the pod, and a user who quit
their agent deliberately would be fighting the machine. A capped target SHALL NOT block repairs of
other targets, and the cap SHALL forgive once the window rolls past.

The pod SHALL report which targets it has given up on, so a surface can say the pod is broken in a
way it cannot fix itself instead of showing a state that reads as "still starting". It SHALL also
report the repairs it recently performed (bounded), so they can become OWNER-visible events — a log
line only an operator with host access can read is not an audit trail for the person whose agent
restarted.

#### Scenario: A declared agent has no window

- **WHEN** an agent listed in `spec.agents` has no window on a live session
- **THEN** the pod SHALL respawn it on the resume path and log the repair

#### Scenario: Repairs are visible to the owner

- **WHEN** the watchdog repairs something
- **THEN** the repair SHALL appear in the pod's event timeline exactly once, however many times the
  pod is reconciled

#### Scenario: Repair is capped

- **WHEN** a target has been repaired 3 times inside the rolling window and needs repair again
- **THEN** the pod SHALL stop repairing it, report it as given-up, and continue repairing other
  targets

### Requirement: The pod reports what is wrong with it

`/healthz` SHALL be readable ONCE for everything a pod reports about itself — its per-agent state,
its issues, the repairs it performed, and what it gave up on. Surfaces SHALL derive from that single
read rather than each fetching the endpoint separately: separate reads of one endpoint can disagree
about a pod at a single moment, and a fleet-wide view multiplies the cost by the number of pods.

`/healthz` SHALL include an `issues` array — a stable id, a severity, a short human title phrased as
the PROBLEM (not the check's name), detail, whether a fix exists, and the agent it belongs to when
applicable — so surfaces can state the problem instead of inferring it from a stuck state.

A passing check SHALL emit nothing: a healthy pod reports an EMPTY array, never a list of green rows.
The pod SHALL NOT invent a problem from a signal it could not read (an unknown disk size is unknown,
not full), and where one problem supersedes another for the same target — "repair gave up" over
"isn't running" — only the stronger SHALL be reported.

Severity is treatment, not drama: `critical` = unusable or about to be, `warn` = degraded and worth
acting on, `info` = worth a report but not an interruption.

#### Scenario: Healthy pod

- **WHEN** every check passes
- **THEN** `issues` SHALL be empty

#### Scenario: Disk is nearly full

- **WHEN** the home volume falls below the critical free-space floor
- **THEN** an issue SHALL be reported at critical severity and listed FIRST, because most other
  repairs fail while it persists

#### Scenario: An unreadable signal is not a problem

- **WHEN** the pod cannot read its disk size
- **THEN** it SHALL report no disk issue rather than a fabricated one

### Requirement: A dead terminal session is recovered

When the tmux server dies, the PTY child dies with it while the pod-agent PROCESS survives — so the
service manager's restart policy never fires, and the pod reports `ready: false` indefinitely with no
terminal and no agents (verified on a live pod, 2026-07-29).

The pod SHALL detect this and recover by re-running the BOOT path, which is the sequence measured to
restore a pod completely including every agent from `spec.agents` — not a separate in-process rebuild.
Recovery SHALL obey the same cap so a pod that cannot start does not restart-loop.

#### Scenario: The tmux server is killed

- **WHEN** the session dies while the pod is running
- **THEN** the pod SHALL re-run its boot path, and afterwards the session and every declared agent
  SHALL be running again without an operator touching the host

### Requirement: A doctor checks and repairs the pod on demand

The image SHALL provide a `podbay doctor` command that probes the pod and, when asked, applies the
repairs that are SAFE, with machine-readable output available. The pod-agent SHALL expose it as
TRANSPORT ONLY — the checks and fixes live in the one command, so the pod's own agent, an operator in
the terminal, and the dashboard all run the same thing rather than three implementations that drift.

Doctor SHALL INCLUDE the findings the pod already reports on its health endpoint, rather than
re-deriving them: two implementations of "what is wrong" drift, and when they did, running doctor
appeared to clear a finding that returned on the next page load. Doctor is a superset of the pod's
own report, never a competing opinion, and where it has run a fix its own result wins.

Doctor SHALL run unprivileged. Everything it repairs lives on the home volume or in the terminal
session; anything that would need root is the owner's restart/update instead. It SHALL NOT modify
anything under the user's working directory, and it SHALL NOT attempt to repair credentials — those
it reports and points at the sign-in flow.

A finding SHALL have exactly one home: a condition already stated by a dedicated surface (the
preview card saying nothing is serving the app) SHALL NOT be repeated as a health finding on the same
page. A passing check SHALL produce no finding, and a check SHALL NOT report a state that is normal (an
earlier draft flagged a post-setup marker that harms nothing and would have cried wolf on every
healthy pod).

#### Scenario: A missing agent runtime

- **WHEN** an agent's remote-control runtime is absent from a pod that hosts and has signed into
  that agent
- **THEN** doctor SHALL report it, and with fixes enabled SHALL install it from the image and confirm

#### Scenario: Safe mode leaves invasive repairs alone

- **WHEN** a fix is requested in the safe mode and the only remaining findings are invasive ones
- **THEN** nothing SHALL be replaced, and those findings SHALL remain reported as needing consent

#### Scenario: A replacement preserves what it replaced

- **WHEN** an invasive repair replaces a file or directory
- **THEN** the previous contents SHALL remain on the pod under a timestamped name

#### Scenario: Damaged credentials are reported, never repaired

- **WHEN** an agent's credentials file is present but unreadable
- **THEN** doctor SHALL report it and direct the owner to sign in again, and SHALL NOT modify or
  delete it

#### Scenario: Read-only by default

- **WHEN** doctor runs without being asked to fix
- **THEN** it SHALL change nothing

#### Scenario: Healthy pod

- **WHEN** every check passes
- **THEN** doctor SHALL report no findings

### Requirement: Codex remote control serves the whole pod and is switchable

The Codex remote-control daemon SHALL be managed for a pod that hosts Codex as EITHER the primary
or an added agent (keyed on presence + Codex's own credentials, never on the primary agent's type),
starting on boot, after login, on wake, and self-healing when found down while it should be up. A
running daemon SHALL NOT be restarted by these hooks (a restart invalidates outstanding pairing
codes).

The agent SHALL expose an owner-driven switch: OFF stops the daemon and persists the choice on the
pod's home volume so boot/wake/login hooks honor it across restarts; ON clears it and starts the
daemon.

#### Scenario: An added Claude gets remote control without the owner typing anything

- **WHEN** an ADDED Claude agent becomes signed in
- **THEN** the pod SHALL take it through the SAME hardened sequence the primary agent gets — respawn
  its window (killing the `/login` process, which otherwise strands the pane on "Login successful.
  Press Enter to continue…"), then the full greeter against that window (wait for the prompt, answer
  the bypass-permissions gate, restart a dead agent, enable and verify remote control) — with no
  kickoff trigger, since it joins a worked-in pod. It SHALL then capture that agent's own hand-off
  link. The owner SHALL NOT have to run `/remote-control`, press Enter, or open a terminal.
- **AND** a step that fails SHALL be retried on a later tick rather than latching a half-state.

#### Scenario: A spent sign-in value is dropped

- **WHEN** an agent's credentials appear after its sign-in URL/code was captured
- **THEN** the pod SHALL stop reporting that value, so a stale sign-in link is never presented for
  an already-signed-in agent

#### Scenario: Codex added to a Claude pod gets remote control

- **WHEN** Codex is added to a pod whose primary agent is Claude and completes its login
- **THEN** the RC daemon SHALL start (no later than the next health tick) and pairing SHALL work
  exactly as on a Codex-primary pod

#### Scenario: Switched off stays off

- **WHEN** the owner switches remote control off and the pod later restarts or wakes
- **THEN** the daemon SHALL NOT be restarted until the owner switches it back on

### Requirement: In-pod operations-job scheduler

The agent SHALL run a scheduler loop that periodically evaluates user-defined jobs and fires the
ones that are due. The scheduler SHALL start unconditionally at agent boot on EVERY pod and SHALL
no-op on any tick where no jobs config exists, so a pod schedules work only once a jobs config is
present — authored by an agent, by the `podbay schedule` command, or by an environment. Ticks SHALL
be single-flight so a slow tick does not overlap the next. All durable state SHALL live under
`~/.podbay/` — on the pod's persistent `/home/dev` volume (so jobs, bookkeeping, and run history
survive a restart) but OUTSIDE the `~/work` git working tree, so a `git reset`/`checkout`/`clean`
cannot corrupt live schedule state. State written by earlier pods under `~/work/.podbay/` SHALL be
migrated into `~/.podbay/` on boot.

Jobs SHALL be read from `~/.podbay/ops-jobs.json`, an object with a `jobs` array whose
entries are `{ id, name, mode, schedule, enabled, instructions? }` where `mode` is one of `brief`,
`watch`, or `routine`; `schedule` is either daily `times` (`"HH:MM"`) with an optional IANA
`timezone` (defaulting to UTC) and an optional `days` array (weekdays `0`=Sun..`6`=Sat, in the
job's timezone; absent means every day, so a `times` job can be weekly) OR a repeating `everyMinutes`
interval; and `instructions` is optional free text describing what the job should do when it runs. The
jobs config is user-owned; the scheduler only reads it.

#### Scenario: No config means no scheduling

- **WHEN** a pod has no `~/.podbay/ops-jobs.json` (or it defines no jobs)
- **THEN** each scheduler tick SHALL no-op and inject nothing

#### Scenario: Any pod can schedule durable work

- **WHEN** a jobs config with at least one enabled job is present on any pod, regardless of
  environment
- **THEN** the scheduler SHALL evaluate and fire that job on its schedule

#### Scenario: State survives a restart

- **WHEN** the agent restarts after jobs have run
- **THEN** the jobs config, per-job scheduling bookkeeping, and run-event history SHALL be read
  back from `~/.podbay/` unchanged

#### Scenario: Disabled jobs never fire

- **WHEN** a job has `enabled: false`
- **THEN** the scheduler SHALL never consider it due

#### Scenario: A finished run must be closable on any pod

- **WHEN** the scheduler fires a job — recording a `started` run event and injecting the run turn
- **THEN** the injected turn SHALL instruct the agent to close the run with `podbay schedule done
  <runId>` (or `… fail`) when it finishes; closing appends the terminal `succeeded`/`failed` event
  the scheduler's dead-man reads. This close SHALL be available and required on EVERY pod — not only
  playbook environments that define their own report rules — so a run that finishes cleanly but is
  never closed (the only way it could be missed) is the sole cause of a dead-man, never a normal one

### Requirement: Due-time evaluation

The scheduler SHALL compute the current local date and `HH:MM` in each job's timezone to decide
when a `times`-based job is due, and compare against elapsed time for an `everyMinutes` job.

For a `times` job, a time SHALL be treated as due when it is at or before the current local time
and has not already been recorded as run for the current local date, so each listed time fires at
most once per day and a time that passed while the pod was suspended still fires on the next tick
after wake (catch-up). At most one time per job SHALL fire per tick (the earliest still-due time).
For an `everyMinutes` job, the job SHALL be due when it has never run or when at least
`everyMinutes` minutes have elapsed since its last run. After firing, the scheduler SHALL record
the run (the fired time for that date, or the run timestamp for an interval) in its bookkeeping
state.

#### Scenario: Daily time fires once per day

- **WHEN** a job's scheduled `"HH:MM"` has passed and it has not run yet today
- **THEN** the scheduler SHALL treat it as due, and after it fires SHALL NOT fire it again that
  local day

#### Scenario: Catch-up after suspend

- **WHEN** the pod was suspended past a job's scheduled time and resumes later the same local day
- **THEN** the scheduler SHALL fire that job on the next tick after resume

#### Scenario: Interval job repeats

- **WHEN** a job specifies `everyMinutes: N` and at least N minutes have elapsed since its last run
  (or it has never run)
- **THEN** the scheduler SHALL treat it as due

#### Scenario: Weekday-restricted time fires only on listed days

- **WHEN** a `times` job also specifies `days` (e.g. `[1]` for Mondays) and the current local weekday
  in the job's timezone is not in that list
- **THEN** the scheduler SHALL NOT treat the job as due that day; a job with no `days` fires every day

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
(`~/.podbay/ops-runs.jsonl`). When it starts a run it SHALL append a `started` event with
the run id; the agent reports the terminal `succeeded`/`failed` event through whatever reporting path
its environment defines (for example, an operations dashboard's `/api/runs`). The scheduler SHALL
reduce the event log to per-run state to know which runs are still open.

On a tick where no job is due, the scheduler SHALL check for a DEAD-MAN condition: a run that
appended a `started` event, has no terminal event, and has been open longer than a stall grace
period. For such a run it SHALL inject a `Dead-man` turn asking the agent to check or close the
run, and SHALL record that the stall was alerted so the dead-man fires once per run rather than
every tick. The dead-man check SHALL respect the same one-turn-per-tick and readiness gating as
run injection.

A run whose `started` event predates the current pod boot SHALL NOT raise a dead-man: it was
interrupted by a pod restart (the agent was killed before it could append a terminal event), which
is an expected lifecycle event rather than a silently-hung run. The scheduler SHALL close such a run
out silently — record it as handled so later ticks do not revisit it — and inject nothing. The
dead-man remains for runs that started during the current boot and genuinely stopped reporting.

#### Scenario: Started run is logged

- **WHEN** the scheduler injects a run turn
- **THEN** it SHALL append a `started` event with that run id to `ops-runs.jsonl`

#### Scenario: Stalled run raises a dead-man once

- **WHEN** a run has a `started` event, no terminal event, and has been open longer than the
  stall grace period, and no job is due
- **THEN** the scheduler SHALL inject a `Dead-man` turn for that run and SHALL NOT inject another
  dead-man for the same run on later ticks

#### Scenario: Restart-interrupted run is not flagged

- **WHEN** a run has a `started` event with no terminal event, and that `started` event predates the
  current pod boot (a restart interrupted it)
- **THEN** the scheduler SHALL NOT inject a `Dead-man` for it — it SHALL record the run as handled
  and inject nothing

#### Scenario: Reported run is not flagged

- **WHEN** a run has a terminal `succeeded` or `failed` event in the log
- **THEN** the scheduler SHALL NOT raise a dead-man for it

### Requirement: A running pod can clone an authorized repo into an empty workspace

The pod agent SHALL accept a request to clone a GitHub repository into the workspace at `~/work`, using
the GitHub credentials already installed in the pod (via the gh credential store, never a token in a
URL or on the command line), and running as the workspace-owning `dev` user. The clone SHALL target
`~/work` directly — never a per-repo subdirectory — so the workspace path is identical across pods.

Because one pod maps to one repository, the clone SHALL by default proceed only when `~/work` is empty.
When `~/work` already contains files, the request SHALL be refused with a clear message and SHALL NOT
modify or overwrite any existing file — UNLESS the request explicitly opts in to overwriting (a `force`
flag), which the caller SHALL gate behind an explicit user confirmation. The request SHALL be owner-gated
upstream.

The clone SHALL be staged so existing work is never destroyed by a failure: the repository SHALL be
fetched into a temporary location first, and the existing contents of `~/work` SHALL be cleared (forced
overwrite only) and replaced ONLY AFTER the fetch succeeds. A clone that fails for any reason (bad repo,
network, auth) SHALL leave `~/work` exactly as it was.

#### Scenario: Clone into an empty workspace

- **WHEN** a clone is requested for a pod whose `~/work` is empty
- **THEN** the repository SHALL be cloned into `~/work` and the request SHALL report success with the
  destination

#### Scenario: Refuse a non-empty workspace

- **WHEN** a clone is requested for a pod whose `~/work` already contains files, without the overwrite opt-in
- **THEN** the request SHALL be refused with a "one pod, one repo" message
- **AND** no existing file in `~/work` SHALL be changed

#### Scenario: Overwrite a non-empty workspace on explicit request

- **WHEN** a clone is requested with the overwrite opt-in for a pod whose `~/work` already contains files
- **THEN** the existing contents of `~/work` SHALL be replaced with the repository and the request SHALL
  report success

#### Scenario: A failed forced clone preserves existing work

- **WHEN** a forced (overwrite) clone is requested but the fetch fails
- **THEN** `~/work` SHALL be left unchanged, with its existing contents intact

