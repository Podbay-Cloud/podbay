import { describe, it, expect } from "vitest";
import { parseOomKillCount, newCgroupOomKills, cgroupLabel } from "../src/oom-cgroup.js";

describe("parseOomKillCount", () => {
  it("reads oom_kill from a memory.events body", () => {
    expect(parseOomKillCount("low 0\nhigh 2\nmax 0\noom 1\noom_kill 4\noom_group_kill 0\n")).toBe(4);
  });
  it("returns 0 when oom_kill is absent or the body is empty", () => {
    expect(parseOomKillCount("low 0\nhigh 0\n")).toBe(0);
    expect(parseOomKillCount("")).toBe(0);
  });
  it("does not confuse oom_group_kill for oom_kill", () => {
    expect(parseOomKillCount("oom 3\noom_group_kill 5\n")).toBe(0);
  });
});

describe("newCgroupOomKills", () => {
  it("first run baselines — no fresh kills, cursor = current counts", () => {
    const r = newCgroupOomKills({ "/a": 3, "/b": 0 }, {}, true);
    expect(r.fresh).toEqual([]);
    expect(r.cursor).toEqual({ "/a": 3, "/b": 0 });
  });
  it("reports the positive delta per cgroup", () => {
    const r = newCgroupOomKills({ "/a": 5, "/b": 2 }, { "/a": 3, "/b": 2 });
    expect(r.fresh).toEqual([{ cgroup: "/a", count: 2 }]);
    expect(r.cursor).toEqual({ "/a": 5, "/b": 2 });
  });
  it("a dropped counter (reset) yields no fresh kills and rebaselines", () => {
    const r = newCgroupOomKills({ "/a": 0 }, { "/a": 5 });
    expect(r.fresh).toEqual([]);
    expect(r.cursor).toEqual({ "/a": 0 });
  });
  it("a brand-new cgroup counts from zero", () => {
    const r = newCgroupOomKills({ "/a": 1, "/new": 2 }, { "/a": 1 });
    expect(r.fresh).toEqual([{ cgroup: "/new", count: 2 }]);
  });
  it("coalesces one kill that propagates up the cgroup hierarchy into a single leaf event", () => {
    // cgroup v2 bumps oom_kill at EVERY ancestor, so one kill increments all three levels.
    // This is the makore burst (2026-08-06): one kill → user.slice/user-1000.slice/session.
    const cur = {
      "/user.slice": 5,
      "/user.slice/user-1000.slice": 5,
      "/user.slice/user-1000.slice/session-c6.scope": 5,
    };
    const prev = {
      "/user.slice": 4,
      "/user.slice/user-1000.slice": 4,
      "/user.slice/user-1000.slice/session-c6.scope": 4,
    };
    const r = newCgroupOomKills(cur, prev);
    expect(r.fresh).toEqual([{ cgroup: "/user.slice/user-1000.slice/session-c6.scope", count: 1 }]);
  });
  it("keeps genuinely distinct kills in sibling subtrees separate", () => {
    const cur = { "/user.slice": 2, "/user.slice/a.scope": 1, "/system.slice": 1 };
    const prev = { "/user.slice": 0, "/user.slice/a.scope": 0, "/system.slice": 0 };
    const r = newCgroupOomKills(cur, prev);
    // /user.slice is an ancestor of a.scope → dropped; a.scope + system.slice are leaves.
    expect(r.fresh.map((f) => f.cgroup).sort()).toEqual(["/system.slice", "/user.slice/a.scope"]);
  });
  it("does not treat a name-prefix sibling as an ancestor (/a vs /ab)", () => {
    const r = newCgroupOomKills({ "/a": 1, "/ab": 1 }, { "/a": 0, "/ab": 0 });
    expect(r.fresh.map((f) => f.cgroup).sort()).toEqual(["/a", "/ab"]);
  });
});

describe("cgroupLabel", () => {
  it("takes the leaf name", () => {
    expect(cgroupLabel("/system.slice/podbay-agent.service")).toBe("podbay-agent.service");
  });
  it("falls back to 'a process' for the root / empty", () => {
    expect(cgroupLabel("/")).toBe("a process");
    expect(cgroupLabel("")).toBe("a process");
  });
});
