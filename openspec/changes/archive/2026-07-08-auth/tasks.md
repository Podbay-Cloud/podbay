## 1. Database foundation

- [x] 1.1 Create `packages/db` (`@podbay/db`, ESM, tsconfig, vitest); add drizzle-orm,
  `@neondatabase/serverless`, `@electric-sql/pglite`, drizzle-kit
- [x] 1.2 Connection factory: Neon serverless when `DATABASE_URL` is set, pglite in tests;
  a `migrate()` that applies the schema to a fresh in-process DB
- [x] 1.3 Wire into the pnpm workspace

## 2. Auth schema

- [x] 2.1 Drizzle schema for the better-auth tables (user, session, account, verification)
- [x] 2.2 Generate the initial migration (drizzle-kit); commit it
- [x] 2.3 Test: `migrate()` applies the schema on pglite; basic user/session insert+query round-trip

## 3. better-auth wiring (apps/web)

- [x] 3.1 better-auth server config with the Drizzle adapter + GitHub provider (identity scope);
  read `GITHUB_CLIENT_ID/SECRET`, `BETTER_AUTH_SECRET`, `DATABASE_URL` from server env only
- [x] 3.2 Auth API route handler (`/api/auth/[...all]`) and client helpers
- [x] 3.3 DB session strategy (revocable on sign-out)

## 4. Identity bridge

- [x] 4.1 `getCurrentUser()` (session → user id or null) and `requireUser()` (throws/redirects
  when unauthenticated); the returned id is the control-plane `ownerId`
- [x] 4.2 Test the bridge against a seeded session on pglite (authed → id; no session → gated)

## 5. Minimal UI

- [x] 5.1 Sign-in page (GitHub button) and a signed-in state with sign-out; server-guarded
- [x] 5.2 Do NOT expose secrets to the client (server components / server actions only)

## 6. Secret-safety test

- [x] 6.1 Assert the client bundle / config surface does not contain the GitHub secret or auth
  secret

## 7. Docs

- [x] 7.1 `packages/db/README.md` (connection factory, migrations, pglite-in-test) and an auth
  setup guide in `apps/web` (create GitHub OAuth app + Neon project; set Fly secrets; run migrations)
- [x] 7.2 Note in docs/roadmap.md that `auth` + DB foundation is implemented; Postgres PodStore next
