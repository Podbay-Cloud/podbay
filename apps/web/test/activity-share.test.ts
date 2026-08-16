import { describe, it, expect } from "vitest";
import { activityShare } from "@/lib/activity-share";
import type { MetricSample } from "@podbay/shared";

const s = (agentStatus: string | null, t = 0): MetricSample => ({
  t,
  cpuPct: 0,
  memUsedMb: 0,
  memTotalMb: 0,
  diskUsedMb: 0,
  diskTotalMb: 0,
  netRxKbps: 0,
  netTxKbps: 0,
  agentStatus,
});

describe("activity share", () => {
  it("says nothing when no sample carried a state — silence is not idleness", () => {
    // Reporting 0% busy here would read as "this pod does nothing", when the truth
    // is "we don't know what it was doing".
    expect(activityShare([])).toBeNull();
    expect(activityShare([s(null), s(null)])).toBeNull();
  });

  it("splits busy / waiting / idle, and keeps waiting SEPARATE", () => {
    // waiting = waiting on the user. Counting it as busy flatters the pod;
    // counting it as idle libels it.
    const share = activityShare([s("busy"), s("busy"), s("waiting"), s("idle")])!;
    expect(share).toMatchObject({ samples: 4, busyPct: 50, waitingPct: 25, idlePct: 25 });
  });

  it("ignores samples with no state rather than counting them as idle", () => {
    const share = activityShare([s("busy"), s(null), s(null)])!;
    expect(share.samples).toBe(1);
    expect(share.busyPct).toBe(100);
  });

  it("reports the most recent known state", () => {
    expect(activityShare([s("busy", 1), s("idle", 2)])!.latest).toBe("idle");
    // …skipping unknowns, so a momentary gap doesn't erase what we last saw
    expect(activityShare([s("busy", 1), s(null, 2)])!.latest).toBe("busy");
  });

  it("reports shell apart from busy — thinking and shelling out mean different things", () => {
    // "It has been running a command for an hour" and "it has been thinking for an
    // hour" send you to different places when you are debugging a stuck pod.
    const share = activityShare([s("shell"), s("busy")])!;
    expect(share).toMatchObject({ busyPct: 50, shellPct: 50, activePct: 100, idlePct: 0 });
  });

  it("folds an UNRECOGNISED state into idle rather than crashing or losing it", () => {
    // A state we have never seen must still total to 100% — the shares are a
    // partition of the time, and a missing slice would read as lost history.
    const share = activityShare([s("busy"), s("compiling")])!;
    expect(share.busyPct + share.shellPct + share.waitingPct + share.idlePct).toBe(100);
  });
});
