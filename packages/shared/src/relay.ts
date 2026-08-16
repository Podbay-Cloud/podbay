/**
 * Relay egress tunnel limits — the SINGLE source of truth, so the gateway (which ENFORCES them)
 * and the pod-agent (which REPORTS remaining capacity to `podbay relay check`) can never disagree.
 *
 * These are per the residential relay's realistic headroom: 32 concurrent streams through one
 * owner's home connection is already heavy. A workload that needs more should size its own
 * concurrency to the cap (and read live usage via `podbay relay check`), not push the ceiling up.
 */
export const RELAY_LIMITS = {
  /** Max concurrent tunnel STREAMS a single pod may hold open. */
  maxPerPod: 32,
  /** Max concurrent streams across ALL of one owner's pods. */
  maxPerOwner: 64,
  /** Max tunnel-opens to one destination host per minute (per owner). */
  ratePerDomainPerMin: 120,
} as const;

/** Classify a gateway tunnel-refusal `reason` string into a stable, machine-checkable kind, so a
 * workload can tell a soft, retryable limit (capacity/rate) from a hard "relay is down". */
export type RelayRefusalKind = "capacity" | "rate-limit" | "no-relay" | "unreachable" | "blocked" | "other";

export function classifyRelayRefusal(reason: string | undefined | null): RelayRefusalKind {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("too many open connections")) return "capacity";
  if (r.includes("rate limit")) return "rate-limit";
  if (r.includes("no relay")) return "no-relay";
  if (r.includes("unavailable")) return "unreachable";
  if (r.includes("not allowed") || r.includes("bad target")) return "blocked";
  return "other";
}
