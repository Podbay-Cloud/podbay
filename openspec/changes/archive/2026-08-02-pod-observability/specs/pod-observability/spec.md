# pod-observability

## ADDED Requirements

### Requirement: Unplanned pod incidents are detected and recorded

The platform SHALL detect and record, as typed, severity-tagged events, the unplanned
conditions that affect a pod: an out-of-memory kill, an agent crash or hang, an agent the
watchdog gave up restarting, memory or disk pressure, and provision/update/resize failures.
An out-of-memory kill SHALL record which process was killed and whether it was the agent (so
the incident's severity reflects whether the owner's work was actually interrupted).

#### Scenario: An out-of-memory kill is recorded with its victim

- **WHEN** the kernel out-of-memory killer terminates a process on a pod
- **THEN** an `oom_killed` incident SHALL be recorded with the victim process and the memory
  state, and IF the victim was the agent, the resulting restart SHALL be attributed to
  out-of-memory rather than left as an unexplained repair

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
incident SHALL be shown prominently (a banner), with any recommended action available inline.

#### Scenario: The owner follows their pod's history

- **WHEN** the owner opens their pod's activity view
- **THEN** they SHALL see its recent events and incidents in order, each with a plain-language
  description and severity

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
