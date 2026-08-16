## ADDED Requirements

### Requirement: Launch accepts a name and the env's required secrets

Launching an environment SHALL accept an optional pod name and values for the secrets the env
declares, and SHALL apply them to the new pod. Launch without any configuration SHALL remain
valid (name defaults to the slug; no secrets set).

#### Scenario: Launch with a name and a required secret

- **WHEN** the owner launches `ai-chat` with a name and a value for `ANTHROPIC_API_KEY`
- **THEN** the created pod carries that name and the secret is stored for the pod, and the value
  is present in the pod's environment from first boot (not added afterward)

#### Scenario: Launch with no configuration still works

- **WHEN** the owner launches an env with no name and no secrets
- **THEN** a pod is created with the slug as its name and no secrets set

### Requirement: The launch UI requires declared-required secrets

The launch dialog SHALL mark the env's required secrets and SHALL keep Launch disabled until
every required secret has a value. The server SHALL NOT hard-block a launch with a required
secret unset — the "run now, add the secret later" path stays valid — but it SHALL reject any
secret key the env does not declare, before any pod is provisioned.

#### Scenario: Launch disabled until required secrets filled

- **WHEN** the owner opens the launch dialog for an env with a required secret
- **THEN** Launch is disabled until that secret has a value

#### Scenario: Undeclared secret key is rejected

- **WHEN** a launch includes a secret key the env does not declare
- **THEN** the launch is rejected with an invalid-input error and no pod is created

#### Scenario: Blank values are dropped

- **WHEN** a launch provides a declared secret with a blank value
- **THEN** no empty secret is stored or injected, and the pod still launches

### Requirement: Secret values never leave the pod or DB in plaintext

Secret values supplied at launch SHALL be stored encrypted and SHALL NOT be logged, echoed back
to the client, or placed in the pod spec beyond the injected secrets file.

#### Scenario: Launch does not echo secret values

- **WHEN** a pod is launched with secrets
- **THEN** no response, log line, or pod record contains the plaintext secret value
