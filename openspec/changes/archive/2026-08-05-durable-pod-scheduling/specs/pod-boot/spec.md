## ADDED Requirements

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
