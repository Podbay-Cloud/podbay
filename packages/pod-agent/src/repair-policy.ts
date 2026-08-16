/**
 * How often the pod may repair itself, and when it must stop.
 *
 * Pure and separately testable ON PURPOSE: the dangerous failure here is not a
 * missed repair, it is an infinite one — a CLI that crashes at start would be
 * respawned forever, burning the pod's CPU and filling the event log, and a user
 * who deliberately quit their agent would be fighting a machine that keeps
 * putting it back. The cap is the whole safety argument, so it lives where a unit
 * test can pin it down rather than inside a tick that needs a live pod.
 */

/** Attempts allowed per target within the window before we stop trying. */
export const MAX_ATTEMPTS = 3;
/** Rolling window the attempts are counted in. */
export const WINDOW_MS = 60 * 60 * 1000;
/** Wait after the Nth attempt before another is allowed (index = attempts so far). */
export const BACKOFF_MS = [5_000, 30_000, 5 * 60_000];
/**
 * After a target is CAPPED, how long to wait before a single spaced-out RECOVERY attempt.
 * This is what lets an unattended pod self-heal instead of sitting wedged until a reboot —
 * but it is OPT-IN per target (see `recoveryDue`): the caller decides whether a target should
 * self-recover. The dev server does (paired with a build-cache wipe); the AGENT watchdog does
 * NOT — a deliberately-quit agent must stay quit, not be re-put-back every ten minutes.
 */
export const RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;

export interface RepairAttempt {
  at: number;
  ok: boolean;
}

export interface RepairDecision {
  /** May we act right now? */
  allow: boolean;
  /** Why not, when `allow` is false — 'backoff' is temporary, 'capped' is not. */
  reason?: "backoff" | "capped";
  /** How many attempts remain in the window (for logging/events). */
  remaining: number;
}

/**
 * Decide whether a repair may run for one target.
 *
 * `history` is that target's attempts, newest or oldest first — order does not
 * matter, only timestamps. Attempts outside the window are ignored, so a pod that
 * misbehaves once an hour is repaired every time rather than being written off
 * forever after three bad minutes.
 */
export function shouldRepair(history: RepairAttempt[], now: number): RepairDecision {
  const recent = history.filter((a) => now - a.at < WINDOW_MS);
  const remaining = Math.max(0, MAX_ATTEMPTS - recent.length);
  if (recent.length >= MAX_ATTEMPTS) return { allow: false, reason: "capped", remaining: 0 };

  const last = recent.reduce<number | null>((m, a) => (m === null || a.at > m ? a.at : m), null);
  if (last !== null) {
    const wait = BACKOFF_MS[Math.min(recent.length - 1, BACKOFF_MS.length - 1)];
    if (now - last < wait) return { allow: false, reason: "backoff", remaining };
  }
  return { allow: true, remaining };
}

/** Drop attempts that have aged out, so the record can't grow without bound. */
export function pruneHistory(history: RepairAttempt[], now: number): RepairAttempt[] {
  return history.filter((a) => now - a.at < WINDOW_MS);
}

/**
 * A target is unhealthy once it has burned its attempts — this is what the
 * cockpit shows instead of a spinner that never resolves.
 */
export function isCapped(history: RepairAttempt[], now: number): boolean {
  return shouldRepair(history, now).reason === "capped";
}

/**
 * For an OPT-IN self-healing target only: once capped, is a spaced-out recovery attempt due?
 *
 * True only when the target is currently capped AND its most recent attempt is older than
 * `RECOVERY_COOLDOWN_MS` — so a wedged dev server gets one careful retry every ~10 minutes
 * (the caller pairs it with a heavier reset, e.g. wiping `.next`) rather than staying dead
 * until the owner reboots. Never call this for the agent watchdog: a user who quit their
 * agent must not be fought. Independent of `shouldRepair`, which stays a hard stop at the cap.
 */
export function recoveryDue(history: RepairAttempt[], now: number): boolean {
  if (!isCapped(history, now)) return false;
  const last = history.reduce<number | null>((m, a) => (m === null || a.at > m ? a.at : m), null);
  return last !== null && now - last >= RECOVERY_COOLDOWN_MS;
}
