## Why

Prod DB migrations have been manual (direct SQL against Neon; the drizzle journal is
empty, so `drizzle-kit migrate` would try to re-run everything and fail on existing
tables). That gates every schema change on a hand-applied step and a human with the
Neon connection string. `lifecycle-model` hit exactly this. This adds an automatic,
idempotent, deploy-time migration runner so schema changes ship on their own.

## Decisions

- **A tracked, baselined runner.** `podbay_migrations(name, applied_at)` records applied
  migrations. On the **first** run (empty table) it RECORDS everything through a
  `BASELINE` (`0006_magenta_legion` — what prod already has via direct SQL) **without
  executing** it (those early files aren't re-runnable), then executes only what's after.
  From then on the table is authoritative and each migration runs exactly once.
- **Fly `release_command` on the gateway.** Fly runs it in a temporary machine from the
  new image, with secrets (`DATABASE_URL`), and **aborts the deploy if it fails**. The
  gateway image carries the whole workspace (so `pg` + the `drizzle/*.sql` files are
  present); the web image is a pruned Next standalone and can't run it. **Consequence:
  for schema changes, deploy gateway FIRST (it migrates), then web.**
- **Standard `pg` over the Neon URL, TLS on.** One-shot connect → run → disconnect.
- **Pure, tested core.** `loadMigrations`, `splitStatements`, `baselineNames`,
  `runMigrations(client, …)` are unit-tested with a fake client; the DB round-trip is
  integration-tested by the deploy itself.

## What Changes

- **db**: `packages/db/src/migrate-prod.ts` (runner + helpers); unit tests.
- **gateway**: `[deploy] release_command = "node packages/db/dist/migrate-prod.js"` in
  `fly.toml`.
- **docs**: deploy note — schema changes deploy gateway-first.

## Deferred

- Running migrations from the web image too (would need a non-standalone build or a
  bundled migrator) — unnecessary while gateway-first is the rule.
- Down-migrations / rollback — out of scope; forward-only, additive migrations.
