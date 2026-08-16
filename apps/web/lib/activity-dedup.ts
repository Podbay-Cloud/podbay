/**
 * Restart-noise dedup for the activity timeline.
 *
 * ONE physical restart emits several rows: the explicit cause (`updated` / `resized`) PLUS the
 * reconciler's echo of the machine bouncing — a `suspended`(reconciled) "Restarted (update or
 * reboot)" and a `running`(reconciled) "Back online after a restart". Three lines for one event
 * reads as noise and looks like a repeat. Keep exactly ONE line per restart:
 *   - the reconciled "Back online" tail is ALWAYS redundant (an update line, or the "Restarted"
 *     line, already tells the story) → drop it;
 *   - the reconciled "Restarted" is redundant when an explicit update/resize nearby already names
 *     the cause → drop it then; keep it only as the lone signal of a spontaneous reboot.
 * Non-restart events pass through untouched.
 *
 * Pure (no server imports) so it is unit-testable and can run either side of the wire.
 */

export interface RestartLike {
  type: string;
  at: string;
  meta: Record<string, unknown> | null;
}

const RESTART_WINDOW_MS = 15 * 60 * 1000;
const isReconciled = (e: RestartLike) => e.meta?.reason === "reconciled";

export function dedupeRestartNoise<T extends RestartLike>(events: T[]): T[] {
  const explicitTimes = events
    .filter((e) => e.type === "updated" || e.type === "resized")
    .map((e) => new Date(e.at).getTime());
  const nearExplicit = (t: number) => explicitTimes.some((x) => Math.abs(x - t) <= RESTART_WINDOW_MS);
  return events.filter((e) => {
    if (e.type === "running" && isReconciled(e)) return false;
    if ((e.type === "suspended" || e.type === "sleeping") && isReconciled(e))
      return !nearExplicit(new Date(e.at).getTime());
    return true;
  });
}
