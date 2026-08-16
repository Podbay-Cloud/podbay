# pod-secrets Specification

## Purpose
Manages the secrets an environment declares: they are stored encrypted, per-pod, and owner-scoped so only the owner can access them; the UI shows whether each is set and returns a value only through an explicit, per-key, owner-scoped, audited reveal. Set secrets are injected into the pod as environment variables, with edits taking effect on the next boot and unset secrets simply absent.
## Requirements
### Requirement: An environment declares the secrets it needs

An environment SHALL be able to declare, in `podbay.yaml`, the secret keys its app requires (key +
optional description + optional required flag). The declaration carries no values.

#### Scenario: Env declares a required secret

- **WHEN** an env's `podbay.yaml` declares a secret `TELEGRAM_BOT_TOKEN`
- **THEN** launching that env surfaces `TELEGRAM_BOT_TOKEN` as a secret the user can set, and its
  value is never part of the environment definition

### Requirement: The agent can request a secret at runtime, and the owner can add any variable

Beyond what an environment declares up front, the agent inside a pod SHALL be able to request a secret
by name and reason (never a value) so it surfaces in the pod's secrets UI as an input to fill; and the
owner SHALL be able to add an arbitrary environment variable to a running pod, not only the declared
ones. A request SHALL carry only a key and a description, and SHALL disappear once its secret is set.

#### Scenario: The agent asks for a secret it needs

- **WHEN** the agent runs `podbay secrets request OPENAI_API_KEY "for the summariser"`
- **THEN** the pod's secrets panel shows `OPENAI_API_KEY` with that reason as an input to fill, and the
  request carries no value
- **AND** once the owner sets `OPENAI_API_KEY`, the request no longer appears

#### Scenario: The owner adds a variable the environment never declared

- **WHEN** the owner adds an arbitrary `UPPER_SNAKE_CASE` variable and value in the secrets panel
- **THEN** it is stored and injected exactly like a declared secret

#### Scenario: Reserved platform keys are refused

- **WHEN** any caller (owner or agent) tries to set a variable whose name begins with the reserved
  `PODBAY_` prefix
- **THEN** the set SHALL be rejected as invalid — platform-managed variables cannot be shadowed by a
  user-set secret

#### Scenario: The running agent consumes a freshly-set secret without a restart

- **WHEN** a secret is set on a running pod and the agent runs `source <(podbay secrets env)` (or
  `podbay secrets get KEY`)
- **THEN** the new value is available to the agent's shell without waiting for a pod restart

### Requirement: Secrets are stored encrypted and per-pod, owner-scoped

Secret values SHALL be stored encrypted at rest (AES-256-GCM), keyed per pod, and accessible only to
the pod's owner. The persistence layer SHALL only ever see ciphertext.

#### Scenario: Setting a secret encrypts it

- **WHEN** the owner sets a secret value for a pod
- **THEN** it is stored as ciphertext and is never persisted or transmitted in plaintext

#### Scenario: Non-owner cannot access a pod's secrets

- **WHEN** a non-owner attempts to set, clear, or list a pod's secrets
- **THEN** the operation is rejected

### Requirement: Stored secret values are returned only via an explicit owner reveal

The secrets LIST SHALL show only whether each declared secret is set or not and SHALL NOT include
stored values. A stored value SHALL be returned to the client only through an explicit, per-key
REVEAL that is owner-scoped and recorded as an audit event; it SHALL NOT be returned in a list, to a
non-owner, or to the admin/support view. (The owner can already read the same value from the pod
terminal — the reveal only saves them from copying it into a second store to verify one.)

#### Scenario: Secrets panel shows set/not-set

- **WHEN** the owner opens the pod's secrets panel
- **THEN** each declared secret shows "set" or "not set", never the value; the owner can set a new
  value or clear it

#### Scenario: Owner reveals a single value on demand

- **WHEN** the owner explicitly reveals one specific set secret
- **THEN** the decrypted value for that one key is returned to the owner, and the reveal is recorded
  as an audit event (`secret_revealed`)

#### Scenario: Reveal is owner-only and never bulk

- **WHEN** a non-owner requests a secret value, or any caller asks for all values for the browser, or
  the admin/support view is opened
- **THEN** the request is rejected or shows set/not-set only; only the owner, one key at a time, can
  reveal a value

### Requirement: Set secrets are injected into the pod as environment variables

Set secrets SHALL be injected into the pod as environment variables available to the app, written
`0600` owned by the unprivileged user, re-injected on each boot from the encrypted store, and never
present in the pod-spec or logs.

#### Scenario: A set secret is available to the app

- **WHEN** a pod boots with a secret set
- **THEN** the value is present as a shell-exported environment variable (in `process.env` for
  anything the agent launches), backed by a `0600` dev-owned file, and is NOT written into the
  workspace (`~/work`)

#### Scenario: Editing a secret takes effect on next boot

- **WHEN** the owner changes a secret value and the pod next wakes
- **THEN** the pod is injected with the new value (the DB is the source of truth)

#### Scenario: An unset secret is absent

- **WHEN** a declared secret has no value set
- **THEN** no environment variable is injected for it

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

