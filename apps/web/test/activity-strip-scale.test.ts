import { describe, it, expect } from "vitest";
import { medianStep } from "@/components/pod-stats";
import { activityShare } from "@/lib/activity-share";
import type { MetricSample } from "@podbay/shared";

const MIN = 60_000;
const at = (t: number, agentStatus: MetricSample["agentStatus"] = "idle"): MetricSample => ({
  t, cpuPct: 1, memUsedMb: 1, memTotalMb: 2, diskUsedMb: 1, diskTotalMb: 2,
  netRxKbps: 0, netTxKbps: 0, agentStatus,
});

describe("gap detection across rollup tiers", () => {
  it("treats a coarse tier's own spacing as normal, not as a suspension", () => {
    // A 7d view arrives at 5-minute resolution. Judged against the 60s base
    // interval every point would read as a gap and the chart would be all dashes.
    const hourly = [0, 1, 2, 3, 4].map((i) => at(i * 60 * MIN).t);
    expect(medianStep(hourly)).toBe(60 * MIN);
  });

  it("a real suspension does not raise the bar enough to hide later gaps", () => {
    // Median, not mean: one 3-day gap in an hour-resolution series would drag a
    // mean past every subsequent gap.
    const t = [0, MIN, 2 * MIN, 3 * 24 * 60 * MIN, 3 * 24 * 60 * MIN + MIN];
    expect(medianStep(t)).toBe(MIN);
  });
});

describe("activity shares are weighted by time, not sample count", () => {
  it("an hour of idle outweighs a busy minute", () => {
    // Tiered history: one hourly sample stands for 60× a minute sample. Counting
    // samples would call this pod 50% busy.
    const series = [at(0, "idle"), at(60 * MIN, "busy"), at(61 * MIN, "busy")];
    const a = activityShare(series)!;
    expect(a.idlePct).toBeGreaterThan(90);
    expect(a.busyPct).toBeLessThan(10);
  });

  it("does not credit or blame the time a pod was suspended", () => {
    // Three days of nothing recorded must not become three days of "idle".
    const series = [at(0, "busy"), at(MIN, "busy"), at(3 * 24 * 60 * MIN, "idle"), at(3 * 24 * 60 * MIN + MIN, "idle")];
    const a = activityShare(series)!;
    expect(a.activePct).toBeGreaterThan(30);
  });

  it("reports busy and shell apart but active together", () => {
    const a = activityShare([at(0, "busy"), at(MIN, "shell"), at(2 * MIN, "idle"), at(3 * MIN, "idle")])!;
    expect(a.busyPct).toBe(25);
    expect(a.shellPct).toBe(25);
    expect(a.activePct).toBe(50);
  });
});
