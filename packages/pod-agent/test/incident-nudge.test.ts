import { describe, it, expect } from "vitest";
import { attributeRestartToOom, composeResumeNudge, OOM_RECENCY_SEC } from "../src/incident-nudge.js";
import type { OomKill } from "../src/oom.js";

const isAgent = (c: string) => /claude|codex/i.test(c);
const kill = (victim: string, ktime: number, rssMb = 300): OomKill => ({ victim, ktime, pid: 1, rssMb });
const BASE = "Resuming — where are we?";

describe("attributeRestartToOom", () => {
  it("attributes a restart to a recent agent OOM just before boot", () => {
    // uptime 200s; the agent was OOM-killed at ktime 190 → 10s before we came up.
    const a = attributeRestartToOom([kill("claude", 190)], 200, isAgent);
    expect(a).toMatchObject({ victim: "claude", loop: false });
  });

  it("ignores a NON-agent victim (a throwaway build/chromium OOM)", () => {
    expect(attributeRestartToOom([kill("next-server (v1", 195)], 200, isAgent)).toBeNull();
  });

  it("ignores an OLD kill outside the recency window (not the cause of THIS restart)", () => {
    // uptime 5000s; the kill was at ktime 100 → ~81min ago, unrelated to this boot.
    expect(attributeRestartToOom([kill("claude", 100)], 5000, isAgent)).toBeNull();
  });

  it("ignores a kill with no ktime (=0) — can't place it in time", () => {
    expect(attributeRestartToOom([kill("claude", 0)], 200, isAgent)).toBeNull();
  });

  it("flags a loop when ≥2 agent OOMs sit in the window", () => {
    const a = attributeRestartToOom([kill("claude", 120), kill("codex", 190)], 200, isAgent);
    expect(a).toMatchObject({ loop: true, ktime: 190 }); // newest wins for the singular fields
  });

  it("respects a custom recency window", () => {
    expect(attributeRestartToOom([kill("claude", 100)], 200, isAgent, 50)).toBeNull(); // 100s ago > 50s
    expect(attributeRestartToOom([kill("claude", 160)], 200, isAgent, 50)).not.toBeNull(); // 40s ago ≤ 50s
  });
});

describe("composeResumeNudge", () => {
  it("returns the plain base nudge when the restart was benign (no attribution)", () => {
    expect(composeResumeNudge(BASE, null)).toBe(BASE);
  });

  it("leads with the owner notice + cockpit link, then the base nudge", () => {
    const out = composeResumeNudge(BASE, { victim: "claude", rssMb: 300, ktime: 190, loop: false }, "https://podbay.cloud/pods/p1");
    expect(out).toContain("Podbay system notice");
    expect(out).toContain("ran out of memory");
    expect(out).toContain("https://podbay.cloud/pods/p1");
    expect(out.endsWith(BASE)).toBe(true);
  });

  it("escalates the wording on a loop", () => {
    const out = composeResumeNudge(BASE, { victim: "claude", rssMb: 300, ktime: 190, loop: true }, null);
    expect(out).toContain("keeps running out of memory");
    expect(out).toContain("resiz"); // recommends a resize
    expect(out).not.toContain("cockpit:"); // no link when none given
  });

  it("OOM_RECENCY_SEC is a sane default", () => {
    expect(OOM_RECENCY_SEC).toBeGreaterThan(60);
  });
});
