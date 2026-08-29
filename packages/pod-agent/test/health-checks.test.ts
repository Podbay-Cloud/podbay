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

  it("flags an EXPIRED agent login even though the window still exists (the blind spot)", () => {
    // The window is present and the creds file exists, but the token is dead — used to report nothing.
    const out = computeIssues({
      ...healthy,
      agents: [{ id: "claude-code", window: 0, authed: false, loginExpired: true }],
    });
    const issue = out.find((i) => i.id === "agent-login-expired:claude-code");
    expect(issue?.agent).toBe("claude-code");
    expect(issue?.title).toMatch(/sign-in expired/i);
    // must NOT be confused with the missing-window issue — the window is there
    expect(out.some((i) => i.id?.startsWith("agent-not-running"))).toBe(false);
  });

  it("surfaces a live logout (needsReauth) and a stuck menu (stuckGate) as their own issues", () => {
    const reauth = computeIssues({
      ...healthy,
      agents: [{ id: "claude-code", window: 0, authed: true, needsReauth: true }],
    });
    expect(reauth.find((i) => i.id === "agent-needs-reauth:claude-code")?.title).toMatch(/signed out/i);

    const stuck = computeIssues({
      ...healthy,
      agents: [{ id: "claude-code", window: 0, authed: true, stuckGate: "the folder-trust prompt" }],
    });
    const issue = stuck.find((i) => i.id === "agent-menu-stuck:claude-code");
    expect(issue?.title).toMatch(/waiting on you/i);
    expect(issue?.detail).toMatch(/folder-trust/i);
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

describe("a startup command whose folder is gone", () => {
  // podbay `dev`, 2026-08-29: 'dashboard-concepts' pointed at a git worktree that had been deleted,
  // so every retry died on `cd: No such file or directory`. The owner was told it "keeps failing"
  // and offered `startup restart` / `doctor --fix` — neither of which can recreate a directory.
  it("names the missing folder and offers fixes that can actually work", () => {
    const [issue] = computeIssues({
      ...healthy,
      repairGaveUp: ["startup:dashboard-concepts"],
      startupMissingDir: { "startup:dashboard-concepts": "/home/dev/worktrees/dashboard-concepts" },
    });
    expect(issue.title).toMatch(/folder is gone/i);
    expect(issue.detail).toContain("/home/dev/worktrees/dashboard-concepts");
    expect(issue.detail).toMatch(/remove the command|recreate that folder/i);
    // Advice that cannot work must NOT be offered for this failure mode.
    expect(issue.detail).not.toMatch(/doctor --fix/i);
    expect(issue.detail).not.toMatch(/startup restart/i);
    // …and it must not be advertised as auto-fixable, because a restart cannot repair it.
    expect(issue.fixable).toBe(false);
  });

  it("keeps the ordinary retry advice when the folder is fine", () => {
    const [issue] = computeIssues({ ...healthy, repairGaveUp: ["startup:preview-3000"] });
    expect(issue.title).toMatch(/keeps failing to start/i);
    expect(issue.detail).toMatch(/startup restart preview-3000/);
    expect(issue.fixable).toBe(true);
  });
});
