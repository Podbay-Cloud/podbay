## ADDED Requirements

### Requirement: Secrets are a first-class cockpit tab

A pod's secrets management SHALL be reachable as a dedicated tab in the pod cockpit, not only through a
modal, and SHALL be deep-linkable by tab. The tab SHALL be available even when the environment
declares no secrets, so that arbitrary variables and the paste flow remain accessible. Its behavior
(declared secrets, agent requests, add-a-variable, write-only set/not-set display) SHALL be unchanged
from the existing panel.

#### Scenario: Opening the Secrets tab

- **WHEN** the owner navigates to the pod cockpit's Secrets tab (including via a tab deep-link)
- **THEN** the secrets panel SHALL render inline, showing set/not-set state and agent requests, never
  a stored value

### Requirement: A pasted .env blob sets multiple secrets at once

Pasting text containing multiple `KEY=VALUE` lines into any secret value input SHALL be parsed and
distributed across keys rather than stored as a single value. Blank lines, `#` comment lines, an
optional `export ` prefix, and surrounding quotes SHALL be handled; lines that are not valid
`UPPER_SNAKE` assignments SHALL be ignored. A pasted key that the pod does not yet declare SHALL be
created as a new variable. Pasting a single value with no `KEY=` SHALL behave as an ordinary paste.
Write-only semantics SHALL be preserved — nothing is read back.

#### Scenario: Paste a multi-line .env

- **WHEN** the owner pastes several `KEY=VALUE` lines (with comments/blank lines) into a secret input
- **THEN** each valid pair SHALL be set on its key, unknown valid keys SHALL be created as new
  variables, and invalid lines SHALL be skipped

#### Scenario: Paste an ordinary single value

- **WHEN** the owner pastes a value that contains no `KEY=` assignment
- **THEN** it SHALL populate that one input as a normal paste
