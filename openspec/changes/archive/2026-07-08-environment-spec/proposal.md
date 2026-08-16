## Why

Everything in Podbay's MVP — launching a pod, seeding Claude config, applying a permission
posture, building the marketplace — depends on a single artifact: a declarative definition of
an *environment*. Without a stable spec for that file, every downstream feature (provider,
pod-agent, dashboard launch flow, first-party environments) would hard-code assumptions and
diverge. This change defines `podbay.yaml` v0 and the on-disk layout of an environment so the
rest of the MVP builds against a fixed contract. It is also the ban-hedge: an environment must
be portable enough to run locally with off-the-shelf tooling if hosted subscription auth is
ever cut off.

## What Changes

- Define the **environment definition format** `podbay.yaml` (v0): identity/metadata, base
  image or Dockerfile/devcontainer reference, the agent CLI(s) to run, Claude config layer
  (skills/rules/CLAUDE.md/permission preset), network egress policy, env vars (non-secret),
  and preinstalled setup steps.
- Define the **environment directory layout**: how `podbay.yaml`, a `.claude/` config dir, an
  optional `Dockerfile`/`.devcontainer/`, and an optional starter repo compose into one
  publishable unit.
- Define the **resolution & validation rules**: which fields are required, defaults, how an
  environment maps onto a provisioned pod, and how the guarded-open permission preset is
  applied unless overridden.
- Ship a **reference schema + validator** (`packages/shared`) and **one worked example**
  environment under `environments/` that conforms to the spec.
- Non-goals: no provisioning implementation, no marketplace submission/publishing, no
  multi-provider image building. Those consume this spec later.

ToS-sensitive surface: the spec declares *which official CLI* a pod runs and that auth happens
per-user inside the pod. The format must never carry model credentials, an API-key/proxy
override, or any mechanism that wraps or replaces official-CLI auth.

## Capabilities

### New Capabilities
- `environment-spec`: the `podbay.yaml` v0 schema, environment directory layout, resolution &
  validation rules, and the mapping from environment → pod.

### Modified Capabilities
<!-- None: this is the first capability. -->

## Impact

- New package `packages/shared`: TypeScript types for the environment spec + a validator
  (single source of truth imported by web, provider, and pod-agent later).
- New directory `environments/`: holds first-party environment definitions; this change adds
  one conforming example.
- Establishes the contract consumed by future changes: `sandbox-provider`, `pod-agent`,
  `pod-lifecycle`, `launch-flow`. No runtime services are built here.
- Depends on decisions already recorded in docs/architecture-topology.md (environment vs pod),
  docs/claude-config.md (guarded-open preset), docs/terminal-frontend-plan.md.
