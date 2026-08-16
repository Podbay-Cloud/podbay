## Why

Every user-facing bug so far (auth cookie loop, terminal drop, delete crash, onboarding
friction) was found by a human clicking around in production. We need automated browser tests
that walk every user flow — sign-in, gating, launch, terminal, lifecycle, delete, admin — so
regressions are caught before deploy, and every future flow lands with a test.

## What Changes

- **Test harness** (`apps/web/e2e/`): Playwright driving the real Next.js app against a
  hermetic local stack — pglite DB, in-memory/fake sandbox provider, a real gateway and a real
  `pod-agent` (tmux) running locally, so the terminal path is tested genuinely, not mocked.
- **Test login**: a test-only credentials sign-in (enabled solely via `PODBAY_TEST_LOGIN=1`,
  never in production config) so flows run without GitHub OAuth; production build refuses the
  flag unless `NODE_ENV=test`.
- **Flow specs** covering current behavior: landing → request access → pending gate → admin
  approve → dashboard → launch → terminal connects and echoes → link chips → sleep/wake →
  delete (with pending state) → sign-out; plus admin page and access denial paths.
- **Convention**: every future opsx change that adds/changes a user flow MUST add or update a
  flow spec (stated in `openspec/project.md`).
- **CI hook**: single `pnpm e2e` entrypoint that boots the stack, runs Playwright headless, and
  tears down — ready to wire into CI when a remote/CI provider is chosen.

## Capabilities

### New: `uix-e2e-tests`

A hermetic Playwright suite that exercises every user flow end-to-end in a browser, runnable
locally with one command.

## Impact

- New devDeps: `@playwright/test` (apps/web). New `apps/web/e2e/` tree + `pnpm e2e` script.
- Small seams behind env flags: pglite DB mode in `@podbay/db`, test login in `@podbay/auth`
  (both no-ops in production).
- `openspec/project.md` gains the "flows ship with flow tests" convention.
