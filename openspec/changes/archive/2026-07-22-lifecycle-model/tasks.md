## 1. Env spec: declared lifecycle

- [x] 1.1 `packages/shared/src/schema.ts`: `lifecycle: z.enum([...]).optional()` (auto | awake-hours
  | always-on | scheduled); tests
- [x] 1.2 `resolve.ts`: carry `lifecycle` (default `auto`) onto `ResolvedPod`

## 2. DB + record

- [ ] 2.1 `packages/db/src/schema.ts`: `pods.lifecycle` text NOT NULL default `'auto'`; migration
  generated + **applied to prod Neon** (idempotent `ADD COLUMN IF NOT EXISTS`)
- [x] 2.2 `PodRecord` gains `lifecycle`; store read/write (Drizzle + in-memory) carries it

## 3. Control-plane

- [x] 3.1 `launchPod` sets `lifecycle` from the resolved env; derives `keepAwake` (always-on ⇒ true)
- [x] 3.2 `setLifecycle(ownerId, id, mode)` — owner-scoped; syncs `keepAwake` + provider
- [x] 3.3 Tests: launch sets lifecycle + keepAwake from the env; setLifecycle toggles both;
  always-on pod is not idle-slept; awake-hours/scheduled stored but idle-sleep for now

## 4. Web + verify

- [x] 4.1 `setLifecycle` server action; dashboard card shows the pod's lifecycle (read-only)
- [x] 4.2 `pnpm -r build` + suites green; leak-scan
- [ ] 4.3 Verify: launch an env (declares its lifecycle) → pod record carries it; always-on stays up
