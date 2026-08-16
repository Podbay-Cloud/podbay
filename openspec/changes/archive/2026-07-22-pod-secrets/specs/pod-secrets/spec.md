## ADDED Requirements

### Requirement: An environment declares the secrets it needs

An environment SHALL be able to declare, in `podbay.yaml`, the secret keys its app requires (key +
optional description + optional required flag). The declaration carries no values.

#### Scenario: Env declares a required secret

- **WHEN** an env's `podbay.yaml` declares a secret `TELEGRAM_BOT_TOKEN`
- **THEN** launching that env surfaces `TELEGRAM_BOT_TOKEN` as a secret the user can set, and its
  value is never part of the environment definition

### Requirement: Secrets are stored encrypted and per-pod, owner-scoped

Secret values SHALL be stored encrypted at rest (AES-256-GCM), keyed per pod, and accessible only to
the pod's owner. The persistence layer SHALL only ever see ciphertext.

#### Scenario: Setting a secret encrypts it

- **WHEN** the owner sets a secret value for a pod
- **THEN** it is stored as ciphertext and is never persisted or transmitted in plaintext

#### Scenario: Non-owner cannot access a pod's secrets

- **WHEN** a non-owner attempts to set, clear, or list a pod's secrets
- **THEN** the operation is rejected

### Requirement: The UI never returns stored secret values

The secrets UI SHALL show only whether each declared secret is set or not; it SHALL NOT return a
stored value to the client.

#### Scenario: Secrets panel shows set/not-set

- **WHEN** the owner opens the pod's secrets panel
- **THEN** each declared secret shows "set" or "not set", never the value; the owner can set a new
  value or clear it

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
