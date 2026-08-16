/** Plain test constants — NO workspace imports, so the Playwright config (loaded
 * via CJS) can import this without pulling in ESM-only packages. */
export const USERS = {
  admin: { email: "admin@podbay.test", password: "test-password-123", name: "Admin" },
  approved: { email: "approved@podbay.test", password: "test-password-123", name: "Approved" },
  pending: { email: "pending@podbay.test", password: "test-password-123", name: "Pending" },
} as const;

export const ADMIN_EMAILS = USERS.admin.email;
export const PREAPPROVE_EMAILS = `${USERS.admin.email},${USERS.approved.email}`;

/** Fixed ephemeral-Postgres coordinates so the Playwright config can hardcode
 * DATABASE_URL (see global-setup.ts). Host port chosen to avoid clashes. */
export const DB = {
  name: "podbay_e2e",
  user: "podbay",
  password: "podbay",
  port: 54329,
  get url() {
    return `postgresql://${this.user}:${this.password}@localhost:${this.port}/${this.name}`;
  },
};
