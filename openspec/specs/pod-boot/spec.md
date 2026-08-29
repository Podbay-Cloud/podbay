# pod-boot Specification

## Purpose
Ensures Claude pods boot the agent with remote control enabled and a descriptive, safely-quoted session name that tolerates characters such as apostrophes, while leaving Codex pods' boot behavior unchanged. It exists so pods are remote-controllable and identifiable from first boot.
## Requirements
### Requirement: The pod's hostname carries its chosen name

First-boot init SHALL set the guest hostname from the pod's chosen name, sanitised to a valid
hostname, and SHALL leave the slug in place when the pod has no usable name. This must happen BEFORE
any agent's remote-control daemon starts.

The reason is not cosmetic: an agent app labels the pod by the name captured at its FIRST enrollment,
which is then fixed on the vendor's side — renaming the host later does not change it, and clearing
the local enrollment re-registers under the same identity and the OLD name (both verified live,
2026-07-29). First boot is therefore the only opportunity, and a pod renamed afterwards keeps its
original label in the agent app. That is a platform limit and SHALL be stated as such rather than
presented as a setting.

#### Scenario: A named pod

- **WHEN** a pod is created with the name "byo test"
- **THEN** its hostname SHALL be `byo-test` before any remote-control daemon starts

#### Scenario: An unnamed pod

- **WHEN** a pod has no name, or one that sanitises to nothing
- **THEN** the hostname SHALL remain the pod's slug

### Requirement: No agent may boot into a prompt nobody can answer

Agent CLIs SHALL be pinned by the image and SHALL NOT change underneath a pod. Where a component
updates itself and offers no way to disable that, the pod SHALL re-pin it on boot.

An agent's boot command SHALL suppress the CLI's own interactive gates — update offers, first-run
notices, permission acceptances. There is nobody at the keyboard on a pod, so such a prompt does not
delay the agent, it PREVENTS it: the pod looks alive, its remote control never comes up, and the
cockpit reports a healthy pod that does nothing (observed live, 2026-07-29, a Codex pod parked on
"Update available … Press enter to continue"). Keeping the CLI current is the image's job, not a
question to ask a window nobody watches.

#### Scenario: A self-updating component is re-pinned

- **WHEN** a pod boots with an agent runtime that has self-updated to a version the image did not
  ship
- **THEN** the pod SHALL restore the shipped version, so what a pod runs is what was reviewed and
  released — and SHALL keep the downloaded version on disk rather than deleting it

#### Scenario: The CLI offers an update at startup

- **WHEN** an agent CLI would prompt to update on launch
- **THEN** the pod SHALL start it with that prompt disabled, and the agent SHALL reach its session

### Requirement: An agent resumes its own conversation on restart

A pod that restarts — image update, crash, machine restart — SHALL bring each agent back into ITS
PRIOR conversation, not a new one, and SHALL re-run the environment's kickoff only on a genuine
first boot. This is what "your agent picks up where it left off" means, and it must hold for every
agent, not just the one it was first implemented for.

Starting fresh instead has two costs, both observed live (2026-07-29): the agent loses the context of
the work it was doing, and the user's agent app accumulates one identical session per restart (12 on
one pod) with no way to tell them apart.

On a restart the resumed agent SHALL be given a turn ("Resuming — where are we?") so it orients and
speaks instead of sitting silent in a session the owner sees as empty. This nudge SHALL be delivered
regardless of whether the environment declares a kickoff — a pod with NO kickoff MUST still receive it
on restart (it previously got the handoff note but no resume turn, and resumed silently).

#### Scenario: Restart with prior work

- **WHEN** a pod restarts and the agent has a recorded prior session
- **THEN** the agent SHALL resume that session and the kickoff SHALL NOT be re-run

#### Scenario: A pod with no kickoff still gets the resume nudge

- **WHEN** a pod that declares no kickoff restarts after having been greeted before
- **THEN** it SHALL still receive the "Resuming — where are we?" turn, not resume silently

#### Scenario: Genuine first boot

- **WHEN** an agent has no prior session
- **THEN** it SHALL start fresh and the environment's kickoff SHALL run

#### Scenario: The choice is made before launching

- **WHEN** deciding between resuming and starting fresh
- **THEN** the pod SHALL test for a recorded session rather than launch a resume and branch on its
  exit code — a resume that fails for any reason would otherwise fall through to a fresh session
  plus kickoff, accumulating one identical session per restart

### Requirement: An agent's runtime is seeded for any declared agent

Per-agent runtime assets baked into the image (notably Codex's standalone remote-control daemon)
SHALL be seeded onto the pod's volume when that agent appears ANYWHERE in the pod's declared agents —
not only when it is the primary. Keying on the primary meant a pod that gained an agent after launch
never received that agent's runtime, so its remote control could never start no matter how many times
the owner asked (found live 2026-07-29).

#### Scenario: Codex added to a Claude pod

- **WHEN** a pod declares `[claude-code, codex]` in any order
- **THEN** the Codex standalone daemon SHALL be seeded onto the volume, so remote control can start

#### Scenario: A pod without that agent

- **WHEN** a pod declares only `[claude-code]`
- **THEN** the Codex runtime SHALL NOT be seeded

### Requirement: The pod boots Claude with remote control enabled and a descriptive session name

When the launched agent is Claude, the pod's boot command SHALL enable Claude Code Remote Control
and set the session title so the session is controllable from, and findable by name in, the user's
Claude apps. Codex sessions are unaffected (no equivalent). The session title SHALL derive from the
pod's environment name and slug, and SHALL be sanitized so it can never break the `bash -lc '…'`
boot wrapper.

Because current Claude Code does not surface the `--remote-control` title in the app's session list,
the pod SHALL additionally `/rename` the session to the pod name — but ownership of that rename is
decided by RC SESSION IDENTITY, not by whether the pod-agent process restarted (a `coldStart` boolean
derived from process-restart cannot tell "the same RC session survived" from "a fresh one opened",
since the tmux-hosted Claude process — and the RC session it owns — can outlive a pod-agent-only
restart). Podbay persists a hash (never the raw session id/URL) of the last RC session identity it
observed, in a mode-0600 state file. On each greet it compares the currently observed identity
(Claude Code's own bridge session id) against that persisted hash:

- the SAME identity as last time (e.g. the tmux-hosted Claude process survived a pod-agent-only
  restart, or a provider suspend that genuinely freezes the process in place — Fly's Machines
  suspend, not Incus's, whose suspend is a plain VM stop/start and therefore a cold boot like any
  other) → the pod SHALL NOT re-apply `/rename`, so a name Podbay or the owner set is preserved;
- a DIFFERENT identity, or no persisted hash yet (first-ever observation, or a genuinely fresh/
  replacement session from an image update or crash restart) → the pod SHALL `/rename` to the pod
  name, and persist the new identity's hash;
- NO observable identity, but a persisted hash EXISTS → the pod SHALL NOT send `/rename` (it has
  recorded a session for this pod before and nothing proves the current one differs, so a rename
  could clobber a title the owner set) and SHALL leave the persisted hash untouched; the
  `--remote-control`/`/remote-control <title>` argument already sent is the best-effort path;
- NO observable identity AND no persisted hash → the pod SHALL `/rename` as best effort, persisting
  nothing (there is no identity to record). Nothing has ever been recorded for this pod, so no owner
  title can be clobbered, and the pod only reaches this step once remote control is confirmed
  ACTIVE — a confirmation it accepts from the terminal pane as well as from the session file. That
  asymmetry is a real window (the pane can report an active session before the session file exists
  to be read), and treating it as "unprovable, skip" would silently forfeit the naming behavior this
  requirement exists for.

#### Scenario: A restart's fresh RC session is named to the pod, not "Resume session context"

- **WHEN** a Claude pod's greeter observes an RC session identity that differs from the last one it
  persisted (e.g. an image update or crash restart opened a new remote-control session), or has no
  persisted identity yet
- **THEN** the pod SHALL rename it to the pod name so the owner recognizes it in their Claude app,
  rather than leaving it under an auto-generated content title, and SHALL persist the new identity's
  hash

#### Scenario: A suspend/resume does not clobber the owner's session name

- **WHEN** a pod is suspended and resumed on a provider whose suspend freezes the process in place
  (Fly), and the same RC session identity is observed as before
- **THEN** the pod SHALL NOT re-apply its pod-name rename, so a name the owner set themselves is kept

#### Scenario: An Incus suspend/resume is a cold boot, not a thaw

- **WHEN** an Incus pod is suspended (a plain VM stop) and resumed (a plain VM start) — the pod-agent
  process does not survive, unlike Fly's in-place Machines suspend
- **THEN** the pod resumes through the normal boot path (the same one an image update or crash uses),
  and the RC-session-identity comparison decides `/rename` from what it actually observes rather than
  from an assumption that suspend implies the same session survived

#### Scenario: A pod-agent-only restart does not imply a fresh Claude session

- **GIVEN** the pod-agent service restarts while the tmux-hosted Claude process and its RC session
  remain alive
- **WHEN** the greeter observes the same RC session identity it persisted before the restart
- **THEN** it SHALL NOT re-apply `/rename`, even though the pod-agent process itself just started

#### Scenario: An unobservable RC session identity does not clobber an already-recorded title

- **GIVEN** the greeter cannot read a current RC session identity from disk, AND it has a persisted
  identity hash from an earlier observation
- **WHEN** it enables remote control
- **THEN** it SHALL pass the pod title through the `--remote-control`/`/remote-control` argument as
  best effort, SHALL NOT send a separate `/rename`, and SHALL leave the persisted identity hash
  untouched

#### Scenario: An unobservable identity with nothing recorded is still named

- **GIVEN** the greeter cannot read a current RC session identity from disk, AND no identity hash has
  ever been persisted for this pod, AND remote control has been confirmed active (which the greeter
  accepts from the terminal pane as well as from the session file)
- **WHEN** it reaches the naming step
- **THEN** it SHALL send `/rename` as best effort — no owner title can exist to clobber — and SHALL
  persist nothing, since there is still no identity to record. Skipping here would forfeit the
  pod-naming behavior in the real window where the pane confirms an active session before the
  session file exists to be read.

#### Scenario: Claude pod boots remote-controllable and named

- **WHEN** a pod whose agent is Claude boots (either the authenticated path or the post-login
  respawn)
- **THEN** the `claude` invocation includes `--remote-control "<envName>: <slug>"`, and the generated
  command is valid shell

#### Scenario: A session name with an apostrophe does not break boot

- **WHEN** the derived session name contains a single quote or newline
- **THEN** it is sanitized (quotes/newlines removed, length-capped) and the boot command still parses

#### Scenario: Codex pods are unchanged

- **WHEN** a pod whose agent is Codex boots
- **THEN** the boot command contains no `--remote-control` flag


### Requirement: The environment's .claude layer is seeded once the pod-spec is present

A pod's `.claude` layer (skills, rules, settings) is injected by the provider AFTER the guest is
up, so the boot-time run of the pod's init script can legitimately find no pod-spec yet. The init
script SHALL NOT mark the pod as seeded on such a pass, and the provider SHALL clear any seed
marker written before its injection, so the post-injection agent restart applies the layer. A
seeded layer SHALL be reported, and a spec that lists `claudeFiles` without a corresponding
`/etc/podbay/claude` directory SHALL be reported as an error rather than passing silently.

#### Scenario: Init runs before the provider pushes the pod-spec

- **WHEN** the init script runs with no `/etc/podbay/pod-spec.json` present
- **THEN** it seeds nothing, writes no seed marker, and logs that the seed is deferred

#### Scenario: The agent restarts after injection

- **WHEN** the provider has pushed the init files and restarts the pod agent
- **THEN** the init script seeds the `.claude` layer (BYO repos at `~/.claude`, prebuilt workspaces
  at `~/work/.claude`) and logs the file and skill counts

#### Scenario: The layer is missing despite being declared

- **WHEN** the pod-spec lists `claudeFiles` but `/etc/podbay/claude` does not exist
- **THEN** the init script logs an error stating the env's skills and rules will not be active

### Requirement: The pod-spec's cockpit link points at the cockpit, and deep-links to a tab

`/etc/podbay/pod-spec.json`'s `cockpitUrl` SHALL be the pod's COCKPIT — `<appOrigin>/dashboard/pods/<slug>`
— never the bare web terminal at `<appOrigin>/pods/<slug>`, which is a different page. In-pod tooling
and agents hand this link to the owner, so pointing it at the terminal strands them on a page with
none of the controls they were sent for. One shared builder writes this spec for every provider, so
the value is wrong on every pod when it is wrong at all.

The cockpit SHALL accept `?tab=<control|settings|secrets|stats|activity|details>` so a link can open
directly on the surface the owner needs, and in-pod tooling SHALL use that rather than emitting a
bare link plus written navigation directions.

An image update SHALL repair a `cockpitUrl` already written in the terminal form, because the update
path otherwise preserves the pod-spec verbatim — so a pod created before the builder was corrected
would keep handing its owner the wrong link forever, however many times it updated. The repair SHALL
be narrow: only the exact `<origin>/pods/<slug>` → `<origin>/dashboard/pods/<slug>` rewrite, leaving an
already-correct, absent, or unrecognised value untouched so it cannot clobber a deliberate one.

#### Scenario: An existing pod's wrong cockpit link is healed by an update

- **GIVEN** a pod whose spec carries the terminal-form `cockpitUrl` from before the builder was fixed
- **WHEN** it takes an image update
- **THEN** its spec is re-pushed with the cockpit-form URL, so in-pod tooling starts handing the owner
  the right link — rather than the fix reaching only newly-created pods

#### Scenario: A secret request links straight to Secrets

- **WHEN** the agent runs `podbay secrets request <KEY>` and hands the owner the printed link
- **THEN** the link is the cockpit's Secrets tab (`…/dashboard/pods/<slug>?tab=secrets`), which opens
  there directly — not a terminal URL, and not a bare cockpit link with "go to Settings → Secrets"
  (secrets is its own tab, not a child of Settings)

### Requirement: The pod-spec stays current when the owner changes a spec-backed field

`/etc/podbay/pod-spec.json` is written once at launch and read in-pod by the `podbay` CLI, the
doctor, and the agent boot. When the owner changes a field that the spec carries — preview
visibility (`previewPublic`), display name (`podName`), or lifecycle policy — the control plane
SHALL push the new value into the running pod's spec, so in-pod tooling reports the CURRENT value
rather than the launch-time one. Preview visibility is security-load-bearing: agents are told to
trust `podbay info`/`podbay visibility`, so a stale value there could lead an owner to expose or
over-restrict an app. The push SHALL be best-effort — it MUST NOT fail the owner's change, since the
`pods` record remains the source of truth (the edge enforces visibility from the record, not the
spec) — and a `podbay visibility` command SHALL report the pod's current preview visibility.

#### Scenario: Toggling preview visibility updates the in-pod value

- **WHEN** the owner flips a running pod's preview between public and owner-only
- **THEN** the control plane pushes `previewPublic` into `/etc/podbay/pod-spec.json`, so `podbay
  info` and `podbay visibility` report the new value rather than the launch-time one

#### Scenario: The pod is unreachable when the field changes

- **WHEN** the pod is suspended or unreachable at the moment of the change
- **THEN** the change still succeeds (the record is authoritative) and the spec push is skipped
  rather than erroring

### Requirement: Assembled project rules refresh without clobbering user edits

The env-rules → project `CLAUDE.md` assembly SHALL refresh when the environment's rules change,
using a content-hash marker to distinguish podbay's own last write from a user edit: an untouched
assembled file is regenerated; a user-edited file is NEVER overwritten (the user's edit outranks the
refresh, permanently); a pre-marker file whose provenance is unknown is left alone. BYO pods are
never written into. (Was seed-once on the persistent volume — a shipped rule change never reached
existing pods; 2026-07-28 seed-once audit.)

#### Scenario: Rules change, file untouched

- **WHEN** the seed re-runs and the assembled `CLAUDE.md` matches the recorded hash of podbay's
  last write, but the current rules assemble to different content
- **THEN** the file SHALL be regenerated from the current rules and the hash updated

#### Scenario: User edited the file

- **WHEN** the file's hash differs from the recorded marker
- **THEN** it SHALL be left exactly as the user wrote it

#### Scenario: No marker exists

- **WHEN** a `CLAUDE.md` exists but no hash marker does (a pre-marker pod)
- **THEN** the file SHALL NOT be modified — ambiguous provenance is treated as the user's

### Requirement: Boot health is checked and recorded

After boot, the pod SHALL verify (in the background, never delaying or failing the boot) that a
workspace with a dev script has a populated `node_modules` and a dev server answering on the
preview port, applying the documented restore (`pnpm install`) when the bind-mount left
`node_modules` empty, and SHALL record the verdict durably where the owner and agent can read it.
Failures SHALL be loud in the boot log — a dead preview URL must never again be the first symptom.

#### Scenario: Bind-mount silently failed

- **WHEN** a dev-script workspace boots with an empty `node_modules`
- **THEN** the health check SHALL run the restore, restart the dev-server path, and record the
  remediation

#### Scenario: Dev server never answers

- **WHEN** the dev server does not answer on the preview port within the grace window (after any
  first-boot setup completes)
- **THEN** the check SHALL record the failure and surface the tail of the dev log in the boot log

### Requirement: The auto dev server can be durably disabled

A workspace with a `dev` script is auto-served (`pnpm dev` on the preview port) at boot and supervised
thereafter. A pod that instead serves its OWN process on the preview port (e.g. a production build via
an agent-declared startup command) SHALL be able to durably turn the auto dev server OFF, so podbay
does not race it for the port or overwrite its build artifacts. The opt-out SHALL be a persistent flag
under `~/.podbay` (surviving every restart), toggled by an explicit command. While the flag is set,
neither the boot path NOR the supervisor SHALL launch or relaunch the auto dev server, and removing
the flag SHALL restore the normal auto-serve behavior. (Distinct from the transient `dev stop`, which
only pauses supervision briefly.)

#### Scenario: Disabled dev server is not started at boot or by the supervisor

- **WHEN** the durable disable flag is present and a dev-script workspace boots (or the supervisor runs)
- **THEN** the auto dev server SHALL NOT be launched or relaunched, leaving the preview port to the
  pod's own process

#### Scenario: Re-enabling restores the auto dev server

- **WHEN** the durable disable flag is removed
- **THEN** the auto dev server SHALL be eligible to run and be supervised as normal again

### Requirement: Agent-declared startup commands are re-launched on every boot

Because a pod restart (Update, Suspend, Resize, or a host reboot) kills all running processes and
only the home volume persists, an agent SHALL be able to declare long-running startup commands that
the boot path re-launches on every boot. Declared commands SHALL be read from `~/.podbay/startup.json`
— on the persistent home volume and deliberately outside `~/work`, so the declaration never lands in
a BYO user's committed repository — as an object with a `commands` array whose entries are
`{ slug, command, enabled }`.

On every boot, after the workspace is in place, the boot path SHALL launch each enabled command as
the workspace-owning `dev` user in the background, capturing its pid and output under
`~/.podbay/startup/<slug>.pid` and `~/.podbay/startup/<slug>.log`. Before launching a command, the
boot path SHALL skip it when its recorded pid is still alive, so a command that survived (or was
already relaunched) is never double-started. The mechanism SHALL never modify `~/work`.

#### Scenario: Declared command relaunched after a restart

- **GIVEN** `~/.podbay/startup.json` declares an enabled command whose process was killed by a restart
- **WHEN** the pod boots
- **THEN** the boot path SHALL relaunch the command as `dev`, recording its pid and log under
  `~/.podbay/startup/`

#### Scenario: A live command is not double-started

- **GIVEN** a declared command whose recorded pid is still alive
- **WHEN** the boot path evaluates startup commands
- **THEN** it SHALL NOT start a second copy of that command

#### Scenario: A disabled command is not launched

- **WHEN** a declared command has `enabled: false`
- **THEN** the boot path SHALL NOT launch it

#### Scenario: BYO workspace is untouched

- **WHEN** startup commands are evaluated on a pod whose `~/work` holds a user's repository
- **THEN** the declaration and all pid/log state SHALL live under `~/.podbay/` and `~/work` SHALL NOT
  be modified

### Requirement: An agent can restart, stop, or start a declared startup command by slug

Boot-time relaunch and crash supervision cover a command across restarts and crashes, but an agent
that ships new code to a declared command (e.g. a custom ops server) needs to RELOAD it without
restarting the whole pod. The in-pod `podbay` CLI SHALL expose per-slug control of a declared startup
command — `podbay startup restart|stop|start <slug>` — routed through the pod-agent so it shares the
supervisor's pause/pidfile contract and never races the watchdog. A `restart` SHALL stop the process
gracefully and relaunch it through a fresh login shell, so it comes up on the latest on-disk code with
the pod's secrets re-sourced. A `stop` SHALL be session-only — the declaration stays registered and
the next boot relaunches it; `remove` remains the way to unregister. Hand-killing a supervised process
is NOT the sanctioned path (the watchdog races it).

A declared command MAY record the TCP port it binds (`podbay startup add --port`). When a port is
declared, `stop` and `restart` SHALL free that port reliably: after signalling the tracked pid, the
pod SHALL identify whatever process still listens on the port — even one the pidfile never tracked
(e.g. a grandchild whose command line does not match the declared command) — terminate it
(escalating from SIGTERM to SIGKILL), and WAIT for the port to actually clear before a `restart`
launches the replacement. Without this, a slow-to-exit or untracked prior instance leaves the new one
crash-looping on "address already in use", and a `stop`/`restart` that only touched the registry
would falsely report success while stale code kept serving.

Independently of a declared port, a `stop`/`restart` SHALL reap the tracked process's whole descendant
TREE, not merely its process group. The process that actually binds the port is frequently a grandchild
that has ESCAPED the tracked pid's group (a wrapper or framework that starts its own session), which a
group-kill alone leaves alive holding the port. The pod SHALL capture the descendant tree while the
parent is still alive (once it dies, children reparent to init and the link is lost) and terminate every
member (SIGTERM then SIGKILL) — so a restart frees the port even when no `--port` was declared.

Per-slug commands SHALL be serialized: while a `stop`/`start`/`restart` for a slug is in flight, another
command for the SAME slug SHALL be refused rather than run concurrently. Overlapping commands otherwise
spawn multiple replacements that all crash-loop on the port until the supervisor backs off.

#### Scenario: Restart frees the port even with no declared port

- **GIVEN** a running startup command with NO declared port whose real listener is a grandchild that
  escaped the tracked pid's process group
- **WHEN** the agent runs `podbay startup restart <slug>`
- **THEN** the pod SHALL reap the whole descendant tree and free the port before relaunching, so the
  replacement binds instead of crash-looping on "address already in use"

#### Scenario: An overlapping command for the same slug is refused, not raced

- **GIVEN** a `podbay startup restart <slug>` already in flight
- **WHEN** a second `restart`/`start`/`stop` for the SAME slug arrives before it finishes
- **THEN** the pod SHALL refuse the second command rather than spawn a competing process

#### Scenario: Restart reloads a declared command on the latest code

- **GIVEN** a declared, running startup command whose on-disk code changed
- **WHEN** the agent runs `podbay startup restart <slug>`
- **THEN** the pod SHALL stop the process without the watchdog racing the swap and relaunch it via a
  fresh login shell, so it runs the new code with re-sourced secrets

#### Scenario: Restart of a port-declared command frees the port before relaunch

- **GIVEN** a declared command with a declared port whose real listener is a process the pidfile did
  not track (an untracked child/orphan still bound to the port)
- **WHEN** the agent runs `podbay startup restart <slug>`
- **THEN** the pod SHALL terminate whatever holds the declared port (SIGTERM then SIGKILL) and wait
  for the port to be free before launching the replacement, so the new instance binds instead of
  crash-looping on "address already in use"

#### Scenario: Stop is session-only, start launches a not-yet-running command

- **WHEN** the agent runs `podbay startup stop <slug>`
- **THEN** the pod SHALL stop the process and NOT respawn it this session, leaving the declaration
  registered so the next boot relaunches it
- **AND WHEN** the agent runs `podbay startup start <slug>` on a registered command that is not running
- **THEN** the pod SHALL launch it and record its pid, without waiting for the next boot

### Requirement: Long-running processes that die MID-RUN are restarted, supervised

Boot-time relaunch alone left a gap: a declared startup command (or the dev server) killed mid-run
— most commonly by the out-of-memory killer — stayed dead until the next reboot, with the preview
dark and nothing telling the owner. The pod SHALL supervise its declared long-running processes
between boots: when a process whose pid was recorded is found dead, it SHALL be relaunched the same
way boot launches it, under the same capped-and-backed-off repair policy as agent repairs, and the
repair SHALL be reported (with `cause: oom` when a kill was just observed) so it reaches the owner
as an incident. A repeatedly-dying process SHALL be backed off (surfaced as a critical issue naming
the owner's slug) but NEVER permanently abandoned: EVERY supervised target — the dev server AND any
`podbay startup` command — SHALL get a spaced-out recovery attempt (~every 10 minutes) so an
unattended pod heals itself rather than staying dead until a reboot. Before a recovery respawn the
pod SHALL clear any SURVIVOR of that command still holding its port (an incompletely-killed prior
generation is the usual crash-loop cause: every respawn dies `EADDRINUSE`). A backed-off process
SHALL also be recoverable IMMEDIATELY by the owner — `podbay startup restart <slug>` (or `podbay dev
restart`) and `podbay doctor --fix` — each of which clears the cap, clears the survivor, and respawns
on the latest code. Owner-facing guidance SHALL point at these real actions, never at a nonexistent
"restart the pod" control.

Supervision SHALL strictly restart what DIED — never start what never ran (a missing pidfile means
boot owns the first launch), and never resurrect a removed or disabled declaration (the declaration
is re-read each pass).

#### Scenario: An OOM-killed startup command comes back without a reboot

- **GIVEN** a declared command whose recorded pid is dead, shortly after an observed OOM kill
- **WHEN** the supervisor next evaluates the pod
- **THEN** the command SHALL be relaunched as `dev` with its pid re-recorded, and the repair
  reported with `cause: oom`

#### Scenario: The dev server is not double-bound

- **GIVEN** the dev-server pidfile is dead but something (e.g. a hand-run `pnpm dev`) already
  answers on the app port
- **WHEN** the supervisor evaluates the dev server
- **THEN** it SHALL NOT start a second copy

#### Scenario: A never-started or removed command is left alone

- **WHEN** a declared command has no recorded pidfile, or a dead process's declaration has been
  removed or disabled
- **THEN** the supervisor SHALL NOT launch it

#### Scenario: A flapping process is backed off but self-heals

- **GIVEN** a supervised process (dev server OR a `podbay startup` command) that keeps dying
- **WHEN** its repair attempts exhaust the shared repair policy
- **THEN** the supervisor SHALL stop the tight relaunch loop and surface a critical issue, but SHALL
  keep making a spaced-out recovery attempt so the process comes back without a reboot — the pod is
  never wedged until the owner restarts it

#### Scenario: A survivor holding the port is cleared before recovery

- **GIVEN** a supervised process was killed incompletely, so an old instance still holds its port and
  every respawn dies `EADDRINUSE`
- **WHEN** the pod makes a recovery respawn (or the owner runs `podbay startup restart <slug>`)
- **THEN** it SHALL first kill the surviving instance of that command so the fresh process can bind

#### Scenario: doctor --fix recovers a backed-off process

- **WHEN** the owner runs `podbay doctor --fix` on a pod with a backed-off `startup` process
- **THEN** doctor SHALL clear the cap, clear any port-holding survivor, and respawn it on the latest
  code — not merely report it — and the owner guidance SHALL NOT tell the owner to "restart the pod"
  naming the process

### Requirement: The agent restarts the dev server without fighting the supervisor

Because the dev server is supervised, an agent that restarts it by hand — most often to load a
secret added after boot — races the supervisor: the kill is indistinguishable from a crash, so the
supervisor relaunches the very process the agent just killed, and the ensuing hard-kill loop corrupts
the build cache into a genuine crash-loop (observed on a real pod, 2026-08-11). The pod SHALL provide
a sanctioned dev-server lifecycle (`podbay dev restart | stop | start`) that the agent uses instead
of a raw kill. A restart SHALL pause supervision for the swap so the supervisor never races it, stop
the process cleanly, relaunch through a fresh login shell (which RE-SOURCES the pod's secrets), and
reset the process's repair cap. A stop SHALL leave the process stopped (its pidfile removed so the
supervisor treats it as intentionally down, not crashed) until an explicit start. The pause SHALL be
time-bounded so a restart that dies mid-swap can never disable crash-recovery permanently.

The supervised dev server SHALL be DISCOVERABLE from inside the pod — surfaced by `podbay dev`,
`podbay startup list`, and `podbay doctor`, with its restart policy and capped state — and each
supervisor respawn SHALL leave a human-readable line in the process's own log, so an agent is never
left inferring that an invisible supervisor exists.

#### Scenario: A sanctioned restart is not fought

- **GIVEN** the dev server is supervised
- **WHEN** the agent runs `podbay dev restart`
- **THEN** supervision SHALL be paused for the swap, the old process stopped and a fresh one launched
  through a login shell that re-sources secrets, and the supervisor SHALL NOT relaunch a competing copy

#### Scenario: A deliberate stop stays stopped

- **WHEN** the agent runs `podbay dev stop`
- **THEN** the process SHALL be stopped and its pidfile removed, and the supervisor SHALL treat the
  missing pidfile as intentional and NOT relaunch it until `podbay dev start`

### Requirement: Dev-server supervision counts outcomes and self-heals

The supervisor SHALL judge a dev-server respawn by whether it actually SERVES, not merely whether it
was launched: a respawn that answers on the preview port SHALL clear the process's repair history (a
healthy restart never accrues toward the cap), while a respawn that comes up but never serves SHALL
count as a failed serve. After a respawn that failed to serve, the supervisor SHALL wipe the dev
server's build cache (`.next`) before the next attempt, since a hard kill mid-build is the common
cause. Once the dev server is capped, the supervisor SHALL still attempt a single spaced-out recovery
(build-cache wiped first) on a long cooldown, so an unattended pod self-heals rather than staying
wedged until a reboot. This self-heal is opt-in to the dev server; the agent watchdog SHALL remain a
hard stop at the cap, so a deliberately-quit agent is never put back.

#### Scenario: A healthy restart does not accrue toward the cap

- **GIVEN** the dev server is respawned and then answers on the preview port
- **WHEN** the supervisor checks the outcome
- **THEN** it SHALL clear that process's repair history, so a later crash starts from a full budget

#### Scenario: A corrupted build cache is recovered

- **GIVEN** a dev-server respawn that came up but never served
- **WHEN** the supervisor next relaunches it
- **THEN** it SHALL delete the workspace's `.next` build cache before relaunching, and SHALL NOT touch
  anything else under `~/work`

#### Scenario: A capped dev server self-heals on a cooldown

- **GIVEN** the dev server has exhausted its repair budget (capped)
- **WHEN** the recovery cooldown has elapsed since the last attempt
- **THEN** the supervisor SHALL make one recovery attempt (build cache wiped first); a served result
  SHALL clear the cap, and the agent watchdog's own cap SHALL be unaffected by this dev-server-only path

### Requirement: Pod resource-metrics history survives suspend/resume and recreate

The Stats sampler SHALL persist its sample ring to the pod's /home/dev block volume and restore it
on start, so resource history is not lost when the agent process ends (a suspend/resume, or an
image-update recreate). Writes SHALL be atomic (temp file + rename) and best-effort — a failed or
corrupt write SHALL never crash the agent, and an unreadable history SHALL start clean. Samples are
timestamped, so a suspended stretch is a real gap.

#### Scenario: History restored after resume

- **WHEN** the agent restarts (suspend/resume or recreate) and a persisted history exists on the volume
- **THEN** the sampler restores the prior samples (newest up to the cap) before taking new ones

#### Scenario: A suspended stretch is visible

- **WHEN** the Stats chart renders a series whose adjacent samples are more than a few sample
  intervals apart in time
- **THEN** it breaks the line at that point and marks the gap, rather than drawing a continuous line

### Requirement: The greeter answers the bypass-permissions gate

Claude launched with `--dangerously-skip-permissions` (used for a `bypassPermissions` env) shows an
interactive "Bypass Permissions mode" acceptance gate. Verified on a live pod (Claude 2.1.215,
2026-07-28): **no configuration key or flag suppresses this gate** — `bypassPermissionsModeAccepted`,
`hasTrustDialogAccepted`, and `--allow-dangerously-skip-permissions` were all present/tried and the
gate still appeared. It therefore cannot be prevented and MUST be answered. The greeter SHALL detect
this specific gate and accept it (select "Yes, I accept"), because the gate asks whether the machine
is a sandboxed, restorable container — which is exactly what a pod is. Acceptance is bounded (a small
maximum per greet) so a mis-detection cannot loop, and the answerer SHALL be distinguishable from the
working "bypass permissions on" status line so a healthy session is never typed into.

This replaces the earlier belief that `--dangerously-skip-permissions` was "non-interactive" or that
seeding a config key suppressed the gate — both false, and the cause of the recurring "stuck after
signin on RC" regressions.

#### Scenario: The gate appears on the work session

- **WHEN** the greeter is waiting for Claude to become ready and the pane shows the bypass acceptance
  gate
- **THEN** the greeter SHALL select "Yes, I accept", wait for the gate to clear, and then continue to
  remote control and the kickoff — rather than waiting at the gate until timeout

#### Scenario: The gate never clears

- **WHEN** the acceptance is sent but the gate does not clear
- **THEN** the greeter SHALL retry only up to a bounded maximum and then give up gracefully, without
  typing the kickoff into the gate and without looping

#### Scenario: A healthy bypass session is not mistaken for the gate

- **WHEN** the pane shows the working "bypass permissions on" status rather than the acceptance gate
- **THEN** the greeter SHALL NOT send an acceptance keystroke

#### Scenario: Launch flag by mode

- **WHEN** the launch command is built for mode `bypassPermissions`
- **THEN** it uses `--dangerously-skip-permissions`; any other mode uses `--permission-mode <mode>`

### Requirement: Codex directory-trust is pre-seeded so login is the only interactive step

First-boot setup SHALL pre-seed Codex's directory trust so its "Do you trust the contents of this
directory?" gate never blocks the post-login session — the Codex analog of the Claude first-run seed
(`hasTrustDialogAccepted`). It SHALL write `~/.codex/config.toml` marking the agent's workspace
`/home/dev/work` (and `/home/dev`, the `cd ~/work || cd ~` fallback) as `trust_level = "trusted"`.

Because Codex writes that file itself, the seed SHALL be a create-and-repair pass that runs every
boot: it appends a trusted entry only for a project path NOT already present, never rewrites a table
Codex or the user wrote (which risks invalid TOML), and leaves a present-but-untrusted path unchanged
so an explicit decline is respected.

#### Scenario: A fresh Codex pod

- **WHEN** first-boot setup runs and no `~/.codex/config.toml` exists
- **THEN** it creates one trusting `/home/dev/work` and `/home/dev` (`trust_level = "trusted"`), so
  Codex boots straight to its prompt with no trust gate

#### Scenario: Codex already wrote a config

- **WHEN** `~/.codex/config.toml` exists with Codex's own settings but no entry for the workspace
- **THEN** the trust entries are appended and Codex's existing settings are preserved

#### Scenario: The user declined trust for a path

- **WHEN** a project path is already present as `untrusted`
- **THEN** the seed leaves that path unchanged

### Requirement: A Codex pod receives its environment's skills

An environment ships skills in Claude shape (`.claude/skills/<name>/SKILL.md` plus support
files), which Codex never reads. First-boot setup SHALL make those same skills available to a
Codex pod by copying each skill directory into `~/.codex/skills/<name>/` — the location Codex
auto-discovers. The `SKILL.md` format is compatible (`name`/`description` frontmatter; Codex
tolerates Claude-only keys such as `allowed-tools`), so the translation is a per-directory copy
with support files preserved. This applies only to Codex pods and SHALL never touch Codex's
reserved `~/.codex/skills/.system/` built-ins. (Env rules reach Codex via `AGENTS.md`, not this
path — skills only.)

#### Scenario: A Codex pod with env skills

- **WHEN** first-boot setup runs for a pod whose agent is Codex and the env supplied skills
- **THEN** each env skill directory (with its support files) is copied into `~/.codex/skills/`,
  the `.system` built-ins are left untouched, and Codex discovers the env's skills

#### Scenario: A Claude pod

- **WHEN** the pod's agent is Claude
- **THEN** no `~/.codex/skills` translation runs

### Requirement: A Codex pod gets the runtime + environment rules via AGENTS.md

Claude reads its rules from `~/.claude/CLAUDE.md` (universal) and `~/work/CLAUDE.md` (env), which
Codex reads NEITHER — so without this a Codex pod runs without the universal confirm-before-outbound
rule or the env's rules. First-boot setup SHALL assemble the universal runtime rules and the env's
`.claude/rules` into the **global `~/.codex/AGENTS.md`** for Codex pods — the location Codex reads in
every project, which (unlike `~/work/AGENTS.md`) never dirties a BYO repo. The rules SHALL live in a
delimited podbay block so the write is non-destructive (content the user or Codex placed outside the
block is preserved) and idempotent, and it SHALL be regenerated each boot so a rules update reaches
existing pods on the next image cycle. This applies only to Codex pods.

#### Scenario: A Codex pod boots

- **WHEN** first-boot setup runs for a Codex pod with universal rules and env rules present
- **THEN** `~/.codex/AGENTS.md` contains both, inside a delimited podbay block

#### Scenario: Regenerating over prior content

- **WHEN** `~/.codex/AGENTS.md` already has a podbay block plus other content
- **THEN** only the podbay block is replaced and the other content is preserved

#### Scenario: A Claude pod

- **WHEN** the pod's agent is Claude
- **THEN** no `~/.codex/AGENTS.md` assembly runs

### Requirement: A Codex pod runs the remote-control daemon so it is pairable

A Codex pod SHALL run the Codex remote-control daemon (`codex remote-control start`) so the pod is
pairable from the Codex app — the codex analog of Claude's remote control. The daemon requires the
STANDALONE codex build (the npm build cannot daemonize), so first-boot setup SHALL seed the standalone
build (staged in the image) onto the pod's `~/.codex` volume for Codex pods, repointing its `current`
symlink relative so it resolves after the move. The pod-agent SHALL start the daemon when the pod is
a signed-in Codex pod with the standalone present — on boot, after login, and again on every wake
(the daemon process does not survive suspend/resume) — and SHALL start it ONLY when it is not already
running, since restarting the daemon invalidates outstanding pairing codes. Claude pods are unaffected.

#### Scenario: A signed-in Codex pod boots or wakes

- **WHEN** a Codex pod with the standalone build is authed and the daemon is not already running
- **THEN** the pod-agent starts `codex remote-control start`, and the pod registers with the Codex
  app as a device named by its hostname (the pod slug)

#### Scenario: The daemon is already running

- **WHEN** the daemon process is already up
- **THEN** the pod-agent does NOT restart it (which would invalidate an outstanding pairing code)

### Requirement: The pod mints Codex pairing codes on demand

The pod-agent SHALL expose an endpoint that mints a fresh, short-lived Codex pairing code
(`codex remote-control pair --json` → a manual code + expiry) for a signed-in Codex pod, ensuring the
daemon is up first. Codes are never persisted (single-use, ~10-min TTL); each request mints a new one
against the running daemon.

#### Scenario: The cockpit requests a pairing code

- **WHEN** the owner requests a pairing code for a running, signed-in Codex pod
- **THEN** the pod returns a manual pairing code + its expiry and the device name; on a Claude pod or
  a pod without the standalone/daemon it returns an error the UI can surface, not a code


### Requirement: A resumed agent orients from the handoff note before its transcript

When a pod restarts and an agent resumes an existing session, the agent SHALL read any handoff note
left for its window before starting new work. The instruction SHALL live in the deploy-shipped
universal configuration layer rather than in a value compiled into the pod-agent bundle, so it
reaches existing pods on their next seed without requiring a new pod-base image.

#### Scenario: Resume trigger fires with a note present

- **GIVEN** a pod that was updated or suspended while an agent was working, leaving a note
- **WHEN** the greeter sends the resume trigger and the agent takes its turn
- **THEN** the agent SHALL read the note for its window and orient from it before acting

#### Scenario: Universal layer carries the instruction

- **WHEN** the universal `.claude` layer is seeded onto a pod
- **THEN** it SHALL include the read-on-resume instruction, so no change to the compiled resume
  trigger text is required for the behavior to apply

### Requirement: The Codex remote-control session is identified by the pod's chosen name

A pod's Codex remote-control session SHALL be identifiable in the user's Codex app by the pod's
user-chosen name rather than an opaque identifier, so a user with several pods can tell them apart.
Where the CLI offers no direct naming flag, the pod SHALL set whatever identity the CLI reports (its
hostname) to the sanitized pod name. If no supported mechanism makes the chosen name visible, the
limitation SHALL be documented rather than worked around.

#### Scenario: Named pod appears in the Codex app

- **WHEN** a pod with a user-chosen name registers a Codex remote-control session
- **THEN** the session SHALL be identifiable by that name in the app

#### Scenario: No supported naming mechanism

- **WHEN** no supported mechanism can set the displayed identity
- **THEN** the pod SHALL keep its default identity and the limitation SHALL be recorded, rather than
  applying an unsupported workaround
