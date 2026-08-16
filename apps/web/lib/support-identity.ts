import { createHmac } from "node:crypto";

/**
 * The identity hash for PostHog Support's verified-identity mode: HMAC-SHA256 of the
 * user's distinct_id (their podbay user id, the same value we `posthog.identify` with)
 * keyed by the team secret. Computed server-side ONLY — the secret never reaches the
 * client; just the hash does, which the widget verifies so a user's support tickets
 * follow them across browsers/devices.
 *
 * Returns null when `POSTHOG_SUPPORT_SECRET` isn't set, so the widget simply runs in
 * unverified (per-browser) mode until the secret exists — no-op, never an error.
 */
export function supportIdentityHash(distinctId: string): string | null {
  const secret = process.env.POSTHOG_SUPPORT_SECRET;
  if (!secret || !distinctId) return null;
  return createHmac("sha256", secret).update(distinctId).digest("hex");
}
