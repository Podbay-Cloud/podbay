import posthog from "posthog-js";

/**
 * Fire an analytics event that can NEVER break the thing it measures.
 *
 * Every client-side `posthog.capture(...)` in this app sat as the first statement of a
 * handler whose real work came next — sign-in, launch, suspend, resume, update, delete,
 * waitlist submit. So anything capture can throw (an uninitialised client, a missing or
 * blocked token, an adblocker, a browser extension) took the user's action with it, and the
 * UI simply appeared to ignore the click. The server side already states this rule in
 * `lib/actions.ts`: "Analytics must never be able to fail — or slow — the operation it
 * observes." This is the client half.
 *
 * Deliberately swallows: there is no user-facing recovery for a lost metric, and surfacing
 * one would be strictly worse than the missing datapoint.
 */
export function track(event: string, props: Record<string, unknown> = {}): void {
  try {
    posthog.capture(event, props);
  } catch {
    /* a dropped metric is never worth a broken action */
  }
}
