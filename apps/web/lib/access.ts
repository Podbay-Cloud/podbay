import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createAppDb, user as userTable, session as sessionTable, pods as podsTable } from "@podbay/db";
import { getCurrentUser, editionOss, type CurrentUser } from "./session";
import { isAdmin, isPreapproved } from "./access-rules";

async function fetchApproved(id: string): Promise<boolean> {
  const rows = await createAppDb()
    .select({ approved: userTable.approved })
    .from(userTable)
    .where(eq(userTable.id, id));
  return rows[0]?.approved ?? false;
}

/** Require an approved (or admin/pre-approved) user; pending users go to /pending. */
export async function requireApprovedUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // OSS is single-tenant: a signed-in user IS the owner. The invite/approval gate is a cloud
  // concept (and `approved` is a custom column better-auth doesn't persist on sign-up), so never
  // send the self-host owner to /pending.
  if (editionOss()) return user;
  if (isAdmin(user.email) || isPreapproved(user.email)) return user;
  if (!(await fetchApproved(user.id))) redirect("/pending");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Defense-in-depth: admin requires BOTH an allowlisted email AND a verified one. Today's
  // GitHub-OAuth-only sign-in always verifies, but a future unverified provider must never
  // reach admin on an allowlist match alone.
  if (!isAdmin(user.email) || !user.emailVerified) redirect("/dashboard");
  return user;
}

/** Whether a given signed-in user is allowed into the product. */
export async function isUserAllowed(user: CurrentUser): Promise<boolean> {
  if (editionOss()) return true; // single-tenant: the signed-in user is the owner
  return isAdmin(user.email) || isPreapproved(user.email) || (await fetchApproved(user.id));
}

/** Is the current signed-in user allowed? (for pages that branch rather than redirect) */
export async function currentUserAllowed(): Promise<{ user: CurrentUser | null; allowed: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false };
  return { user, allowed: await isUserAllowed(user) };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  approved: boolean;
  createdAt: string;
}

/** Admins and pre-approved emails bypass the `approved` column (they're allowed
 * by email rule), so their column stays false — which made them show up as
 * "pending" in the backoffice. Treat access as EFFECTIVE approval everywhere the
 * admin UI reasons about status. */
function effectiveApproved(email: string, approved: boolean): boolean {
  return approved || isAdmin(email) || isPreapproved(email);
}

/** One user's identity (email + name) by id — for the admin pod drill-in, so the
 * Owner row shows who the pod belongs to instead of an opaque id. Null if gone. */
export async function getUserById(id: string): Promise<{ email: string; name: string } | null> {
  const rows = await createAppDb().select().from(userTable).where(eq(userTable.id, id));
  return rows[0] ? { email: rows[0].email, name: rows[0].name } : null;
}

/** All users, pending first then oldest-first, for the admin page. */
export async function listUsers(): Promise<AdminUser[]> {
  const rows = await createAppDb().select().from(userTable);
  return rows
    .map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      approved: effectiveApproved(r.email, r.approved),
      createdAt: r.createdAt.toISOString(),
    }))
    .sort((a, b) => Number(a.approved) - Number(b.approved) || a.createdAt.localeCompare(b.createdAt));
}

export interface AdminUserDetail extends AdminUser {
  emailVerified: boolean;
  lastLoginAt: string | null;
  loginCount: number;
  lastIp: string | null;
  /** Median-ish signal is overkill; the newest session's lifetime span in ms. */
  lastSessionMs: number | null;
  podCount: number;
  /** No billing yet — every alpha user is on the free invite plan. */
  subscription: "alpha";
}

/**
 * Rich per-user view for /admin/users: registration, login recency + count (from
 * the session table), last IP, and pod count. Subscription is a placeholder until
 * billing exists. Three cheap table scans assembled in JS — fine at alpha scale.
 */
export async function listUsersDetailed(): Promise<AdminUserDetail[]> {
  const db = createAppDb();
  const [users, sessions, pods] = await Promise.all([
    db.select().from(userTable),
    db
      .select({
        userId: sessionTable.userId,
        createdAt: sessionTable.createdAt,
        expiresAt: sessionTable.expiresAt,
        ipAddress: sessionTable.ipAddress,
      })
      .from(sessionTable),
    db.select({ ownerId: podsTable.ownerId }).from(podsTable),
  ]);

  const byUser = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  const podCounts = new Map<string, number>();
  for (const p of pods) podCounts.set(p.ownerId, (podCounts.get(p.ownerId) ?? 0) + 1);

  return users
    .map((u) => {
      const us = (byUser.get(u.id) ?? []).slice().sort((a, b) => +b.createdAt - +a.createdAt);
      const latest = us[0] ?? null;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        approved: effectiveApproved(u.email, u.approved),
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: latest ? latest.createdAt.toISOString() : null,
        loginCount: us.length,
        lastIp: latest?.ipAddress ?? null,
        lastSessionMs: latest ? +latest.expiresAt - +latest.createdAt : null,
        podCount: podCounts.get(u.id) ?? 0,
        subscription: "alpha" as const,
      };
    })
    .sort(
      (a, b) =>
        Number(a.approved) - Number(b.approved) ||
        (b.lastLoginAt ?? "").localeCompare(a.lastLoginAt ?? ""),
    );
}
