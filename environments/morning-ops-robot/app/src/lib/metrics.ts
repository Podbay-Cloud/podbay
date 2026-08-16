import type { Run } from "./types";

/** Run reliability KPI: succeeded vs. finished runs (running excluded). Failed +
 * stalled both count against — a silently-dead run is a failure. */
export function runSuccess(runs: Run[]): { succeeded: number; total: number } {
  const finished = runs.filter((r) => r.status !== "running");
  const succeeded = finished.filter((r) => r.status === "succeeded").length;
  return { succeeded, total: finished.length };
}

/**
 * Digest streak = consecutive calendar days ending at the most recent digest that
 * each have a digest. Broken (0) if the latest is older than yesterday. Secondary
 * KPI (the motivating one); run success is the primary reliability metric.
 */
export function computeStreak(dates: string[], today = new Date().toISOString().slice(0, 10)): number {
  const have = new Set(dates);
  if (have.size === 0) return 0;
  const latest = [...have].sort().reverse()[0];
  const dayBefore = shiftDate(today, -1);
  if (latest !== today && latest !== dayBefore) return 0;
  let count = 0;
  let cursor = latest;
  while (have.has(cursor)) {
    count += 1;
    cursor = shiftDate(cursor, -1);
  }
  return count;
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
