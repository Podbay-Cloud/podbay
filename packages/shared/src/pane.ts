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
  /bypass permissions mode|do you want to proceed|select login method|use this api key|do you trust the files|yes, i accept|oauth error/i;

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

/** Which known blocking gate a pane is showing. `atBlockingGate` only says "some gate is up, don't
 * type"; the menu WATCHDOG needs to know WHICH one so it can drive the right answer (or surface an
 * owner-decision one). `bypass` is tested with its dual-match so the working status line never counts;
 * `proceed` is the one we deliberately do NOT auto-answer (owner decision). */
export type GateKind =
  | "login-menu"
  | "api-key"
  | "bypass"
  | "trust"
  | "proceed"
  | "login-continue"
  | "oauth-retry";
export function classifyGate(paneText: string): GateKind | null {
  if (atBypassGate(paneText)) return "bypass";
  if (/select login method/i.test(paneText)) return "login-menu";
  if (/use this api key|custom api key in your environment/i.test(paneText)) return "api-key";
  if (/do you trust the files/i.test(paneText)) return "trust";
  if (/do you want to proceed/i.test(paneText)) return "proceed";
  // The post-login "Login successful. Press Enter to continue…" screen: a dismiss-with-Enter
  // confirmation, NOT an owner decision. Left unhandled it sat forever as `dialog open`, which the
  // dashboard reads as "Needs you" even though sign-in fully succeeded (makore.app dev, 2026-08-26).
  if (/press enter to continue/i.test(paneText)) return "login-continue";
  // A pasted OAuth code the server rejected: "OAuth error: Invalid code … Press Enter to retry."
  // Enter here RESUBMITS the same dead code — it is not a dismiss-and-move-on gate like the one
  // above, so it must stay unanswerable and route to login-required (test:1, 2026-08-26/27).
  if (/oauth error/i.test(paneText)) return "oauth-retry";
  return null;
}

/**
 * The agent's own LIVE auth-failure output — the signal a mid-session logout leaves in the terminal
 * that the credential FILE misses (a refresh that failed while the stored hard-expiry is still in the
 * future). Claude prints "Login expired · Please run /login"; the remote-control worker reports
 * `worker_auth_expired` / "sign in again" (velsa hit both, 2026-08-23). A rejected OAuth code during a
 * fresh /login is the same shape of blind spot — the OLD credential file still parses as unexpired, so
 * file-based `authed` alone reports fine while the pane is stuck needing a human to retry sign-in
 * (test:1, 2026-08-26/27). Kept deliberately specific so it never matches ordinary output. A caller
 * debounces (must persist across ticks) before acting, and clears it the moment the agent reads authed
 * again. `login method` is EXCLUDED — that is the menu (classifyGate handles it), not a failure.
 */
const AUTH_FAILURE_RE =
  /login expired|please run \/login|worker[_ ]auth[_ ]expired|(?:needs to |please )?sign in again|session initialization failed|oauth error/i;
export function authFailureInPane(paneText: string): boolean {
  return AUTH_FAILURE_RE.test(paneText) && !/select login method/i.test(paneText);
}
