## 1. Package scaffold

- [x] 1.1 Create `packages/shared` (package.json `@podbay/shared`, tsconfig, tsup/tsc build, vitest)
- [x] 1.2 Add `zod` dependency; wire `packages/shared` into the pnpm workspace

## 2. Schema & types

- [x] 2.1 Define the Zod schema for `podbay.yaml` v0: `apiVersion`, `name`, `base` (image |
  dockerfile | devcontainer discriminated union), `agents`, `permissions`, `network`, `env`,
  `setup`, optional `repo`, `metadata`
- [x] 2.2 Export inferred TS types (`Environment`, `ResolvedPod`) as the shared contract
- [x] 2.3 Encode the ToS denylist: hard-fail on any credential / API-key / auth-base-url field
- [x] 2.4 Unknown-field policy: warn (forward-compat) except the denylist which hard-fails

## 3. Validator & resolver

- [x] 3.1 `validateEnvironment(yamlString)` → `{ ok, errors[], warnings[] }`
- [x] 3.2 `resolve(envDir)` pure function → `ResolvedPod` (applies defaults: `network=trusted`,
  `permissions.preset=guarded-open`), reading `.claude/` and optional `repo`
- [x] 3.3 Surface the effective permission preset in the resolver output for inspection

## 4. Tests (against the spec scenarios)

- [x] 4.1 Minimal valid env accepted; missing `name`/`base` rejected with named field
- [x] 4.2 Credential/auth-override field rejected with ToS-violation error
- [x] 4.3 Default posture = guarded-open; default egress = trusted; custom empty allowlist fails
- [x] 4.4 Deterministic resolution: resolve twice → byte-for-byte equal
- [x] 4.5 Portability test: resolved env contains no required hosting-only field

## 5. Reference example

- [x] 5.1 Create `environments/nextjs-starter/` conforming to v0: `podbay.yaml`, `.claude/`
  (CLAUDE.md + a rule + a skill), devcontainer or Dockerfile base, a starter `repo` pointer
- [x] 5.2 Add a workspace check that runs `validateEnvironment` over `environments/*` in CI/test

## 6. Docs

- [x] 6.1 Write `environments/README.md` documenting the v0 fields and defaults (mirrors the spec)
- [x] 6.2 Cross-link the format from docs/roadmap.md (env spec v0 → this capability)
