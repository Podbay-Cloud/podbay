/**
 * Cookie-consent state, shared by the PostHog init and the consent banner so they can
 * never disagree. The choice lives in a first-party, strictly-necessary cookie (exempt
 * from consent itself), read on the client.
 */
export const CONSENT_COOKIE = "pb-cookie-consent";
export type ConsentChoice = "granted" | "denied";

/** The visitor's stored choice, or null if they haven't chosen yet. Client-only. */
export function readConsentFromDocument(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]+)`));
  const v = m ? decodeURIComponent(m[1]!) : null;
  return v === "granted" || v === "denied" ? v : null;
}

/** Persist the choice for a year (strictly-necessary cookie; secure on https). */
export function writeConsentToDocument(choice: ConsentChoice): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
}
