import type { RcState } from "@podbay/shared/protocol";
import type { GateKind } from "@podbay/shared/pane";

/**
 * The single RC lifecycle classifier — health reporting, automatic recovery, and doctor all consume
 * this ONE function so they cannot disagree about what state RC is in (design.md, decision 2). Pure:
 * every input is a pre-derived boolean/enum, never raw pane text or a session URL/credential, so the
 * function does no I/O and never risks logging anything sensitive (the same privacy-adjacent
 * constraint `rc-session-identity.ts` established for the title-ownership decision).
 *
 * See openspec/changes/rc-reconnect-hardening/design.md, "### 2. Model RC lifecycle outcomes, not
 * provider lifecycle labels" and openspec/changes/rc-reconnect-hardening/specs/pod-agent/spec.md,
 * "Requirement: Claude Remote Control lifecycle state is current and classified" for the scenarios
 * this precedence order is derived from.
 */
export interface RcStateInput {
  /** `credentialState(...).authed` — file-based, current, token-aware (false once hard-expired or
   * never signed in; NOT mere file-presence, see server.ts's agentStates() comment). */
  authed: boolean;
  /** `credentialState(...).expired` — the credential file's own hard-expiry flag specifically (kept
   * distinct from `!authed` so a future decoupling of `authed`'s definition can't silently change
   * this classifier's behavior; today the two always agree). */
  loginExpired: boolean;
  /** `authFailureInPane(pane)`, already debounced by the caller (pod-agent's `primaryNeedsReauth`) so
   * a transient one-tick blip never reaches this classifier as a failure. */
  liveAuthFailure: boolean;
  /** `classifyGate(pane)` — the named gate the current pane is showing, or null for none. */
  gate: GateKind | null;
  /** A Claude RC session URL has been captured (this tick or a sticky prior one) — a BOOLEAN, never
   * the URL itself (see the module doc). By itself this is NOT sufficient for `active` — see the
   * "stale URL" scenario — but combined with no login problem and no recovery in flight, it's the
   * only positive liveness evidence the pinned CLI's interactive mode currently exposes. */
  hasSessionUrl: boolean;
  /** A bounded auto-restore attempt is currently owed and has not yet exhausted its cap — i.e. an
   * attempt is actively being tried (or about to be). */
  recovering: boolean;
  /** The bounded auto-restore attempt exhausted its cap without observing RC active. */
  recoveryGaveUp: boolean;
  /** Control was deliberately yielded to an external harness (T3) — `existsSync(CLAUDE_RC_OFF)`.
   * Podbay is not the one observing or driving RC while this is true. */
  rcYielded: boolean;
}

export function classifyRcState(input: RcStateInput): RcState {
  // Login problems always win, over every other signal. `recovering` and `down` both presuppose a
  // valid login (design.md decisions 2 and 5 — doctor/auto-restore only ever act "for down with a
  // valid login"), and a current blocking login/OAuth dialog must outrank a still-present-looking
  // credential file (the exact test:1 regression this change fixes) rather than being read as a
  // healthy login with RC merely down.
  const loginBlocked =
    !input.authed ||
    input.loginExpired ||
    input.liveAuthFailure ||
    input.gate === "login-menu" ||
    input.gate === "oauth-retry";
  if (loginBlocked) return "login-required";

  // Deliberately yielded to T3 (CLAUDE_RC_OFF): Podbay is not the one observing or driving RC here,
  // so neither `down` (which would invite doctor/auto-restore to "fix" something that isn't theirs to
  // touch) nor `active` (which Podbay cannot currently vouch for) is honest. The design specifies
  // exactly 5 states and no 6th — `unknown` ("RC could not be verified, offer diagnosis not a
  // success") is the closest honest fit; this is a flagged deviation from a literal reading of the
  // task brief's classifier sketch, not an invented state. See the task's commit message for the full
  // reasoning trail.
  if (input.rcYielded) return "unknown";

  // A bounded restore attempt is in flight — not yet proof of active, but not a bare "down" either;
  // it outranks a merely-captured URL (a restore in progress means the prior URL was already known
  // stale — that's WHY a restore is running).
  if (input.recovering) return "recovering";

  // The bounded restore exhausted its cap without observing active — confirmed unavailable, with a
  // valid login (loginBlocked already returned above otherwise).
  if (input.recoveryGaveUp) return "down";

  // A captured session URL, no login problem, no recovery in flight and none exhausted: the only
  // positive liveness evidence the pinned CLI exposes today.
  if (input.hasSessionUrl) return "active";

  // No URL ever captured, nothing in progress, nothing exhausted — genuinely insufficient evidence.
  // Never guessed as active from a process or a prior successful connection.
  return "unknown";
}

/**
 * Should a bounded RC restore attempt (driving the greeter, spending a slot in the auto-restore
 * budget) proceed for the given CURRENT classified state? `login-required` is the one state a restore
 * can never fix — the greeter's `/remote-control` is refused by a logged-out CLI and would either
 * no-op behind the pane-safety guards or burn a wasted attempt against a state only the owner's own
 * `/login` can clear (design.md, "### 5. Doctor and the cockpit consume the same state and fix
 * primitive": doctor/auto-restore only ever act "for down with a valid login"). Every other state is
 * safe to attempt: `active`/`recovering` make the call moot (nothing to fix, or already in flight) and
 * `down`/`unknown` are exactly what a restore exists to try.
 *
 * Pure and tiny on purpose — the point isn't the branching (trivial), it's giving
 * `reenableRemoteControl`/`/agent/rc-restore` (server.ts) a single named decision that a fast unit test
 * can pin down without a tmux/PTY harness, mirroring `rc-session-identity.ts`'s `decideRcRename`.
 */
export function shouldAttemptRcRestore(rcState: RcState): boolean {
  return rcState !== "login-required";
}

/**
 * Is the RC-off sentinel an ORPHAN — present with no external harness to justify it?
 *
 * `CLAUDE_RC_OFF` means "T3 (an external harness) drives Claude here", and every Podbay RC path
 * returns early on it: the greeter, the fail-state watchdog, `reenableRemoteControl`, and
 * `/agent/rc-restore`. That is correct while T3 really is in control — and catastrophic when it
 * isn't, because the pod then has NO remote control AND no resume nudge on every restart, forever,
 * with no error anywhere. The only symptom the owner sees is "my agent stopped greeting me after a
 * restart".
 *
 * It strands pods because BOTH removal paths are best-effort: `clearT3Failure`'s rollback issues
 * `execRcYield(…, false)` as a `curl … || true` (swallows failure in the shell) wrapped in a
 * `.catch(() => undefined)` (swallows it again in TS). One missed call during a failed T3 enable —
 * exactly when the pod is least healthy — leaves the marker behind permanently. Observed on podbay
 * `first10`: marker written 2026-08-23T15:25:26Z by a T3 enable that ended `t3Stage="error"`, still
 * there 2026-08-29 with `t3Control=false`, an EMPTY `startup.json` and no t3 process.
 *
 * Safe to clear because of ordering: a real handover runs `podbay startup add --slug t3-code`
 * BEFORE `execRcYield(…, true)` writes the marker (`startT3Enable`), and the entry is durable
 * across restarts. So "marker present, `t3-code` entry absent" is never a legitimate state — it can
 * only mean the harness never registered or was already torn down. Deliberately keyed to the
 * durable registration and NOT to a live process, so a pod that reboots with T3 legitimately
 * enabled (entry present, `t3 serve` not up yet) is never mistaken for an orphan.
 */
export function isOrphanedRcYield(input: {
  markerExists: boolean;
  t3StartupRegistered: boolean;
}): boolean {
  return input.markerExists && !input.t3StartupRegistered;
}
