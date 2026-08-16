# Podbay environments

An **environment** is a shareable definition; launching one gives a user a **pod** (a running
container + persistent filesystem). Each environment is a directory containing a `podbay.yaml`
plus an optional `.claude/` config layer and a base (image / Dockerfile / devcontainer). The
format is validated by `@podbay/shared` (`validateEnvironment`, `resolve`).

## `podbay.yaml` v0

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `apiVersion` | yes | — | must be `podbay/v0` |
| `name` | yes | — | kebab-case, unique |
| `base` | yes | — | exactly one of `image:` \| `dockerfile:` \| `devcontainer:` |
| `agents` | no | `[claude-code]` | subset of `claude-code`, `codex` (official CLIs only) |
| `permissions.preset` | no | `guarded-open` | named posture; see docs/reference/claude-config.md |
| `permissions.{allow,deny,ask}` | no | — | optional rule overrides |
| `network.policy` | no | `trusted` | `none` \| `trusted` \| `full` \| `custom` |
| `network.allow` | if custom | — | non-empty allowlist required when `policy: custom` |
| `env` | no | — | non-secret vars only; secret-looking keys are rejected |
| `setup` | no | — | shell steps run once at first provision |
| `repo` | no | — | `{ url, ref? }` starter repository |
| `metadata` | no | — | `{ description, author, tags }` |

### Rules

- **No secrets, ever.** Any credential/auth field (API keys, tokens, `*_BASE_URL`) or a
  secret-looking `env` key hard-fails validation — this is a ToS guardrail, not a style choice.
- **Official CLIs only.** `agents` may not reference third-party harnesses.
- **Portability.** Keep `base` a plain image/Dockerfile/devcontainer so the environment can be
  built and run by standard tooling without Podbay hosting.
- **Unknown fields warn** (forward compatibility); they do not fail.

### Shared `.claude` base layer

[`_shared/.claude/`](./_shared/.claude) is injected into **every** pod, merged under each env's own
`.claude/` (the env wins on path conflicts). Put cross-env skills/rules here once instead of copying
them into every environment — e.g. `skills/mobile-keyboard-viewport` (the iOS keyboard/viewport fix
for any bottom-input mobile UI). `_shared` has no `podbay.yaml`, so it never appears as a launchable
environment.

See [`nextjs-starter/`](./nextjs-starter) for a complete example.
