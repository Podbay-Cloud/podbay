import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, getAuth } from "./auth";

/** OSS / self-host single-tenant edition (one owner, no cloud account surfaces). The owner is
 * authenticated by a real session (self-host-auth-gate) — this flag no longer implies "no login". */
export function editionOss(): boolean {
  return process.env.PODBAY_EDITION === "oss";
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  /** Whether the auth provider verified this email. GitHub OAuth always does; a future
   * unverified provider must not clear the admin gate on an allowlist match alone. */
  emailVerified: boolean;
}

/**
 * Resolve the current session to a user, or null. The user id is the `ownerId`
 * used with @podbay/control-plane. Returns null when auth isn't configured, so
 * pages render as logged-out rather than crashing.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Both editions now resolve the same way — a signed-in better-auth session. OSS differs only in
  // HOW you sign in (email+password owner vs GitHub) and is "configured" without GitHub creds
  // (see isAuthConfigured). No more hardcoded local owner: the owner is a real, created account.
  if (!authConfigured()) return null;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const u = session.user;
  return { id: u.id, email: u.email, name: u.name, image: u.image, emailVerified: Boolean(u.emailVerified) };
}

/** Require an authenticated user; redirect to sign-in otherwise. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}
