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

#### Scenario: A first-run onboarding prompt never blocks launch or sign-in

- **GIVEN** the Claude CLI shows a first-run onboarding step (e.g. the v2.1.x theme picker) BEFORE the
  agent is usable or before `/login` reaches its method menu
- **THEN** the pod SHALL not stall on it: the launch SHALL pre-seed the known non-interactive setting
  (the theme) so the picker is skipped, AND the login-drive SHALL also accept such a pre-login prompt
  with its highlighted default — so an authed boot reaches the agent and an unauthed `/login` reaches
  the sign-in URL, rather than sitting on the onboarding screen

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

#### Scenario: A sign-in URL sliced across TUI rows is rejoined regardless of pane width

- **GIVEN** the login TUI has painted a long OAuth URL as consecutive rows, each cut at the pane
  boundary but SHORTER than the full pane width (so the rows do not "wrap" from tmux's view)
- **WHEN** the agent captures the sign-in URL
- **THEN** it SHALL rejoin the sliced rows into the whole URL (including the trailing `&state=…`) by
  appending following pure-URL rows until one is not — WITHOUT relying on the pane width. A URL that
  happens to be sliced a couple characters short of the pane SHALL still be recovered complete, so the
  sign-in wizard never hangs on "Getting the sign-in link…" (the pane-width-dependent flakiness fixed
  2026-08-25).

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

#### Scenario: Pairing shows the pod's current name after a rename

- **WHEN** a pod is renamed in the dashboard (which writes the new name into the pod's spec) and the
  owner then requests a Codex pairing code
- **THEN** the pairing SHALL report the pod's CURRENT name as the device name, read fresh from the
  pod's spec rather than a value cached at boot, so the app shows the renamed pod without a restart
- **AND** when the spec has no usable name the device name SHALL fall back to the boot-time name, then
  the hostname

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

### Requirement: Agent CLIs are updatable by the unprivileged user

The agent CLIs (`claude`, `codex`) are baked into the pod image at pinned versions, owned by root
under `/usr`. The pod runs as the unprivileged `dev` user, so a bare `npm install -g …@latest`
fails with EACCES. To let a pod update its agent CLIs WITHOUT root and have the update persist, the
pod SHALL provide a dev-writable global npm prefix at `~/.npm-global` (on the persistent home
volume) placed FIRST on `PATH` — for interactive shells, for processes the owner launches as `dev`,
and for the agent the pod-agent itself launches (its tmux session env). An updated CLI installed
there SHALL shadow the baked one. `podbay agent update [claude | codex | --all]` performs the
update; `podbay agent versions` reports the effective (dev-prefix-first) and latest versions.

Codex is a special case: it is BOTH an npm package AND a standalone RC-daemon build under
`~/.codex/packages/standalone` that shares `~/.codex` state and MUST match the npm version. So
`podbay agent update codex` SHALL bring both to the same version in lockstep and record the chosen
release in `~/.config/podbay/codex-pin`, which the boot-time standalone pin-enforcer SHALL honour in
preference to the image default — so a deliberate update survives restart while the pod stays
reproducible (pinned to the chosen version, never a silent self-update).

#### Scenario: The owner updates claude without root

- **WHEN** `podbay agent update claude` runs as the `dev` user
- **THEN** the latest `@anthropic-ai/claude-code` SHALL be installed into `~/.npm-global` and SHALL
  shadow the baked CLI for the agent, surviving a pod restart

#### Scenario: A codex update keeps npm and the standalone in lockstep

- **WHEN** `podbay agent update codex` runs
- **THEN** the npm codex and the standalone RC-daemon build SHALL both be at the chosen version, the
  choice SHALL be recorded in `~/.config/podbay/codex-pin`, and a subsequent boot SHALL pin the
  standalone to that recorded version rather than reverting to the image default

### Requirement: A crashed agent is recoverable, and a stale transcript never bricks boot

The agent boot command SHALL be resilient to an unresumable transcript. `claude --continue` is
attempted only when a prior transcript file exists, but that file may not be resumable (stale,
corrupt, or written by a DIFFERENT agent harness sharing the workspace). If `--continue` exits fast
(within a few seconds) with a non-zero status, the boot SHALL fall back to a FRESH session ONCE
rather than crash-loop the pane to a dead shell.

When an agent nonetheless exits to a bare shell (the `PODBAY-AGENT-EXITED` state), the pod SHALL
provide a working recovery path: a `POST /agent/restart` endpoint on the pod-agent (optional `agent`
in the body; defaults to the primary agent) that relaunches the agent in its existing window, and a
`podbay-agent-restart` command that calls it — the exact command the exit banner tells the user to
run. `podbay doctor` SHALL detect this state — a window that exists but whose agent process has died
(the pane shows `PODBAY-AGENT-EXITED`) — and, with `--fix`, repair it via that endpoint; reporting
"no problems" for a window-present-but-agent-dead pod is a defect.

#### Scenario: A foreign or stale transcript does not crash-loop boot

- **WHEN** the agent boots with `--continue` but the transcript cannot be resumed and claude exits
  within a few seconds non-zero
- **THEN** the boot SHALL start a fresh session instead of retrying `--continue` into a dead shell

#### Scenario: doctor detects and repairs a dead agent

- **WHEN** `podbay doctor --fix` runs on a pod whose agent window exists but shows `PODBAY-AGENT-EXITED`
- **THEN** it SHALL report the dead agent and relaunch it via `POST /agent/restart`

### Requirement: An expired agent login is detected, not hidden

`authed` on `/healthz` SHALL reflect whether the agent can actually authenticate, NOT merely whether a
credentials file exists. When the file is present but the login token has hard-expired (claude's
`claudeAiOauth.refreshTokenExpiresAt` in the past, or codex's OAuth token expiry), the pod SHALL report
`authed: false` and `loginExpired: true` for that agent, and SHALL emit an agent-scoped health issue
("<Agent> sign-in expired") so the cockpit and `podbay doctor` surface it instead of reporting the pod
healthy. Detection is conservative: only a KNOWN expiry field in the past marks a login expired, so an
unrecognised credential shape never false-alarms.

#### Scenario: A dead token is reported as logged out, not authed

- **WHEN** an agent's credentials file exists but its refresh token has expired
- **THEN** `/healthz` SHALL report `authed: false`, `loginExpired: true`, and an agent-scoped
  "sign-in expired" issue — never `authed: true` with no issue

#### Scenario: The owner can reconnect an expired agent from the cockpit

- **WHEN** the owner clicks Reconnect on an agent whose login has expired
- **THEN** the dead token SHALL be cleared and the agent respawned into its `/login` flow, so its
  fresh device-auth URL surfaces in the cockpit's existing sign-in UI (open-link + paste-code)

### Requirement: Podbay yields agent remote-control to an external harness without logging the agents out

When an external agent harness (e.g. T3 Code) is put in control of a pod, Podbay SHALL stop driving
its own remote-control for BOTH agents so the two never compete for the same tmux session, and SHALL
do so WITHOUT touching the credential files — the agents stay signed in and the external harness uses
the same on-disk logins. The yield SHALL be durable (survive restart/resume) and SHALL be fully
reversible: on hand-back, Podbay restarts its own remote-control for both agents.

#### Scenario: Podbay stops driving Claude and Codex while yielded

- **WHEN** the pod is put in external-harness control
- **THEN** Podbay stops running its Claude greeter/remote-control and its Codex remote-control daemon
  (including on boot and on every resume), and does not type `/remote-control` into either agent

#### Scenario: The agents stay signed in across the hand-off

- **WHEN** control is yielded to the external harness
- **THEN** the Claude and Codex credential files are left untouched, so both agents remain
  authenticated and the harness drives them with no re-login

#### Scenario: The yield survives restart and resume

- **WHEN** a pod under external-harness control is restarted or resumed
- **THEN** Podbay does not re-enable its own remote-control on boot or on the resume watcher — the
  yield persists until control is explicitly handed back

#### Scenario: Handing control back restores Podbay's remote-control

- **WHEN** external-harness control is turned off
- **THEN** Podbay clears the yield and restarts its own remote-control for both Claude and Codex, with
  the agents still signed in

#### Scenario: A yield with no harness behind it heals itself

The yield is a pod-local marker, while the decision to yield lives in the control plane — so a T3
enable that fails mid-flight can leave the marker set with nothing in control (its rollback issues the
un-yield best-effort, and one missed call strands the pod). Because every remote-control path returns
early on the marker, a stranded pod has NO remote control and NO resume nudge on every subsequent
restart, indefinitely, with nothing surfaced to the owner.

- **WHEN** the pod boots with remote-control yielded but no external harness is registered to run on
  this pod (a real hand-over always declares its startup command BEFORE the yield is recorded, and
  that declaration is durable, so a yield without one cannot be legitimate)
- **THEN** the pod SHALL treat the yield as stale, clear it before the greeter runs, and resume its own
  remote-control — so the pod greets and reconnects normally on that same boot rather than staying
  silently disabled
- **AND** `podbay doctor` SHALL report the stale yield as a finding rather than reading it as
  intentional, with `--fix` clearing it and restoring remote control
- **AND** a yield whose harness IS registered SHALL be left untouched, including early in boot before
  the harness process has started

### Requirement: A supervised startup command reports only while it is declared, and says what actually blocks it

The pod SHALL report a startup command as failing only while that command is still DECLARED. Removing
a command SHALL stop it being reported — the declaration is the source of truth, and give-up state
that outlives it makes the cockpit warn about a command that no longer exists, with fix advice that
cannot work.

When a startup command cannot run because the directory it changes into no longer exists, the pod
SHALL say so and name that directory, and SHALL NOT offer restart-based advice — retrying cannot
recreate a directory, and a fix that cannot work is worse than no fix. The pod SHALL only make this
claim when it can determine the directory unambiguously; an unexpanded or relative path SHALL be
treated as unknown rather than guessed.

#### Scenario: A removed startup command stops being reported

- **WHEN** a startup command the watchdog had given up on is removed from the pod's declarations
- **THEN** the pod SHALL stop reporting it, without requiring a restart of the pod

#### Scenario: A missing working directory is named, with advice that can work

- **WHEN** a declared startup command changes into a directory that no longer exists
- **THEN** the reported problem SHALL name that directory and offer recreating it or removing the
  command, and SHALL NOT present the failure as auto-recoverable

#### Scenario: An ambiguous path is not diagnosed

- **WHEN** a startup command's directory cannot be determined unambiguously (an unexpanded variable,
  a glob, or a relative path)
- **THEN** the pod SHALL NOT claim the directory is missing

### Requirement: The agent is never left silently stuck at a known menu

The pod SHALL continuously ensure the Claude agent is not wedged at one of its known interactive
menus with nothing driving it. A menu that the platform knows how to answer (the login-method select,
the API-key prompt, the bypass-permissions gate, the folder-trust prompt, and the remote-control
modal) SHALL be driven automatically whenever it is showing, has been static (unchanged) for a short
bounded interval, and no one-shot driver is currently acting on it — regardless of which flow put the
agent there (boot, reconnect, resume, an image update, a window respawn, or a future flow). Driving is
bounded per gate: after a capped number of attempts a gate that will not clear SHALL be surfaced to
the owner as a "needs you" state, never retried indefinitely and never left as a silent hang.

#### Scenario: A menu shown by any flow gets driven

- **WHEN** the Claude agent is sitting at a known menu (e.g. the login-method select after a reconnect
  respawn) and no driver is currently acting on it
- **THEN** the pod drives the correct answer for that menu so the flow advances (e.g. the sign-in URL
  prints and the cockpit captures it), without the owner touching the terminal

#### Scenario: The watchdog does not fight an in-progress driver or the owner

- **WHEN** a menu is present but the pane is still changing (a one-shot driver is clearing it, or the
  owner is interacting)
- **THEN** the watchdog does not act on that window until the pane has been static for the bounded
  interval, so it never collides with legitimate in-progress input

#### Scenario: An unclearable gate becomes an explicit "needs you", not a hang

- **WHEN** a gate keeps reappearing past the per-gate attempt cap, or a menu is present that cannot be
  safely auto-answered
- **THEN** the pod surfaces it to the owner as a clear "needs you" state rather than waiting silently
  or looping forever

### Requirement: Every previously-orphaned blocking gate is handled

A blocking gate the platform can detect SHALL either be driven or surfaced — it SHALL NOT be merely
detected-and-ignored. In particular the folder-trust prompt (on the owner's own `~/work`) is answered
automatically, the post-login "Login successful — press Enter to continue" confirmation is dismissed
automatically, and any ambiguous confirmation the platform should not decide on the owner's behalf is
surfaced as "needs you".

#### Scenario: The folder-trust prompt no longer stalls startup

- **WHEN** the agent shows the "do you trust the files in this folder" prompt for its own workspace
- **THEN** the pod answers it so startup proceeds, rather than only refusing to type and waiting

#### Scenario: The post-login "press Enter to continue" is dismissed automatically

- **WHEN** sign-in succeeds and the agent sits on "Login successful. Press Enter to continue…"
- **THEN** the pod presses Enter so the agent reaches its prompt, rather than leaving it at a dialog that
  the dashboard reads as "Needs you" even though the login fully succeeded

#### Scenario: An owner-decision gate is surfaced, not guessed

- **WHEN** the agent shows a confirmation the platform cannot safely answer on the owner's behalf
- **THEN** the pod surfaces it as a "needs you" state so the owner decides, rather than hanging

#### Scenario: A rejected OAuth code is recognized and never retried automatically

- **WHEN** the agent shows a rejected-code OAuth error ("invalid code … press Enter to retry")
- **THEN** the pod SHALL NOT send any input into that dialog — Enter would resubmit the same dead code,
  not advance it — and SHALL surface it as a "needs you" state immediately, without spending the
  bounded-drive attempts a recoverable menu gets

### Requirement: A re-spawned primary agent can be driven again

The one-shot menu drivers SHALL be re-armable, so that when the PRIMARY agent's process is respawned
after the initial greet (e.g. a credentials-present restart, or a watchdog window respawn), a fresh
menu it lands on is still driven — the guards that make a driver fire once per process SHALL NOT
permanently disable driving for a later respawn.

#### Scenario: A primary-agent restart lands on a driven menu

- **WHEN** the primary agent's window is respawned after the process's first greet and it surfaces a
  known menu
- **THEN** the menu is driven (by the re-armed one-shot driver or the watchdog), not left stuck
  because a once-per-process guard already fired

### Requirement: Auth failure is detected from live signals, not only the credential file

The pod SHALL detect that an agent needs re-authentication from LIVE signals — the CLI's own
auth-failure output in the terminal ("login expired", "please run /login", "worker auth expired", the
remote-control "sign in again" message, or a rejected OAuth code during a fresh sign-in attempt) — in
addition to the credential file's hard-expiry field. A mid-session refresh failure that leaves the
credential file's expiry still in the future SHALL still be reported as needing attention, so the pod
never reports healthy while the owner is locked out. The live signal SHALL be debounced (present
across a short interval) so a transient, self-healing state is not flagged, and SHALL clear as soon as
the agent is authenticated again.

#### Scenario: A mid-session logout is detected despite a valid-looking credential file

- **WHEN** the agent's terminal shows an auth-failure message but the credential file's hard-expiry is
  still in the future
- **THEN** the pod reports that agent as needing re-authentication, and the cockpit/doctor reflect it
  — rather than reporting the pod healthy

#### Scenario: A rejected OAuth code is detected even though the old credential file still looks valid

- **WHEN** the agent's terminal shows a rejected-code OAuth error from a fresh sign-in attempt, while
  the credential file left over from a PRIOR login still parses as unexpired
- **THEN** the pod reports that agent as needing re-authentication (not "signed in, remote control
  down"), so the cockpit offers Reconnect instead of a bridge-repair action that cannot succeed

#### Scenario: A transient auth blip is not flagged

- **WHEN** an auth-failure message appears for less than the debounce interval and then clears on its
  own
- **THEN** the pod does not raise a needs-reauth state for it

### Requirement: Remote-control liveness is reported from the current bridge, not a stale capture

The pod SHALL classify each Claude interactive session's Remote Control lifecycle as `active`,
`recovering`, `down`, `login-required`, or `unknown` from CURRENT evidence — not from the mere fact
that a session URL was captured at some earlier point. A remote-control worker that has died
mid-session SHALL read as inactive.

The health payload SHALL expose the classification additively as `rcState`. For backward
compatibility, the existing `rcActive` boolean SHALL remain `true` if and only if `rcState` is
`active`; `recovering` and `unknown` SHALL NOT be promoted to `rcActive: true`. Health reporting,
automatic recovery, and doctor SHALL consume the same classifier so they cannot disagree. A recognized
blocking login or OAuth retry dialog SHALL outrank a still-present-looking credential file: it SHALL
classify as `login-required`, never as a valid login with RC merely `down`. An older pod-agent image
that does not send `rcState` at all SHALL be treated by consumers the same as `unknown`, never as
active.

#### Scenario: A dead remote-control worker reads as inactive

- **WHEN** the remote-control bridge has died (e.g. its worker auth expired) after a session URL was
  once captured
- **THEN** the pod reports remote control as inactive (`rcActive: false`), with `rcState` reflecting
  the reason (`down` or `login-required`), and the cockpit/doctor no longer show it active

#### Scenario: A stale URL is not reported as active

- **GIVEN** a Claude session URL was captured earlier but the current TUI reports that RC is down
- **WHEN** the pod-agent emits health
- **THEN** it reports `rcState: "down"` and does not report `rcActive: true`

#### Scenario: Missing liveness evidence remains unknown

- **GIVEN** the current pinned CLI exposes neither a live nor failed RC signal
- **WHEN** the pod-agent emits health
- **THEN** it reports `rcState: "unknown"` rather than guessing from a process, URL, or prior
  successful connection

#### Scenario: Login failure is distinct from bridge failure

- **GIVEN** the agent login is expired, or the Claude TUI is in its login flow, or the live pane shows
  a recognized auth-failure/OAuth-retry message
- **WHEN** the pod-agent classifies RC
- **THEN** it reports `rcState: "login-required"`, not `"down"`, and does not start RC recovery

#### Scenario: A stale credential does not hide a blocking OAuth error

- **GIVEN** the Claude credential file still appears valid but the live pane shows a recognized OAuth
  failure dialog such as invalid-code plus "Press Enter to retry"
- **WHEN** the pod-agent emits health
- **THEN** it reports `login-required`, not merely signed-in with RC down

#### Scenario: An in-progress bounded restore is reported distinctly from down or active

- **GIVEN** a bounded RC auto-restore attempt is currently owed and has not yet exhausted its cap
- **WHEN** the pod-agent emits health
- **THEN** it reports `rcState: "recovering"`, and `rcActive` remains `false` until the restore is
  actually observed to succeed

#### Scenario: An older pod image's absent rcState is treated as unknown

- **GIVEN** an older pod-agent image that never sends `rcState` in its health payload
- **WHEN** a newer consumer reads that health payload
- **THEN** it treats the missing field the same as `"unknown"` rather than erroring or assuming active

### Requirement: The pod auto-restores remote control when it dies while the login is valid

When an agent is authenticated (its login is valid) but remote control is not live — including
immediately after the owner re-runs `/login` mid-session — the pod SHALL re-establish remote control
itself, without the owner having to run `/remote-control` manually. This SHALL be bounded (a capped
number of attempts with backoff) and SHALL NOT fire while the agent is logged out or sitting at a
login/menu prompt. If it cannot restore remote control within the cap, the pod SHALL surface that
rather than retry indefinitely.

This SHALL hold for a DELIBERATE reconnect too, not only a pane-detected auth failure: when the owner
reconnects an agent (its credential is wiped and it is relaunched into `/login`), the pod SHALL clear
the now-dead remote-control session (so the pod stops reporting it "on") and owe an RC restore that
fires once the re-login completes — a manual reconnect previously left RC lost and the stale session
URL still reported as active. And `podbay doctor --fix` SHALL detect a signed-in agent whose remote
control is down (not deliberately yielded to an external harness) and re-establish it, so the owner has
a recovery path when the automatic restore didn't fire.

Both the automatic restore path and the manual `/agent/rc-restore` endpoint SHALL consult the SAME
current `rcState` classification (not merely the credential file's expiry) before proceeding: a restore
attempt SHALL NOT run the greeter or spend a slot from the bounded attempt budget while the classified
state is `login-required` — including a LIVE blocking gate (a login menu or an OAuth retry dialog) that
the credential file alone does not see. `/agent/rc-restore` SHALL report which of these happened rather
than always answering as if an attempt were accepted.

#### Scenario: A live blocking login dialog is not spent from the restore budget

- **GIVEN** the primary agent's pane currently shows a recognized blocking login/OAuth-retry dialog
  while the credential file itself still parses as unexpired
- **WHEN** an automatic restore tick or a manual `/agent/rc-restore` call would otherwise run
- **THEN** the pod SHALL NOT run the greeter and SHALL NOT consume a bounded auto-restore attempt for
  it, and SHALL log that the restore was skipped because a login problem is blocking it

#### Scenario: The restore endpoint reports honestly when it cannot help

- **GIVEN** the primary agent's classified `rcState` is `login-required`
- **WHEN** `POST /agent/rc-restore` is called
- **THEN** the pod SHALL respond indicating the call was skipped for a login problem rather than
  reporting success, so the caller (doctor, or the cockpit) can tell "you must reconnect" apart from
  "an attempt was made"

#### Scenario: Remote control is restored after a mid-session re-login

- **WHEN** the owner runs `/login` to recover a mid-session logout and the agent becomes authenticated
  again while remote control is dead
- **THEN** the pod re-establishes remote control on its own and a fresh session becomes available,
  without the owner running `/remote-control`

#### Scenario: Auto-restore does not fire into a logged-out or mid-login agent

- **WHEN** the agent is not authenticated, or is sitting at a login/method menu
- **THEN** the pod does not attempt to re-establish remote control (the login/menu path is handled
  first), so it never drives remote control into a session that cannot accept it

#### Scenario: A bridge that will not come back is surfaced, not looped

- **WHEN** remote control cannot be re-established within the attempt cap
- **THEN** the pod surfaces that remote control could not be restored, rather than retrying forever or
  reporting it active

#### Scenario: A manual reconnect restores remote control after re-login

- **WHEN** the owner reconnects the primary agent (credential wiped, relaunched into `/login`) and then
  completes the re-login
- **THEN** the pod SHALL have cleared the dead session URL (so it does not report RC "on" off a stale
  session) and SHALL re-establish remote control once authed, without a manual `/remote-control`

#### Scenario: Doctor detects and fixes remote control that is down

- **WHEN** `podbay doctor` runs on a pod whose Claude is signed in but has no live remote-control
  session, and RC was not deliberately turned off (yielded to T3)
- **THEN** doctor SHALL report it, and `--fix` SHALL ask the pod to re-establish remote control, then
  re-read the pod's health and report `fixed` from the OBSERVED resulting state, never from the
  restore request having merely been accepted

#### Scenario: Doctor does not attempt to fix a login-required state

- **GIVEN** the pod's classified `rcState` for Claude is `login-required`
- **WHEN** `podbay doctor --fix` runs
- **THEN** doctor SHALL report a distinct finding directing the owner to reconnect/sign in, and SHALL
  NOT call the restore endpoint — only the owner's own sign-in can clear this state

#### Scenario: Doctor treats an unverifiable RC state as not a problem, not a false negative

- **GIVEN** the pod's classified `rcState` for Claude is `unknown` (including an older pod-agent image
  that sends no `rcState` field at all)
- **WHEN** `podbay doctor` runs
- **THEN** doctor SHALL NOT report it as a confirmed failure and SHALL NOT translate a historical
  session URL or the pre-`rcState` heuristic into a false `down`/`active` claim

### Requirement: The greeter does not attempt remote-control against a logged-out agent

Enabling remote control types `/remote-control` into the agent and waits for a success signal. When
the agent's login is known-expired, that command is refused and can never succeed, so every
remote-control enable path SHALL consult the credential expiry signal (not merely the credential
file's presence) and short-circuit — logging the skip — rather than spending its retry budget on a
doomed attempt. This applies to the boot greeter, the resume re-enable, the added-agent greeter, and
the codex daemon start.

#### Scenario: Boot/resume RC enable skips a logged-out agent

- **WHEN** a remote-control enable path runs for an agent whose credential is known-expired
- **THEN** it does not type `/remote-control`, records that it skipped because the login is expired,
  and leaves the pod free to surface the "sign-in expired" state instead of appearing to retry

#### Scenario: A logged-out agent does not re-arm the RC attempt on every resume

- **WHEN** a pod whose agent login is expired is suspended and resumed repeatedly
- **THEN** the resume watcher does not re-run the full remote-control attempt each cycle for that
  agent, so it never loops typing a refused command

#### Scenario: A signed-in agent still enables remote control normally

- **WHEN** a remote-control enable path runs for an agent whose credential is present and not expired
- **THEN** it proceeds exactly as before, attempting `/remote-control` and confirming the session

### Requirement: An expired login does not stall an owner-initiated interrupt

A wedged remote-control attempt against a logged-out agent SHALL NOT delay a maintenance interrupt
(update/resize) — the platform proceeds to its bounded handoff and graceful-shutdown path regardless
of a stuck RC attempt.

#### Scenario: Update proceeds despite a logged-out agent

- **WHEN** an update is requested for a pod whose agent login is expired
- **THEN** the update's handoff and shutdown proceed within their bounded timeouts and are not held
  open by a remote-control attempt that cannot succeed

