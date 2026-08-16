/**
 * Best-effort in-memory sliding-window rate limiter for public endpoints (spam / DB-abuse
 * blunting). PER-INSTANCE on Fly — not shared across machines — so it's a speed bump, not a
 * hard guarantee; a durable/edge limiter is the follow-up if abuse actually shows up. Kept
 * dependency-free and bounded in memory.
 */
const buckets = new Map<string, number[]>();

/** Returns true if the action is ALLOWED, false if the key is over `max` within `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic sweep so the map can't grow unbounded from one-off keys.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => t <= cutoff)) buckets.delete(k);
  }
  return true;
}

/** The caller's IP from Fly's headers (fly-client-ip), falling back to x-forwarded-for. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("fly-client-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
