import { describe, it, expect } from "vitest";
import { narrowSnapshot } from "../src/provider.js";
import type { MetricsSnapshot, MetricSample } from "@podbay/shared";

const MIN = 60_000;
const at = (t: number): MetricSample => ({
  t, cpuPct: 1, memUsedMb: 1, memTotalMb: 2, diskUsedMb: 1, diskTotalMb: 2,
  netRxKbps: 0, netTxKbps: 0, agentStatus: "idle",
});
const snap = (series: MetricSample[]): MetricsSnapshot =>
  ({ series, sampleIntervalMs: MIN, disk: { path: "/", usedMb: 1, totalMb: 2, breakdown: [] }, app: { port: 3000, listening: true } }) as never;

/**
 * A client must not require the fleet to update before it works.
 *
 * Adding `?windowMs=` to /metrics 404s on any pod running an older pod-agent, which
 * matches the path exactly — so the Stats tab read "metrics aren't available yet"
 * on pods whose data was fine (live find: cheerful-donkey-6bc4, 2026-07-29). The
 * provider falls back to the plain endpoint and narrows the series itself.
 */
describe("narrowSnapshot — the old-agent fallback", () => {
  it("keeps only the requested window", () => {
    const series = Array.from({ length: 120 }, (_, i) => at(i * MIN));
    const out = narrowSnapshot(snap(series), 30 * MIN);
    expect(out.series.length).toBe(31); // inclusive of the boundary sample
    expect(out.series[0]!.t).toBe(89 * MIN);
  });

  it("anchors on the newest SAMPLE, not on now()", () => {
    // A suspended pod stopped recording days ago. Anchoring on now() would return an
    // empty window and read as "no metrics" — the bug this whole fix is about.
    const old = [at(1_000), at(1_000 + MIN)];
    expect(narrowSnapshot(snap(old), 60 * MIN).series.length).toBe(2);
  });

  it("leaves an empty series alone rather than inventing a shape", () => {
    expect(narrowSnapshot(snap([]), MIN).series).toEqual([]);
  });
});
