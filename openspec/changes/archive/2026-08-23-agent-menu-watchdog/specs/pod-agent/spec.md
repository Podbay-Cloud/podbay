## ADDED Requirements

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
automatically, and any ambiguous confirmation the platform should not decide on the owner's behalf is
surfaced as "needs you".

#### Scenario: The folder-trust prompt no longer stalls startup

- **WHEN** the agent shows the "do you trust the files in this folder" prompt for its own workspace
- **THEN** the pod answers it so startup proceeds, rather than only refusing to type and waiting

#### Scenario: An owner-decision gate is surfaced, not guessed

- **WHEN** the agent shows a confirmation the platform cannot safely answer on the owner's behalf
- **THEN** the pod surfaces it as a "needs you" state so the owner decides, rather than hanging

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
