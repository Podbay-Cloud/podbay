## Why

The self-host (OSS) dashboard has **no login** — `getCurrentUser()` returns a hardcoded `LOCAL_USER`
in OSS mode, so every request is treated as the approved owner. That is fine on a laptop bound to
localhost, but the whole point of the compose install is to run on a **VPS**, where the dashboard and
the terminal WebSocket are reachable by anyone who finds the host. Right now the README hand-waves
this with a "put basic_auth in front" note. We need a real auth gate so an OSS install is safe to
expose.

## What Changes

- Enable better-auth's **email + password** login in the OSS edition (it already ships for cloud via
  GitHub OAuth; the `account.password` column already exists). OSS stops bypassing auth: a signed-in
  session is required to reach the dashboard.
- **First-run setup**: when no owner credential exists yet, the sign-in page shows a *create owner*
  step (set your email + password, or click **generate a strong password** and copy it). Once an owner
  exists, that step closes and the page becomes a normal login. The owner may also pre-seed the
  credential via env (`PODBAY_AUTH_PASSWORD`) so there is **no claim window** on a public VPS.
- `getCurrentUser()` in OSS consults the better-auth session (as cloud does) instead of returning
  `LOCAL_USER`; the single-owner model is preserved (one owner row, `approved: true`).
- The **terminal is covered for free**: `serve` already validates better-auth sessions
  (`getSessionUserId`), so a session-based gate protects the WebSocket terminal, not just the dashboard.
- **Config + secret plumbing**: OSS auth is "configured" without GitHub creds (DB + a session secret +
  email/password enabled). `BETTER_AUTH_SECRET` is generated-and-persisted on the shared data volume
  on first boot (mirroring how `PODBAY_CRED_KEY` is handled in `selfhost/start.sh`), so sessions
  survive restarts without the owner configuring anything.
- **Sign out** works (already wired via `authClient.signOut()`), and the user menu shows the owner.
- README updated: the auth gate replaces the "add basic_auth" workaround; the VPS section documents
  first-run setup and the `PODBAY_AUTH_PASSWORD` pre-seed.

## Capabilities

### New Capabilities
<!-- none — this extends the existing self-host capability -->

### Modified Capabilities
- `self-host`: the single-tenant OSS edition SHALL require an authenticated owner session to access the
  dashboard and terminal, with a first-run owner-setup flow — replacing the current no-login bypass.

## Impact

- **Web**: `apps/web/lib/session.ts` (`getCurrentUser` OSS branch), `apps/web/lib/auth.ts`
  (`authConfigured` for OSS), `packages/auth/src/index.ts` (enable emailPassword plugin), the sign-in
  page/form (`apps/web/app/signin`, `components/signin-form.tsx`), a first-run owner-setup server
  action, the user menu.
- **Auth/session**: no schema change — reuses `user`/`session`/`account` tables (the `password` column
  already exists). New env: `PODBAY_AUTH_PASSWORD` (optional pre-seed).
- **Install**: `selfhost/start.sh` generates+persists `BETTER_AUTH_SECRET`; `selfhost/compose.yaml`
  `x-app-env` passes it (and the optional password) to `web` + `serve`; `selfhost/README.md`.
- **Gateway/serve**: no code change expected — it already validates better-auth sessions; verify it
  rejects unauthenticated terminal connections in OSS.
- **Security-sensitive**: this is an auth boundary — timing-safe credential checks (delegated to
  better-auth), no credential logging, and the first-run flow must close after the owner is created.
