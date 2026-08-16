## Context

`control-plane` takes an opaque `ownerId`; nothing produces real ones. This change adds GitHub
OAuth accounts and, because auth must persist users/sessions, the Neon+Drizzle database
foundation the product has deferred. It is the first substantial backend in `apps/web`. The
in-pod AI-subscription login is unrelated and untouched.

## Goals / Non-Goals

**Goals:**
- GitHub OAuth sign-in → real, session-backed Podbay users.
- `packages/db`: Drizzle schema + a driver-by-env connection (Neon prod, pglite test).
- `getCurrentUser()` / `requireUser()` bridging session → `ownerId`.
- DB + bridge tested against pglite; no network, no external DB.

**Non-Goals:**
- Google / email / password providers (GitHub only for the alpha).
- GitHub *App* + repo-access scopes (identity scope only; repo access later).
- Postgres `PodStore` (next change, small — the schema seam is left for it).
- Full dashboard UI; org/team accounts; billing.

## Decisions

- **better-auth (self-hosted) + Drizzle adapter.** Matches the roadmap: TS-native, own the data,
  no per-MAU vendor cost, first-class GitHub OAuth + Drizzle. _Alternatives:_ Auth.js/NextAuth
  (heavier session model, more Next-coupled) or a hosted IdP (Clerk/WorkOS — recurring cost,
  data offsite). better-auth wins for a self-hosted dev tool.
- **Neon serverless in prod, pglite in test**, both via Drizzle, chosen by a connection factory.
  pglite is an in-process Postgres so schema and queries are tested with zero external deps —
  the same pattern (real behavior, no cloud) used for the provider/control-plane. _Alternative:_
  a throwaway Docker Postgres in CI — slower, needs a daemon.
- **`packages/db` owns the schema + connection; `apps/web` owns the auth wiring.** Keeps the
  Drizzle schema importable by the later Postgres `PodStore` without dragging in Next.js.
- **Identity scope only at sign-in.** Request minimal GitHub scopes for login; repo access is a
  separate, explicit consent later (mirrors Anthropic's separate GitHub App) so users aren't
  asked for broad repo scopes just to log in.
- **Secrets are server-only.** GitHub client secret + better-auth secret come from env / Fly
  secrets, read only on the server; never in the repo, never in client bundles. A test asserts
  the config surface doesn't leak them to the client.
- **ownerId = better-auth user id.** No parallel user table; the auth user *is* the owner the
  control plane already keys on.

## Risks / Trade-offs

- **OAuth isn't unit-testable end-to-end** (needs a registered app + browser) → automated tests
  cover the DB, session resolution, and the ownerId bridge; the real GitHub round-trip is a
  documented manual/e2e check once the OAuth app exists.
- **pglite ≠ Neon exactly** (extensions, some SQL nuances) → keep the schema to portable Postgres;
  a later gated test can run migrations against a real Neon branch.
- **Secret leakage** is the highest-severity risk → server-only reads, a client-bundle assertion
  test, and setup docs that put secrets in Fly secrets, not `.env` committed to the repo.
- **Migration drift** between environments → commit generated migrations; apply them on deploy;
  document the `drizzle-kit` flow.
- **Scope creep toward repo access** → explicitly deferred; identity scope only now.

## Migration Plan

New packages + `apps/web` auth wiring; nothing to migrate. Live setup: create a GitHub OAuth app
and a Neon project; set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`,
`DATABASE_URL` as Fly secrets; run migrations on deploy. Rollback = revert; the landing page is
unaffected (auth is additive routes).

## Open Questions

- Session strategy: database sessions vs signed cookies. Leaning DB sessions (revocable sign-out,
  matches "session state in the database" requirement).
- Whether to co-locate the `pods` table in `packages/db` now (empty seam) or add it with the
  Postgres `PodStore` change. Leaning: add it with the PodStore change to keep this change about
  identity.
