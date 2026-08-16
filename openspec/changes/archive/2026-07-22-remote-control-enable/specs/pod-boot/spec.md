## ADDED Requirements

### Requirement: The pod boots Claude with remote control enabled and a descriptive session name

When the launched agent is Claude, the pod's boot command SHALL enable Claude Code Remote Control
and set the session title so the session is controllable from, and findable by name in, the user's
Claude apps. Codex sessions are unaffected (no equivalent). The session title SHALL derive from the
pod's environment name and slug, and SHALL be sanitized so it can never break the `bash -lc '…'`
boot wrapper.

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
