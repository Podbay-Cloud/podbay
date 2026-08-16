# agent-credentials Specification

## Purpose

Podbay agents authenticate **per pod**. Each pod runs the agent CLI's own login
(`claude /login`, `codex login`) once, and that grant lives on the pod's own
persistent volume. There is no shared credential vault and no cross-pod
propagation: a new pod means a new login. This spec defines that per-pod login
model, the requirement that the app's injected `ANTHROPIC_API_KEY` never hijacks
the agent's subscription login, and the boundaries that keep login material off
logs, out of the environment format, and inside the owning pod.

## Requirements

### Requirement: Each pod authenticates its own agent login

A pod has an authentication mode (`agentAuth`), defaulting to `subscription`. In
`subscription` mode the pod SHALL obtain the agent CLI's credentials by running that
CLI's login flow inside the pod: on first boot with no credentials file present it
SHALL start the login flow; once a credentials file exists it SHALL launch the agent
already authenticated with no login step. In `api-key` mode the pod SHALL run the
agent on a caller-supplied API key instead, with NO login flow (see "A pod may run its
agent on a BYO API key" below).

#### Scenario: First boot runs the CLI login (subscription)

- **WHEN** a subscription-mode pod boots and no credentials file exists for its agent
  (`~/.claude/.credentials.json` for claude, `~/.codex/auth.json` for codex)
- **THEN** the pod's first tmux session runs the CLI login (`claude /login` /
  `codex login`) so the user can sign in

#### Scenario: Already-authenticated pod skips login

- **WHEN** a subscription-mode pod boots and a credentials file already exists on its
  volume
- **THEN** the pod launches the agent directly, with no login step

### Requirement: A pod may run its agent on a BYO API key

When a pod's `agentAuth` is `api-key`, the pod SHALL launch the agent authenticated with
a bring-your-own API key rather than the subscription login: the key is set for the agent
PROCESS ONLY (from a reserved secret, so the general environment never carries it and app
code / other agents are unaffected), the `/login` flow SHALL be skipped entirely, and the
in-pod greeter SHALL accept the CLI's "use this API key?" prompt (which otherwise defaults
to "No" and blocks the session). This is the ToS-clean path for unattended / automated
pods (docs/plans/api-key-pod-mode.md). `agentAuth` defaults to `subscription`.

#### Scenario: api-key pod launches on the key, never logs in

- **WHEN** an `api-key`-mode pod boots
- **THEN** the agent SHALL launch with the BYO key set for its process, no `/login` step
  SHALL run, and the greeter SHALL accept the "use this API key?" prompt so the session
  proceeds

#### Scenario: Subscription pods are unaffected

- **WHEN** a pod's `agentAuth` is `subscription` (the default)
- **THEN** the agent SHALL authenticate via the login flow with the app's API key stripped,
  exactly as before

### Requirement: Agent logins are never shared across pods

The platform SHALL NOT capture, store, or inject agent credentials between pods.
There is no credential vault, no write-back of refreshed tokens, and no
cross-pod propagation; each pod owns only its own grant.

#### Scenario: A new pod requires its own login

- **WHEN** a user who has already signed a different pod into an agent launches a
  new pod for that same agent
- **THEN** the new pod starts its own login flow — it receives no credentials
  from any prior pod or from the control plane

#### Scenario: A refreshed token stays local to its pod

- **WHEN** the agent CLI in a running pod refreshes or rotates its token
- **THEN** the new token is written only to that pod's own volume; no other pod
  and no central store is updated

### Requirement: A pod's login persists across sleep and wake

A pod SHALL remain authenticated across suspend/resume and cold restarts without
repeating the login, because the credentials file lives on the pod's persistent
home volume.

#### Scenario: Login survives suspend/resume

- **WHEN** an authenticated pod is suspended and later resumed (or cold-restarted)
- **THEN** the agent boots still authenticated, reading the credentials file from
  its volume, with no new login step

### Requirement: The app's API key does not hijack the agent login

The agent CLI SHALL be launched with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`
stripped from its own environment, so an app key injected by the environment does
not hijack the agent's subscription login. Podbay agents authenticate on the
user's subscription via `/login`, not on the app key; the app's own processes
still receive the key.

#### Scenario: Claude is launched with the app key stripped

- **WHEN** the pod launches the claude CLI (for login or for an authenticated
  session)
- **THEN** it runs under `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN`, so
  Claude Code does not see the app key and does not interrupt with a "use this
  API key?" prompt

#### Scenario: The app still gets its key

- **WHEN** the env's app process (e.g. `pnpm dev`) runs via the agent's shell
- **THEN** it re-sources the injected key from `/etc/podbay/secrets.env` and runs
  with `ANTHROPIC_API_KEY` set as normal

#### Scenario: The API-key prompt is declined if it appears

- **WHEN** the "use this API key? / custom API key in your environment" prompt
  nonetheless surfaces during login
- **THEN** the pod-agent greeter accepts the highlighted "No (recommended)"
  default so the subscription login is not overridden

### Requirement: The agent reports its login state as a signal

The pod-agent SHALL report whether the agent's credentials file is present and
non-empty (with a short content hash that never contains the secret) so the
launch wizard and terminal can detect the unauthenticated→authenticated
transition and advance. This signal is for UI progression only; it never carries
or persists credential material off the pod.

#### Scenario: The authed transition advances the login UI

- **WHEN** the credentials file appears (or its content hash changes) in a
  running pod
- **THEN** the pod reports an `authed` status signal, and the wizard/terminal
  moves past the login step

#### Scenario: The signal carries no secret

- **WHEN** the login-state signal is emitted
- **THEN** it contains only `{ agent, authed, hash }` where `hash` is a truncated
  digest, never the credentials themselves

### Requirement: Credentials never leak beyond the pod

Login material SHALL exist only as files on the owning pod's own volume, owned by
the pod's unprivileged `dev` user; it SHALL never appear in logs, in the
environment format, or on any marketplace-visible surface.

#### Scenario: Logs are clean

- **WHEN** login or status reporting runs
- **THEN** no log line contains credential material

#### Scenario: The environment format refuses credentials

- **WHEN** an environment file attempts to carry credential-bearing keys
- **THEN** validation hard-fails; credentials are never declared in or shipped by
  the environment format

### Requirement: The GitHub connection is separate from the agent login

Private-repo access SHALL use a short-lived GitHub user token (from the web app's
OAuth device flow), installed into `gh`/`git` inside the pod. This is distinct
from the agent's Claude/Codex login and follows the same no-leak rules.

#### Scenario: The token is installed without appearing in the process list

- **WHEN** the pod-agent receives the user's GitHub token
- **THEN** it passes the token to `gh auth login --with-token` via stdin (never
  argv), runs `gh`/`git` as the `dev` user with `HOME=/home/dev`, and lands the
  credential on the persistent volume where the dev shell's `git clone` finds it

#### Scenario: A BYO repo cloned at launch reports its connection honestly

- **WHEN** a pod is launched from a user's own GitHub repo with a clone token
- **THEN** first boot SHALL install that token into BOTH `git` (credential store) and
  `gh` (`gh auth login --with-token` via stdin), so the pod's reported GitHub status —
  which is derived from `gh` — reflects the working connection rather than showing
  "not connected" while `git` alone is authenticated
