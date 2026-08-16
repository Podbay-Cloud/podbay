import { describe, it, expect } from "vitest";
import { OomWatcher, type OomWatcherDeps } from "../src/oom-watcher.js";

function harness(initial: Record<string, number>) {
  let counts = { ...initial };
  let cursor: Record<string, number> | null = null;
  let clock = 1_000_000;
  const deps: OomWatcherDeps = {
    readOomCounts: () => ({ ...counts }),
    readCursor: () => cursor,
    writeCursor: (c) => (cursor = c),
    now: () => clock,
  };
  return {
    deps,
    set: (c: Record<string, number>) => (counts = { ...c }),
    tick: (ms: number) => (clock += ms),
  };
}

describe("OomWatcher (cgroup oom_kill counter)", () => {
  it("baselines on first run, then records a later kill once (deduped across scans)", () => {
    const h = harness({ "/system.slice/podbay-agent.service": 3 }); // a pre-existing count
    const w = new OomWatcher(h.deps);
    w.scan(); // first run: baseline the historical count, emit nothing
    expect(w.list()).toEqual([]);

    h.set({ "/system.slice/podbay-agent.service": 4 }); // one new kill
    w.scan();
    w.scan(); // cursor advanced → nothing new
    expect(w.list()).toHaveLength(1);
    expect(w.list()[0]).toMatchObject({ victim: "podbay-agent.service", rssMb: 0, victimIsAgent: false });
  });

  it("emits one event per new kill, each with a unique dedup key", () => {
    const h = harness({ "/a": 0 });
    const w = new OomWatcher(h.deps);
    w.scan(); // baseline 0
    h.set({ "/a": 2 }); // two kills seen in one scan
    w.scan();
    const ks = w.list();
    expect(ks).toHaveLength(2);
    expect(ks[0]!.ktime).not.toBe(ks[1]!.ktime); // unique so the control plane won't dedup one away
  });

  it("a counter reset (container recreate) rebaselines without phantom kills", () => {
    const h = harness({ "/a": 5 });
    const w = new OomWatcher(h.deps);
    w.scan(); // baseline 5
    h.set({ "/a": 0 }); // counters reset on recreate
    w.scan();
    expect(w.list()).toEqual([]);
    h.set({ "/a": 1 }); // a real kill after the reset
    w.scan();
    expect(w.list()).toHaveLength(1);
  });

  it("answers 'saw an OOM recently?' for respawn attribution, and expires it", () => {
    const h = harness({ "/a": 0 });
    const w = new OomWatcher(h.deps);
    w.scan();
    h.set({ "/a": 1 });
    w.scan();
    expect(w.sawOomSince(60_000)).toBe(true);
    h.tick(120_000);
    expect(w.sawOomSince(60_000)).toBe(false); // outside the window
  });

  it("no throw on an unreadable cgroup source, nothing recorded", () => {
    const w = new OomWatcher({
      readOomCounts: () => {
        throw new Error("sysfs denied");
      },
      readCursor: () => null,
      writeCursor: () => {},
      now: () => 1,
    });
    expect(() => w.scan()).not.toThrow();
    expect(w.list()).toEqual([]);
    expect(w.sawOomSince(1000)).toBe(false);
  });
});
