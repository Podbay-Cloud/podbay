## 1. Runner
- [x] 1.1 `packages/db/src/migrate-prod.ts` — tracked + baselined runner (loadMigrations,
  splitStatements, baselineNames, runMigrations); `pg` over DATABASE_URL, TLS on
- [x] 1.2 Unit tests with a fake client (baseline no-exec; apply-after; run-once)

## 2. Wire it
- [x] 2.1 Gateway `fly.toml`: `[deploy] release_command`
- [x] 2.2 Docs: schema changes deploy gateway-first
- [ ] 2.3 Deploy gateway → release_command applies 0007 (lifecycle) automatically → then web
