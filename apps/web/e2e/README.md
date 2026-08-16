# End-to-end tests (`pnpm e2e`)

Hermetic Playwright suite that drives the **real** Next.js app in a browser
against an **ephemeral Postgres** (testcontainers) — no Neon, no Fly, no GitHub.

## Run

```bash
# from the repo root (Docker must be running):
pnpm e2e
# or from apps/web:
pnpm e2e            # headless
pnpm e2e:ui         # Playwright UI mode
pnpm exec playwright test e2e/access.spec.ts   # one spec
```

## How it works

`e2e/global-setup.ts` starts a Postgres container, migrates it, boots the Next
server pointed at it (test env below), and waits until it's ready.
`e2e/global-teardown.ts` kills the server and removes the container.

Test env flags (all gated, never in production):
- `PODBAY_DB=pg` + `DATABASE_URL` → the ephemeral Postgres (via `createAppDb`).
- `PODBAY_TEST_LOGIN=1` → email+password sign-in (`login()` helper).
- `PODBAY_FAKE_PROVIDER=1` → in-memory pods (no Fly).
- `ADMIN_EMAILS` / `PREAPPROVE_EMAILS` → decide approval for the seeded test users.

## Coverage

- `access.spec.ts` — anon→signin, landing CTA, unapproved→pending, approved→
  dashboard, admin gating.
- `lifecycle.spec.ts` — launch→ready→dashboard, sleep/wake, delete (removing
  state → gone).
- `admin.spec.ts` — pending signup shows in admin, approve unblocks the user.

**Not yet covered:** the live terminal (browser → gateway → pod-agent). That
needs the gateway + a real pod-agent running in the harness (multi-process); the
terminal client/gateway/pod-agent are unit-tested separately. Tracked as a
follow-up.

## Requirements

- Docker running (testcontainers). Chromium is installed via
  `pnpm exec playwright install chromium`.
