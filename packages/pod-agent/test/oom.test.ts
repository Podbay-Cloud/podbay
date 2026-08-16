import { describe, it, expect } from "vitest";
import { parseOomKills, newOomKills } from "../src/oom.js";

// Real capture from makore (dual-bear-fb14), 2026-08-01.
const MAKORE = `
[127688.540184] Out of memory: Killed process 196850 (next-server (v1) total-vm:69990212kB, anon-rss:3242600kB, file-rss:256kB, shmem-rss:0kB, UID:1000 pgtables:31460kB oom_score_adj:0
[128505.932608] Compositor invoked oom-killer: gfp_mask=0x140cca(GFP_HIGHUSER_MOVABLE|__GFP_COMP), order=0
[128505.932924] oom-kill:constraint=CONSTRAINT_NONE,nodemask=(null),cpuset=/,mems_allowed=0,global_oom,task_memcg=/system.slice/podbay-agent.service,task=next-server (v1,pid=199387,uid=1000
[128505.932924] Out of memory: Killed process 199387 (next-server (v1) total-vm:69246556kB, anon-rss:2598320kB, file-rss:128kB, shmem-rss:0kB, UID:1000 pgtables:27492kB oom_score_adj:0
`;

describe("parsing OOM kills from the kernel log", () => {
  it("pulls the two real kills, with victim + resident MB", () => {
    const kills = parseOomKills(MAKORE);
    expect(kills).toHaveLength(2);
    expect(kills[0]).toMatchObject({ pid: 196850, ktime: 127688.540184 });
    expect(kills[0]!.victim).toContain("next-server");
    // 3242600 kB ≈ 3167 MB
    expect(kills[0]!.rssMb).toBe(Math.round(3242600 / 1024));
    expect(kills[1]!.pid).toBe(199387);
  });

  it("ignores the oom-killer INVOCATION lines, only the 'Killed process' ones", () => {
    // The 'Compositor invoked oom-killer' + 'oom-kill:constraint' lines are not kills.
    expect(parseOomKills(MAKORE).every((k) => k.pid > 0)).toBe(true);
  });

  it("handles a log with no timestamps", () => {
    const kills = parseOomKills("Out of memory: Killed process 42 (node) total-vm:1kB, anon-rss:512000kB");
    expect(kills).toEqual([{ ktime: 0, pid: 42, victim: "node", rssMb: 500 }]);
  });

  it("empty / unrelated log → no kills", () => {
    expect(parseOomKills("nothing here\n[1.0] usb 1-1: new device")).toEqual([]);
  });

  // The line a CGROUP OOM actually produces (MemoryMax exceeded) — different wording
  // ("Memory cgroup out of memory", lowercase 'o') than a global OOM, matched
  // case-insensitively. Live capture from correct-jackal, 2026-08-02.
  it("parses a cgroup (memcg) OOM line, with its ktime", () => {
    const line =
      "[  386.291297] Memory cgroup out of memory: Killed process 4380 (claude) total-vm:327996kB, anon-rss:306432kB, file-rss:6144kB, shmem-rss:0kB";
    const kills = parseOomKills(line);
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ pid: 4380, victim: "claude", ktime: 386.291297 });
    expect(kills[0]!.rssMb).toBe(Math.round(306432 / 1024));
  });
});

describe("de-duping against a cursor across scans", () => {
  it("returns only kills newer than the cursor and advances it", () => {
    const kills = parseOomKills(MAKORE);
    const first = newOomKills(kills, 0);
    expect(first.fresh).toHaveLength(2);
    expect(first.cursor).toBeCloseTo(128505.932924, 3);
    // A re-scan with the advanced cursor yields nothing new.
    const again = newOomKills(kills, first.cursor);
    expect(again.fresh).toEqual([]);
  });

  // THE bug that hid every OOM in prod: with `dmesg -t` the ktime prefix is stripped,
  // so every kill parses as ktime=0 and is filtered as "not newer than cursor 0" —
  // detection reports nothing, forever. This encodes WHY the server must read dmesg
  // WITHOUT -t, so no one re-adds it.
  it("drops kills that have no ktime (=0) — why `dmesg -t` is fatal", () => {
    const noTs = parseOomKills("Out of memory: Killed process 4380 (claude) anon-rss:306432kB");
    expect(noTs[0]!.ktime).toBe(0);
    expect(newOomKills(noTs, 0).fresh, "ktime 0 is never > cursor 0 → silently dropped").toEqual([]);
  });

  it("treats a reboot (ktime jumps back below the cursor) as all-new", () => {
    const afterReboot = parseOomKills("[12.5] Out of memory: Killed process 7 (node) anon-rss:1024kB");
    const { fresh, cursor } = newOomKills(afterReboot, 128505 /* stale pre-reboot cursor */);
    expect(fresh).toHaveLength(1);
    expect(cursor).toBeCloseTo(12.5, 1);
  });
});
