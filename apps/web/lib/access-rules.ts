/**
 * Pure access rules — no DB, no server-only, so they unit-test directly.
 * A user is allowed if approved, OR their email is an admin, OR pre-approved.
 */
type Env = Record<string, string | undefined>;

function set(csv?: string): Set<string> {
  return new Set(
    (csv ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(email: string, env: Env = process.env): boolean {
  return set(env.ADMIN_EMAILS).has(email.toLowerCase());
}

export function isPreapproved(email: string, env: Env = process.env): boolean {
  return set(env.PREAPPROVE_EMAILS).has(email.toLowerCase());
}

export function isAllowed(u: { email: string; approved: boolean }, env: Env = process.env): boolean {
  return u.approved || isAdmin(u.email, env) || isPreapproved(u.email, env);
}
