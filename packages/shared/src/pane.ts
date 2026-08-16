/**
 * Safety predicates for "is this tmux pane safe to type into?".
 *
 * These lived in pod-agent's greeter, which is where they were learned the hard way.
 * They are here because the CONTROL PLANE now also types into a live pane (the
 * pre-interrupt handoff request), and the one thing that must not happen is a second
 * implementation of "looks ready to me" drifting from the first. One definition,
 * two callers.
 */

/** The launcher's "agent process is gone, this is a bare shell" sentinel (boot.ts). */
const AGENT_EXITED_RE = /PODBAY-AGENT-EXITED/;

/** True when the pane is a plain shell because the agent exited — never type here. */
export function agentGone(paneText: string): boolean {
  return AGENT_EXITED_RE.test(paneText);
}

/**
 * Screens that EAT keystrokes and must never be mistaken for "ready to accept a turn".
 *
 * Readiness keys on the "❯" prompt marker — but Claude also renders "❯" as the selected
 * item of a menu, so a modal looks exactly like an input prompt. That is how the
 * 2026-07-24 outage escalated: the "Bypass Permissions mode" gate showed "❯ 1. No, exit",
 * waitReady declared success, and the greeter typed into a modal whose default answer
 * was "exit". Treat a known gate as NOT ready and let it be answered/seeded, never typed at.
 */
const BLOCKING_GATE_RE =
  /bypass permissions mode|do you want to proceed|select login method|use this api key|do you trust the files|yes, i accept/i;

/** True when the pane is showing a gate that swallows keystrokes — never type here. */
export function atBlockingGate(paneText: string): boolean {
  return BLOCKING_GATE_RE.test(paneText);
}

/**
 * The `--dangerously-skip-permissions` acceptance gate specifically — the one that
 * has stranded pods "stuck after signin on RC" over and over.
 *
 * Verified on a live pod 2026-07-28 (Claude 2.1.215): NO config key or flag
 * suppresses this gate. `bypassPermissionsModeAccepted`, `hasTrustDialogAccepted`,
 * and `--allow-dangerously-skip-permissions` were ALL set/tried and it still
 * appeared. Every prior "fix" seeded a key that does not control this gate, which
 * is why it kept regressing on version bumps. The gate cannot be prevented — it
 * must be ANSWERED.
 *
 * And answering is always correct here: the gate asks "is this a sandboxed
 * container/VM with restricted internet that can be restored if damaged?" — which
 * is the definition of a podbay pod. So a greeter that sees this gate accepts it.
 *
 * Requires BOTH the mode warning AND the accept CHOICE so it never matches the
 * working status line ("⏵⏵ bypass permissions on"), which has neither choice.
 */
const BYPASS_ACCEPT_CHOICE_RE = /yes,\s*i\s*accept/i;
export function atBypassGate(paneText: string): boolean {
  return /bypass permissions mode/i.test(paneText) && BYPASS_ACCEPT_CHOICE_RE.test(paneText);
}

/**
 * The single check both callers use before sending keys. Kept as one function so a
 * caller cannot accidentally check one condition and forget the other.
 */
export function paneAcceptsInput(paneText: string): boolean {
  return !agentGone(paneText) && !atBlockingGate(paneText);
}
