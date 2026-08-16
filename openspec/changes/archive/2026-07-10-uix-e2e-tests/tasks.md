## 1. Hermetic stack seams

- [x] 1.1 `@podbay/db`: pglite mode behind `PODBAY_DB=pglite` (dev/test only) so the app runs
  with zero external DB
- [x] 1.2 `@podbay/auth`: test credentials sign-in enabled only when `PODBAY_TEST_LOGIN=1` and
  not production; unit test proves it's absent otherwise
- [x] 1.3 `apps/web`: fake provider mode (in-memory pods) behind `PODBAY_FAKE_PROVIDER=1`;
  gateway `resolveAgentUrl` → local pod-agent address in test mode

## 2. Harness

- [x] 2.1 Add `@playwright/test`; `apps/web/e2e/` with global setup that boots web (test env),
  gateway, and a local pod-agent (tmux) and tears them down
- [x] 2.2 `pnpm e2e` root script; seed helpers (create admin user, approve user, create pod)

## 3. Flow specs

- [x] 3.1 Access: landing CTA → test sign-in → pending gate → admin approve → dashboard;
  sign-out; direct-URL gating (dashboard/new/pods/admin) for anon + unapproved
- [x] 3.2 Launch: /new → launch → routed to /pods/:slug → pod ready → appears on dashboard;
  live terminal (terminal.spec.ts) connects through a REAL gateway + REAL pod-agent
  (tmux, plain shell) and a typed command echoes back.
- [x] 3.3 Lifecycle: sleep → wake from dashboard; delete shows removing state, row disappears;
  failed delete surfaces error and restores the card
- [x] 3.4 Admin: pending list shows signup, approve/revoke updates state, non-admin blocked

## 4. Convention + wiring

- [x] 4.1 Add "user-flow changes ship with e2e flow specs" to `openspec/project.md` conventions
- [x] 4.2 Document `pnpm e2e` in README/docs; note CI wiring as follow-up when CI exists

## 5. Verify

- [x] 5.1 Full suite green locally from a clean checkout (`pnpm i && pnpm e2e`)
- [x] 5.2 Intentionally break a flow (e.g. gate) and confirm the suite fails

## Resolution (2026-07-10)

- DB: ephemeral Postgres via testcontainers (pglite can't run inside Next). The
  harness boots pg + a real pod-agent + a real gateway + the Next server, all
  hermetically. Full suite: 12 specs green (access 6, lifecycle 3, admin 2,
  live-terminal 1). `pnpm e2e` requires Docker.
