import { describe, it, expect } from "vitest";
import { agentGone, atBlockingGate, atBypassGate, paneAcceptsInput } from "../src/pane.js";

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

  it("paneAcceptsInput is false at any gate or dead pane, true at a live prompt", () => {
    expect(paneAcceptsInput(BYPASS_GATE)).toBe(false);
    expect(paneAcceptsInput("PODBAY-AGENT-EXITED")).toBe(false);
    expect(paneAcceptsInput('❯ Try "x"')).toBe(true);
  });
});
