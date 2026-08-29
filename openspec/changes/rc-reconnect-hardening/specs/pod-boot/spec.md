## MODIFIED Requirements

### Requirement: The pod boots Claude with remote control enabled and a descriptive session name

When the launched agent is Claude, the pod SHALL run the official interactive Claude Code session and
enable Remote Control so the session is controllable from the user's Claude apps. Codex sessions are
unaffected. The requested RC title SHALL derive from the pod's environment name and slug and SHALL be
sanitized so it cannot break the TUI-driving or shell boundary.

On a restart, the pod SHALL first resume the prior local Claude conversation and allow Claude's native
interactive RC reconnection to reach an observable outcome. It SHALL NOT infer RC session identity from
the provider operation or from the pod-agent process starting: Incus Suspend/wake and image Update are
cold boots, while a pod-agent-only restart can leave the existing Claude process and RC session alive.

The pod SHALL compare the last successfully observed RC session identity with the current identity. If
the same RC session reattaches, Podbay SHALL preserve its existing title. If a fresh or replacement RC
session is observed, Podbay SHALL apply the sanitized pod title so the owner can recognize it. If
session identity is not observable, Podbay SHALL use the documented RC name argument as best effort
but SHALL NOT send `/rename`, because it cannot prove that doing so would not overwrite an owner title.

#### Scenario: First boot creates a named interactive RC session

- **GIVEN** a Claude pod has no prior local conversation or RC session identity
- **WHEN** its authenticated interactive session reaches the input prompt
- **THEN** the pod SHALL enable RC with the sanitized pod title and SHALL record the resulting session
  identity when it is observable

#### Scenario: The same RC session reattaches after restart

- **GIVEN** the owner renamed an active RC session and Podbay recorded its identity
- **WHEN** Claude resumes after a restart and the same RC session identity becomes active
- **THEN** Podbay SHALL preserve the owner's title and SHALL NOT send `/rename`

#### Scenario: A replacement RC session is recognizable

- **GIVEN** a pod resumes its local conversation but Claude creates a different RC session
- **WHEN** Podbay observes the replacement session identity
- **THEN** Podbay SHALL apply the sanitized pod title to the replacement and SHALL NOT claim that the
  prior app session reattached

#### Scenario: Pod-agent restart does not imply a fresh Claude session

- **GIVEN** the pod-agent service restarts while the tmux-hosted Claude process remains alive
- **WHEN** the boot greeter observes the same active RC session identity
- **THEN** it SHALL leave the session and its title unchanged

#### Scenario: Suspend/wake is classified by outcome rather than assumed to thaw

- **GIVEN** an Incus pod is suspended with a plain stop and later cold-boots from its persistent home
- **WHEN** Claude resumes and RC recovery completes
- **THEN** Podbay SHALL classify the actual RC identity as reattached, replacement, unavailable, or
  unknown and SHALL apply the corresponding title rule

#### Scenario: Unobservable identity does not clobber a title

- **GIVEN** the pinned Claude version exposes no current RC session identity
- **WHEN** Podbay enables or recovers RC
- **THEN** it SHALL pass the pod title through the documented RC naming argument but SHALL NOT send
  `/rename` solely because a process restarted

#### Scenario: A session name with an apostrophe does not break boot

- **GIVEN** the derived session name contains a single quote or newline
- **WHEN** Podbay enables Remote Control
- **THEN** the name SHALL be sanitized (quotes/newlines removed and length capped) and the generated
  command SHALL remain valid

#### Scenario: Codex pods are unchanged

- **GIVEN** a pod whose launched agent is Codex
- **WHEN** it boots or resumes
- **THEN** the Claude interactive Remote Control and naming flow SHALL NOT run
