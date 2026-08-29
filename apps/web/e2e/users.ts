/** Plain test constants — NO workspace imports, so the Playwright config (loaded
 * via CJS) can import this without pulling in ESM-only packages. */
export const USERS = {
  admin: { email: "admin@podbay.test", password: "test-password-123", name: "Admin" },
  approved: { email: "approved@podbay.test", password: "test-password-123", name: "Approved" },
  pending: { email: "pending@podbay.test", password: "test-password-123", name: "Pending" },
} as const;

export const ADMIN_EMAILS = USERS.admin.email;
export const PREAPPROVE_EMAILS = `${USERS.admin.email},${USERS.approved.email}`;

/**
 * Naming defaults only — NOT a connection string.
 *
 * There used to be a `url` getter here (`postgresql://podbay:podbay@localhost:54329/podbay_e2e`)
 * described as "fixed ephemeral-Postgres coordinates". It never matched reality: global-setup starts
 * `new PostgreSqlContainer(...)` with no fixed port binding, so testcontainers assigns a RANDOM host
 * port and its own credentials, and passes that real URL to the app as DATABASE_URL. Anything using
 * the constant therefore connected to a dead port — `ECONNREFUSED 127.0.0.1:54329`, which failed
 * cockpit.spec.ts's walkthrough test on every CI run and read as a mystery "e2e flake" (it blocked
 * PR #49, 2026-08-27).
 *
 * The getter is deliberately gone rather than corrected: no constant CAN name a random port. Tests
 * needing their own connection read `dbUrl` from `.e2e-state.json` (see helpers.ts).
 */
export const DB = {
  name: "podbay_e2e",
};
