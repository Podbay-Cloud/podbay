# environment-spec Specification

## Purpose
Defines the declarative environment definition file that specifies what a pod contains — the agent CLI, Claude configuration and permission posture, environment-supplied skills and rules, network egress policy, and non-secret variables and setup steps. It exists to give a single portable, secret-free source of truth that resolves deterministically to a pod and stays compatible with local launches.
## Requirements
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
- **THEN** the resolved pod SHALL apply the `guarded-open` preset (acceptEdits + broad allow +
  credential/destructive deny, including a hard deny on force-push). A normal `git push` is NOT
  prompted — the owner opted out of that friction (2026-08-01); "nothing leaves the pod without
  a yes" rests on the agent's conversational rule, not a tool-level prompt.

#### Scenario: Preset changes reach existing pods (refresh, not seed-once)

- **WHEN** the permission preset changes (e.g. a new `deny`, or a removed prompt) and a pod that
  was provisioned under an older preset boots again
- **THEN** the pod SHALL refresh the podbay-MANAGED permission fields (`defaultMode`, `allow`,
  `deny`, `ask`) in the user settings from the current preset, SHALL preserve any keys it does not
  manage, and SHALL NOT clobber a value the user has edited themselves. A seed-once write (which
  froze the preset on the pod that first wrote it) SHALL NOT be used — otherwise a security
  tightening or a policy fix never reaches a pod created before it.

#### Scenario: An image update re-resolves the preset into the preserved pod-spec

- **WHEN** a pod's image is updated and the pod-spec is preserved across the recreate (to keep
  non-preset state such as bind-mount paths and kickoff)
- **THEN** the `permissions` block of the preserved spec SHALL be replaced with the freshly-resolved
  env permissions before it is re-pushed, so the boot-time settings refresh reads a CURRENT preset
  rather than the frozen one the pod was created with; all non-permission fields SHALL be preserved,
  and a spec that cannot be parsed SHALL be pushed unchanged rather than fail the update

#### Scenario: Environment-supplied skills and rules

- **WHEN** an environment includes a `.claude/` directory
- **THEN** its contents SHALL be placed into the pod's project config so the agent boots
  already briefed, without overwriting user-scoped config

### Requirement: Shared config buckets

An environment SHALL declare which shared configuration buckets it inherits via a `shared` list
of bucket names, defaulting to `[universal]`. Each bucket is an `environments/_shared/<bucket>/.claude`
layer. The resolver SHALL compose the declared buckets in order, then the environment's own
`.claude` layer, with later layers overriding earlier ones on path conflict. This lets a generic
environment avoid inheriting stack-specific config it cannot use.

#### Scenario: Generic environment inherits universal only

- **WHEN** an environment declares `shared: [universal]` (or omits `shared`)
- **THEN** the resolved pod SHALL receive the `universal` bucket's `.claude` layer plus the
  environment's own, and SHALL NOT receive any other bucket (e.g. the `web-app` skills)

#### Scenario: Web environment opts into the web-app bucket

- **WHEN** an environment declares `shared: [universal, web-app]`
- **THEN** the resolved pod SHALL receive both buckets' `.claude` layers, in that order, before
  the environment's own

### Requirement: Bring-your-own-repo config seeding

The environment's config layer SHALL be seeded at USER scope (`~/.claude`) — never written into the
repository working tree — when a pod's workspace is a repository the user brought in (a `githubRepo`
is set), so the user's own files and git status are never altered by podbay.

#### Scenario: BYO repo keeps its own config

- **WHEN** a pod is launched with a `githubRepo` and the environment supplies skills/rules
- **THEN** those SHALL be seeded under `~/.claude`, the cloned repo's `~/work` tree SHALL be left
  unmodified, and any skill the repo ships under the same name SHALL win over podbay's copy

### Requirement: Environment declares BYO-repo intent

An environment SHALL declare `byoRepo` (default false) to opt into accepting a user's own GitHub
repo at launch. Only envs where bringing a repo is the point (BYO / OSS-contribution engines) set it;
envs with a prebuilt `~/work` app leave it false. The launch UI SHALL show the "Bring a GitHub repo"
picker ONLY for envs with `byoRepo: true`, so the field is intentional and never appears where a repo
makes no sense.

#### Scenario: Picker gated by the flag

- **WHEN** the launch form renders for an env with `byoRepo: false` (or unset)
- **THEN** the repo picker SHALL NOT be shown

#### Scenario: BYO env shows the picker

- **WHEN** the launch form renders for an env with `byoRepo: true`
- **THEN** the connect-GitHub → select-repo picker SHALL be shown

### Requirement: Environment declares required pod capabilities

An environment SHALL declare `capabilities` describing what the pod image must provide for its agent
to do its job. `capabilities.browserTesting` (default **true**) states that the pod ships a working
Playwright + Chromium so the agent can click-test a UI. The pod image SHALL provide a launchable
Chromium and expose `PLAYWRIGHT_BROWSERS_PATH` to both the agent service and login shells whenever
the declaration is true; agent-facing instructions that promise browser testing SHALL be conditioned
on this declaration rather than asserting it unconditionally.

All pods currently boot ONE shared base image, so this declaration does NOT vary what is installed —
it declares intent, keeps agent instructions truthful, and is the signal that would later drive
per-env image variants. Declaring `false` SHALL NOT be read as a guarantee the browser is absent.

#### Scenario: Env omits the declaration

- **WHEN** an environment does not specify `capabilities.browserTesting`
- **THEN** it SHALL resolve to `true`, since every current env ships a web UI and a BYO env cannot
  know what repository it will receive

#### Scenario: Non-UI environment opts out

- **WHEN** an environment sets `capabilities.browserTesting: false`
- **THEN** resolution SHALL preserve the value, and agent instructions SHALL NOT promise browser
  testing for pods of that environment

#### Scenario: Image lacks the declared capability

- **WHEN** a pod runs an image built before the capability shipped, so Chromium cannot launch
- **THEN** the agent SHALL report it as an image gap and SHALL NOT attempt to install system
  libraries or a browser inside the running pod

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


### Requirement: Environment declares web-fetch capability

An environment SHALL be able to declare `capabilities.webFetch`, default OFF, opting the env into
the web-fetch capability and stating which rungs it may use. When absent or false, the agent SHALL
NOT reach for the web-fetch skill unprompted. The capability summary shown for the env SHALL reflect
the declaration.

#### Scenario: Env omits the declaration

- **WHEN** an environment does not set `capabilities.webFetch`
- **THEN** it SHALL resolve to off, and the web-fetch skill SHALL NOT be presented as available

#### Scenario: A research env opts in

- **WHEN** an environment sets `capabilities.webFetch` on with a set of allowed rungs
- **THEN** resolution SHALL preserve it and the web-fetch skill SHALL be available to that env's agent
