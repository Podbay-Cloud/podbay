import { encryptSecret, decryptSecret } from "@podbay/shared/crypto";

export type QuickAction = "approve" | "later";
interface Payload {
  a: QuickAction;
  u: string;
  exp: number;
}

/**
 * Mint an unforgeable ONE-CLICK action token for an admin email link (Approve / Later).
 *
 * It's the request payload AES-encrypted with the pod's cred key (`PODBAY_CRED_KEY`), so ONLY the
 * server can create or read it — the link in the operator's inbox is a capability, not a guessable
 * URL, and it can't be forged to approve an arbitrary user. `ttlMs` bounds the window. The result may
 * contain URL-unsafe chars; the caller must `encodeURIComponent` it.
 */
export function mintActionToken(
  action: QuickAction,
  userId: string,
  now: number,
  ttlMs: number = 30 * 24 * 60 * 60_000,
): string {
  const payload: Payload = { a: action, u: userId, exp: now + ttlMs };
  return encryptSecret(JSON.stringify(payload));
}

/** Verify + decode an action token. Returns null on tamper, malformed, or expiry. */
export function verifyActionToken(
  token: string,
  now: number,
): { action: QuickAction; userId: string } | null {
  try {
    const p = JSON.parse(decryptSecret(token)) as Payload;
    if ((p.a !== "approve" && p.a !== "later") || typeof p.u !== "string" || typeof p.exp !== "number") {
      return null;
    }
    if (now > p.exp) return null;
    return { action: p.a, userId: p.u };
  } catch {
    return null; // tampered / wrong key / malformed
  }
}
