import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";

// The bot's PUBLIC preview means anyone can reach it — so the owner console and the
// document write operations are gated behind ADMIN_PASSWORD (a per-pod secret set in
// the dashboard). Until it's set, the console is locked (never publicly editable).
//
// The cookie stores a hash of the password, not the password itself. Single-tenant
// pod, httpOnly cookie — enough for v1; not a multi-user auth system.

const COOKIE = "dq_admin";

function token(pw: string): string {
  return createHash("sha256").update(`doc-qa:${pw}`).digest("hex");
}

/** Whether an owner password has been configured at all. */
export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

/** True if the caller holds a valid owner cookie. */
export async function isAdmin(): Promise<boolean> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && c === token(pw);
}

/** Set the owner cookie if the password matches. Returns whether it matched. */
export async function login(password: string): Promise<boolean> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || password !== pw) return false;
  (await cookies()).set(COOKIE, token(pw), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
