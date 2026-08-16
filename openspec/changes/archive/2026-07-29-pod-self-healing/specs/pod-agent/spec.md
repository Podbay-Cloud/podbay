## ADDED Requirements

### Requirement: The pod repairs drift from its declared shape

The pod-agent SHALL continuously compare the pod's RUNNING shape against the shape its spec
declares — a live tmux session, one window per agent in `spec.agents`, each hosting a live agent
process, and the sidecar daemons that should be up — and SHALL repair differences it can repair.

Repairs SHALL be bounded: at most 3 attempts per target per rolling hour with exponential backoff,
after which the target is marked unhealthy with the reason rather than retried forever. A capped-out
target SHALL NOT block repairs of other targets.

Every repair, and every exhausted cap, SHALL emit a pod event. Self-healing that leaves no trace is
indistinguishable from a pod that was never broken, and denies the owner any way to know their agent
restarted twice while they were away.

#### Scenario: An agent's window is gone

- **WHEN** an agent listed in `spec.agents` has no window
- **THEN** the pod SHALL respawn it on the RESUME path (never the first-run kickoff) and emit an
  event naming the agent

#### Scenario: An agent process has exited

- **WHEN** an agent's window exists but its CLI has exited (leaving a bare shell)
- **THEN** the pod SHALL restart the agent in that window, subject to the cap

#### Scenario: A repair loop is capped

- **WHEN** a target has been repaired 3 times within a rolling hour and fails again
- **THEN** the pod SHALL stop retrying it, mark it unhealthy with the reason, emit an event, and
  continue repairing unrelated targets

### Requirement: A dead terminal session is recovered

A pod whose tmux server has died has no terminal and no agents, and today nothing recovers it: the
pod-agent process survives (only its PTY child dies), so the service manager's restart policy never
fires, while `/healthz` reports `ready: false` indefinitely.

The pod SHALL detect this state and recover it by re-running the BOOT path — the sequence measured
to restore a pod completely, including respawning every agent from `spec.agents` — rather than a
separate in-process rebuild. Recovery SHALL be subject to the same cap so a pod that cannot start
does not thrash, and SHALL emit an event.

#### Scenario: The tmux server is killed

- **WHEN** the pod's tmux server dies while the pod is running
- **THEN** the session SHALL be rebuilt and every agent in `spec.agents` SHALL be running again,
  without an operator touching the box

#### Scenario: Recovery cannot succeed

- **WHEN** session recovery has hit its cap
- **THEN** the pod SHALL stop attempting it and report the failure as a health issue rather than
  restarting in a loop

### Requirement: The pod reports what is wrong with it

`/healthz` SHALL include an `issues` array describing current problems — a stable id, a severity, a
short human title, detail, whether a fix exists, and the agent it belongs to when applicable — so
surfaces can state the problem instead of inferring it from a stuck state. An issue SHALL be absent
when the corresponding check passes.

#### Scenario: Disk is nearly full

- **WHEN** the pod's home volume is below its free-space floor
- **THEN** `/healthz` SHALL carry an issue naming it, at a severity reflecting that most other
  repairs will fail while it persists

#### Scenario: Healthy pod

- **WHEN** every check passes
- **THEN** `issues` SHALL be empty — not a list of green rows

### Requirement: A doctor checks and repairs a pod on demand

The image SHALL provide a `doctor` command that runs a checklist against the pod, each check being a
probe with an optional fix, and SHALL support machine-readable output. It SHALL be runnable by the
pod's own agent and by the owner through the pod-agent, which exposes it as transport only.

Fixes SHALL escalate by blast radius:

1. Safe repairs (respawn windows/daemons, clear stale locks and markers, prune caches when disk is
   tight, restart the app) MAY be applied when a fix is requested.
2. Invasive repairs (reinstalling dependencies, restoring a config file from the environment
   template) SHALL require explicit confirmation and SHALL back up the existing file before
   replacing it — never destroying evidence of the failure.
3. When nothing else applies, doctor SHALL offer restarting or updating the pod, which resets
   everything outside the home volume.

Doctor SHALL NOT modify `~/work` content, and SHALL NOT attempt to repair credentials — it SHALL
report and direct the owner to the sign-in flow instead.

#### Scenario: Read-only run

- **WHEN** doctor runs without being asked to fix
- **THEN** it SHALL change nothing and report each check's state

#### Scenario: Fixing what is safe

- **WHEN** a fix is requested and the failing checks are safe-tier
- **THEN** doctor SHALL apply them, report what it did, and re-probe

#### Scenario: A config file is replaced

- **WHEN** doctor restores a config file from the environment template
- **THEN** the existing file SHALL be preserved under a timestamped backup first

#### Scenario: User work is never touched

- **WHEN** a check concerns files under `~/work`
- **THEN** doctor SHALL report the finding and SHALL NOT modify them
