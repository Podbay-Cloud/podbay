# launch-config Specification

## Purpose
Governs launching a pod with a chosen name and the environment's declared required secrets: the launch UI blocks until required secrets are supplied, rejects undeclared keys, and drops blank values. Secret values are never echoed back and never leave the pod or database in plaintext.
## Requirements
### Requirement: Launch accepts a name and the env's required secrets

Launching an environment SHALL accept an optional pod name and values for the secrets the env
declares, and SHALL apply them to the new pod. Launch without any configuration SHALL remain
valid at the server (name defaults to the slug; no secrets set) — so a direct/API launch is never
hard-blocked — even though the guided wizard requires a name before it will submit (see the wizard
requirement below).

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

### Requirement: Launch may offer a per-pod agent auth mode

The launch wizard MAY offer the pod's agent authentication mode — `subscription`
(default) or `api-key`. The api-key option is currently **shelved** (hidden behind a
flag): the interactive agent TUI does not run cleanly on a BYO key and Remote Control is
subscription-only, so every pod launches in `subscription` mode. When the option IS
offered and `api-key` is chosen, the wizard SHALL collect a BYO API key and refuse to
create the pod until one is entered; the key SHALL be handled like any secret (encrypted,
never echoed, never persisted in a launch draft), and the mode choice MAY be persisted in
the draft. The auth-mode plumbing (schema → pod-spec → boot → reserved-key vault) remains
in place regardless.

#### Scenario: api-key mode requires a key before create

- **WHEN** the user selects `api-key` mode but has not entered a key
- **THEN** the Create action SHALL be disabled with a clear hint, and no pod is created

#### Scenario: The key is not stashed in the draft

- **WHEN** the launch draft is persisted for reload-resume
- **THEN** the auth-mode choice MAY be saved but the API key value SHALL NOT be

### Requirement: Launch is a guided, adaptive, multi-step wizard

The launch flow SHALL present configuration one step at a time rather than as a single form, and SHALL
show only the steps a given environment actually needs. The steps are Basics (name, size), GitHub
(connect + choose repo), Agents (agent selection + control), Secrets (the env's declared secrets), and
a read-only Review that launches. The GitHub step SHALL be present only when the environment is
bring-your-own-repo. Every environment offers every agent, so the Agents step is always present. The
Secrets step SHALL be present only when the environment declares secrets — agents and secrets are
separate steps (one decision per screen), never combined. Advancing SHALL be gated
per step (Basics
requires a pod name; a BYO repo must be chosen; required secrets must be filled); going back SHALL
never re-validate. The Review step SHALL present the chosen size as its tier label and machine specs
(vCPU, RAM, disk), not a bare tier code. Reaching Review and launching SHALL send the same launch
request as before and hand off to the existing post-create phases (creating → login → agent → ready)
unchanged.

#### Scenario: Basics requires a name

- **WHEN** a user is on the Basics step with the name field empty
- **THEN** Next SHALL be disabled until a pod name is entered

#### Scenario: A non-BYO environment with a required secret

- **WHEN** a user launches a non-BYO environment that declares a required secret
- **THEN** the wizard SHALL show Basics → Agents → Secrets → Review, with no GitHub step

#### Scenario: A non-BYO environment with no declared secrets

- **WHEN** a user launches a non-BYO environment that declares no secrets
- **THEN** the wizard SHALL show Basics → Agents → Review, with no Secrets step

#### Scenario: A bring-your-own-repo environment

- **WHEN** a user launches a BYO-repo environment
- **THEN** a GitHub step SHALL appear, and Next SHALL be disabled until a repository is chosen
- **AND** the Review step SHALL show the chosen repository before launch

#### Scenario: Launch is unchanged downstream

- **WHEN** the user confirms launch from the Review step
- **THEN** the same launch request SHALL be sent as the single-form flow sent
- **AND** the post-create provisioning and setup phases SHALL behave identically

### Requirement: The launch wizard survives a page reload

An in-progress launch configuration SHALL be restored after a page reload — both the current step and
the fields already entered — so a refresh does not discard the user's input. The draft SHALL be scoped
to the environment being launched, SHALL be cleared once a pod is successfully created, and SHALL NOT
persist beyond the browser tab.

#### Scenario: Reload mid-configuration

- **WHEN** a user has filled fields on a step and reloads the page
- **THEN** the wizard SHALL return to that step with the entered fields still populated

#### Scenario: Draft cleared after launch

- **WHEN** a pod is successfully created from the wizard
- **THEN** the saved draft for that environment SHALL be cleared

