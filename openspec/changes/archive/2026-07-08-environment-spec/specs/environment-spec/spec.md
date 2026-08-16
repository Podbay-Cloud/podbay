## ADDED Requirements

### Requirement: Environment definition file

An environment SHALL be described by a single `podbay.yaml` file at the root of the environment
directory. The file SHALL declare, at minimum, an API version, a unique name, and the base
image source. All other fields are optional and SHALL have documented defaults.

#### Scenario: Minimal valid environment

- **WHEN** a `podbay.yaml` declares `apiVersion: podbay/v0`, a kebab-case `name`, and a
  `base` (an image reference OR a path to a `Dockerfile`/`.devcontainer`)
- **THEN** the validator SHALL accept it and resolve every unset field to its default

#### Scenario: Missing required field

- **WHEN** a `podbay.yaml` omits `name` or `base`
- **THEN** the validator SHALL reject it with an error naming the missing field, and no pod
  mapping SHALL be produced

### Requirement: Agent CLI declaration

The environment SHALL declare which official agent CLI(s) the pod runs, from a fixed allowed
set (`claude-code`, `codex`). The format SHALL NOT provide any field that carries model
credentials, an API key, an auth-proxy override, or any value that changes how the official
CLI authenticates. Authentication SHALL occur per-user inside the running pod.

#### Scenario: Declaring the agent

- **WHEN** an environment sets `agents: [claude-code]`
- **THEN** the resolved pod definition SHALL mark Claude Code as the CLI to launch on connect

#### Scenario: Rejecting credential or auth-override fields

- **WHEN** a `podbay.yaml` contains any field that supplies a model API key, token, or a base
  URL / proxy that redirects official-CLI auth
- **THEN** the validator SHALL reject the file with a ToS-violation error

### Requirement: Claude config layer

The environment SHALL be able to contribute a Claude Code configuration layer: a `.claude/`
directory (skills, rules, agents, commands, `CLAUDE.md`) plus a named permission preset. When
no preset is specified, the resolver SHALL apply the `guarded-open` preset defined in
docs/claude-config.md.

#### Scenario: Default permission posture

- **WHEN** an environment does not specify `permissions.preset`
- **THEN** the resolved pod SHALL seed the `guarded-open` preset (acceptEdits + broad allow +
  credential/destructive deny + ask-on-push)

#### Scenario: Environment-supplied skills and rules

- **WHEN** an environment includes a `.claude/` directory
- **THEN** its contents SHALL be placed into the pod's project config so the agent boots
  already briefed, without overwriting user-scoped config

### Requirement: Network egress policy

The environment SHALL declare a network egress policy of `none`, `trusted` (a default
package-registry allowlist), `full`, or `custom` (an explicit allowlist). When unset, the
resolver SHALL default to `trusted`.

#### Scenario: Default egress

- **WHEN** an environment does not declare `network`
- **THEN** the resolved pod SHALL apply the `trusted` allowlist

#### Scenario: Custom allowlist

- **WHEN** an environment declares `network.policy: custom` with a list of domains
- **THEN** the resolved pod SHALL permit egress only to those domains (plus Anthropic API),
  and validation SHALL fail if the list is empty

### Requirement: Non-secret environment variables and setup steps

The environment SHALL be able to declare non-secret environment variables and an ordered list
of setup steps (shell commands) run once at pod build/first-boot. The format SHALL NOT store
secrets; a field documented as secret-bearing SHALL be rejected.

#### Scenario: Setup steps run once and are cached

- **WHEN** an environment declares `setup` steps
- **THEN** the resolver SHALL mark them to run before the agent launches on first provision,
  with results reusable by later sessions of the same pod

#### Scenario: Rejecting inline secrets

- **WHEN** a `podbay.yaml` places a value under a field reserved for secrets
- **THEN** the validator SHALL reject the file and instruct the author to use pod-level secrets

### Requirement: Deterministic environment → pod resolution

Given a valid environment, the resolver SHALL produce a deterministic pod definition: the same
`podbay.yaml` input SHALL always yield the same resolved configuration (image source, agents,
config layer, egress policy, env, setup steps).

#### Scenario: Stable resolution

- **WHEN** the resolver runs twice on an unchanged environment directory
- **THEN** the two resolved pod definitions SHALL be byte-for-byte equal

### Requirement: Portability (ban hedge)

The environment format SHALL remain runnable outside Podbay's hosting: the `base` and config
layer SHALL be expressible with off-the-shelf tooling (a Docker image or devcontainer plus a
`.claude/` dir), so an environment can be launched locally without Podbay infrastructure.

#### Scenario: Local launch compatibility

- **WHEN** an environment's `base` is a devcontainer or Dockerfile and it carries a `.claude/`
  directory
- **THEN** the definition SHALL contain no Podbay-hosting-only required field, such that the
  same directory can be built and run by standard container tooling
