import { describe, it, expect } from "vitest";
import { classifyRcState, isOrphanedRcYield, shouldAttemptRcRestore, type RcStateInput } from "../src/rc-state.js";
import type { RcState } from "@podbay/shared/protocol";

/**
 * Pure classifier for the RC lifecycle model (openspec/changes/rc-reconnect-hardening/design.md,
 * decision 2): `active` | `recovering` | `down` | `login-required` | `unknown`. Health reporting,
 * automatic recovery, and doctor all consume this ONE classifier so they cannot disagree — these
 * tests are the exhaustive scenario list from the delta spec (`rc-reconnect-hardening/specs/pod-agent/spec.md`,
 * "Requirement: Claude Remote Control lifecycle state is current and classified").
 *
 * `input` fields are pre-derived signals (authed/expired from `credentialState`, `liveAuthFailure`
 * from `authFailureInPane`, `gate` from `classifyGate`, `hasSessionUrl` a BOOLEAN never the URL
 * itself, `recovering`/`recoveryGaveUp` from the pod-agent's bounded auto-restore tracking, and
 * `rcYielded` from `existsSync(CLAUDE_RC_OFF)`) — this function does no I/O of its own.
 */

// A fully-authed, no-failure baseline — each test overrides only the field(s) it's exercising, so a
// new field added to RcStateInput later doesn't silently leave every other test under-specified.
const BASE: RcStateInput = {
  authed: true,
  loginExpired: false,
  liveAuthFailure: false,
  gate: null,
  hasSessionUrl: false,
  recovering: false,
  recoveryGaveUp: false,
  rcYielded: false,
};

describe("classifyRcState", () => {
  it("an active bridge with a captured URL and no failure signal → active", () => {
    expect(classifyRcState({ ...BASE, hasSessionUrl: true })).toBe("active");
  });

  it("a stale URL is not reported as active — current evidence says RC is down → down, not active", () => {
    // GIVEN a Claude session URL was captured earlier but the current TUI reports RC is down
    // (the bounded auto-restore already exhausted its attempts trying to bring it back).
    expect(classifyRcState({ ...BASE, hasSessionUrl: true, recoveryGaveUp: true })).toBe("down");
  });

  it("missing liveness evidence remains unknown — never guessed from a process, URL, or prior success", () => {
    // No URL ever captured, no recovery attempted or exhausted, no failure — genuinely insufficient
    // evidence (e.g. a fresh boot before RC has been established either way).
    expect(classifyRcState({ ...BASE })).toBe("unknown");
  });

  it("a login-menu gate is login-required, not down", () => {
    expect(classifyRcState({ ...BASE, gate: "login-menu" })).toBe("login-required");
  });

  it("test:1's exact invalid-code retry dialog (oauth-retry gate) with a still-valid credential → login-required", () => {
    // The exact test:1 regression (2026-08-26/27): the credential FILE still parses as unexpired
    // (authed: true, loginExpired: false) but the live pane shows OAUTH_RETRY_GATE — reused fixture
    // shape from packages/shared/test/pane.test.ts's OAUTH_RETRY_GATE. classifyGate AND
    // authFailureInPane both fire on that fixture, so both signals are set here as they would be from
    // one real pane capture.
    expect(
      classifyRcState({
        ...BASE,
        authed: true,
        loginExpired: false,
        liveAuthFailure: true,
        gate: "oauth-retry",
      }),
    ).toBe("login-required");
  });

  it("a stale credential does not hide a blocking OAuth error — gate alone is enough even if authFailureInPane somehow didn't also fire", () => {
    expect(classifyRcState({ ...BASE, authed: true, gate: "oauth-retry" })).toBe("login-required");
  });

  it("a live auth-failure message (no gate) → login-required", () => {
    // The mid-session-logout case: the CLI printed "Login expired · Please run /login" but no
    // recognized GATE matched (classifyGate returned null) — the live failure signal alone must win.
    expect(classifyRcState({ ...BASE, liveAuthFailure: true })).toBe("login-required");
  });

  it("a hard-expired credential file → login-required, even with no live pane signal at all", () => {
    expect(classifyRcState({ ...BASE, authed: false, loginExpired: true })).toBe("login-required");
  });

  it("never-authenticated (no credential file, not expired either) → login-required, not down", () => {
    // credentialState reports {authed: false, expired: false} for a missing/empty/unreadable file —
    // RC categorically cannot be active without a login, so this must not fall through to "down"
    // (down presupposes a VALID login per design.md decision 2/5) or "unknown" (this is not
    // ambiguous — we know for a fact there's no login yet).
    expect(classifyRcState({ ...BASE, authed: false, loginExpired: false })).toBe("login-required");
  });

  it("a recovering-in-progress case → recovering", () => {
    expect(classifyRcState({ ...BASE, recovering: true })).toBe("recovering");
  });

  it("recovering outranks a captured URL — an in-progress bounded restore is not yet proof of active", () => {
    expect(classifyRcState({ ...BASE, recovering: true, hasSessionUrl: true })).toBe("recovering");
  });

  it("a recovery-exhausted case with no URL at all → down", () => {
    expect(classifyRcState({ ...BASE, recoveryGaveUp: true })).toBe("down");
  });

  it("login-required outranks recovering — a login problem always wins even mid-restore-attempt", () => {
    // recovering only ever fires once the login recovered (failStateWatchdog's own transition logic),
    // but the classifier must not TRUST that invariant blindly — if the caller ever passes
    // recovering:true alongside a login-blocked signal (e.g. a race), login-required must still win,
    // since "recovering" and "down" both presuppose a valid login per design.md decisions 2 and 5.
    expect(classifyRcState({ ...BASE, recovering: true, liveAuthFailure: true })).toBe("login-required");
  });

  it("login-required outranks recoveryGaveUp for the same reason", () => {
    expect(classifyRcState({ ...BASE, recoveryGaveUp: true, gate: "login-menu" })).toBe("login-required");
  });

  it("control deliberately yielded to T3 (CLAUDE_RC_OFF) → unknown, not down and not active", () => {
    // Podbay isn't the one observing/driving RC once yielded, so neither "down" (which would invite
    // doctor/auto-restore to try fixing something that isn't theirs to fix) nor "active" (which
    // Podbay cannot currently vouch for) is honest — mapped to unknown, the deliberate 5th-state
    // choice documented in design.md's "exactly 5 states" constraint. See the commit message / task
    // report for the full reasoning — this is a flagged deviation from a literal reading of the task
    // brief's sketch, not an invented 6th state.
    expect(classifyRcState({ ...BASE, rcYielded: true, hasSessionUrl: true })).toBe("unknown");
  });

  it("yielded-to-T3 does not report down even when a recovery attempt had already given up", () => {
    expect(classifyRcState({ ...BASE, rcYielded: true, recoveryGaveUp: true })).toBe("unknown");
  });

  it("login-required still outranks a T3 yield — a real login problem is never hidden by yielding", () => {
    expect(classifyRcState({ ...BASE, rcYielded: true, gate: "login-menu" })).toBe("login-required");
  });
});

/**
 * `shouldAttemptRcRestore` is the pure decision extracted alongside the classifier so
 * `reenableRemoteControl`/`/agent/rc-restore` (and their tests) don't need a full
 * AgentServer/tmux harness to prove the "login-required skips the restore attempt" gate (task 3.3).
 * A restore attempt (driving the greeter, spending a bounded auto-restore attempt) is only ever
 * pointless-or-harmful for `login-required` — only the owner's own `/login` can clear that, never a
 * greeter run. Every other state is fine to attempt against (the greeter/recovery primitive's own
 * guards, e.g. yielded-to-T3 or already-active, handle the rest as no-ops or are simply moot).
 */
describe("shouldAttemptRcRestore", () => {
  const ALL_STATES: RcState[] = ["active", "recovering", "down", "login-required", "unknown"];

  it("login-required is the ONE state that skips a restore attempt", () => {
    expect(shouldAttemptRcRestore("login-required")).toBe(false);
  });

  it("every other classified state is fine to attempt", () => {
    for (const s of ALL_STATES.filter((s) => s !== "login-required")) {
      expect(shouldAttemptRcRestore(s)).toBe(true);
    }
  });
});

/**
 * The orphaned RC-off sentinel — the bug that made podbay `first10` stop greeting for six days
 * (marker written 2026-08-23 by a T3 enable that failed; still there 2026-08-29 with
 * `t3Control=false` and an empty `startup.json`). The marker gates the greeter, the watchdog and
 * `/agent/rc-restore`, so an orphan means no remote control AND no resume nudge, silently, forever.
 */
describe("isOrphanedRcYield", () => {
  it("is an orphan when the marker outlived its harness — the first10 state", () => {
    expect(isOrphanedRcYield({ markerExists: true, t3StartupRegistered: false })).toBe(true);
  });

  it("leaves a LEGITIMATE yield alone (T3 registered and in control)", () => {
    expect(isOrphanedRcYield({ markerExists: true, t3StartupRegistered: true })).toBe(false);
  });

  it("does nothing when there is no marker, registered or not", () => {
    expect(isOrphanedRcYield({ markerExists: false, t3StartupRegistered: false })).toBe(false);
    expect(isOrphanedRcYield({ markerExists: false, t3StartupRegistered: true })).toBe(false);
  });

  it("keys on the DURABLE registration, not a live process: a pod rebooting with T3 enabled is not an orphan", () => {
    // `startup add` declares t3-code; `t3 serve` is not up yet this early in boot. Keying the check
    // on a running process instead would clear the marker here and yank control back from T3.
    expect(isOrphanedRcYield({ markerExists: true, t3StartupRegistered: true })).toBe(false);
  });
});
