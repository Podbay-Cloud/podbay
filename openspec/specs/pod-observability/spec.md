# pod-observability Specification

## Purpose
TBD - created by archiving change pod-observability. Update Purpose after archive.
## Requirements
### Requirement: Unplanned pod incidents are detected and recorded

The platform SHALL detect and record, as typed, severity-tagged events, the unplanned
conditions that affect a pod: an out-of-memory kill, an agent crash or hang, an agent the
watchdog gave up restarting, memory or disk pressure, and provision/update/resize failures.
Out-of-memory detection MUST NOT depend on a signal the pod cannot read: a container cannot read
the host kernel ring buffer (`dmesg`) — even as root — so an OOM kill SHALL be detected from the
cgroup v2 `oom_kill` counter, which IS readable inside the container. An out-of-memory kill SHALL
record the cgroup it occurred in, and — when the source makes them available — the victim process,
its memory, and whether it was the agent (so severity can reflect whether the owner's work was
interrupted); when only the counter is available, agent involvement is instead established via the
restart-attribution path below.

#### Scenario: An out-of-memory kill is detected and recorded

- **WHEN** the out-of-memory killer terminates a process on a pod
- **THEN** an `oom_killed` incident SHALL be recorded — with the victim process and memory state
  where the source provides them, otherwise the cgroup the kill occurred in — and IF the agent
  died, the resulting restart SHALL be attributed to out-of-memory rather than left as an
  unexplained repair

#### Scenario: A single kill is recorded once, not once per cgroup level

- **WHEN** one out-of-memory kill increments the cgroup v2 `oom_kill` counter at multiple levels of
  the hierarchy (the counter propagates to every ancestor cgroup)
- **THEN** the kill SHALL be recorded ONCE, attributed to the most-specific (leaf) cgroup where it
  landed — NOT once per ancestor level (which would surface as a burst of near-duplicate incidents);
  genuinely distinct kills in separate subtrees SHALL remain separate incidents

#### Scenario: Dismissing an OOM banner clears the whole cascade

- **WHEN** the owner dismisses an OOM incident banner on a pod whose single kill was recorded as
  several `oom_killed` events at the same instant (a pod predating the once-per-kill fix)
- **THEN** all sibling `oom_killed` events from that kill (same pod, same moment) SHALL be dismissed
  together, so the banner does not resurface a sibling on reload — while a genuinely distinct later
  kill SHALL remain undismissed. A benign non-agent kill's banner SHALL read calmly (the agent kept
  running) and SHALL NOT surface the raw cgroup name to the owner

#### Scenario: A supervised process restart is a calm, NAMED incident

- **WHEN** the pod's supervisor restarts a dead non-agent process (the dev server or a
  `podbay startup` command) — see pod-boot's supervision requirement
- **THEN** the owner SHALL see a calm (non-critical, non-restart-causing) incident naming the
  process by the owner's own slug (or "dev server"), saying it was restarted automatically — with a
  resize recommendation when the death was attributed to out-of-memory

#### Scenario: Pod-reported health is sanitized at the trust boundary

- **WHEN** the control plane reads a pod's self-reported health (which the pod, running untrusted
  code, fully controls) and turns it into events, dashboard data, or a critical alert
- **THEN** the fields SHALL be bounded and sanitized at the boundary (pre-Alpha security M2): array
  sizes capped, string fields length-capped with control characters stripped, numeric fields
  (including the OOM dedup key) coerced into a finite range, and booleans coerced — so a hostile pod
  cannot inject into logs/render, bloat storage, forge severity, or poison the OOM dedup key

#### Scenario: Memory pressure warns before a kill

- **WHEN** available memory on a pod falls below the warning threshold
- **THEN** a `memory-low` (or `memory-critical`) issue SHALL be raised, so the pod is flagged
  before a kill happens, not only after

### Requirement: An agent restart the owner did not cause is explained to them, in the session

Any restart of a pod's agent that the owner did not personally initiate SHALL be explained to
the owner **in the agent session** — the channel the owner actually uses — not only in a web
UI they may never open. The explanation SHALL be delivered as part of the agent's resume after
the restart, attributed as a platform notice (so it reads as fact, not the agent's
speculation), and SHALL cover restarts caused by a planned admin action (image update or
resize) as well as unplanned ones. A restart SHALL never appear to the owner as an unexplained
disappearance of their session. The same events SHALL also be recorded in the cockpit.

#### Scenario: An OOM restart is explained in the agent session

- **WHEN** the agent is restarted because the pod ran out of memory
- **THEN** the resumed agent SHALL receive an attributed platform notice that the pod ran out
  of memory and was restarted, phrased so it relays this to the owner and can recommend the fix

#### Scenario: A repeated restart does not repeat the same notice every time

- **WHEN** the same restart-causing incident recurs on a pod within the dedup window
- **THEN** the cause SHALL be stated once and escalated in wording on recurrence, not restated
  identically on every resume

#### Scenario: A planned admin update is not a mystery

- **WHEN** an admin action (update or resize) restarts the owner's pod
- **THEN** the owner SHALL be told, in the session, what happened, so the restart is
  attributable rather than mysterious

### Requirement: The cockpit activity timeline reads as distinct, self-explanatory lines

The cockpit's activity timeline SHALL present events as plain-language lines that a person can act
on, with no raw event slugs and no line that merely repeats another. Specifically: every line SHALL
be human English (an unmapped type is de-underscored, never shown as `some_slug`); an event that
names an actor SHALL name it (an added agent says **which** agent; a toggled setting says on or
off); a secret access SHALL read calmly and name the variable ("Viewed `<KEY>`", not "revealed the
value of"). ONE physical restart SHALL occupy exactly ONE line: the reconciler's echo of a machine
bounce (a reconciled "Restarted" and its "Back online" tail) SHALL NOT add lines when an explicit
cause (update or resize) already names it, and SHALL collapse to a single line when it is a
spontaneous reboot. A run of ADJACENT identical lines SHALL collapse to one line carrying a count.

#### Scenario: An update is one line, not three

- **WHEN** an owner update restarts the pod (emitting the explicit `updated` plus the reconciler's
  reconciled `suspended` and `running` echo)
- **THEN** the timeline SHALL show a single "You updated this pod and it restarted" line, and the
  reconciled "Restarted"/"Back online" echo SHALL NOT appear as extra lines

#### Scenario: A spontaneous reboot is one line

- **WHEN** the pod restarts with no owner update or resize nearby
- **THEN** the timeline SHALL show a single "Restarted" line (its "Back online" tail suppressed)

#### Scenario: An added agent is named

- **WHEN** an `agent_added` event is shown
- **THEN** the line SHALL name the agent (e.g. "Codex was added to this pod")

#### Scenario: Repeated identical accesses collapse

- **WHEN** the same secret is viewed several times in a row (each access is audited)
- **THEN** the timeline SHALL show one "Viewed `<KEY>`" line carrying a count (e.g. "6×"), while the
  underlying audit rows are preserved

### Requirement: The agent can point the owner to its pod's cockpit

A recommended action SHALL include a direct link into the pod's cockpit so the owner can act
in one click rather than being told to "find the dashboard". To make this possible, the agent
SHALL know its own pod's cockpit URLs (the pod's cockpit base and the relevant deep-links, such
as resize/settings), exposed through the pod's metadata and the in-pod `podbay` CLI.

#### Scenario: A resize recommendation is one click

- **WHEN** an incident recommends resizing the pod
- **THEN** the notice SHALL carry a direct link to the pod's resize/settings page in the cockpit

#### Scenario: The agent knows where its pod lives

- **WHEN** the agent needs to point the owner at the pod's cockpit (for a secret, a setting, a
  resize)
- **THEN** the pod's cockpit URL SHALL be available to the agent from its own pod metadata,
  without guessing

### Requirement: The cockpit shows a pod's activity, not just its current state

The owner SHALL be able to see a reverse-chronological timeline of their pod's lifecycle
events and incidents — not only its current status. A recent unplanned warning or critical
incident SHALL be shown prominently (a banner), with any recommended action available inline
and the incident's time shown. Dismissing the banner SHALL be recorded server-side on the
incident (durable and cross-device): a dismissed incident SHALL NOT re-appear on any device
or reload, while a NEW incident still surfaces. Dashboard state SHALL reflect the database,
not per-browser storage.

#### Scenario: The owner follows their pod's history

- **WHEN** the owner opens their pod's activity view
- **THEN** they SHALL see its recent events and incidents in order, each with a plain-language
  description and severity

#### Scenario: A dismissed incident stays dismissed everywhere

- **WHEN** the owner dismisses an incident banner and later reloads, or opens the pod on
  another device
- **THEN** that incident's banner SHALL NOT re-appear (the dismissal is recorded on the
  incident, server-side), though a newer incident SHALL still be shown

### Requirement: Admins are alerted to critical incidents across the fleet

The platform SHALL surface incidents to admins in a fleet view and SHALL send a Telegram
alert for critical incidents through a dedicated ops channel, separate from growth
notifications. Alerts SHALL be deduplicated so a repeating incident (such as an out-of-memory
loop) produces a single escalating alert rather than a flood. Notification credentials SHALL
be held as deployment secrets, never committed to the repository.

#### Scenario: A critical incident pages the admin, once

- **WHEN** a critical incident occurs (or recurs) on a pod
- **THEN** a Telegram alert SHALL be sent through the ops channel, and repeated occurrences of
  the same incident on the same pod within the dedup window SHALL NOT send a new alert each
  time

#### Scenario: A warning stays in the dashboard

- **WHEN** a non-critical (warning) incident occurs
- **THEN** it SHALL appear in the admin fleet view and the owner's cockpit, but SHALL NOT (by
  default) send a Telegram page

