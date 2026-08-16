import { describe, it, expect } from "vitest";
import { rollup, compact, windowed, tierFor, TIERS, MINUTE, HOUR, DAY } from "../src/rollup.js";
import type { MetricSample } from "@podbay/shared";

const T = 1_800_000_000_000;
const s = (t: number, o: Partial<MetricSample> = {}): MetricSample => ({
  t,
  cpuPct: 0,
  memUsedMb: 100,
  memTotalMb: 1000,
  diskUsedMb: 500,
  diskTotalMb: 5000,
  netRxKbps: 0,
  netTxKbps: 0,
  agentStatus: null,
  ...o,
});

describe("rollup", () => {
  it("keeps the PEAK of a rate, because the spike is why you kept history", () => {
    const folded = rollup([s(T, { cpuPct: 5 }), s(T + 1000, { cpuPct: 92 }), s(T + 2000, { cpuPct: 7 })], MINUTE);
    expect(folded).toHaveLength(1);
    expect(folded[0].cpuPct).toBe(92); // an average (34) would hide it entirely
  });

  it("keeps the LAST value of a level — the average of a level never existed", () => {
    const folded = rollup([s(T, { memUsedMb: 100 }), s(T + 1000, { memUsedMb: 800 })], MINUTE);
    expect(folded[0].memUsedMb).toBe(800);
  });

  it("an hour containing work is not an idle hour", () => {
    const folded = rollup(
      [s(T, { agentStatus: "idle" }), s(T + 1000, { agentStatus: "busy" }), s(T + 2000, { agentStatus: "idle" })],
      HOUR,
    );
    expect(folded[0].agentStatus).toBe("busy");
  });

  it("stamps the bucket START, so a point means a period not a moment", () => {
    const folded = rollup([s(T + 30_000), s(T + 45_000)], MINUTE);
    expect(folded[0].t).toBe(Math.floor(T / MINUTE) * MINUTE);
  });

  it("does NOT invent empty buckets — a gap means the pod wasn't running", () => {
    // Zero-filling would turn "suspended" into "running and doing nothing".
    const folded = rollup([s(T), s(T + 10 * MINUTE)], MINUTE);
    expect(folded).toHaveLength(2);
    expect(folded[1].t - folded[0].t).toBe(10 * MINUTE);
  });
});

describe("tiers", () => {
  it("picks the finest tier that covers the window", () => {
    expect(tierFor(HOUR).bucketMs).toBe(MINUTE);
    expect(tierFor(DAY).bucketMs).toBe(MINUTE);
    expect(tierFor(3 * DAY).bucketMs).toBe(5 * MINUTE);
    expect(tierFor(30 * DAY).bucketMs).toBe(HOUR);
    expect(tierFor(400 * DAY).bucketMs).toBe(HOUR); // never wider than the coarsest
  });

  it("compaction keeps recent detail and folds only what is older", () => {
    const now = T;
    const raw = [
      s(now - 10 * MINUTE, { cpuPct: 11 }),      // inside 24h → untouched
      s(now - 2 * DAY, { cpuPct: 22 }),          // 24h–7d → 5-minute buckets
      s(now - 2 * DAY + 60_000, { cpuPct: 90 }),
      s(now - 10 * DAY, { cpuPct: 33 }),         // 7d–30d → hourly
    ];
    const out = compact(raw, now);
    expect(out.find((x) => x.cpuPct === 11), "recent sample kept").toBeTruthy();
    // The two mid-age samples are 1 minute apart, so they fold into ONE 5-minute
    // bucket carrying the PEAK — 22 is correctly gone, which is the whole point of
    // rolling up. (My first version of this test asserted 22 still existed, which
    // contradicted its own comment.)
    const mid = out.filter((x) => x.t >= now - 2 * DAY - 5 * MINUTE && x.t <= now - 2 * DAY + 5 * MINUTE);
    expect(mid).toHaveLength(1);
    expect(mid[0].cpuPct).toBe(90);
    expect(mid[0].t % (5 * MINUTE)).toBe(0);
    expect(out.some((x) => x.cpuPct === 33 && x.t % HOUR === 0)).toBe(true);
    expect(out.length).toBeLessThan(raw.length + 1);
  });

  it("keeps the sample just taken (t === now) — it must not vanish on its own tick", () => {
    const now = T;
    expect(compact([s(now, { cpuPct: 42 })], now).map((x) => x.cpuPct)).toEqual([42]);
    // …and one from a clock a second ahead
    expect(compact([s(now + 1000)], now)).toHaveLength(1);
  });

  it("drops anything older than the coarsest window", () => {
    const now = T;
    expect(compact([s(now - 60 * DAY)], now)).toHaveLength(0);
  });

  it("the whole tiered history is far smaller than a month at full resolution", () => {
    const budget = TIERS.reduce((n, t, i) => {
      const prev = i === 0 ? 0 : TIERS[i - 1].windowMs;
      return n + (t.windowMs - prev) / t.bucketMs;
    }, 0);
    expect(budget).toBeLessThan(5000);
    expect(30 * DAY / MINUTE).toBeGreaterThan(40_000); // what we avoided
  });
});

describe("windowed", () => {
  it("serves a short window at full resolution", () => {
    const now = T;
    const raw = [s(now - 30 * MINUTE), s(now - 20 * MINUTE), s(now - MINUTE)];
    expect(windowed(raw, HOUR, now)).toHaveLength(3);
  });

  it("folds a long window, and excludes what falls outside it", () => {
    const now = T;
    const raw = [s(now - 40 * DAY), s(now - 3 * DAY), s(now - 3 * DAY + 60_000)];
    const out = windowed(raw, 7 * DAY, now);
    expect(out.every((x) => x.t >= now - 7 * DAY)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
