/**
 * How a Claude login is refreshed when it is expiring or expired, chosen by the pod's auth MODE
 * (t3-unattended-integration §5.1). The two are not interchangeable:
 *
 * - **subscription** → `reconnect`: a full re-login. It signs the agent OUT and starts a fresh
 *   sign-in, interrupting the session — so it is always confirmed first (there is no way to extend a
 *   refresh token past its hard expiry).
 * - **setup-token** → `renew`: mint a fresh ~1-year `setup-token` NON-destructively. The existing
 *   credential keeps working until the new token lands, so there is no forced sign-out — the
 *   session-interrupt warning of the reconnect path would be wrong here.
 *
 * Pure so the routing is unit-pinned without rendering the cockpit. A pod with no explicit mode
 * (`null`/subscription/api-key) takes the reconnect path — only an explicit setup-token pod renews.
 */
export function claudeReauthMode(
  agentAuth: "subscription" | "api-key" | "setup-token" | null | undefined,
): "renew" | "reconnect" {
  return agentAuth === "setup-token" ? "renew" : "reconnect";
}
