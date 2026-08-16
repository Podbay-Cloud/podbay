import { describe, it, expect } from "vitest";
import { computeIssues, worstSeverity, type HealthInput } from "../src/health-checks.js";

const healthy: HealthInput = {
  sessionAlive: true,
  agents: [{ id: "claude-code", window: 0, authed: true }],
  repairGaveUp: [],
  disk: { usedMb: 1_000, totalMb: 20_000 },
  app: { port: 3000, listening: true },
};

describe("health checks", () => {
  it("a healthy pod reports NOTHING — green must be empty, not a wall of green rows", () => {
    expect(computeIssues(healthy)).toEqual([]);
    expect(worstSeverity([])).toBeNull();
  });

  it("does not invent a disk problem when the disk size is unknown", () => {
    // totalMb 0 means we couldn't read it. Reporting "0% free" would be a lie
    // that sends the owner chasing a full disk that isn't full.
    expect(computeIssues({ ...healthy, disk: { usedMb: 0, totalMb: 0 } })).toEqual([]);
  });

  it("escalates disk from warn to critical, because it breaks the other repairs", () => {
    const warn = computeIssues({ ...healthy, disk: { usedMb: 18_000, totalMb: 20_000 } });
    expect(warn[0]).toMatchObject({ id: "disk-low", severity: "warn" });
    const crit = computeIssues({ ...healthy, disk: { usedMb: 19_600, totalMb: 20_000 } });
    expect(crit[0]).toMatchObject({ id: "disk-critical", severity: "critical" });
    // and it is reported FIRST, so the thing to fix first reads first
    expect(crit[0].id).toBe("disk-critical");
  });

  it("warns on low memory, but never invents one when memory is unknown or fine", () => {
    // Absent memory field → no memory issue (older callers).
    expect(computeIssues(healthy).some((i) => i.id?.startsWith("memory"))).toBe(false);
    // Plenty free → nothing.
    expect(
      computeIssues({ ...healthy, memory: { availableMb: 3_000, totalMb: 4_000 } }).some((i) =>
        i.id?.startsWith("memory"),
      ),
    ).toBe(false);
    // ~10% free → memory-low (warn).
    const low = computeIssues({ ...healthy, memory: { availableMb: 400, totalMb: 4_000 } });
    expect(low.find((i) => i.id?.startsWith("memory"))).toMatchObject({ id: "memory-low", severity: "warn" });
    // ~3% free → memory-critical, but still severity warn (a build runs hot; the kill is the critical signal).
    const crit = computeIssues({ ...healthy, memory: { availableMb: 120, totalMb: 4_000 } });
    expect(crit.find((i) => i.id?.startsWith("memory"))).toMatchObject({ id: "memory-critical", severity: "warn" });
  });

  it("reports a dead session as critical", () => {
    const i = computeIssues({ ...healthy, sessionAlive: false });
    expect(i).toContainEqual(expect.objectContaining({ id: "session-dead", severity: "critical" }));
  });

  it("reports a missing agent against ITS card", () => {
    const i = computeIssues({
      ...healthy,
      agents: [
        { id: "claude-code", window: 0, authed: true },
        { id: "codex", window: null, authed: true },
      ],
    });
    expect(i).toContainEqual(
      expect.objectContaining({ id: "agent-not-running:codex", severity: "warn", agent: "codex" }),
    );
  });

  it("gave-up REPLACES not-running for the same agent — one problem, stated once, louder", () => {
    const i = computeIssues({
      ...healthy,
      agents: [{ id: "codex", window: null, authed: true }],
      repairGaveUp: ["codex"],
    });
    expect(i.filter((x) => x.agent === "codex")).toHaveLength(1);
    expect(i[0]).toMatchObject({ id: "repair-gave-up:codex", severity: "critical" });
  });

  it("a given-up SESSION is not attributed to an agent card", () => {
    const [issue] = computeIssues({ ...healthy, repairGaveUp: ["session"] });
    expect(issue.agent).toBeUndefined();
    expect(issue.title).toMatch(/session/i);
  });

  it("a given-up STARTUP process names the owner's slug and is not an agent card", () => {
    const [issue] = computeIssues({ ...healthy, repairGaveUp: ["startup:preview-3000"] });
    expect(issue.agent).toBeUndefined(); // no phantom agent card
    expect(issue.title).toContain("'preview-3000'");
    expect(issue.severity).toBe("critical");
    const [dev] = computeIssues({ ...healthy, repairGaveUp: ["startup:dev-server"] });
    expect(dev.title).toMatch(/dev server/i);
  });

  it("does NOT report the dead preview app — the preview card states it inline", () => {
    // Reporting it here as well put the same sentence twice on one page, and the
    // doctor (a different implementation) disagreed with it, so "Run doctor" wiped
    // a finding that then came back on refresh.
    expect(computeIssues({ ...healthy, app: { port: 3000, listening: false } })).toEqual([]);
  });

  it("only complains about the scheduler when the pod actually has jobs", () => {
    expect(computeIssues({ ...healthy, scheduler: { expected: false, alive: false } })).toEqual([]);
    expect(computeIssues({ ...healthy, scheduler: { expected: true, alive: false } })).toContainEqual(
      expect.objectContaining({ id: "scheduler-dead" }),
    );
  });

  it("says WHY codex remote control can't start, instead of leaving a dead button", () => {
    const i = computeIssues({ ...healthy, codexRuntimeMissing: true });
    expect(i).toEqual([
      expect.objectContaining({ id: "codex-runtime-missing", severity: "warn", agent: "codex" }),
    ]);
    expect(i[0].detail).toMatch(/update/i); // and what to do about it
  });

  it("worstSeverity ranks critical over warn", () => {
    const i = computeIssues({ ...healthy, sessionAlive: false, repairGaveUp: [] });
    expect(worstSeverity(i)).toBe("critical");
    expect(worstSeverity(computeIssues({ ...healthy, codexRuntimeMissing: true }))).toBe("warn");
  });
});
