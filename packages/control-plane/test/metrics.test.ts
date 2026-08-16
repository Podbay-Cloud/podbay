import { describe, it, expect } from "vitest";
import { usageForPod, usageByPod } from "../src/metrics.js";
import type { PodEvent, PodEventType } from "../src/types.js";

const T0 = Date.parse("2026-07-17T00:00:00.000Z");
const min = (n: number) => n * 60_000;

let seq = 0;
function ev(type: PodEventType, atMs: number, podId = "p1", ownerId = "u1"): PodEvent {
  return { id: `e${++seq}`, podId, ownerId, type, at: new Date(atMs).toISOString(), meta: null };
}
const meta = (e: PodEvent, m: Record<string, unknown>): PodEvent => ({ ...e, meta: m });

describe("lifecycle metrics (derived from the event log)", () => {
  it("folds one running→suspended cycle (owner suspend)", () => {
    const u = usageForPod([ev("created", T0), ev("suspended", T0 + min(30))], T0 + min(90))!;
    expect(u.runningMs).toBe(min(30));
    expect(u.suspends).toBe(1);
    expect(u.currentRunningMs).toBeNull();
    expect(u.since).toBe(new Date(T0).toISOString());
  });

  it("counts suspend BETWEEN intervals AND the trailing suspend", () => {
    const u = usageForPod(
      [
        ev("created", T0),
        ev("suspended", T0 + min(10)), // running 10
        ev("running", T0 + min(40)), // suspended 30
        ev("suspended", T0 + min(50)), // running 10
      ],
      T0 + min(60), // still suspended → 10 more min up to now
    )!;
    expect(u.runningMs).toBe(min(20));
    expect(u.suspendedMs).toBe(min(40)); // 30 between + 10 trailing
    expect(u.currentSuspendedMs).toBe(min(10));
    expect(u.currentRunningMs).toBeNull();
    expect(u.suspends).toBe(2);
  });

  it("counts the open suspend against `now` (a pod suspended right now)", () => {
    const u = usageForPod([ev("created", T0), ev("suspended", T0 + min(15))], T0 + min(75))!;
    expect(u.currentSuspendedMs).toBe(min(60));
    expect(u.suspendedMs).toBe(min(60));
    expect(u.currentRunningMs).toBeNull();
  });

  it("does not drop an unpaired leading suspend (log started mid-suspend)", () => {
    const u = usageForPod(
      [ev("suspended", T0), ev("running", T0 + min(30))],
      T0 + min(40),
    )!;
    expect(u.suspendedMs).toBe(min(30));
    expect(u.currentRunningMs).toBe(min(10));
  });

  it("counts a still-open running interval against `now` (live uptime)", () => {
    const u = usageForPod([ev("created", T0)], T0 + min(45))!;
    expect(u.currentRunningMs).toBe(min(45));
    expect(u.runningMs).toBe(min(45));
  });

  it("reports a long-running pod's uptime plainly, with no suspends", () => {
    const u = usageForPod([ev("created", T0)], T0 + min(300))!;
    expect(u.currentRunningMs).toBe(min(300));
    expect(u.suspends).toBe(0);
  });

  it("does NOT double-count a repeated open (reconcile re-confirming running)", () => {
    const u = usageForPod(
      [ev("created", T0), ev("running", T0 + min(5)), ev("running", T0 + min(9))],
      T0 + min(10),
    )!;
    expect(u.runningMs).toBe(min(10)); // one interval from T0
    expect(u.suspends).toBe(0);
  });

  it("closes the final interval on destroy, and survives the pod row being gone", () => {
    const u = usageForPod([ev("created", T0), ev("destroyed", T0 + min(15))], T0 + min(99))!;
    expect(u.destroyed).toBe(true);
    expect(u.runningMs).toBe(min(15));
    expect(u.currentRunningMs).toBeNull();
    expect(u.currentSuspendedMs).toBeNull(); // destroyed ≠ suspended
    expect(u.ownerId).toBe("u1");
  });

  it("is order-independent (events may arrive unsorted)", () => {
    const inOrder = [ev("created", T0), ev("suspended", T0 + min(30))];
    const shuffled = [inOrder[1], inOrder[0]];
    expect(usageForPod(shuffled, T0 + min(60))!.runningMs).toBe(
      usageForPod(inOrder, T0 + min(60))!.runningMs,
    );
  });

  it("splits the fleet per pod", () => {
    const all = [
      ev("created", T0, "p1"),
      ev("created", T0, "p2"),
      ev("suspended", T0 + min(10), "p1"),
    ];
    const byPod = usageByPod(all, T0 + min(60)).sort((a, b) => a.podId.localeCompare(b.podId));
    expect(byPod.map((u) => u.podId)).toEqual(["p1", "p2"]);
    expect(byPod[0].runningMs).toBe(min(10));
    expect(byPod[1].currentRunningMs).not.toBeNull();
  });

  it("returns null for a pod with no events (no history ⇒ no claims)", () => {
    expect(usageForPod([], T0)).toBeNull();
  });

  it("a currently-suspended legacy pod (only a backfilled `created`) reads suspended now", () => {
    const events = [ev("created", T0)];
    const u = usageForPod(events, T0 + min(60 * 24 * 4), "suspended")!;
    expect(u.currentRunningMs).toBeNull();
    expect(u.currentSuspendedMs).toBe(min(60 * 24 * 4));
    expect(u.runningMs).toBe(0);
  });
});

describe("platform restarts are NOT suspends (24/7 pods never suspend themselves)", () => {
  const span = (u: { intervals: { from: number; to: number; state: string }[] }) =>
    u.intervals.map((i) => `${i.state}:${Math.round((i.to - i.from) / 60_000)}m`);

  it("ignores a reconciled sleep→wake (an image update / reboot restart)", () => {
    // reconcile records the restart as `sleeping reason=reconciled` → `running`, but
    // the owner never suspended it — it's normal running, not off-time.
    const u = usageForPod(
      [
        ev("created", T0),
        meta(ev("suspended", T0 + min(60)), { from: "running", reason: "reconciled" }),
        meta(ev("running", T0 + min(90)), { from: "suspended", reason: "reconciled" }),
      ],
      T0 + min(120),
    )!;
    expect(span(u)).toEqual(["running:120m"]);
    expect(u.suspends, "a restart is not a suspend").toBe(0);
    expect(u.suspendedMs).toBe(0);
    expect(u.runningMs).toBe(min(120));
  });

  it("does not treat an update window as downtime", () => {
    // Updates keep the pod 'running' in this model — they are normal operation, not
    // an interruption the owner needs subtracted from uptime.
    const u = usageForPod(
      [ev("created", T0), ev("update_started", T0 + min(60)), ev("updated", T0 + min(62))],
      T0 + min(120),
    )!;
    expect(span(u)).toEqual(["running:120m"]);
    expect(u.suspends).toBe(0);
  });

  it("ignores the reconciler's mid-update sleep too", () => {
    const u = usageForPod(
      [
        ev("created", T0),
        ev("update_started", T0 + min(60)),
        meta(ev("suspended", T0 + min(61)), { from: "running", reason: "reconciled" }),
        ev("updated", T0 + min(62)),
      ],
      T0 + min(120),
    )!;
    expect(span(u)).toEqual(["running:120m"]);
    expect(u.suspends).toBe(0);
  });

  it("ignores a Fly idle auto-suspend (retired; pods no longer self-suspend)", () => {
    const u = usageForPod(
      [
        ev("created", T0),
        meta(ev("suspended", T0 + min(60)), { reason: "idle" }),
        ev("running", T0 + min(90)),
      ],
      T0 + min(120),
    )!;
    expect(span(u)).toEqual(["running:120m"]);
    expect(u.suspends).toBe(0);
  });

  it("KEEPS a real owner suspend, even one made during an update", () => {
    // Only reconciled/idle sleeps are ignored. A suspend the owner performed
    // (manual, or a bare legacy sleep) is theirs and stays.
    const u = usageForPod(
      [
        ev("created", T0),
        ev("update_started", T0 + min(60)),
        meta(ev("suspended", T0 + min(61)), { reason: "manual" }),
        ev("updated", T0 + min(62)),
      ],
      T0 + min(120),
    )!;
    expect(u.suspends).toBe(1);
    expect(u.suspendedMs).toBeGreaterThan(0);
  });

  it("still folds a LEGACY `sleeping` event as an owner suspend (pre-rename rows)", () => {
    // The token was renamed sleeping→suspended (2026-08-02) and rows migrated, but
    // the fold stays tolerant so un-migrated / historical audit rows still count.
    const u = usageForPod(
      [ev("created", T0), ev("sleeping", T0 + min(30)), ev("running", T0 + min(50))],
      T0 + min(90),
    )!;
    expect(u.suspends).toBe(1);
    expect(u.suspendedMs).toBe(min(20));
    expect(u.runningMs).toBe(min(70));
  });

  it("does NOT infer a suspend from a bare wake with no recorded suspend", () => {
    // We used to treat `running from=waking` as proof of an unrecorded sleep. In a
    // 24/7 world an unrecorded gap is a restart, not a suspend — don't invent off-time.
    const u = usageForPod(
      [ev("created", T0), meta(ev("running", T0 + min(120)), { from: "waking", reason: "reconciled" })],
      T0 + min(125),
      "running",
    )!;
    expect(u.suspends).toBe(0);
    expect(u.suspendedMs).toBe(0);
    expect(u.currentRunningMs).toBe(min(125));
  });
});

describe("lifecycle intervals (the timeline behind the totals)", () => {
  const span = (u: { intervals: { from: number; to: number; state: string }[] }) =>
    u.intervals.map((i) => `${i.state}:${(i.to - i.from) / 60_000}m`);

  it("emits the stretches the totals are made of, and they ADD UP to them", () => {
    const u = usageForPod(
      [ev("created", T0), ev("suspended", T0 + min(30)), ev("running", T0 + min(50))],
      T0 + min(90),
    )!;
    expect(span(u)).toEqual(["running:30m", "suspended:20m", "running:40m"]);
    const sum = (state: string) =>
      u.intervals.filter((i) => i.state === state).reduce((a, i) => a + (i.to - i.from), 0);
    expect(sum("running")).toBe(u.runningMs);
    expect(sum("suspended")).toBe(u.suspendedMs);
  });

  it("reconciles the open stretch with the pod's REAL status", () => {
    const u = usageForPod([ev("created", T0)], T0 + min(120), "suspended")!;
    expect(span(u)).toEqual(["suspended:120m"]);
  });

  it("stops the clock on a destroyed pod rather than drawing it forever", () => {
    const u = usageForPod([ev("created", T0), ev("destroyed", T0 + min(10))], T0 + min(500))!;
    expect(span(u)).toEqual(["running:10m"]);
  });

  it("drops zero-length stretches", () => {
    const u = usageForPod([ev("created", T0), ev("suspended", T0)], T0 + min(10))!;
    expect(u.intervals.every((i) => i.to > i.from)).toBe(true);
  });
});
