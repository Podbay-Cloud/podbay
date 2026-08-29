import { describe, it, expect } from "vitest";
import { agentCardState, isManagedableState, SPAWN_GRACE_MS, type LiveAgent } from "@/lib/agent-card-state";

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

  it("an EXPIRED login reads as login-expired, distinct from never-signed-in", () => {
    expect(
      agentCardState({
        ...base,
        id: "claude-code",
        live: [{ id: "claude-code", window: 0, authed: false, loginExpired: true, rcActive: false }],
      }),
    ).toBe("login-expired");
  });

  it("a LIVE mid-session logout (needsReauth) reads as login-expired too, even while authed=true", () => {
    // The file still looks valid (authed true) but the terminal showed a logout — same reconnect card.
    expect(
      agentCardState({
        ...base,
        id: "claude-code",
        live: [{ id: "claude-code", window: 0, authed: true, needsReauth: true, rcActive: false }],
      }),
    ).toBe("login-expired");
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

  // rc-reconnect-hardening §4.1: the shared `rcState` classification (packages/pod-agent/src/rc-state.ts)
  // replaces the old "Signed in — turning on remote control…" catch-all, which conflated four
  // genuinely different situations into one misleading "in progress" message. Each rcState maps to its
  // own honest CardState, per design.md's "Doctor and the cockpit consume the same state" mapping.
  describe("rcState-aware Claude states (rc-reconnect-hardening)", () => {
    it("test:1's case: rcState 'login-required' maps to login-expired (Reconnect), even though authed=true and no loginExpired/needsReauth flag is set", () => {
      // The blocked-OAuth-retry-dialog case: the credential file still looks present (authed=true) but
      // the backend classifier already knows the login is blocked. This must NOT read as claude-ready.
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [agent({ id: "claude-code", authed: true, rcState: "login-required" })],
        }),
      ).toBe("login-expired");
    });

    it("rcState 'down' with a valid login offers Restore remote control, distinct from the generic 'unknown'", () => {
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [agent({ id: "claude-code", authed: true, rcState: "down" })],
        }),
      ).toBe("claude-down");
    });

    it("rcState 'recovering' shows bounded progress and is never promoted to claude-linked, even if a stale session URL is still present", () => {
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [
            agent({
              id: "claude-code",
              authed: true,
              rcState: "recovering",
              sessionUrl: "https://claude.ai/code/session_stale",
            }),
          ],
        }),
      ).toBe("claude-recovering");
    });

    it("rcState 'unknown' says RC could not be verified — never an endless 'turning on' state and never a stale success", () => {
      const st = agentCardState({
        ...base,
        id: "claude-code",
        live: [agent({ id: "claude-code", authed: true, rcState: "unknown" })],
      });
      expect(st).toBe("claude-rc-unknown");
      // Must not collide with the pre-existing "unknown" (which means "the pod itself hasn't answered"
      // — a completely different situation a consumer can no longer tell apart from "RC unverifiable").
      expect(st).not.toBe("unknown");
      expect(st).not.toBe("claude-ready");
      expect(st).not.toBe("starting");
    });

    it("rcState 'active' still reads as claude-linked, exactly like today's URL-presence check", () => {
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [
            agent({
              id: "claude-code",
              authed: true,
              rcState: "active",
              sessionUrl: "https://claude.ai/code/session_x",
            }),
          ],
        }),
      ).toBe("claude-linked");
    });

    it("backward compat: an OLDER pod image reporting no rcState at all behaves EXACTLY as before this change", () => {
      // authed, no session URL anywhere → claude-ready (unchanged)
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [agent({ id: "claude-code", authed: true })],
        }),
      ).toBe("claude-ready");
      // authed, with a session URL → claude-linked (unchanged)
      expect(
        agentCardState({
          ...base,
          id: "claude-code",
          live: [
            agent({ id: "claude-code", authed: true, sessionUrl: "https://claude.ai/code/session_x" }),
          ],
        }),
      ).toBe("claude-linked");
    });

    // Regression: while a pod is yielded to T3 (CLAUDE_RC_OFF), the backend classifier reports
    // rcState:"unknown" for the primary Claude (rc-state.ts's rcYielded precedence — checked BEFORE
    // hasSessionUrl, so it wins even if a stale session URL is still on file), which now maps to the
    // new "claude-rc-unknown" CardState. The T3-managed row dimming (agent-cards.tsx's `managed` check)
    // must still treat this as "an otherwise-healthy agent T3 owns" — not as "RC couldn't be verified,
    // here's a diagnosis" — or a T3-controlled pod's Claude row shows the wrong message entirely.
    it("isManagedableState covers every rcState-derived Claude state, not just the pre-existing two", () => {
      expect(isManagedableState("claude-ready")).toBe(true);
      expect(isManagedableState("claude-linked")).toBe(true);
      expect(isManagedableState("claude-down")).toBe(true);
      expect(isManagedableState("claude-recovering")).toBe(true);
      expect(isManagedableState("claude-rc-unknown")).toBe(true);
      expect(isManagedableState("codex-on")).toBe(true);
      expect(isManagedableState("codex-off")).toBe(true);
      // States that must NEVER be dimmed to "managed by T3" — they need the owner's attention
      // regardless of who's driving the session.
      expect(isManagedableState("login-expired")).toBe(false);
      expect(isManagedableState("needs-signin")).toBe(false);
      expect(isManagedableState("not-running")).toBe(false);
      expect(isManagedableState("starting")).toBe(false);
      expect(isManagedableState("unknown")).toBe(false);
    });
  });
});

// `shouldAutoOpenPairing` was removed (rc-reconnect-hardening §6): an empty/loading
// remembered-device list means "Podbay remembers no labels," not "nothing is paired" or
// "onboarding is incomplete," so pairing no longer has an auto-open path to unit-test here —
// there is no pure function left to call. The regression this used to guard (RC on + empty
// device list must NOT navigate to the full-page wizard, including across a delayed Codex-live
// update, Back, and reload) is covered end-to-end in
// apps/web/e2e/multi-agent.spec.ts ("Codex pairing is explicit, Back survives reload, and
// confirmation returns with the device pill"), which is the level where "no unwanted navigation
// happened" is actually observable.
