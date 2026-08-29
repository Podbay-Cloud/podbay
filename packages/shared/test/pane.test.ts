import { describe, it, expect } from "vitest";
import {
  agentGone,
  atBlockingGate,
  atBypassGate,
  paneAcceptsInput,
  classifyGate,
  authFailureInPane,
} from "../src/pane.js";

// The real "Select login method" menu (Claude 2.1.215) that hung velsa's Reconnect, 2026-08-22.
const LOGIN_MENU = `  Login
  Select login method:
  ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise
    2. Anthropic Console account · API usage billing`;

// The actual gate text a live pod showed (strategic-squid-1ed0, 2026-07-28).
const BYPASS_GATE = `
WARNING: Claude Code running in Bypass Permissions mode

In Bypass Permissions mode, Claude Code will not ask for your approval before
running potentially dangerous commands.

  ❯ 1. No, exit
    2. Yes, I accept

Enter to confirm · Esc to cancel
`;

// The WORKING status line after acceptance — must NOT be mistaken for the gate.
const WORKING = `
❯ Try "refactor <filepath>"
────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
`;

// The exact live pane on test:1 (2026-08-26/27): a fresh /login attempt whose pasted OAuth code was
// rejected. The credential FILE still parses as unexpired (a prior login), so health reported
// authed:true, rcActive:false — read by the cockpit as "Signed in — turning on remote control…" and by
// automatic RC restore as "just re-run /remote-control", which instead retypes into this dialog
// ("Press Enter to retry" — Enter resubmits the same dead code). Neither reads as recovery: only the
// owner completing a fresh /login can clear it.
const OAUTH_RETRY_GATE = `
 OAuth error: Invalid code. Please make sure the full code was copied
 Press Enter to retry.
`;

describe("atBypassGate", () => {
  it("detects the real acceptance gate", () => {
    expect(atBypassGate(BYPASS_GATE)).toBe(true);
  });

  it("does NOT fire on the working 'bypass permissions on' status line", () => {
    // This is the regression that a naive /bypass permissions/ match would cause:
    // auto-answering a healthy session and injecting a stray keystroke.
    expect(atBypassGate(WORKING)).toBe(false);
  });

  it("needs BOTH the mode warning and the accept choice", () => {
    expect(atBypassGate("Bypass Permissions mode")).toBe(false); // warning alone
    expect(atBypassGate("2. Yes, I accept")).toBe(false); // choice alone
  });

  it("is not confused by a normal prompt", () => {
    expect(atBypassGate('❯ Try "write a test"')).toBe(false);
  });
});

describe("pane safety predicates", () => {
  it("agentGone detects the exited-agent sentinel", () => {
    expect(agentGone("PODBAY-AGENT-EXITED - the agent is NOT running.")).toBe(true);
    expect(agentGone('❯ Try "x"')).toBe(false);
  });

  it("atBlockingGate treats the bypass gate as a gate too", () => {
    // atBypassGate is the specific answerable case; atBlockingGate is the broad
    // 'do not type the kickoff here' guard. The bypass gate is in both.
    expect(atBlockingGate(BYPASS_GATE)).toBe(true);
  });

  // test:1, 2026-08-26/27: nothing recognized this pane as a gate, so paneAcceptsInput said "safe to
  // type" and automatic RC restore retried into it (Enter resubmits the dead code — the "3x" hammering
  // in 0audit). A blocking OAuth error must never look typeable.
  it("atBlockingGate treats a rejected OAuth code retry as a gate — never type into it", () => {
    expect(atBlockingGate(OAUTH_RETRY_GATE)).toBe(true);
  });

  it("paneAcceptsInput is false at any gate or dead pane, true at a live prompt", () => {
    expect(paneAcceptsInput(BYPASS_GATE)).toBe(false);
    expect(paneAcceptsInput("PODBAY-AGENT-EXITED")).toBe(false);
    expect(paneAcceptsInput(OAUTH_RETRY_GATE)).toBe(false);
    expect(paneAcceptsInput('❯ Try "x"')).toBe(true);
  });

  it("authFailureInPane catches a LIVE logout the credential file would miss", () => {
    expect(authFailureInPane("Login expired · Please run /login")).toBe(true);
    expect(authFailureInPane("Session initialization failed (worker_auth_expired)")).toBe(true);
    expect(authFailureInPane("Your computer needs to sign in again")).toBe(true);
    // The login-method MENU is not a failure — classifyGate owns that.
    expect(authFailureInPane(LOGIN_MENU)).toBe(false);
    expect(authFailureInPane('❯ Try "x"')).toBe(false);
  });

  // The credential FILE still parses as unexpired (a prior login), so file-based `authed` alone
  // reports fine — this is the live signal that must override it and drive the SAME needsReauth path
  // as a mid-session logout, so the cockpit offers Reconnect instead of "turning on remote control…".
  it("authFailureInPane also catches a rejected OAuth code — the login the credential file can't see failed", () => {
    expect(authFailureInPane(OAUTH_RETRY_GATE)).toBe(true);
  });

  it("classifyGate names which gate is showing (for the menu watchdog)", () => {
    expect(classifyGate(LOGIN_MENU)).toBe("login-menu");
    expect(classifyGate(BYPASS_GATE)).toBe("bypass"); // dual-match wins over the login word
    expect(classifyGate(OAUTH_RETRY_GATE)).toBe("oauth-retry");
    expect(classifyGate("Do you trust the files in this folder?")).toBe("trust");
    expect(classifyGate("Do you want to proceed? ❯ 1. Yes")).toBe("proceed");
    expect(classifyGate("Do you want to use this API key from your environment?")).toBe("api-key");
    expect(classifyGate('❯ Try "x"')).toBeNull(); // a live prompt is not a gate
    expect(classifyGate("⏵⏵ bypass permissions on")).toBeNull(); // the working status line, not the gate
    // The post-login confirmation — sign-in succeeded but the agent sits until Enter; the watchdog
    // must recognize it so it doesn't read as "Needs you" forever (makore.app dev, 2026-08-26).
    expect(classifyGate("Login successful. Press Enter to continue…")).toBe("login-continue");
  });
});
