# dashboard Specification

## Purpose
The dashboard is the signed-in owner's home for their pods: it lists the available first-party
environments, shows the owner's own pods with live status, launches a pod from the catalog, and
exposes owner-scoped lifecycle controls. Pods run continuously; the owner explicitly suspends a pod
to free compute and resumes it to bring it back, or deletes it outright.
## Requirements
### Requirement: An operator can see and disbelieve what the fleet has learned

The platform SHALL show operators the shared fetch-memory table, ordered so the domains that keep
failing appear first — sorting by name buries the row worth looking at.

Each row SHALL carry when it was last verified and SHALL be marked when that verdict has expired. A
verdict shown without a date invites trusting a stale one.

An operator SHALL be able to force a re-check of a domain. Doing so SHALL age the verdicts rather than
delete the row: the accumulated counts are what distinguish a rung that is unreliable from one that has
never worked, and asking to re-check is not asking to discard that.

The surface SHALL state what the table holds and does not hold. It is the place an operator would
otherwise assume it records URLs, so the boundary belongs there rather than only in design notes.

An empty table SHALL explain when rows will appear, so a fresh fleet does not read as a broken feature.

#### Scenario: A domain that keeps refusing

- **WHEN** an operator opens the table
- **THEN** the domains with the most failures SHALL appear first, each with its last-verified time

#### Scenario: Forcing a re-check

- **WHEN** an operator re-checks a domain
- **THEN** its verdicts SHALL expire and its history SHALL be retained

### Requirement: Product analytics never captures the pod's contents

Where the platform sends usage analytics to a third party, it SHALL send events and properties only,
and SHALL NOT capture the contents of a pod.

Session replay is the specific hazard: the cockpit embeds a live terminal showing the owner's source
and their conversation with their agent, and the launch and settings panes accept secret VALUES. The
terminal element and secret inputs SHALL be marked as excluded from replay at their source, and input
masking SHALL be enabled globally as a backstop, so an element added later is masked by default.

Marking at the source matters because whether recording happens at all is a setting in the analytics
provider's dashboard, which anyone with access can turn on. Masking must therefore live in the code,
not in a toggle.

Outbound analytics events SHALL be scrubbed of credential-shaped values — including exception
messages, stack text and the current URL — at the pipeline, not at each call site. Whether any given
error carries a credential is a property of today's code; the protection must survive the next person
who throws an error containing a URL with a token, since that leak lands in a third-party system
nobody is watching.

Analytics SHALL NOT be able to fail or delay the operation it observes: a send that cannot be
delivered SHALL be dropped, never surfaced to the user as a failure of their action.

Non-essential (analytics) cookies SHALL NOT be set, and analytics SHALL NOT capture, until the
visitor has consented. Until then analytics run in a cookieless, opted-out mode; a consent banner
records the choice in a strictly-necessary first-party cookie, and only an explicit accept switches
analytics to persistent storage and opts capturing in. Strictly-necessary cookies (session, the
consent choice itself) are exempt. The consent surface SHALL be a non-blocking banner, not a
full-screen wall.

#### Scenario: A visitor has not chosen yet

- **WHEN** a first-time visitor loads the site
- **THEN** no analytics cookies SHALL be set and no analytics SHALL be captured until they accept,
  and a non-blocking consent banner SHALL offer accept/decline

#### Scenario: A visitor accepts, then returns

- **WHEN** the visitor accepts analytics and later returns
- **THEN** their choice SHALL be remembered (no re-prompt) and analytics SHALL resume; a decline SHALL
  keep analytics opted out with no analytics cookies

#### Scenario: Session replay is enabled in the analytics project

- **WHEN** replay records a page containing the terminal or a secret input
- **THEN** those elements SHALL be masked

#### Scenario: The analytics provider is unreachable

- **WHEN** an event cannot be delivered during a pod launch or a waitlist signup
- **THEN** the user's operation SHALL still report success

### Requirement: A platform-initiated restart announces itself and locks the pod

Any operation the platform performs that restarts a pod — an image update or a resize — SHALL mark the
pod as in-flight BEFORE returning to the caller, and SHALL present ONE transient state that REPLACES the
cockpit — naming what is happening, showing its stages and elapsed time, and reassuring the owner what is
preserved — rather than leaving operable-but-disabled controls in place. Mid-transition the terminal,
stats, secrets, preview and settings are HIDDEN, not merely greyed out; the cockpit returns on its own
when the operation finishes.

WHICH operation is running SHALL be recorded durably on the pod, not inferred from the text of a
progress stage. The word the owner sees must survive a refresh mid-operation, and a shared field
parsed for meaning is a contract no type checker enforces. A recorded kind SHALL be cleared on every
exit path, including success — a kind that outlives its operation mislabels the next one.

Marking before returning is the load-bearing part. A resize that awaited the whole restart held the
in-flight mark correctly for minutes and no surface ever saw it, because the page did not re-render
until the work was already over: the owner watched a pod reporting "Running" while it was down, with no
progress. Progress requires the call to come back first.

The transient view SHALL name the operation and stand alone. Disabled controls with no explanation read
as a broken page; a dedicated progress view reads as a busy pod that is working for you.

#### Scenario: Update or resize in progress

- **WHEN** an owner updates or resizes a pod
- **THEN** the cockpit SHALL be replaced by a dedicated progress view that names the operation
  (Updating/Resizing), lists the stages with the active one and total elapsed time, and reassures that
  the workspace is preserved — and the terminal, stats, secrets, preview and settings SHALL NOT be shown
- **AND** the progress view SHALL NOT repeat the release changelog: by this point the owner has already
  chosen to update, so "what's new" belongs to the pre-update dialog. Showing it here duplicated the
  decision surface AND was the one place raw commit subjects reached the owner with no summary-first
  path (2026-08-29). One reassurance line is enough — a second standalone block restating it was
  redundant with the view's own opening sentence.

#### Scenario: A suspended pod shows a dedicated resume view, not the cockpit

- **WHEN** an owner opens a pod that is suspended
- **THEN** the page SHALL show a dedicated view — the suspended state, when it was suspended and for how
  long, a few at-a-glance facts, and Resume as the single primary action — and SHALL NOT show the
  terminal, stats, secrets or preview, since a suspended pod runs nothing to operate

### Requirement: The running history is running-vs-suspended, with crashes marked

A Podbay pod runs 24/7 and never suspends itself; the ONLY thing that legitimately stops it is the
owner pressing Suspend. The lifecycle timeline SHALL therefore have exactly two states — **running**
and **suspended** — where suspended means a suspend the OWNER performed (`sleeping` with
`reason: "manual"`, or a bare legacy `sleeping`). Nothing else subtracts from uptime.

Updates, resizes, reboots and any other platform restart SHALL be treated as normal RUNNING, not
downtime. Concretely, a `sleeping` with `reason: "reconciled"` (the reconciler observing the machine
restart out of band) and a `reason: "idle"` (the retired Fly auto-suspend) SHALL be ignored by the
fold — they neither open a suspended stretch nor count as a suspend. The reconciler only samples pod
state on demand, so the gap between an observed sleep and the next observed wake is mostly UNOBSERVED
time, not real downtime; rendering it as any kind of "off" would be a fabricated duration.

Real trouble — an OOM kill, a failed self-repair, an error (the unplanned, critical incidents from the
incident classifier) — SHALL be shown as **crash markers** on the timeline (e.g. a red tick at the
event's time), visible as such and distinct from a deliberate suspend. A crash marker asserts only
*when* something happened, never a made-up duration.

The fold SHALL NOT infer a suspend from a wake with no recorded owner suspend: in a 24/7 world an
unrecorded gap is a restart, not a suspend. The trailing (current) interval SHALL be governed by the
pod's live status. The observation window SHALL be stated at both ends with its span, with the start
and end sitting under the ends of the bar.

#### Scenario: A pod that was updated mid-run

- **WHEN** a pod was updated (or rebooted / restarted) during a long run — recorded as
  `sleeping reason=reconciled` then `running`, with or without an `update_started`/`updated` bracket
- **THEN** the timeline SHALL show one continuous running stretch, with no suspend and no suspend count

#### Scenario: The owner suspends the pod

- **WHEN** the owner suspends the pod (`sleeping reason=manual`) and later resumes it
- **THEN** the timeline SHALL show a suspended stretch of that duration and count it as one suspend

#### Scenario: The pod is OOM-killed

- **WHEN** the pod emits a critical unplanned incident (e.g. `oom_killed`)
- **THEN** the timeline SHALL show a crash marker at that time, without turning it into a suspended band

### Requirement: Environment catalog

The dashboard SHALL list the available first-party environments, reading each environment's
definition and surfacing its display metadata. Each entry SHALL show a human **title**
(`metadata.title`, falling back to the kebab-case `name` when unset) rather than the raw id; the
`name` remains the stable id used in URLs. Invalid definitions SHALL be skipped, not crash the catalog.

The catalog SHALL group environments by `kind` into two tabs: **Workspaces** (`kind: engine` —
open-ended coding environments, e.g. bring-your-own-repo) and **Playbooks** (`kind: playbook` —
guided, outcome-driven). **Workspaces is the default (active) tab.** Both kinds are launchable;
workspace cards are rendered with a visually distinct treatment so they don't read as consumer
playbooks. (Engine envs were previously omitted from the catalog entirely; they are now surfaced
under Workspaces.)

The page SHALL frame both options as ways to create a pod without promising that the agent is
already authenticated or that an app preview is already running. Catalog cards SHALL use concise
selection copy and customer-facing proof points; repeated implementation capabilities and internal
taxonomy tags do not help the owner choose and SHALL NOT dominate the card.

#### Scenario: Catalog lists valid environments

- **WHEN** the catalog is built from the environments directory
- **THEN** each environment with a valid `podbay.yaml` SHALL appear with its name and description

#### Scenario: Catalog groups environments into Workspaces and Playbooks tabs

- **WHEN** the owner opens the environments catalog
- **THEN** the catalog SHALL present two tabs, "Workspaces" and "Playbooks", with **Workspaces active by default**
- **AND** an engine environment (e.g. `byo-project`) SHALL be launchable from the Workspaces tab, and a playbook environment from the Playbooks tab

#### Scenario: Catalog copy sets truthful expectations

- **WHEN** an owner opens the environments catalog
- **THEN** the page SHALL explain that playbooks are guided outcomes and workspaces are open-ended
- **AND** it SHALL NOT claim that agent authentication or an app preview is already complete

#### Scenario: Invalid environment is skipped

- **WHEN** a directory has no valid `podbay.yaml`
- **THEN** it SHALL be omitted from the catalog without failing the others

### Requirement: Owner-scoped pod list

The dashboard SHALL show the signed-in user's pods with their status and last-active time, and
SHALL NOT show pods owned by other users.

Each card SHALL show the environment's human display title, falling back to its stable id only when
the environment no longer resolves. Internal kebab-case ids SHALL NOT be the normal owner-facing
label.

The list SHALL be ordered by a STABLE, immutable key so cards do not reshuffle on refresh: first by
status rank (error pods on top, then active, then suspended, then teardown), then by creation time
newest-first, then by id. `lastActiveAt` MAY be displayed but MUST NOT determine order (it changes on
every interaction and the idle sweep, which previously made the unsorted list churn).

#### Scenario: Lists only the user's pods

- **WHEN** a signed-in user opens the dashboard
- **THEN** it SHALL display that user's pods (status + last active) and no others

#### Scenario: Stable ordering across refreshes

- **WHEN** the pod list is rendered and re-rendered while pods are used (activity, idle sweep)
- **THEN** a pod's position SHALL change only when its status changes, never on interaction alone
- **AND** error pods SHALL sort above active pods, active above suspended, and newest above older
  within a group

#### Scenario: Unauthenticated visitor is redirected

- **WHEN** an unauthenticated user opens the dashboard
- **THEN** they SHALL be redirected to sign-in

### Requirement: Launch a pod from the launcher

The launcher page (`/new`) SHALL present the catalog with a launch action; on success the pod
SHALL be provisioned and persisted to the user, and the user SHALL be taken to that pod's
workspace. The launcher SHALL accept an `env` query parameter that preselects an environment,
and that parameter SHALL survive the sign-in round-trip for unauthenticated visitors.

#### Scenario: Launch provisions and navigates

- **WHEN** the user launches a valid environment and provisioning is enabled
- **THEN** a pod SHALL be created and stored under the user, and they SHALL be routed to
  `/pods/[slug]`

#### Scenario: Launch link preselects

- **WHEN** a user opens `/new?env=nextjs-starter`
- **THEN** that environment SHALL be preselected/highlighted in the launcher

#### Scenario: Provisioning not yet enabled

- **WHEN** the user attempts to launch while pod provisioning is not configured
- **THEN** the action SHALL surface a clear "not yet enabled" state and SHALL NOT create a record

### Requirement: Memorable pod slugs

Pods SHALL be identified by memorable slugs (`adjective-noun-4hex`) used as the record id and in
URLs, rather than UUIDs.

#### Scenario: Launched pod gets a slug

- **WHEN** a pod is launched
- **THEN** its id SHALL match the `adjective-noun-4hex` shape and its workspace URL SHALL be
  `/pods/<that-slug>`

### Requirement: Pod lifecycle actions

Pods run continuously. The dashboard SHALL provide owner-scoped Suspend, Resume, and Delete actions
for a pod, delegating to the control plane, and SHALL NOT auto-suspend a pod on idle — suspend and
resume are explicit user verbs. A user SHALL NOT act on a pod they do not own.

#### Scenario: Owner suspends a running pod

- **WHEN** the owner triggers Suspend on their own running pod
- **THEN** the control plane SHALL suspend it (freeing its compute) and the pod SHALL read as
  Suspended, staying suspended until the owner resumes it

#### Scenario: Owner resumes a suspended pod

- **WHEN** the owner triggers Resume on their own suspended pod
- **THEN** the control plane SHALL bring it back and the pod SHALL read as Running

#### Scenario: Owner deletes a pod

- **WHEN** the owner triggers Delete on their own pod
- **THEN** the control plane SHALL tear it down (machine, volume, and login) and the list SHALL
  reflect its removal

#### Scenario: A pod is not auto-suspended on idle

- **WHEN** a running pod is left idle
- **THEN** it SHALL keep running and SHALL only become suspended when the owner explicitly suspends it

#### Scenario: Cross-owner action is denied

- **WHEN** a user targets a pod they do not own
- **THEN** the action SHALL be denied as not-found

### Requirement: An owner can edit the pod-relevant slice of Claude settings

When Claude Code is one of a running pod's agents, the cockpit Settings tab SHALL offer a "Claude
settings" editor scoped to the settings that matter for an agent running headless / remote-controlled
and often unattended: unattended timeouts (`askUserQuestionTimeout`, `dialogExpiry`), owner-awareness
(`agentPushNotifEnabled`, `awaySummaryEnabled`), git attribution (`attribution.commit`/`.pr`/
`.sessionUrl`), and long-session health (`autoCompactEnabled`). It SHALL NOT expose settings the
Claude client owns (`model`), that podbay injects (`env`), or that podbay pins in the image
(`autoUpdatesChannel`). The control plane SHALL merge a validated patch into the pod's
`~/.claude/settings.json`, PRESERVING every podbay-managed key (permissions, hooks), and SHALL reject
any key outside the exposed allowlist. This behavior is edition-agnostic: it uses `provider.exec`, so
it works identically on cloud (Incus) and self-host (Docker) and reaches existing pods without an
image update.

#### Scenario: Owner opens the editor on a Claude pod

- **WHEN** the owner opens Settings on their own running pod that includes Claude
- **THEN** the "Claude settings" editor SHALL show the current values read from the pod's
  `~/.claude/settings.json`, falling back to Claude's defaults for absent keys

#### Scenario: The editor is hidden when it cannot apply

- **WHEN** the pod has no Claude agent, or the pod is not running
- **THEN** the "Claude settings" editor SHALL NOT be shown

#### Scenario: Saving preserves podbay-managed keys

- **WHEN** the owner saves a change (e.g. hides commit attribution or sets a question timeout)
- **THEN** the control plane SHALL merge only the exposed keys into `~/.claude/settings.json`, leaving
  podbay's `permissions` and `hooks` untouched, and SHALL record a `claude_settings_changed` event

#### Scenario: A malformed or unknown key is rejected

- **WHEN** a save carries a key outside the allowlist (e.g. `model`, `permissions`) or a malformed
  value (a non-boolean toggle, an invalid duration)
- **THEN** the control plane SHALL reject the save as invalid and write nothing

#### Scenario: Cross-owner access is denied

- **WHEN** a user reads or writes Claude settings for a pod they do not own
- **THEN** the action SHALL be denied as not-found

### Requirement: A bring-your-own-repo environment requires a repository at launch

An environment declaring `byoRepo` IS the user's own repository, so the launch form SHALL require a
repository before the pod can be created, and the launch action SHALL reject a `byoRepo` launch that
carries no repository. When GitHub connect is not configured on the deployment, the form SHALL say
so instead of hiding the field.

#### Scenario: No repository picked

- **WHEN** the user opens the launch form for a `byoRepo` environment and has picked no repository
- **THEN** "Create pod" is disabled and the form explains that a repository is required

#### Scenario: The repository picker

- **WHEN** the user's repositories have loaded
- **THEN** they are presented in a filterable picker (type to narrow, arrow keys to move, Enter to
  select) that marks private repositories, not a plain native select

#### Scenario: GitHub connect is unavailable

- **WHEN** the deployment has no GitHub OAuth app configured
- **THEN** the field states that this environment cannot clone a repo yet, rather than rendering nothing

### Requirement: The cockpit's GitHub connection is disconnected explicitly and confirmed

The cockpit SHALL offer "Disconnect" (not "Reconnect") for a connected pod, behind a confirmation
that states the consequence, and the device-flow instructions SHALL be presented identically
wherever the flow appears.

#### Scenario: Disconnecting

- **WHEN** the owner chooses Disconnect on a connected pod and confirms
- **THEN** the pod's GitHub login is forgotten and the chip returns to the disconnected state

#### Scenario: Declining the confirmation

- **WHEN** the owner opens the confirmation and chooses to keep the connection
- **THEN** nothing changes

### Requirement: The cockpit's active tab survives a reload

The selected cockpit tab SHALL be reflected in the URL so that reloading, or opening a shared link,
restores that tab instead of resetting to the default. The default tab is **Control** (the agents +
T3 Code control — the primary thing an owner does with a pod), shown first.

#### Scenario: Reloading on a non-default tab

- **WHEN** the user selects Stats and reloads the page
- **THEN** Stats is still the selected tab

#### Scenario: An unknown tab value

- **WHEN** the URL carries a `tab` value that is not a cockpit tab
- **THEN** the cockpit falls back to the default Control tab

### Requirement: A replaced view starts at its top, not the previous view's scroll offset

When a view is REPLACED rather than navigated to — a cockpit full-page takeover (update/resize,
T3 enabling, Codex pairing, agent sign-in, T3 connect, token renew) or a launch-wizard step change —
the scroll position SHALL be reset to the top of the new content. Otherwise the new view inherits the
previous one's offset and opens already scrolled past its heading, which is the normal case on mobile:
the control that triggers the change (Update, Next) sits at the BOTTOM of a long page, which is exactly
where the user is when they tap it (owner report, 2026-08-27).

The reset SHALL target the actual scrolling element. The dashboard shell scrolls its `<main>`
container, so the window's own scroll position never moves inside the dashboard and scrolling the
window alone is a silent no-op there. The reset SHALL be instant, not animated: the content is being
swapped, so animating the outgoing view reads as a glitch rather than as motion.

#### Scenario: Opening a full-page takeover from the bottom of a long cockpit

- **GIVEN** the owner has scrolled down the cockpit on a narrow screen
- **WHEN** they press Update (or open any of the cockpit's full-page wizards)
- **THEN** the takeover renders from its beginning, not at the previous scroll offset

#### Scenario: Advancing a launch-wizard step

- **GIVEN** the owner has scrolled to the Next button at the bottom of a wizard step
- **WHEN** they advance to the following step
- **THEN** the next step renders from its heading, not at the previous step's scroll offset

### Requirement: The cockpit controls appear only once the pod is ready

While a pod is still onboarding — being created, or waiting for the owner to sign the agent in — the
cockpit SHALL show only the guided setup, and SHALL NOT show the controls tabs (Control / Settings /
Secrets / Stats / Details / Admin). Half of those controls cannot act on a pod that isn't up yet, and the setup
is the only thing the owner can act on, so the tabs would be noise. The tabs SHALL appear once the pod
reaches ready.

#### Scenario: A pod still creating or signing in

- **WHEN** the owner opens a pod that has not yet reached ready
- **THEN** the cockpit SHALL show the guided setup and SHALL NOT show the controls tabs

#### Scenario: A ready pod

- **WHEN** the pod reaches ready
- **THEN** the cockpit SHALL show the controls tabs

### Requirement: An image update never blocks the dashboard and reports its progress

Applying a pod image update SHALL start the work and return immediately, rather than holding the
request open for the whole recreate — awaiting it serialized against the router and froze every
link and tab in the dashboard. Progress SHALL be derived from the pod's event log so the cockpit
can show the current stage and elapsed time, and a failure SHALL surface to the owner.

#### Scenario: Navigating during an update

- **WHEN** an image update is in flight and the owner selects another cockpit tab or a nav link
- **THEN** the navigation happens immediately

#### Scenario: Progress while updating

- **WHEN** an update is running
- **THEN** the cockpit shows the stage the update last reported and the seconds elapsed, and the
  Update control stays disabled until it finishes

#### Scenario: A failed update

- **WHEN** the update fails
- **THEN** the failure is recorded against the pod and shown to the owner instead of the control
  appearing to succeed

### Requirement: The update control explains what the update contains

Next to the pod's Update control, an info affordance SHALL open a modal describing the update: the
image the pod runs now versus the image it would update to, the target's build date and size, and
its release notes. The notes are recorded per image at build time (git-derived); the modal only
reads them and SHALL degrade gracefully when an image predates the manifest or has no recorded notes.

#### Scenario: Notes are recorded

- **WHEN** the owner opens the update-info modal and the target image has recorded notes
- **THEN** the modal lists the notes, with the current→target images and the target's date and size

#### Scenario: Notes are missing

- **WHEN** the target image has no recorded notes (built before the manifest, or not yet recorded)
- **THEN** the modal still opens and states that notes aren't recorded, describing what an update does

### Requirement: The pods list can bulk-update idle pods that are behind

On cloud (`!editionOss()`), the pods list SHALL offer a single "Update N idle pods" control that
updates every pod that is genuinely idle AND behind the current image in one action. Self-host
updates are a host-level `docker compose pull`, not a per-pod dashboard action, so this control
SHALL NOT appear in the OSS edition.

A pod is **update-eligible** for this control when ALL hold: it is behind the current pinned image
(its recorded `imageDigest` differs from the provider's pin), it is `running` and not already
updating, it is not excluded from auto-update (`autoUpdate !== "off"`), it is **not T3-controlled**,
NO agent is busy/waiting/shell, and it is idle by one of two arms. The idle test: at least one agent
AFFIRMATIVELY reports `idle` and has been idle for a fixed dwell (≈10 minutes, so a pod merely paused
between turns is not interrupted mid-task) — OR the agent status is UNKNOWN (null, e.g. Claude not
reporting because it is sitting at a gate) but the pod has been demonstrably inactive for a MUCH
longer window (≈4 hours), a conservative "clearly abandoned" bar that lets a genuinely-idle pod we
cannot confirm live still be updated. **T3-controlled pods are always excluded** — Claude yields its
session to T3 so its status is always null, and an update recreates the pod and would interrupt the
live T3 session; a T3 pod updates only via the per-pod Settings → Update. The idle duration — and the
idle time shown per pod in the confirmation — SHALL come from the AGENT's true idle (its session
activity, which counts remote-control and autonomous turns), NOT from a client-connection activity
timestamp that goes stale; the client timestamp MAY be a fallback only when the pod does not report
the agent idle. The control SHALL render only when at least one pod is eligible, and its label SHALL
carry the count.

The action SHALL recompute eligibility server-side and update only the pods that still qualify —
never a client-supplied list — and SHALL start the updates without blocking the dashboard. Each
updated pod keeps its files and login and resumes its agent after the restart, exactly as a single
Update does. The recreates SHALL run with a BOUNDED CONCURRENCY (a few pods at a time) rather than
all at once, so a large fleet updates in waves instead of a thundering herd of simultaneous recreates
on the host; each pod flips to "updating" as its recreate actually starts.

Activating the control SHALL first open a confirmation that shows WHAT the update brings and WHICH
pods it affects — the target build (like the single-pod update) with its "what's new" summary, and a
scannable LIST of the eligible pods — not a prose sentence of names. It SHALL state concisely what
happens (each restarts about a minute, its agent resumes, files are kept, and working/waiting/excluded
pods are skipped); the updates start only on confirm, and cancelling changes nothing.

#### Scenario: Some pods are idle and behind

- **WHEN** the owner has one or more update-eligible pods
- **THEN** the pods list shows an "Update N idle pods" control whose count matches the eligible pods

#### Scenario: Confirming the bulk update

- **WHEN** the owner activates the "Update N idle pods" control
- **THEN** a confirmation shows the target build with its "what's new" summary and a list of the
  eligible pods, and only on confirm does it start an image update on each of them (cancel starts
  nothing)

#### Scenario: A large batch updates in bounded waves

- **WHEN** the bulk action runs against many eligible pods
- **THEN** it SHALL recreate only a few at a time (bounded concurrency), starting the next as earlier
  ones finish, rather than triggering every recreate simultaneously

#### Scenario: A pod is behind but busy, recently active, or excluded

- **WHEN** a pod is behind the current image but its agent is busy, it was active within the idle
  dwell, or its `autoUpdate` is `off`
- **THEN** that pod is NOT counted by the control and is NOT updated by the bulk action

#### Scenario: Self-host edition

- **WHEN** the dashboard runs in the OSS/self-host edition
- **THEN** the "Update N idle pods" control does not appear

### Requirement: A pod can be excluded from auto-update

On cloud (`!editionOss()`), the pod's Settings tab SHALL offer an "Auto-update" toggle (on/off) that
sets the pod's `autoUpdate` between `inherit` (on — included in the bulk "update idle pods" action)
and `off` (excluded — never touched by the bulk action; the owner updates it deliberately from the
pod's own Update control). The toggle reflects the current state, its change is durable on the pod
record (surviving a reload), and it defaults to on (`inherit`). This control is cloud-only and SHALL
NOT appear in the OSS edition.

#### Scenario: Owner excludes a service pod

- **WHEN** the owner sets a pod's Auto-update to off (e.g. a pod running a long-lived service)
- **THEN** the pod is durably marked `autoUpdate: "off"` and is skipped by the bulk idle-update
  action, while remaining individually updatable from its own Update control

### Requirement: A running pod's config is kept in sync automatically, without a restart

A running pod's config layer — the `.claude` layer, skills, the managed `settings.json` slice, and
rules — SHALL be kept current AUTOMATICALLY: when it drifts from the env's current resolved layer
(because the env changed or a newer pod-base shipped), the control plane SHALL re-apply the current
layer in place WITHOUT recreating the instance or restarting the agent, with no owner action. The
re-apply uses the same idempotent, never-clobber-a-user-edit logic used at boot; live-reloadable
layers (permissions/hooks, skills) reach the running agent at once, while rules in `CLAUDE.md` apply
at the agent's next compaction. A pod on an image that predates the in-pod refresh has the content
delivered but needs an image update to apply it. There SHALL be no manual "Sync config" button — the
sync is a background reconcile behavior, not an owner control. (Mechanism: openspec control-plane
"Automatic config-drift reconciliation".)

#### Scenario: No manual sync control in pod Settings

- **WHEN** the owner opens a running pod's Settings tab
- **THEN** there SHALL be no manual "Sync config" control — config sync is automatic

#### Scenario: A drifted running pod is re-synced without owner action

- **WHEN** a running pod's config layer has drifted from the env's current resolved layer
- **THEN** the current layer SHALL be re-applied in place, with no recreate and no agent restart,
  and without any owner action

### Requirement: Restarting controls warn that a live agent session is interrupted

Every cockpit control that restarts or stops the pod — Update and Suspend — SHALL show, in its
confirmation modal, a visually distinct caution (the amber `warning` token, not the destructive one)
stating that any running agent session stops and that work in progress which is not saved or
committed can be lost. Existing reassurance about what survives (files, agent plan, agent login)
SHALL be kept, because the risk being communicated is precisely the difference between the pod's
durable state and the agent's in-flight work. The caution SHALL be brief enough to be read.

#### Scenario: Owner opens the Update confirmation

- **WHEN** the owner clicks Update on a running pod
- **THEN** the confirmation SHALL state that the pod restarts and its files/login are kept, AND
  SHALL show the amber session-interruption caution before the confirm action

#### Scenario: Owner opens the Suspend confirmation

- **WHEN** the owner clicks Suspend on a running pod
- **THEN** the confirmation SHALL show the same amber session-interruption caution alongside the
  explanation that the pod stays suspended until Resume

### Requirement: In-flight image updates are reflected from the backend on every surface

Whether an image update is in progress SHALL be durable on the pod record (a timestamp set when the
update starts and cleared when it finishes or fails), NEVER client-only state. Every surface — the
pods list card and the pod cockpit — SHALL render "updating" from that backend field, so navigating
away and back, or refreshing, still shows the update in progress. While updating, the "Update available"
affordance SHALL be suppressed in favour of the progress indication.

#### Scenario: Navigating away during an update

- **WHEN** an update is started and the user navigates to the pods list
- **THEN** that pod's card shows "Updating…", not "Update available"

#### Scenario: Re-entering the cockpit during an update

- **WHEN** the user reopens the cockpit of a pod whose update is in flight
- **THEN** the Update control shows "Updating…" (disabled) with the current stage and elapsed time,
  derived from the backend — not a reset "Update" button

#### Scenario: Update completes

- **WHEN** the update finishes and the record's in-flight flag is cleared
- **THEN** both surfaces stop showing "updating" and reflect the new image (cockpit "Up to date")

### Requirement: The pods-list card is consistent with the cockpit and surfaces action errors

The list card SHALL follow the same rules as the cockpit for a failed pod: when the pod's
environment no longer exists it SHALL hide "Try again" (retry can't rebuild it) and offer only
Delete. A card action (retry, delete, resume) that fails SHALL show the error to the user inline,
never swallow it to the console. The card SHALL NOT carry unwired display props.

#### Scenario: A failed pod whose environment is gone

- **WHEN** an error pod's environment no longer resolves
- **THEN** its card shows Delete only, not "Try again"

#### Scenario: A card action fails

- **WHEN** a resume/retry/delete from the card returns an error
- **THEN** the card shows that error inline

### Requirement: The pod card is state-first (signal card)

The dashboard card SHALL lead with the pod's live state, derived from signals the pod actually
reports — never invented. For a running pod that answers, the card SHALL show: the agent CLI's own
activity (`busy` → working, `waiting` → waiting for the owner, `shell` → in the terminal, `idle` →
idle; a reported blocking dialog → "Needs you"), written in words on an agent line with that agent's
mark; and a colour spine on the card's edge encoding the same state so a stack of cards scans
at a glance (a running-shell command counts as Working, not a separate state). Codex has no live
state file, but it DOES have an activity signal derived on the pod from how recently it wrote to its
rollout log — so a Codex pod shows the SAME vocabulary as Claude (Working / Idle), never a bare
"Running". Its paired devices list as inline pills on the Codex line (that carries the pairing info,
so the chip doesn't). Its primary action is opening the cockpit (there is no "Open in Codex").
Claude's activity signal SHALL never be applied to a Codex-only pod, and vice-versa.

Resuming a suspended pod SHALL confirm first (it resumes compute and re-counts a slot) — the card and
the cockpit use the same confirmation. The full-screen web terminal SHALL NOT overlay the support-chat
launcher.
A Claude pod's primary action is opening the session, carrying the Claude mark.

A pod that does NOT answer (unreachable, suspended, older image) SHALL fall back to its lifecycle
status alone and SHALL NOT claim any live state it didn't hear from the pod. A live critical
problem (pod unreachable, disk full, repair gave up) SHALL ride a visible ribbon on the card.

The Preview control SHALL tell the truth about :3000: offered when the pod reports something
serving; HIDDEN when the pod reports nothing serving (a status line — "No app on :3000" — says why,
so there is no dead or disabled control); and behaving as before (offered with the URL) when the
pod cannot say — unknown is not "no app". When the preview is owner-only, the card SHALL mark it
with a lock, matching the cockpit's preview card. Live signals for the cards SHALL be fetched off
the dashboard's render path (client-side), so navigating to the dashboard is not blocked on an
N-pod health sweep. The card and the
cockpit's preview card SHALL derive this from the SAME source (the pod's app-port listening probe),
so they never disagree — including on an image that predates the cheap health-report field, where
both fall back to the metrics probe. The cockpit's preview card SHALL likewise offer its **Open**
action only when something is serving (or while the probe is still unknown) — never when the pod
reports nothing serving, so Open never leads to the 503 page — and it carries no manual reload
control (the listening state auto-refreshes on its own).

Every preview response the proxy sends for an UNAVAILABLE or DENIED state SHALL be UNIFORM: the
semantically-correct HTTP status ALWAYS (so monitors, caches and crawlers behave), with a body
content-negotiated by `Accept` — a small, correctly **UTF-8-encoded** HTML card for browsers, and plain
UTF-8 text for API/`fetch` callers (never HTML-with-200, which would report a down preview as healthy).
The status mapping: a missing pod OR a private pod requested by a non-owner → **404** (never 403, which
would confirm the pod exists to a stranger); an owner-only preview for a signed-out browser → redirect
to sign in; a **suspended**, **starting/provisioning**, or **app-not-serving-:3000** pod → **503** (a
temporarily-unavailable service, not a 4xx), with `Retry-After` and an auto-retrying page for the
cases that recover without a human (starting, no-app) but NOT for suspended (the owner must resume — the
page links to the dashboard instead).

Beyond owner-only and public, a THIRD preview visibility — **delegated-auth** (`previewAppAuth`) — SHALL
forward the preview as public transport WITHOUT requiring a podbay session, for a pod running an
agent-harness backend (e.g. T3 Code) that guards its OWN endpoint with a pairing token. A podbay cookie
would block the third-party app, which carries only its own token, so the UPSTREAM app is the gate. It
is DISTINCT from `public` so the UX can label it honestly ("guarded by the app's own login") and a
backend flavor sets it, rather than the owner flipping a generic public toggle; the gateway treats it
like `public` for transport but the two are separate flags on the pod.

#### Scenario: Agent working

- **WHEN** a running pod reports `agentStatus: busy`
- **THEN** its card shows a working state and the agent line says so in words

#### Scenario: Nothing serving the preview port

- **WHEN** a running pod reports `appListening: false`
- **THEN** the card shows no Preview button, and a "No app on :3000" status line explains why

#### Scenario: A preview request when nothing is serving :3000

- **WHEN** a preview request reaches a pod whose app port has nothing listening
- **THEN** the proxy SHALL return 503 with a short "nothing is serving this preview yet" page,
  not a bare error and not a 4xx

#### Scenario: A suspended pod's preview

- **WHEN** a preview request reaches a suspended pod
- **THEN** the proxy SHALL return **503** (not 409, not 2xx) without auto-waking the pod, and a browser
  gets a "suspended — resume it" card linking to the dashboard (no auto-retry)

#### Scenario: A private preview requested by a non-owner

- **WHEN** a signed-in user who is not the owner requests a private preview
- **THEN** the proxy SHALL return **404** (as if the pod does not exist), never 403

#### Scenario: Preview errors are UTF-8 and content-negotiated

- **WHEN** any preview-error response is served
- **THEN** a browser (`Accept: text/html`) receives an HTML card with `Content-Type: text/html;
  charset=utf-8`, and an API/`fetch` caller receives `text/plain; charset=utf-8` — never a mis-encoded
  string, and never an HTML page carrying a 200

#### Scenario: Older image

- **WHEN** a running pod's image predates the live-signal fields
- **THEN** the card shows lifecycle status only and the Preview control behaves as before

#### Scenario: Live critical trouble

- **WHEN** a running pod reports a critical pod-level issue or does not answer at all
- **THEN** the card carries a visible ribbon naming the problem

### Requirement: The pod list is hand-ordered (manual order only)

The owner SHALL be able to reorder pod cards by dragging (the grip is the drag target; clicking
the card still opens it). The order SHALL persist server-side per pod and survive reload and
device changes. There SHALL be NO automatic grouping of the list; hand order wins over any default
sort. A pod created after the owner last sorted SHALL appear ABOVE the hand-ordered pods (easy to
find and drag into place) rather than buried by a default sort.

Every pod SHALL be assigned a concrete order position AT CREATION (placed above the owner's existing
pods), so the hand order is authoritative for the whole list. A card SHALL NOT change position in
response to its own lifecycle status or agent activity: once placed, it moves only when the owner
drags it. Leaving a pod unpositioned is what previously let a card sort itself by status rank and
physically move as its pod went Working → Waiting → Idle (owner report, 2026-08-27).

#### Scenario: Drag to reorder

- **WHEN** the owner drags a card to a new place and reloads the dashboard
- **THEN** the cards render in the dropped order

#### Scenario: A new pod after sorting

- **WHEN** the owner has hand-ordered pods and then creates a new one
- **THEN** the new pod appears at the top, above the hand-ordered cards, with a persisted position of
  its own — not as an unpositioned card that floats

#### Scenario: A status change never reorders the list

- **GIVEN** the owner has hand-ordered their pods
- **WHEN** a pod's lifecycle status or agent activity changes (e.g. it starts working, begins waiting
  for input, goes idle, or errors)
- **THEN** its card SHALL stay exactly where the owner placed it

### Requirement: The sign-in link survives a refresh mid-login

The Claude sign-in (OAuth) URL shown during a pod's first login SHALL be captured to durable state
(the pod row) by the gateway from the terminal links frame — the same path that already captures the
session URL — so the cockpit's Sign-in step renders it from the backend and survives a
navigate-away/refresh, not client-only. It SHALL be cleared once the pod is authed (the URL is spent).

While the pod is at the sign-in step and no captured value is yet shown, the cockpit SHALL POLL the
persisted value from the backend, not rely solely on the page-load prop or a live terminal frame — so
a value captured server-side AFTER the page loaded (notably a Codex device code, which reaches the
client via no frame) appears without a manual refresh. Polling stops as soon as a value lands.

#### Scenario: Refresh during sign-in

- **WHEN** a pod is at the sign-in step with a captured auth URL and the user reloads the cockpit
- **THEN** the sign-in link is still shown, served from the pod row

#### Scenario: Code captured after the page loaded

- **GIVEN** the cockpit is open at the sign-in step showing "Getting your sign-in code…"
- **WHEN** the gateway captures the code to the pod row while that page stays open
- **THEN** the cockpit's poll surfaces the code with no manual refresh

#### Scenario: After login

- **WHEN** the pod becomes authed
- **THEN** the stored sign-in URL is cleared and no longer shown

#### Scenario: Reconnecting a previously-authed pod re-surfaces its sign-in URL

A pod that was signed in before carries `authedAt` and a session URL from that login. When its login is
later wiped or expires and the agent returns to `/login` with a FRESH sign-in URL, the backend MUST
detect that authed→unauthed transition, reset the stale authed markers + dead session URL, and capture
the new URL — otherwise the onboarding capture (gated on first-login) never runs and the wizard hangs
on "Getting the sign-in link…" while the URL sits unread. The wizard SHALL read the sign-in URL from
BOTH the live agent state and the persisted pod row, so a lag in either path still surfaces it.

- **GIVEN** a pod with `authedAt` set (a prior login) whose agent is now unauthed with a fresh sign-in URL
- **WHEN** the backend reconciles it
- **THEN** it SHALL clear the stale `authedAt`/session URL, persist the fresh sign-in URL, and the wizard
  SHALL surface it (from the pod row or the live state) rather than hang

#### Scenario: The reconnect wizard does not close on the still-authed agent it starts from

- **WHEN** the owner opens the reconnect wizard for an agent whose login is only EXPIRING (still authed)
- **THEN** the wizard SHALL NOT treat that initial authed state as "done" and close — it stays open
  through the wipe, and only returns to the cockpit once the re-login actually completes

#### Scenario: A setup-token pod renews non-destructively; a subscription pod reconnects

The cockpit's re-auth affordance (both the "expiring soon" prompt on a still-valid login and the
"Reconnect" action on an expired one) SHALL route by the pod's Claude auth MODE. A setup-token pod
SHALL open the RENEW wizard — minting a fresh ~1-year token WITHOUT signing the agent out or
interrupting the session — and its still-valid confirm SHALL NOT carry the session-interrupt warning.
A subscription pod SHALL open the RECONNECT wizard, a full session-interrupting re-login, confirmed
first. Only an explicit setup-token mode renews; an unset or subscription mode reconnects.

- **WHEN** the owner triggers re-auth for `claude-code` on a setup-token pod
- **THEN** the non-destructive renew wizard SHALL open, labelled "Renew", with no session-interrupt warning

- **WHEN** the owner triggers re-auth on a subscription pod
- **THEN** the reconnect wizard SHALL open, labelled "Reconnect", behind the session-interrupt confirm

#### Scenario: The pasted code is validated against the LIVE agents, not stale stored config

The cockpit shows an agent's sign-in step by reading that agent from LIVE health, so accepting the
pasted code MUST validate against the same live truth — not the pod row's stored `agents` list, which
a legacy pod (created before that field was tracked) can have empty while genuinely running the agent.

- **GIVEN** a running pod whose stored `agents` list is empty/unknown, but whose live health reports
  `claude-code` running with a sign-in URL the cockpit is showing
- **WHEN** the user pastes the code for `claude-code`
- **THEN** the code SHALL be delivered to that agent's window (NOT rejected with "this pod does not run
  claude-code"); the guard only refuses when a KNOWN, non-empty agent set positively excludes the agent

### Requirement: The admin pod drill-in surfaces oversight data without impersonation

The backoffice per-pod view SHALL present read-only oversight of any pod without exposing the owner's
live terminal or session: the owner's email, the preview URL with its public/owner-only status,
current resource metrics (CPU/mem/disk/net) when the pod is running, whether each declared secret is
SET (never its value), sign-in / remote-control status, lifecycle, and any bound repo. The shortcut
to the owner-scoped cockpit SHALL appear only when the admin owns the pod (it 404s otherwise, by the
cockpit's ownership gate).

#### Scenario: Admin views another user's pod

- **WHEN** an admin opens `/admin/pods/[id]` for a pod they don't own
- **THEN** they see owner email, preview link + visibility, resources, secret set-status, and
  onboarding/lifecycle info — and NOT the "owner cockpit" shortcut

#### Scenario: Secret values are never exposed

- **WHEN** the admin view lists a pod's secrets
- **THEN** it shows only which keys are set, never any value

### Requirement: The sign-in step is agent-aware (Claude vs Codex)

The onboarding sign-in step SHALL match the pod's agent. Claude uses an auth URL + a code pasted
BACK into the CLI. Codex uses a device-code flow: a one-time code entered on OpenAI's site, nothing
pasted back — the gateway captures that code from the pod's terminal output (gated on the
`codex/device` marker) and persists it so the cockpit shows it, refresh-safe. Copy names the correct
agent and subscription throughout onboarding.

#### Scenario: A Codex pod signs in

- **WHEN** the sign-in step renders for a pod whose agent is Codex
- **THEN** it says "Sign in to Codex", names the OpenAI subscription, shows the captured one-time code
  as a one-click copy control with a visible copy affordance (the same control the GitHub device flow
  uses), with a link to OpenAI's device page, and has NO paste-back field

#### Scenario: A Claude pod signs in

- **WHEN** the sign-in step renders for a Claude pod
- **THEN** it shows the auth URL and the paste-a-code-back field, unchanged

### Requirement: Reaching "ready" is agent-aware (Codex has no remote control)

The onboarding "Start agent" → "Ready" transition SHALL account for the agent. Claude lingers on
"Start agent" until its remote-control session URL is captured or a best-effort RC window elapses.
Codex has NO remote-control session URL, so it SHALL move to "Ready" after just a short respawn grace
once logged in — never sit on the full RC fallback window (which left the cockpit on "Starting your
agent" while Codex was already answering in the terminal). The derivation is durable-state driven so a
refresh agrees, and the client's flip uses the same agent-aware wait. In the ready state, the Claude
remote-control hand-off copy (session list / `/remote-control`) SHALL NOT be shown for a Codex pod;
Codex shows a plain "open the terminal" affordance instead.

#### Scenario: A Codex pod finishes signing in

- **WHEN** a Codex pod has just logged in and has no session URL
- **THEN** the cockpit moves to "Ready" after a short grace (not the 90s RC window), and the ready
  state shows an "open the terminal" affordance with NO `/remote-control` hand-off copy

#### Scenario: A Claude pod finishes signing in

- **WHEN** a Claude pod has logged in
- **THEN** it waits for its remote-control session URL (or the RC window) before "Ready", unchanged

### Requirement: A Codex pod's ready state offers a pairing wizard

Because Codex has no clickable session URL, a Codex pod's ready state SHALL offer a pairing wizard
(the codex analog of Claude's "Continue in Claude") rather than a hand-off link. It SHALL explain the
in-app path to the pair screen for the phone and desktop apps (which differ) via a platform picker
that shows ONE platform's steps at a time (not both stacked), and the device name the pod registers
under, and let the owner generate a short-lived pairing code on demand, shown with a
live countdown to its expiry and a control to generate a fresh one. It SHALL surface a readable error
with a retry when the code can't be minted (daemon still starting, pod needs updating, or
unreachable), and note that remote control requires the pod to stay awake.

It SHALL NOT claim the pod is connected: pairing is recorded server-side by the Codex service and
nothing on the pod reveals it. (The daemon's `remote_control_enrollments` row looks like such a signal
but is its own self-enrollment — identical on paired and unpaired pods — and keying a "Connected"
badge off it told users they were paired before they had done anything. Shipped and reverted
2026-07-27.) The wizard states where the code lands instead.

#### Scenario: The owner opens a ready Codex pod

- **WHEN** the cockpit shows a ready Codex pod
- **THEN** it presents the pair-screen guidance + device name and a control to generate a pairing
  code — no Claude session-URL hand-off

#### Scenario: The owner generates a code

- **WHEN** the owner generates a pairing code
- **THEN** the code is shown as a one-click copy control with a countdown to expiry and a "new code"
  control; a failure shows a retryable error instead

#### Scenario: QR for the phone flow on a wide viewport

- **WHEN** a code is shown, the Phone platform is selected, and the cockpit is on a desktop-sized
  viewport
- **THEN** a QR encoding `https://chatgpt.com/codex/pair?pairing_code=<code>` is shown to scan with
  the phone; on the Desktop platform (no scanner) or a narrow viewport, only the code is shown

### Requirement: The cockpit ready-state renders one self-contained card per agent

Once a pod is ready, the cockpit SHALL render one card per agent the pod hosts. Nothing about one
agent renders inside another's card. The only pod-level action in the ready state is the preview
link; the terminal is NOT an access method here — it lives in the Admin tab, and appears in a card
only as a transactional sign-in step that deep-links to that agent's named terminal tab.

Each card is an explicit state machine — starting → needs sign-in → connected (Claude: with/without
a hand-off link · Codex: remote control on/off) — showing one status line and one primary action for
the CURRENT state, so the owner always knows where they are and what happens next. **No card state
may direct the owner to the terminal.** The terminal is the Admin surface; anything a card needs
done, the pod does itself or the card does inline. State comes from
the pod's per-agent report; when a pod's image predates that report, the card SHALL say state is
unavailable and point at the software update, rather than guessing.

#### Scenario: Two agents, two cards

- **WHEN** a pod runs Claude and Codex
- **THEN** the cockpit SHALL show a Claude card and a Codex card, each with its own status dot,
  status line, and state-appropriate action — never interleaved rows

#### Scenario: A just-added agent is acknowledged and signed in from the card

- **WHEN** an agent is added to a live pod
- **THEN** its card SHALL first show it starting, then (unauthenticated) an explicit "not signed in
  yet" state carrying the SAME sign-in flow the onboarding wizard uses — Claude: its captured OAuth
  link plus a paste-the-code-back box; Codex: its one-time device code plus the OpenAI link — scoped
  to that agent's own window. The terminal SHALL NOT be part of the sign-in flow; the pasted code is
  delivered to that agent's window server-side, never typed over the terminal socket (which follows
  the ACTIVE window and can land on the wrong CLI)

#### Scenario: Claude's hand-off stays direct

- **WHEN** a Claude session URL is available for THAT agent
- **THEN** the Claude card SHALL offer "Continue in Claude" as its one-click action, using the
  agent's OWN captured link (an added Claude's link is its own, not the primary's)

#### Scenario: Remote control is enabled for the owner, not by the owner

- **WHEN** a Claude agent (primary or added) becomes signed in without remote control yet enabled
- **THEN** the pod SHALL enable it in that agent's own window, and the card SHALL report it as in
  progress — it SHALL NOT instruct the owner to run `/remote-control` in a terminal

#### Scenario: Degraded honestly on an old image

- **WHEN** the pod's image predates per-agent state reporting and legacy signals can't resolve a
  card's state
- **THEN** the card SHALL say state is unavailable and point at the pod software update — not render
  a guessed state

### Requirement: The update offer says what it contains

The Software row SHALL summarise the pending update — how many changes and which parts of the pod
they touch — rather than only that one exists, so the owner can judge whether a restart is worth it
without opening anything.

Opening the update SHALL present ONE dialog that both explains and confirms: what each build is
(identified by DATE first, a short id second — never "<hash> → <internal build alias>"), what
changes, what is kept (files, agent plan and history, sign-in, secrets), what happens (the pod hands
off, restarts, the agent resumes), the session-interruption warning, and the action itself. It SHALL
NOT be split into an informational dialog and a separate confirmation: that forces the owner to open
both to decide, and duplicates copy that must then be kept in sync. No fact SHALL appear twice within
the dialog.

#### Scenario: Deciding in one place

- **WHEN** the owner opens the update
- **THEN** a single dialog SHALL carry the changes, the consequences and the confirm action, and
  cancelling it SHALL change nothing

#### Scenario: An update with changes

- **WHEN** release notes were recorded for the target image
- **THEN** the row SHALL show the change count and affected areas, and the dialog SHALL list the
  changes

#### Scenario: An update with nothing new

- **WHEN** the target image contains no changes to what the pod runs
- **THEN** both the row and the dialog SHALL say so plainly, instead of implying a benefit

### Requirement: The preview is presented as a live preview card

The pod's preview SHALL be presented as a card — a browser-chrome bar carrying the URL (copyable)
and its visibility (public / owner-only), a view of the running app, and an Open action — rather than
a lone button. The card SHALL remain informative when the app view is not available (app not started,
crashed, still building): the URL, the visibility, and Open SHALL always be present, and a blank
frame SHALL never be the only thing the card communicates. The card SHALL decide whether to warn from
the pod's own report of whether anything is LISTENING on the app port — and SHALL stay silent when the
app is up, rather than captioning a working page with a permanent "blank?" hedge.

The app view SHALL be a LIVE scaled-down iframe of the running app (owner preference: a live view is
more useful than a static thumbnail). The card SHALL NOT render any app view until liveness is
CONFIRMED (`appListening` true) — never optimistically while still checking — so it never flashes a
view it is about to hide.

(A pod-side self-screenshot capability exists — the pod-agent can capture its own loopback `:3000`
with the image's prebaked headless Chromium and serve a PNG on `/preview-shot`, surfaced via the
provider/control-plane and a web route — but it is currently DORMANT: the cockpit renders the live
iframe, not the thumbnail. It is kept in place for a possible lighter-weight thumbnail return later.)

#### Scenario: Running pod

- **WHEN** the pod is running and a preview URL exists
- **THEN** the card SHALL show the live app view, the URL, its visibility, and Open

#### Scenario: The app is serving

- **WHEN** the pod reports something listening on the app port
- **THEN** the card SHALL show the live app view with NO warning caption, and SHALL NOT have flashed it
  before liveness was confirmed

#### Scenario: Still confirming liveness

- **WHEN** the pod is running but whether anything is listening is not yet known
- **THEN** the card SHALL show a light "checking" placeholder, NOT an app view it may immediately hide

#### Scenario: Nothing is serving

- **WHEN** the pod reports nothing listening on the app port
- **THEN** the card SHALL say so and what to do about it

#### Scenario: Stopped pod

- **WHEN** the pod is not running
- **THEN** the card SHALL say the preview is live only while the pod runs, instead of framing a
  dead URL

#### Scenario: The URL is readable and copyable at any width

- **WHEN** the card is rendered
- **THEN** the URL SHALL be shown in full where it fits and ellipsized where it does not (never
  hard-clipped mid-character), its copy affordance SHALL stay visible so a click gives visible
  feedback, and the page SHALL NOT scroll sideways
- **AND** on a narrow viewport the URL SHALL take its own full-width row rather than being squeezed
  between the visibility chip and the actions

### Requirement: The owner sees what Podbay did to their pod

Podbay can suspend, resume, change the image of, roll back and repair any pod. Those actions
currently delegate to the same paths the owner uses, which made them indistinguishable from the
owner's own. Every action Podbay takes on someone's pod SHALL be recorded distinctly and SHALL be
visible to that pod's owner.

Only actions that CHANGED something SHALL be recorded — a check that repaired nothing is not an
event. The principle: if we are comfortable doing it, we should be comfortable saying it; if we are
not comfortable saying it, that is the signal not to do it.

#### Scenario: Podbay resumes a pod the owner suspended

- **WHEN** an operator resumes someone's pod
- **THEN** the owner's cockpit SHALL show that Podbay resumed it, and when

#### Scenario: The owner acts on their own pod

- **WHEN** the owner suspends or updates their own pod
- **THEN** nothing SHALL be attributed to Podbay

#### Scenario: A pod nobody touched

- **WHEN** Podbay has never acted on a pod
- **THEN** the cockpit SHALL say so plainly rather than showing an empty area

### Requirement: A pod shows ONE state, and its timestamp says what it measures

A pod SHALL present a single current state. An in-flight image update SHALL REPLACE the pod's status
rather than sit beside it: showing "Running" and "updating…" together presents two competing truths
and leaves the owner unsure which applies. The update state SHALL read as transitional (amber,
pulsing), like the pod's other mid-transition states.

A relative timestamp on a pod SHALL say what it measures. A bare "8h ago" beside a status badge reads
as the age of the status, or of the pod, or of the update; it is the last time anything happened
inside the pod, and SHALL be labelled as such.

#### Scenario: An update is in flight

- **WHEN** a pod is running and an image update is underway
- **THEN** the card and the cockpit SHALL show the updating state INSTEAD of Running, and SHALL NOT
  show both

#### Scenario: An update is merely available

- **WHEN** an update is available but not started
- **THEN** the pod's real status SHALL remain shown, alongside the separate "Update available" marker

### Requirement: Resource charts are a timeline the owner can zoom

Resource history SHALL be presented over selectable windows (hour, day, week, month), each served at
its own resolution. Alongside the selection the surface SHALL state what the pod ACTUALLY holds —
how many points, covering how long — because a "30 days" button on a pod that booted yesterday
otherwise implies a month of history that does not exist.

Gaps SHALL be drawn as breaks, never bridged: a suspended pod records nothing, and a line drawn
across that gap claims activity that did not happen.

#### Scenario: A young pod viewed over a wide window

- **WHEN** the owner selects a window longer than the pod's history
- **THEN** the charts SHALL show what exists and state the real coverage rather than implying more

### Requirement: Usage is a timeline, and always states its window

A pod's running history SHALL be presented as the running/suspended stretches it is made of, not as
totals alone, on both the owner and operator surfaces. Totals answer "how much" and never "when", and
"when" is what connects a suspend (or a crash marker) to the resource charts beside it.

The span the figures cover SHALL be stated. The event log begins the day instrumentation shipped and
is not backfilled, so an unlabelled total reads as a lifetime figure for a pod whose history starts
last week.

The stretches SHALL come from the same fold that produces the totals, so the picture and the numbers
printed beside it cannot disagree. Durations SHALL be rendered at a resolution that matches the
drawing — a stretch shown as a tenth of the bar must not be labelled the same as one shown as most of
it.

#### Scenario: A pod suspended and resumed

- **WHEN** a pod has been suspended and resumed
- **THEN** the history SHALL show the running and suspended stretches in proportion, with the
  observation window stated

### Requirement: The operator's view stays live while something is moving

While a pod is in a transient state — updating, provisioning, starting, stopping — the admin drill-in
SHALL keep itself current, and SHALL show elapsed time advancing. An operator watching a stuck update
on a page that never changes cannot tell a slow update from a dead page.

It SHALL NOT poll on the happy path. This surface reconciles against the provider on every load, so
an unconditional heartbeat would mean a provider call per open tab forever, and a backgrounded tab
must not keep a machine warm.

#### Scenario: Watching an update

- **WHEN** an operator has the drill-in open for a pod that is updating
- **THEN** the stage and elapsed time SHALL advance without the operator reloading

#### Scenario: An idle pod

- **WHEN** the pod is in a settled state
- **THEN** the page SHALL NOT poll

### Requirement: An operator can resize a pod, and the owner is told

The admin drill-in SHALL allow changing a pod's size. "Memory is near the ceiling" is a support
request, and an operator who can suspend, update, roll back and delete but NOT resize must hand the
one useful remedy back to the user.

A resize SHALL be recorded as an admin action in the OWNER's activity, named in the size's human
label rather than its tier id. It changes what the owner is billed, and an unexplained bill change is
worse than the problem it fixed. A resize to the size the pod already has SHALL be a no-op — it would
otherwise cut a live agent session for nothing.

#### Scenario: Operator resizes someone else's pod

- **WHEN** an operator changes a pod's size
- **THEN** the owner SHALL see an entry naming the new size in words

### Requirement: Provisioning failures are diagnosable from the screen

Where a pod's provisioning has retried, or a build lease is recorded, the admin drill-in SHALL show
the attempt count and the lease — including whether the lease is still HELD or has EXPIRED. A pod
stuck behind an expired lease has nobody building it, and that state was previously invisible on
every screen.

These SHALL be hidden on the happy path so they read as a signal rather than another row.

#### Scenario: A pod stuck behind an expired lease

- **WHEN** a lease timestamp is in the past
- **THEN** the surface SHALL say no worker is building the pod

### Requirement: An operator can repair, not only observe

The admin drill-in SHALL offer doctor — the active check — and the ability to apply its SAFE fixes.
An operator who can see that a pod is broken but cannot act on it has to hand the problem back to the
owner, who has the fix button but not the context.

Invasive repair (replacing files) SHALL remain owner-only, and SHALL be refused by the admin action
itself rather than merely hidden from the operator's screen: replacing a user's files is a decision
for the person whose files they are, and a hidden button is not an access control.

The operator's health view SHALL be single-sourced on doctor, the same source the owner's is. The
passive report and doctor apply different filters, so rendering the passive one here let a single pod
show the owner nothing and the operator several problems.

Successful self-repairs SHALL be shown, not only the give-ups: a pod that has quietly restarted an
agent nine times is reporting something, and only the failures were visible before.

#### Scenario: Operator finds a fixable problem

- **WHEN** doctor reports a safely fixable finding on another user's pod
- **THEN** the operator SHALL be able to apply the safe fix

#### Scenario: Operator faces a finding that needs files replaced

- **WHEN** the only remedy replaces files
- **THEN** the admin surface SHALL NOT offer it, and the admin action SHALL refuse it if called

### Requirement: One pod is described the same way to both audiences

Where both surfaces state the same fact — whether an update is available, an image digest, what a
destructive control will do — they SHALL derive it from ONE shared definition.

Duplicated predicates drift, and the drift surfaces at the worst moment: mid-update, one audience was
told an update was available while the other was told the pod was up to date. Digests SHALL be
abbreviated identically on both, so the two people can match the string by eye.

Copy describing a CONSEQUENCE SHALL be shared, not re-worded per surface, and SHALL NOT name a
specific agent where the pod may run another one. The warning that a control ends a live agent
session SHALL appear on both surfaces — an operator acting on someone else's pod cannot see what its
agent was doing, so the warning matters more there, not less.

#### Scenario: A pod is mid-update

- **WHEN** an update is in flight
- **THEN** both surfaces SHALL indicate an update is in progress, and neither SHALL report the pod as
  up to date

### Requirement: An operator and an owner see the same pod the same way

The admin drill-in SHALL render pod resources through the SAME component the owner's cockpit uses,
not a parallel operator rendering. Two renderings of one pod drift, and then an operator and an owner
describe the same machine differently — which is the expensive kind of confusion during an incident.

Agent activity SHALL be shown as a timeline with its shares on the legend, not as a sentence of
percentages, on both surfaces.

#### Scenario: Operator opens a pod they do not own

- **WHEN** an operator views another user's pod
- **THEN** the resource charts SHALL load through an admin-scoped read and show the same history the
  owner sees

### Requirement: Activity is measured by time, not by sample count

Agent-activity shares SHALL be weighted by the time each sample stands for. Samples from a coarse
rollup tier represent far more time than recent ones, so counting samples equally would let a recent
busy minute outweigh a quiet hour.

Time the pod was suspended SHALL be excluded rather than attributed to the last known state — the
pod recorded nothing across a gap, and carrying a state over it would assert knowledge we lack.

#### Scenario: A wide window spanning several tiers

- **WHEN** activity is summarised over a window whose samples come from more than one tier
- **THEN** each sample SHALL count for the time it represents

### Requirement: Cockpit reads run in parallel, so one slow read can't freeze the others

The cockpit's polled reads — the live-signals feed, the Secrets tab, the Stats tab — SHALL be served
by HTTP Route Handlers (`GET /api/...`) consumed via `fetch`, NOT by Next.js server actions. Server
actions run one-at-a-time per client on a single serialized lane; the always-on live-signals poll can
stall on a wedged pod's health probe and monopolize that lane, leaving every other read stuck in its
loading skeleton until a full page reload resets the client's action queue. Route Handlers run on the
parallel HTTP lane, so a slow poll can never starve a tab's read. Each read stays owner-scoped (the
service authorizes by the session user) and never returns a secret's value, only whether it is set.

#### Scenario: A wedged pod does not freeze the cockpit's other tabs

- **GIVEN** one of the owner's pods is unresponsive, so its health probe is slow
- **WHEN** the owner opens the Secrets or Stats tab while the live-signals poll is mid-sweep
- **THEN** that tab's data SHALL load on its own parallel request rather than queue behind the poll and
  stick in a skeleton until a manual refresh

### Requirement: Switching cockpit tabs keeps you oriented

Cockpit tab panels differ in height by hundreds of pixels, and the dashboard's scroll container
CLAMPS to the shorter panel's maximum — so switching from a tall tab to a short one silently moved
the reader to the top of the page. Switching SHALL leave the owner looking at the tab strip they just
used, and panels SHALL keep a minimum height so the page does not collapse between tabs.

The correction SHALL be computed AFTER the incoming panel has laid out. Aligning against the outgoing
panel's height overshoots — the strip settles just above the viewport, which is the same "where did my
tabs go" failure in a subtler form, and it only reproduces once panel height has grown with real
content.

#### Scenario: A tall panel followed by a short one

- **WHEN** the owner scrolls to the bottom of the tallest tab and switches to the shortest
- **THEN** the tab strip SHALL remain on screen, neither below the fold nor above the viewport

### Requirement: The cockpit surfaces pod health only when it is bad

The cockpit's main (ready) surface SHALL be reserved for what is **broken right now** — the pod is
down, unreachable, out of disk, or auto-repair has given up. It SHALL render a health strip when the
pod reports a **live, pod-level, CRITICAL** problem, and SHALL render NOTHING otherwise — the strip's
presence is itself the signal, and a permanent "all good" banner trains people to ignore the one place
they will need to look. Live warn-level pod problems SHALL NOT pin to the main surface (they are not
"the pod is down"); per-agent problems SHALL stay on that agent's card; informational findings SHALL
NOT appear in the cockpit at all. The health strip is a live signal and self-clears when the condition
clears; it is not dismissible.

The full check list (warn and info included) and an explicit healthy result SHALL live in the Admin
tab, drawn from ONE source so that opening the tab and running the check on demand can never disagree:
routine use never meets the machinery, but someone who asks the question gets an answer rather than
silence.

#### Scenario: Healthy pod

- **WHEN** the pod reports no live critical pod-level problems
- **THEN** the ready state SHALL show no health strip

#### Scenario: A live-critical problem

- **WHEN** the pod is unreachable, out of disk, or auto-repair has given up
- **THEN** the strip SHALL name it with its consequence, its severity visible at a glance, and it SHALL
  NOT be dismissible (it is a live signal that clears when the condition clears)

#### Scenario: A warn-level live problem stays off the main surface

- **WHEN** the pod reports a warn-level pod problem that is not "the pod is down"
- **THEN** the main ready surface SHALL NOT pin it, and it SHALL remain visible in the Admin health panel

#### Scenario: Asking explicitly

- **WHEN** the owner opens the Admin tab's health panel on a healthy pod
- **THEN** it SHALL say no problems were found, rather than showing an empty area

### Requirement: Past incidents are dismissible and retraceable in an Activity log

Anything that already happened and recovered — an OOM that restarted the agent, a background process
that was killed, a completed update/resize/repair — is NOT a live "the pod is down" signal and SHALL
NOT pin permanently to the cockpit. Such incidents SHALL be surfaced as a **dismissible** banner and
SHALL be retraceable afterwards in a dedicated **Activity** tab that lists what actually HAPPENED —
real events, newest first, grouped by day with the relative age on the day heading (not repeated on
each event) — including events the owner has dismissed (marked as such). Momentary "logging"
statuses that are a step WITHIN an operation (e.g. "Updating…", "Resizing…") are NOT events and
SHALL be excluded; only the completed event (updated, resized) appears, attributed to the actor
(today "You updated…"; a future automatic update would read "Podbay updated…").

Dismissal SHALL be durable and cross-device (recorded server-side on the event), and a single dismiss
SHALL clear the **whole current pile** of banner-worthy incidents on that pod — not one at a time — so
a pod that failed repeatedly does not require repeated dismiss-and-reload. A **new** occurrence after a
dismissal (an incident newer than what was dismissed) SHALL surface again, so a recurring problem is
never silently swallowed.

#### Scenario: An OOM restarts the agent

- **WHEN** the pod emits a critical unplanned incident that already recovered (e.g. `oom_killed`)
- **THEN** the cockpit SHALL show a dismissible banner (not a permanent pinned strip), and the incident
  SHALL appear in the Activity tab

#### Scenario: Dismissing a pile of repeated incidents

- **WHEN** the pod has accrued several undismissed incidents over time and the owner dismisses the banner
- **THEN** every banner-worthy incident at or before that one SHALL become dismissed in a single action,
  and SHALL remain visible (marked dismissed) in the Activity tab

#### Scenario: A new incident after dismissal

- **WHEN** a fresh incident occurs after the owner has dismissed the earlier ones
- **THEN** the banner SHALL surface again for the new incident

### Requirement: The Codex card owns pairing and the remote-control switch

The Codex card's status line SHALL name the confirmed paired devices (self-reported at
pair time — pairing is recorded server-side by OpenAI and is not observable from the pod). Removing
a device from that list edits ONLY Podbay's record: the Codex CLI exposes `start`/`stop`/`pair` and
no revoke, so the pod CANNOT disconnect a paired device. The control SHALL therefore confirm first
and state plainly that the device stays connected and must be removed in the Codex app — it SHALL
NOT present as a disconnect; a generic "remote control is on" sentence with the devices buried in the wizard is
not acceptable. The pairing wizard SHALL open ONLY from an explicit open control (never on its own —
see below), SHALL have an explicit close, and SHALL collapse/close after a confirmed pairing.

A Codex card with at least one paired device is DONE: its wizard SHALL stay collapsed and the card
SHALL offer exactly ONE control — "Pair another device". No disclosure that merely reveals another
button. There is deliberately NO
"turn remote control off" control — switching it off only breaks the owner's own devices, and
forgetting a device is the actual remedy. "Turn remote control on" exists solely as RECOVERY from a
stopped/dead daemon (the off state names the consequence: paired devices can't reach the pod).
Claude's remote control has no external switch (it is governed in-session by `/remote-control`);
the Claude card SHALL state the fact rather than fake a toggle.

#### Scenario: Removing a device is honest about what it does

- **WHEN** the owner removes a device from the card's paired list
- **THEN** they SHALL be told, before it happens, that this only updates Podbay's record and that
  the device stays connected until they remove this pod in the Codex app

#### Scenario: Devices in the status line

- **WHEN** Codex remote control is on and devices have been confirmed
- **THEN** the card's status line SHALL list them by name, each with an inline forget control, and
  the wizard SHALL NOT repeat the list

#### Scenario: Paired card is collapsed

- **WHEN** Codex remote control is on and at least one device is paired
- **THEN** the card SHALL show its status line (devices inline) and a single "Pair another device"
  control, with the wizard collapsed

#### Scenario: An empty or loading device list is not a readiness gate

- **WHEN** Codex remote control is on and the owner's remembered-device list is empty, still
  loading, or the pod's agent report hasn't arrived yet — including across a reload, a delayed
  Codex-live update, or completing another agent's onboarding
- **THEN** the pairing wizard SHALL NOT open on its own: an empty/unloaded list means "Podbay
  remembers no labels," not "nothing is paired" (OpenAI-side enrollment is invisible to Podbay) and
  not "onboarding is incomplete"; the normal cockpit SHALL remain visible with its explicit "Pair a
  device" control until the owner clicks it

#### Scenario: Recovering a stopped daemon

- **WHEN** the daemon is down while Codex is signed in
- **THEN** the card SHALL show the off state with its consequence and a single
  "turn remote control on" recovery action

#### Scenario: Pairing an additional device

- **WHEN** the owner opens the pairing flow from the card
- **THEN** it expands in place with a fresh code and an explicit close, and collapses once the
  pairing is confirmed

### Requirement: Adding GitHub to an existing pod authorizes, chooses a repo, and clones it

Connecting GitHub to an already-running pod SHALL be a guided flow that authorizes the account, lets
the owner choose one of their repositories, and then places that repository in the pod — not merely a
token authorization. After authorization the flow SHALL present a repository picker (the owner's
repositories for the pod's connection) and, on selection, SHALL clone the repository into the pod's
`~/work`. The outcome SHALL be surfaced to the owner: a success when the repository is placed, or the
"one pod, one repo" refusal when `~/work` already has code. Only the pod's owner SHALL be able to
initiate the clone.

#### Scenario: Connect and clone on an empty pod

- **WHEN** the owner connects GitHub to a pod whose `~/work` is empty and picks a repository
- **THEN** the repository SHALL be cloned into `~/work` and the cockpit SHALL confirm it

#### Scenario: Connect on a pod that already has code

- **WHEN** the owner picks a repository for a pod whose `~/work` already contains a workspace
- **THEN** the cockpit SHALL show that the pod already has a workspace and no files SHALL be changed

### Requirement: The cockpit relay row explains itself

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04.

The relay row SHALL carry a short, plain-language explanation the owner can open in place (an ⓘ),
stating what the relay does AND its limits: on only while they run it; public web only, never their
private network; logged for them with the platform keeping the site name only; rate-limited per site;
and signed-in access opt-in per site. It SHALL say plainly that it is not an anonymous proxy. The
owner SHALL NOT have to read external documentation to decide whether to run it.

#### Scenario: Owner opens the relay explanation

- **WHEN** the owner opens the relay row's ⓘ
- **THEN** they SHALL see what the relay does and each of its limits, without leaving the app

### Requirement: The cockpit relay indicator reflects REAL liveness, not a stale flag

The cockpit's relay indicator SHALL report "connected" only while the relay link is actually live —
driven by real proof-of-life (the gateway's ping/pong on the relay socket), NOT by a timer that keeps
asserting "connected" after the socket has gone half-open. A half-open link (owner's machine slept,
a network blip with no FIN/RST) SHALL be detected and reflected as disconnected, so the owner is never
shown "connected" while their pods actually time out. When the link has dropped/flapped recently, the
indicator SHALL surface that instability (a recent-drop signal) rather than showing an unqualified
"connected" — the flapping that was previously invisible as "connected, 0 errors."

#### Scenario: The relay link goes half-open

- **WHEN** the relay socket dies without a clean close (sleep/wake, network blip)
- **THEN** the gateway's liveness heartbeat SHALL detect it within its ping/pong window and the cockpit
  SHALL report the relay as not-connected, instead of "connected" while pod traffic silently fails

#### Scenario: The relay has flapped recently

- **WHEN** the relay reconnected after one or more recent drops
- **THEN** the cockpit relay indicator SHALL surface the recent instability, not a bare "connected"

### Requirement: Relay oversight covers both consumers

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04.

The admin relay view SHALL show BOTH relay consumers — pages fetched AND connections tunnelled —
including connections carried and data moved, broken down **per domain, per relay owner, and per pod**,
so an operator can see what a relay is actually being used for and who is driving it. Per-owner and
per-domain figures MAY accumulate for the life of the gateway process; **per-pod attribution SHALL be
derived from connections open at that moment only**, so it disappears when the traffic stops and is
never accumulated or persisted. The view SHALL remain domain-level throughout: never a URL, never
content. A pod that only tunnels SHALL still appear in the per-pod view. The view SHALL also show, per
owner, whether that relay's tunnel is currently known to work. A gateway that predates the tunnel SHALL
degrade to the fetch-only view rather than erroring.

#### Scenario: A relay carrying tunnelled traffic

- **WHEN** an operator opens the relay view while pods are egressing through relays
- **THEN** it SHALL show open tunnels, data moved, and per-domain connection counts alongside fetch
  activity, with no URL or content

#### Scenario: Attributing tunnel load to an owner and a pod

- **WHEN** an operator opens the relay view while a pod is tunnelling
- **THEN** the owning relay SHALL show its connection and byte totals and its tunnel health, and the pod
  SHALL appear with its open connections — even if that pod has fetched nothing

#### Scenario: The tunnelling stops

- **WHEN** every tunnelled connection for a pod closes
- **THEN** that pod SHALL drop out of the per-pod view, because per-pod attribution is live-only

### Requirement: The cockpit says whether the tunnel actually works

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04.
> AMENDED 2026-08-05: the row is near-realtime by POLLING the last-known health, and drops the manual
> re-check button. Rendering a dashboard must never open a connection through the owner's machine, so a
> "re-check" button — which did exactly that on click — was the wrong affordance. The connect-time
> canary plus live traffic keep the state fresh; the row just reads it.

A connected relay is not the same as a working tunnel: the websocket can be up while connections
through it fail. The cockpit relay row SHALL therefore distinguish the two, showing whether a real
connection through the tunnel is known to succeed. The platform SHALL verify this automatically once
when a relay connects; the row SHALL then keep itself current by polling the last-known result on a
short interval, rather than requiring the owner to press anything.

Reading the row SHALL NOT open a connection through the owner's machine — polling returns only the
last-known health, so watching the dashboard costs the owner nothing. The connect-time verification
SHALL be a single connection to a **platform-owned** host — never a third party — because proving the
tunnel works must not spend the owner's connection on a site they did not choose, and it SHALL appear
in the owner's own relay log like any other connection. Verification SHALL NOT be performed on a
repeating schedule.

A failure observed from ordinary traffic SHALL NOT be reported as the tunnel being broken (one
unreachable target is not a broken tunnel); ordinary traffic MAY only confirm that it works. When the
platform cannot be reached to answer the question, the row SHALL say the state is unknown rather than
report a failure.

The row SHALL also show that owner's own tunnel usage headline (connections carried and data moved).
The per-site breakdown SHALL stay on the owner's machine.

#### Scenario: Relay connects

- **WHEN** an owner's relay connects
- **THEN** the platform SHALL verify the tunnel once against its own host, and the relay row SHALL
  report whether it works

#### Scenario: The row stays current on its own

- **WHEN** the owner is viewing the cockpit and the relay's state or usage changes
- **THEN** the row SHALL reflect the change without the owner pressing anything, and SHALL NOT open a
  connection through their machine to do so

#### Scenario: One unreachable target

- **WHEN** a tunnelled connection to some site fails while the tunnel itself is fine
- **THEN** the relay row SHALL NOT report the tunnel as broken

### Requirement: An action updates the page the user performed it on

A pod action SHALL leave the view it was performed from showing the RESULT of that action, not
the state that preceded it. Server-side success is not the deliverable: a user who clicks
Suspend and watches the badge keep saying "Running" has been told the action failed, and will
click again.

Actions whose controls live on the pod's own page SHALL therefore invalidate that page, not
only the dashboard list — including on the ERROR path, where a stale page is worse still: it
renders a pod that looks untouched beside a message saying something went wrong.

#### Scenario: Suspending from the cockpit is reflected there

- **WHEN** the owner confirms Suspend on the pod's page
- **THEN** that page SHALL show the suspended state without a manual reload

#### Scenario: Clearing a secret is reflected there

- **WHEN** the owner clears a stored secret from the pod's secrets panel
- **THEN** that panel SHALL show the secret as unset, without a manual reload

#### Scenario: Analytics cannot prevent the action

- **WHEN** a lifecycle control is used (suspend, resume, update, add agent, delete) and the
  analytics client is unavailable, blocked, or throws
- **THEN** the action SHALL still be performed — instrumentation SHALL NOT sit between the
  user's click and the work, and a lost metric SHALL never surface as a control that appears
  to do nothing

#### Scenario: A failed action still refreshes the view

- **WHEN** a pod action fails after server state may already have moved
- **THEN** the page SHALL still be invalidated, so the owner is never shown a stale pod
  alongside an error describing it

### Requirement: Connect a pod to the T3 Code app

The pod cockpit SHALL offer a T3 Code control action that turns the pod into a backend for the T3 Code
app (iOS/Android/desktop), as a **confirmed, reversible, first-class control mode** — not a silent
one-shot. Enabling SHALL first present a confirm dialog (the shared cockpit `AlertDialog` pattern)
that states what T3 takes over, that currently-running Claude/Codex sessions will end and restart
under T3, that files and sign-ins are preserved (nothing is logged out), and that it can be turned off
at any time. On confirm, enabling SHALL: run `t3 serve` on a DEDICATED port (NOT :3000) DURABLY
(via `podbay startup`, surviving restarts) — registering the startup is NOT enough, enabling SHALL
also LAUNCH it in-session (`podbay startup start`) and wait for that port to actually answer before
reporting ready. Enabling SHALL **leave the pod's own :3000 dev server running** — T3 is reached by
the T3 app via T3's own relay (which follows the serve port), NOT via the podbay preview, so :3000
stays the user's app and its preview keeps working while T3 drives the agents. (Consequently the enable
does NOT flip the preview to delegated-auth — that was only needed when t3 occupied :3000.) Because
provisioning downloads the T3 runtime (a large, native-compiled package) and can take a minute or two,
enabling SHALL run as an **asynchronous, refresh-safe full-page setup flow** that replaces the cockpit
(the same pattern as an image update), showing progress through its stages — and the download stage
SHALL report a REAL percentage (measured from the runtime cache growing), not a static spinner.

If a gateway restart orphans an in-flight enable (its detached task dies with `t3_since` still set), a
maintenance sweep SHALL reconcile it — failing the stale enable so the wizard surfaces an error and the
owner can retry — and a re-enable of a stale (orphaned) pod SHALL be allowed rather than blocked as a
duplicate.

When the enable completes, the cockpit SHALL guide the owner straight into a **T3 Connect** wizard step
(in the flow, not the control page): sign the pod's t3 into the OWNER'S T3 cloud account and LINK this
environment, via T3's headless out-of-band OAuth (`t3 connect login --headless` → `t3 connect link`) —
the same open-a-link, approve, paste-a-code shape as the Claude 1-year token. This account link
(recorded durably as `t3Connected`) is what makes the pod appear in the T3 app on EVERY signed-in
device, synced and remotely reachable; a per-device pairing token/QR does not, so it is NOT used. The
connect step is skippable (the pod still runs t3 locally) and re-enterable from the Control tab.

While T3 Code is in control, the cockpit SHALL show a persistent "T3 Code is in control" indication
and SHALL hide the Open-in-Claude and Codex-pairing controls (which are inert while T3 owns the
agents). The enable and turn-off triggers SHALL follow the cockpit's button conventions — tinted
outline actions, not the blue/primary style reserved for opening an external window. The cockpit SHALL
offer a "Turn off T3 control" action (its own confirm dialog) that fully reverses the mode: stops
`t3 serve`, removes the durable startup entry, returns the preview to owner-auth, restores the Podbay
dev server on :3000, and restores Podbay's own agent controls — leaving the agents signed in.

#### Scenario: A completed enable guides the owner into connecting their T3 account

- **WHEN** the owner enables T3 Code control on a running pod and it reaches ready
- **THEN** `t3 serve` SHALL be provisioned durably, the preview SHALL become delegated-auth, and the
  cockpit SHALL present the T3 Connect wizard step (sign into the T3 account + link this environment)
  so the pod syncs to the owner's devices — not a per-device pairing QR

#### Scenario: The setup flow leaves the progress screen the moment T3 takes control

- **WHEN** the durable enable state reports the pod is now in T3 control (the enable finished, so the
  in-progress marker `t3Since` has cleared and `t3Control` is set)
- **THEN** the cockpit SHALL treat that as completion and advance to the T3 Connect step, and SHALL
  NOT keep showing the progress screen. Completion SHALL be recognised by the pod being **in control**,
  never by the presence of the in-progress marker alone — a finished enable and a not-yet-started
  enable both clear that marker, and conflating them once froze the setup flow on its first stage
  ("Preparing") while the pod was already fully in T3 control. An unrecognised or terminal progress
  stage SHALL NOT render as the first stage.

#### Scenario: Concurrent enable triggers do not double-provision

- **WHEN** a T3 enable is requested for a pod that is already in T3 control, or whose enable is already
  in flight (multiple triggers exist — the post-token server action, the launch/auto-enable path, and
  the Control-tab button — with no cross-coordination)
- **THEN** the request SHALL be a no-op: it SHALL NOT reset the progress stage back to the start nor
  start a second provisioning run that would race the first, and the skip SHALL be logged

#### Scenario: A failed enable rolls the pod back, not stranded

- **WHEN** enabling T3 Code fails partway (e.g. `t3 serve` never answers on :3000)
- **THEN** the pod SHALL be restored to its pre-enable state — the Podbay dev server re-enabled on
  :3000, the t3 startup entry removed, and agent remote-control handed back — rather than left with
  its preview dark, and the cockpit SHALL surface the failure (t3 stage = error)

#### Scenario: Enabling is confirmed before anything changes

- **WHEN** the owner clicks the T3 Code enable action
- **THEN** a confirm dialog explains the hand-off (T3 takes control, running sessions restart,
  files/sign-ins preserved, reversible) and nothing is provisioned until the owner confirms

#### Scenario: Enabling runs as an async, refresh-safe setup flow

- **WHEN** the owner confirms enabling T3 Code control on a running pod
- **THEN** the cockpit shows a full-page setup flow with progress stages while `t3 serve` is
  provisioned durably and the preview becomes delegated-auth, the flow survives a page refresh, and it
  resolves into the T3 Connect step (T3-account sign-in + environment link)

#### Scenario: The dashboard card AND cockpit reflect T3 control, not a false "needs sign-in"

- **WHEN** a pod is in T3 Code control (or an enable is in flight) and its Podbay Claude agent
  therefore reads as not-signed-in (its remote-control is yielded to T3, and it has no Podbay session)
- **THEN** BOTH the pod's dashboard card AND its cockpit header SHALL show a **T3 Code** state (an
  "Enabling T3…" state while the enable is in flight) and SHALL NOT present it as onboarding
  ("Finish setup"/"Cancel") nor as "Needs you — Claude needs sign-in". An in-flight image update
  SHALL still take precedence over the T3 indication.

#### Scenario: The cockpit shows who is in control

- **WHEN** T3 Code is in control of a pod
- **THEN** the cockpit shows a persistent "T3 Code is in control" indication and hides the
  Open-in-Claude and Codex-pairing controls

#### Scenario: Turning off T3 control restores Podbay control

- **WHEN** the owner turns off T3 control and confirms
- **THEN** `t3 serve` is stopped and its startup entry removed, the preview returns to owner-auth, the
  Podbay dev server and Podbay's own agent controls are restored, and the agents remain signed in

#### Scenario: Destroying a T3-linked pod frees its T3 account slot

- **WHEN** a pod connected to the owner's T3 account (or under T3 control) is destroyed
- **THEN** its T3 Connect environment SHALL be unlinked from the relay (freeing the per-account
  environment/tunnel slot) BEFORE the machine is torn down — a best-effort step that RETRIES the
  relay's transient failures and NEVER blocks teardown if it cannot complete. Orphaned env links
  otherwise accumulate and exhaust the account's tunnel quota, which makes new connects be refused.

### Requirement: The dashboard card reflects an expired agent login

A logged-out agent reads as "idle" from its activity signal, so the dashboard pod card MUST NOT show
a signed-out pod as merely idle. When any agent on a running pod reports `loginExpired`, the card
SHALL show a "Sign-in expired" state (a needs-you amber chip, outranking activity) so the owner sees
it from the dashboard grid, not only inside the cockpit.

#### Scenario: A card surfaces an expired login instead of "idle"

- **WHEN** a running pod's agent has `loginExpired: true` while its status signal reads idle
- **THEN** the card SHALL render "Sign-in expired", not "Idle"

### Requirement: An expiring-but-valid login can be reconnected from the Control tab

A login has a hard expiry (`expiresAt`, the refresh token's end) past which no auto-refresh is
possible. While it is STILL VALID but within the expiring-soon window, the dashboard warns "expires in
~Nd — reconnect soon in the Control tab"; the Control tab MUST therefore actually offer a reconnect for
that state, not only once the login has already expired. Because a reconnect is a full re-login that
INTERRUPTS the running session (a refresh token cannot be extended past its hard expiry without signing
in again), the action SHALL be OPTIONAL and CONFIRMED — never an instant sign-out of a working agent —
with the confirmation stating the login still works and that the session is interrupted. The affordance
SHALL NOT appear for an agent whose session is managed by T3.

#### Scenario: The dashboard warning has a matching Control-tab action

- **GIVEN** an agent that is signed in and working but whose login hard-expires within the warning window
- **WHEN** the owner opens the pod's Control tab
- **THEN** it SHALL show an optional "Reconnect" for that agent — so the dashboard's "reconnect soon in
  the Control tab" is never a dead end

#### Scenario: Reconnecting an expiring login is confirmed, not instant

- **WHEN** the owner triggers that reconnect
- **THEN** a confirmation SHALL appear first, stating the login still works and that reconnecting
  interrupts the current session; only on confirm does the re-login begin. Cancel leaves the working
  agent untouched.

### Requirement: The Control tab exposes actionable Claude RC recovery

The Claude row SHALL render the shared `rcState` classification rather than deriving bridge health
from `authed` plus a historical session URL. `active` SHALL offer the live session; `recovering` SHALL
show bounded progress; `down` with a valid login SHALL offer **Restore remote control**;
`login-required` SHALL offer **Reconnect Claude**; and `unknown` SHALL say that RC could not be
verified and offer diagnosis rather than claiming success. The restore action SHALL call the same
bounded recovery primitive as doctor, prevent concurrent attempts, and render the observed state after
reclassification rather than assuming command submission succeeded. On a pod image that predates this
classification (`rcState` absent), the row SHALL fall back to today's `authed` + session-URL signal
rather than showing any of these new states.

#### Scenario: Valid login plus RC-down is actionable

- **GIVEN** Claude reports `rcState: "down"` with a valid login and control is not yielded to T3
- **WHEN** the Control tab renders
- **THEN** it SHALL show **Restore remote control**, and invoking it SHALL show bounded recovery
  progress followed by the reclassified result

#### Scenario: Blocked authentication offers Reconnect

- **GIVEN** current Claude state is `login-required`, including a recognized blocking OAuth retry
  dialog despite a still-present credential file
- **WHEN** the Control tab renders
- **THEN** it SHALL offer **Reconnect Claude**, SHALL NOT offer RC restore, and SHALL NOT remain on
  "Signed in — turning on remote control…"

#### Scenario: Unknown is not an endless transition

- **GIVEN** current CLI evidence cannot establish whether RC is live or down
- **WHEN** the Control tab renders
- **THEN** it SHALL report that RC could not be verified and offer diagnosis without claiming active,
  repeatedly restoring, or showing an unbounded turning-on state

### Requirement: Cockpit and pod-list data is near-realtime, renders immediately, and never gets stuck

The dashboard pod list and the pod cockpit SHALL present live data that is near-realtime, renders
without a jarring empty-then-populate jump, refreshes in the background, and never leaves a surface
stuck on a loading state when a fetch fails or is slow.

#### Scenario: Data is shown immediately, not after a fetch round-trip

- **WHEN** the owner opens a pod's cockpit, or switches to a cockpit tab, they have viewed this session
- **THEN** the surface renders its last-known data immediately from cache rather than a blank/loading
  first paint, and updates in place once fresh data arrives (a genuine cold first load shows a skeleton)

#### Scenario: Displayed data stays near-realtime, never silently stale

- **WHEN** a surface is shown from cache
- **THEN** it refetches in the background right away so what is displayed reflects the current state
  within about a second — it SHALL NOT present cached, minute-old data as if it were current

#### Scenario: A failed or slow fetch never sticks on loading

- **WHEN** a data fetch rejects, times out, or returns a transient empty result
- **THEN** the surface does not hang on a loading placeholder forever — it retries (bounded), keeps
  the last-known data visible rather than clobbering it with an empty result, and surfaces an error
  state only when there is genuinely nothing to show

#### Scenario: Switching tabs does not lose or wrongly reset data

- **WHEN** the owner navigates away from a cockpit tab and back
- **THEN** that tab shows its data immediately (not "Status unavailable" / a fresh loading spinner),
  because the data is cached rather than cold-refetched from scratch on every switch

### Requirement: Loading placeholders are skeletons, not blank space or a bare spinner

While a surface has no data to show yet (a first-ever load with no cache/prefetch), it SHALL present a
skeleton that mirrors the shape of the content, not an empty panel or a lone centered spinner.

#### Scenario: First load shows a skeleton

- **WHEN** a pod card, or a cockpit tab, has no cached or prefetched data yet
- **THEN** it renders a skeleton placeholder matching the content layout, replaced in place when data
  arrives

### Requirement: Agent sign-in and reconnect run as a full-page wizard

When an owner signs a pod's Claude agent in (or reconnects it) from the Control tab, the cockpit SHALL present a **full-page takeover** flow that replaces the normal cockpit tabs (the same pattern as pod update / T3-enable), not a block squeezed inside the agent card. The wizard SHALL show a header (a status dot, the pod name, and a "Claude sign-in" label), the line "Sign this pod in to Claude so you can drive it from the Claude app or browser." (no additional reassurance copy), a **Step 1** that opens the agent's sign-in page (the OAuth URL) with the caption "Approve it, then Claude shows you a code to paste back.", and a **Step 2** with a paste-the-code input and a submit control. After the code is submitted it SHALL show a "Signing in…" progress state, and SHALL return to the cockpit automatically once the agent reports authed. Reconnect SHALL reuse the same screen titled "Reconnect Claude". The sign-in mechanics (OAuth URL, code submission, reconnect action) are unchanged — only the presentation moves to full-page.

#### Scenario: Signing in takes over the cockpit and returns on success

- **WHEN** the owner starts (or reconnects) Claude sign-in on a running pod
- **THEN** the cockpit SHALL replace its tabs with the full-page sign-in wizard (open-sign-in-page + paste-code + "Signing in…"), and SHALL return to the normal cockpit automatically once the agent is authed

#### Scenario: The wizard omits the removed reassurance copy

- **WHEN** the Claude sign-in wizard renders
- **THEN** it SHALL NOT show a "files/git/settings are untouched" reassurance line or a "safe to close this tab" note

### Requirement: Codex pairing runs as a full-page wizard

Connecting the ChatGPT app to a pod's Codex agent SHALL be presented as a **full-page takeover** wizard (like update/T3-enable), not an inline card block. It SHALL keep the existing Phone/Desktop step-1 pairing instructions (how to reach the pair screen and enter the code, with the QR on a wide viewport + Phone), a **step 2 "Open your session"** that renders the shared "continue this Codex session" guidance (below), and SHALL refer to the **ChatGPT app** (not "Codex app"). It SHALL NOT show a "Remote control needs the pod awake…" footer line.

#### Scenario: Pairing takes over the cockpit and keeps the pairing steps

- **WHEN** the owner opens Codex pairing on a running pod
- **THEN** the cockpit SHALL show the full-page pairing wizard with the Phone/Desktop step-1 pairing instructions intact and step-2 "Open your session" showing the shared continue-session guidance, and no "pod awake" footer

The full-page wizard SHALL await and inspect the owner-confirmation ("I've paired this") action's
result, the same as the inline card panel it wraps. On success it SHALL invalidate/refetch the shared
confirmed-device query and return to the normal cockpit, where the newly confirmed device pill is
visible. On failure it SHALL remain open with the entered device label intact and display the action's
error — it SHALL NOT mimic success (first10 incident: the device was recorded server-side but the
full-page wrapper never closed or refetched, because it did not forward the panel's completion
callback).

#### Scenario: Successful confirmation returns to the cockpit with the device pill

- **WHEN** the owner enters a device label in the full-page wizard and "I've paired this" succeeds
- **THEN** the wizard SHALL close, returning to the normal cockpit, and the Control tab SHALL show
  that label as a confirmed-device pill without a manual page reload

#### Scenario: A failed confirmation stays put

- **WHEN** "I've paired this" returns an error
- **THEN** the wizard SHALL remain open with the entered label unchanged and the error shown, and
  SHALL NOT add or display a confirmed-device pill

### Requirement: One shared "Continue this Codex session" guidance

The guidance for continuing a Codex session in the ChatGPT app SHALL be defined ONCE and rendered verbatim by BOTH the Codex info "(i)" modal and the Codex pairing wizard's "Open your session" step, so the two cannot drift. It SHALL be titled "Continue this Codex session" and cover the **ChatGPT app** on mobile and desktop: on **mobile**, once paired the pod appears automatically under Remote → Projects as a project named "work" with the pod name shown underneath, and the owner taps it; on **desktop**, the pod is added once as a remote project (+ next to Projects → Remote → name it after the pod → pick the pod as Remote host → set Source folder to `work`, replacing the `/home/dev` default → Add project), and thereafter opened from the sidebar. The pod name SHALL be interpolated wherever "[pod name]" appears.

#### Scenario: The info modal and the pairing wizard show identical continue-session copy

- **WHEN** the owner opens the Codex "(i)" info modal OR reaches step 2 of the pairing wizard
- **THEN** both SHALL render the same "Continue this Codex session" mobile + desktop guidance from a single shared source, referring to the ChatGPT app and naming the pod where "[pod name]" appears

