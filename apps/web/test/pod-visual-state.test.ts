import { describe, it, expect } from "vitest";
import { deriveState, type PodCardLive } from "@/lib/pod-visual-state";

const live = (over: Partial<PodCardLive>): PodCardLive => ({
  agentStatus: "waiting",
  agentWaitingFor: "dialog open", // the shape a /login screen ALSO reports
  codexStatus: "idle",
  agents: [],
  appListening: true,
  criticalIssue: null,
  unreachable: false,
  ...over,
});

describe("deriveState — sign-in vs command-approval (first10 mislabel, 2026-08-24)", () => {
  it("a signed-out agent at /login reads as 'needs sign-in', NOT 'approve a command'", () => {
    const r = deriveState(
      "running",
      false,
      live({ agents: [{ id: "claude-code", authed: false }, { id: "codex", authed: true }] }),
      true,
    );
    expect(r.activity?.text).toBe("Claude needs sign-in");
    expect(r.chip?.label).toBe("Needs you");
  });

  it("a genuine command dialog (agent IS signed in) still reads as 'approve a command'", () => {
    const r = deriveState("running", false, live({ agents: [{ id: "claude-code", authed: true }] }), true);
    expect(r.activity?.text).toBe("asking to approve a command");
  });

  it("an EXPIRED login still wins over the sign-in branch", () => {
    const r = deriveState(
      "running",
      false,
      live({ agents: [{ id: "claude-code", authed: false, loginExpired: true }] }),
      true,
    );
    expect(r.chip?.label).toBe("Sign-in expired");
  });
});

describe("deriveState — T3 Code control outranks Claude-session signals (2026-08-25)", () => {
  // While T3 owns the pod, Podbay's Claude agent reads as not-signed-in (RC yielded to T3). Without a
  // T3 branch the card mislabeled a fully-working T3 pod as "Needs you — Claude needs sign-in".
  it("a T3-in-control pod reads as 'T3 Code', NOT 'Needs you', even with an unauthed Claude agent", () => {
    const r = deriveState(
      "running",
      false,
      live({ agents: [{ id: "claude-code", authed: false }] }),
      true,
      { control: true },
    );
    expect(r.chip?.label).toBe("T3 Code");
    expect(r.activity?.text).toBe("in T3 Code control");
  });

  it("shows 'T3 Code' even before live signals arrive (durable state, live=null)", () => {
    const r = deriveState("running", false, null, true, { control: true });
    expect(r.chip?.label).toBe("T3 Code");
  });

  it("a pod mid-enable reads as 'Enabling T3…' (pulsing), not onboarding/Needs-you", () => {
    const r = deriveState("running", false, null, true, { enabling: true });
    expect(r.chip?.label).toBe("Enabling T3…");
    expect(r.chip?.pulse).toBe(true);
  });

  it("an in-flight IMAGE update still outranks T3 (amber, no T3 chip)", () => {
    const r = deriveState("running", true, null, true, { control: true });
    expect(r.chip).toBeNull();
    expect(r.spine).toBe("bg-warning");
  });

  it("without T3 flags, behaviour is unchanged (an unauthed agent still reads 'Needs you')", () => {
    const r = deriveState("running", false, live({ agents: [{ id: "claude-code", authed: false }] }), true);
    expect(r.chip?.label).toBe("Needs you");
  });
});
