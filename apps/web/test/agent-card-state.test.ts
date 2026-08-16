import { describe, it, expect } from "vitest";
import {
  agentCardState,
  shouldAutoOpenPairing,
  SPAWN_GRACE_MS,
  type LiveAgent,
} from "@/lib/agent-card-state";

const NOW = 1_800_000_000_000;
const base = {
  primaryAgent: "claude-code",
  sessionUrl: null as string | null,
  authedAt: null as string | null,
  legacyCodexRc: false,
  running: true,
  startingNow: false,
  now: NOW,
};
const agent = (o: Partial<LiveAgent> & { id: string }): LiveAgent => ({
  window: 0,
  authed: true,
  rcActive: false,
  ...o,
});

describe("agentCardState", () => {
  it("unauthenticated agent needs sign-in, whichever CLI it is", () => {
    for (const id of ["claude-code", "codex"]) {
      expect(
        agentCardState({ ...base, id, live: [agent({ id, authed: false })] }),
      ).toBe("needs-signin");
    }
  });

  it("uses the agent's OWN session URL for the hand-off, not the pod's", () => {
    // An ADDED Claude's RC link lives on its own record; the pod-level field
    // belongs to the primary and would otherwise mislabel it.
    expect(
      agentCardState({
        ...base,
        id: "claude-code",
        live: [agent({ id: "claude-code", sessionUrl: "https://claude.ai/code/session_x" })],
      }),
    ).toBe("claude-linked");
    expect(
      agentCardState({ ...base, id: "claude-code", live: [agent({ id: "claude-code" })] }),
    ).toBe("claude-ready");
  });

  it("codex reflects its daemon, not a guess", () => {
    expect(
      agentCardState({ ...base, id: "codex", live: [agent({ id: "codex", rcActive: true })] }),
    ).toBe("codex-on");
    expect(
      agentCardState({ ...base, id: "codex", live: [agent({ id: "codex", rcActive: false })] }),
    ).toBe("codex-off");
  });

  it("a missing agent is 'starting' briefly, then 'not-running' (never forever)", () => {
    const live = [agent({ id: "codex", rcActive: true })];
    const missing = { ...base, id: "claude-code", live };
    expect(agentCardState({ ...missing, missingSince: NOW })).toBe("starting");
    expect(agentCardState({ ...missing, missingSince: NOW - SPAWN_GRACE_MS - 1 })).toBe(
      "not-running",
    );
    // …unless an add is actively in flight
    expect(
      agentCardState({ ...missing, missingSince: NOW - 10 * 60_000, startingNow: true }),
    ).toBe("starting");
  });

  it("degrades to 'unknown' rather than guessing when the pod reports nothing", () => {
    expect(agentCardState({ ...base, id: "claude-code", live: [] })).toBe("unknown");
    // legacy pod-level signals still resolve the PRIMARY agent
    expect(
      agentCardState({ ...base, id: "claude-code", live: [], sessionUrl: "https://s" }),
    ).toBe("claude-linked");
    expect(agentCardState({ ...base, id: "claude-code", live: [], authedAt: "2026-01-01" })).toBe(
      "claude-ready",
    );
    // but never for a SECOND agent — we have no pod-level truth about it
    expect(
      agentCardState({ ...base, id: "codex", live: [], authedAt: "2026-01-01" }),
    ).toBe("unknown");
  });

  it("a stopped pod is 'unknown', not a stale success state", () => {
    expect(
      agentCardState({
        ...base,
        id: "codex",
        running: false,
        live: [agent({ id: "codex", rcActive: true })],
      }),
    ).toBe("unknown");
  });
});

describe("shouldAutoOpenPairing", () => {
  const on = { hasCodex: true, alreadyAutoOpened: false, codexState: "codex-on" as const };
  const live: LiveAgent[] = [agent({ id: "codex", rcActive: true })];

  it("opens only when RC is on and NOTHING has ever been paired", () => {
    expect(shouldAutoOpenPairing({ ...on, devices: [], live })).toBe(true);
  });

  it("stays shut when a device is already paired (the reported bug)", () => {
    expect(shouldAutoOpenPairing({ ...on, devices: [{ name: "mbp14" }], live })).toBe(false);
  });

  it("stays shut while devices are still LOADING — the cause of that bug", () => {
    // null = the fetch hasn't answered. Treating it as [] popped the wizard open
    // on every visit for a pod that had a paired device all along.
    expect(shouldAutoOpenPairing({ ...on, devices: null, live })).toBe(false);
    expect(shouldAutoOpenPairing({ ...on, devices: [], live: null })).toBe(false);
  });

  it("never re-opens once auto-opened, and never without codex", () => {
    expect(shouldAutoOpenPairing({ ...on, alreadyAutoOpened: true, devices: [], live })).toBe(false);
    expect(shouldAutoOpenPairing({ ...on, hasCodex: false, devices: [], live })).toBe(false);
  });

  it("never opens when remote control isn't on", () => {
    expect(
      shouldAutoOpenPairing({ ...on, codexState: "codex-off", devices: [], live }),
    ).toBe(false);
  });
});
