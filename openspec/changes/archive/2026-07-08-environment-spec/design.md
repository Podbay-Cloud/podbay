## Context

Podbay delivers "environments" (shareable definitions) as "pods" (running instances). The MVP's
provider, pod-agent, launch flow, and first-party environments all need a fixed definition
format to build against. Decisions already made in the design docs constrain this: per-project
pods (architecture-topology.md), guarded-open permission posture (claude-config.md), official
CLIs only / no auth wrapping (analysis.md), and devcontainer-compatible portability as the ban
hedge. This change produces the format + validator + one example only — no provisioning.

## Goals / Non-Goals

**Goals:**
- A `podbay.yaml` v0 that is small, human-authorable, and covers image, agents, Claude config,
  egress, env, setup.
- A single TypeScript source of truth (`packages/shared`) — types + validator — importable by
  every later component.
- Deterministic environment → resolved-pod mapping.
- Portability: an environment is a Docker/devcontainer base + `.claude/` dir + `podbay.yaml`,
  runnable by standard tooling.
- One conforming example under `environments/`.

**Non-Goals:**
- Provisioning/booting pods (future `sandbox-provider`, `pod-lifecycle`).
- Marketplace submission, versioning, forking, trust tiers.
- Building images from the spec; multi-provider concerns.
- Secret management (only declares that secrets are NOT stored here).

## Decisions

- **YAML over JSON/TS for the definition.** Human-authored by environment creators; YAML is the
  norm for devcontainer/compose/CI, lowest authoring friction. Validation happens in TS.
  _Alternative:_ TS config (great DX for us, bad for non-TS creators) — rejected for authoring.
- **Zod as schema + validator in `packages/shared`.** One schema yields both the runtime
  validator and inferred TS types, so web/provider/pod-agent share exactly one contract.
  _Alternative:_ JSON Schema + ajv (language-agnostic, but double-maintains TS types) — defer;
  we can emit JSON Schema from Zod later for non-TS tooling.
- **`base` is a discriminated union**: `{ image: "..." }` | `{ dockerfile: "path" }` |
  `{ devcontainer: "path" }`. Keeps portability explicit and resolution deterministic.
- **Permission preset by name, not inline rules.** `permissions.preset: guarded-open` (default)
  keeps environments terse and lets the platform own/update presets centrally (managed-settings
  precedence). Inline overrides allowed but discouraged.
- **Egress mirrors Anthropic's model** (none/trusted/full/custom) — proven design, and later
  maps directly onto the provider's network policy.
- **ToS guardrails encoded in the validator**, not just docs: a denylist of credential/auth
  fields causes hard validation failure. Makes the constraint executable.
- **Resolver is a pure function** `resolve(envDir) -> ResolvedPod` with no I/O beyond reading
  the dir, so "same input → same output" is testable.

## Risks / Trade-offs

- **v0 too rigid or too loose** → keep the schema additive; unknown fields warn (forward-compat)
  rather than hard-fail, except the credential denylist which always hard-fails.
- **Zod-only excludes non-TS tooling** → acceptable for MVP (we author the first envs); emit
  JSON Schema from Zod when community submission arrives.
- **Portability claim drifts** as we add hosting-only conveniences → enforce with a test that a
  resolved env contains no required hosting-only field.
- **Preset-by-name hides posture from readers** → validator surfaces the effective resolved
  permissions in `resolve()` output for inspection.

## Migration Plan

New capability; nothing to migrate. Deploy = merge `packages/shared` + the example environment.
Rollback = revert the change; no runtime surface depends on it yet.

## Open Questions

- Exact field name for setup steps: `setup` (list of shell strings) vs `build.steps`. Leaning
  `setup:` for v0 simplicity.
- Whether v0 should already model multi-repo pods or defer (leaning: single optional `repo`
  field now, multi-repo later).
