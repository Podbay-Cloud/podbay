## Why

`control-plane` enforces ownership but `ownerId` is an opaque string — there are no real users
yet. Every user-facing surface (dashboard, terminal gateway) needs to know *who* is signed in.
This change adds **Podbay account authentication via GitHub OAuth**, turning opaque owner ids
into real, session-backed identities. Because authentication must persist users and sessions, it
also stands up the **database foundation** (Neon Postgres + Drizzle) that the rest of the product
has been deferring — which in turn unblocks a real `PodStore`. GitHub is the right (and, for the
dev alpha, only) provider: it's the identity every developer already has, and the same account
later unlocks pod repo access.

## What Changes

- New package `packages/db` (`@podbay/db`): Drizzle schema + a connection factory that uses **Neon
  serverless in production and in-process Postgres (pglite) in tests**, so DB code is verifiable
  without an external database.
- **Auth schema**: the tables better-auth requires (user, session, account, verification).
- **better-auth** configured in `apps/web` with the **GitHub OAuth** provider (identity scope
  only for now); the auth API route, sign-in and sign-out.
- **Identity → ownerId bridge**: a `getCurrentUser()` / `requireUser()` helper resolving the
  session to a user id, which becomes the `ownerId` passed to `PodService`.
- Minimal sign-in / signed-in UI in `apps/web` (a real dashboard is a later change).
- Tests: schema + user/session queries + the ownerId bridge against **pglite** (no network). Real
  GitHub OAuth is verified manually/e2e once the OAuth app exists.

Security: **no passwords** — authentication is delegated to GitHub. Podbay stores no passwords.
The GitHub client secret and the better-auth secret are server-only config (Fly secrets), never
in the repo. This change never touches the in-pod AI-subscription login (that stays the user's,
inside the pod).

## Capabilities

### New Capabilities
- `auth`: GitHub-OAuth Podbay accounts, session management, the identity→ownerId bridge, and the
  Neon/Drizzle database foundation with a testable connection abstraction.

### Modified Capabilities
<!-- None. control-plane is unchanged; it already takes an ownerId. -->

## Impact

- New package `packages/db` (`@podbay/db`): Drizzle, `@neondatabase/serverless` (prod),
  `@electric-sql/pglite` (test), migration tooling.
- `apps/web` gains better-auth server config, the `/api/auth/*` route, session middleware/helper,
  and a sign-in page. This is the first substantial backend in `apps/web` beyond the landing.
- Unblocks: a real Postgres `PodStore` (next), and every authenticated surface (terminal gateway,
  dashboard).
- **Requires user setup before the live path**: a GitHub OAuth app (client id + secret) and a Neon
  project (connection string), supplied as Fly secrets. Code + tests run without them.
- Non-goals (explicit): Google / email / password providers (GitHub only for the alpha); the
  GitHub *App* + repo-access scopes (identity scope only now — repo access is a later change); the
  Postgres `PodStore` implementation (next, small, now that Drizzle exists); the full dashboard
  UI; org/team accounts and billing.
