import type { MetricSample } from "@podbay/shared";

/**
 * Tiered history: full detail recently, coarser further back.
 *
 * Keeping a month at 1-minute resolution is ~43,000 samples shipped on EVERY
 * /metrics read — the payload is the binding constraint, not disk. Tiers give 30×
 * the reach in a SMALLER payload than today's single 24h ring.
 *
 * The trade is real and irreversible per pod: once a minute is folded into an
 * hour, that minute is gone. So the aggregation has to be right, which is why it
 * lives here as a pure function rather than inside the sampler's tick.
 */
export interface Tier {
  /** Bucket width. Samples inside one bucket are folded into a single sample. */
  bucketMs: number;
  /** How far back this tier reaches. */
  windowMs: number;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 1min/24h · 5min/7d · 1h/30d — about 4,200 samples in total. */
export const TIERS: Tier[] = [
  { bucketMs: MINUTE, windowMs: DAY },
  { bucketMs: 5 * MINUTE, windowMs: 7 * DAY },
  { bucketMs: HOUR, windowMs: 30 * DAY },
];

/** The coarsest tier that covers a requested window (so a 7-day view doesn't ship
 * a month of hourly points, and a 1-hour view keeps full detail). */
export function tierFor(windowMs: number): Tier {
  return TIERS.find((t) => windowMs <= t.windowMs) ?? TIERS[TIERS.length - 1];
}

/**
 * Fold samples into buckets of `bucketMs`.
 *
 * Aggregation is per-metric on purpose:
 *  - **cpu / network** take the MAX in the bucket. Averaging hides the spike that
 *    made someone look, which is the entire reason to keep history.
 *  - **memory / disk** take the LAST value: they are levels, not rates, and the
 *    average of a level across an hour is a number that never existed.
 *  - **agentStatus** takes "busy" if the agent was busy at ANY point in the bucket —
 *    an hour containing work is not an idle hour.
 *
 * A bucket with no samples is NOT emitted. Gaps are real (a suspended pod records
 * nothing) and the charts draw them as breaks; inventing zero-filled buckets would
 * turn "we weren't running" into "we were running and doing nothing".
 */
export function rollup(samples: MetricSample[], bucketMs: number): MetricSample[] {
  if (bucketMs <= 0 || samples.length === 0) return [...samples];
  const buckets = new Map<number, MetricSample[]>();
  for (const s of samples) {
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const arr = buckets.get(key);
    if (arr) arr.push(s);
    else buckets.set(key, [s]);
  }
  const out: MetricSample[] = [];
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const group = buckets.get(key)!;
    const last = group[group.length - 1];
    out.push({
      // Stamp the bucket START, so a point's time means "this period", not "the
      // moment of the last reading inside it".
      t: key,
      cpuPct: Math.max(...group.map((g) => g.cpuPct)),
      netRxKbps: Math.max(...group.map((g) => g.netRxKbps)),
      netTxKbps: Math.max(...group.map((g) => g.netTxKbps)),
      memUsedMb: last.memUsedMb,
      memTotalMb: last.memTotalMb,
      diskUsedMb: last.diskUsedMb,
      diskTotalMb: last.diskTotalMb,
      agentStatus: group.some((g) => g.agentStatus === "busy")
        ? "busy"
        : (group.find((g) => g.agentStatus)?.agentStatus ?? last.agentStatus),
    });
  }
  return out;
}

/**
 * Compact a full-resolution ring into the tiers, newest-first precedence: recent
 * samples keep their detail, older ones are folded once and never again (folding a
 * rolled-up sample repeatedly would drift its timestamps and re-max its peaks).
 */
export function compact(samples: MetricSample[], now: number): MetricSample[] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const oldest = now - TIERS[TIERS.length - 1].windowMs;
  const kept: MetricSample[] = [];
  let prevWindow = 0;
  for (const tier of TIERS) {
    const from = now - tier.windowMs;
    // The finest tier is open-ended at the top: `now - 0` would EXCLUDE the sample
    // just taken (t === now), so the newest reading vanished on every tick — and a
    // clock a second ahead would drop samples too.
    const to = prevWindow === 0 ? Infinity : now - prevWindow;
    const slice = sorted.filter((s) => s.t >= Math.max(from, oldest) && s.t < to);
    // The finest tier keeps raw samples; coarser tiers fold their slice.
    kept.push(...(tier.bucketMs === TIERS[0].bucketMs ? slice : rollup(slice, tier.bucketMs)));
    prevWindow = tier.windowMs;
  }
  return kept.sort((a, b) => a.t - b.t);
}

/** Samples inside a requested window, at that window's resolution. */
export function windowed(samples: MetricSample[], windowMs: number, now: number): MetricSample[] {
  const from = now - windowMs;
  const slice = samples.filter((s) => s.t >= from);
  const tier = tierFor(windowMs);
  // Already-coarse history is left alone; re-folding it would be a no-op at best.
  return tier.bucketMs === TIERS[0].bucketMs ? slice : rollup(slice, tier.bucketMs);
}
