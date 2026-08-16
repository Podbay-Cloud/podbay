import { describe, expect, it } from "vitest";
import {
  deriveSetupStep,
  readyWaitMsForAgent,
  RC_WAIT_MS,
  CODEX_READY_GRACE_MS,
} from "../lib/pod-onboarding";

/** The launch step is derived from durable DB fields alone, so a page load (or
 * reload, or reopen after sleep) always lands on the same step. */
describe("deriveSetupStep", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  it("provisioning/waking (agent not reachable) → creating", () => {
    for (const status of ["provisioning", "waking", "suspended"]) {
      expect(deriveSetupStep({ status, authedAt: null, sessionUrl: null }, now)).toBe("creating");
    }
  });

  it("running but not logged in → login", () => {
    expect(deriveSetupStep({ status: "running", authedAt: null, sessionUrl: null }, now)).toBe("login");
  });

  it("just logged in → agent (waiting for remote control)", () => {
    const authedAt = new Date(now - 10_000).toISOString();
    expect(deriveSetupStep({ status: "running", authedAt, sessionUrl: null }, now)).toBe("agent");
  });

  it("logged in a while ago with no session URL → ready (RC is best-effort)", () => {
    const authedAt = new Date(now - RC_WAIT_MS - 1000).toISOString();
    expect(deriveSetupStep({ status: "running", authedAt, sessionUrl: null }, now)).toBe("ready");
  });

  it("session URL captured → ready, regardless of status (durable across sleep)", () => {
    const url = "https://claude.ai/code/session_abc";
    expect(deriveSetupStep({ status: "suspended", authedAt: null, sessionUrl: url }, now)).toBe("ready");
    expect(deriveSetupStep({ status: "running", authedAt: null, sessionUrl: url }, now)).toBe("ready");
  });

  // Codex has no remote-control session URL, so it must not sit on the 90s RC
  // fallback (the cockpit showed "Starting your agent" for 90s while Codex was
  // already answering). It goes ready after just the respawn grace.
  it("Codex: goes ready shortly after login (no RC session URL to wait for)", () => {
    const base = { status: "running", sessionUrl: null, agent: "codex" };
    // within the short grace → still "agent"
    expect(
      deriveSetupStep({ ...base, authedAt: new Date(now - 2_000).toISOString() }, now),
    ).toBe("agent");
    // past the grace → ready, WITHOUT any session URL
    expect(
      deriveSetupStep({ ...base, authedAt: new Date(now - CODEX_READY_GRACE_MS - 1_000).toISOString() }, now),
    ).toBe("ready");
    // a Claude pod at the SAME age is still waiting on RC
    expect(
      deriveSetupStep(
        { status: "running", sessionUrl: null, agent: "claude-code", authedAt: new Date(now - CODEX_READY_GRACE_MS - 1_000).toISOString() },
        now,
      ),
    ).toBe("agent");
  });

  it("readyWaitMsForAgent: Codex uses the short grace, everything else the RC window", () => {
    expect(readyWaitMsForAgent("codex")).toBe(CODEX_READY_GRACE_MS);
    expect(readyWaitMsForAgent("claude-code")).toBe(RC_WAIT_MS);
    expect(readyWaitMsForAgent(undefined)).toBe(RC_WAIT_MS);
    expect(readyWaitMsForAgent(null)).toBe(RC_WAIT_MS);
    expect(CODEX_READY_GRACE_MS).toBeLessThan(RC_WAIT_MS);
  });
});
