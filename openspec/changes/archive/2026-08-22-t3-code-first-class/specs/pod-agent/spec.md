## ADDED Requirements

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
