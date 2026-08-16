import type { PodEvent, PodStatus } from "./types.js";

/**
 * Lifecycle metrics DERIVED from the append-only event log — nothing here is
 * stored (docs/plans/observability-plan.md). Fold the stream into intervals:
 * a `created`/`running` opens a RUNNING stretch, an OWNER suspend closes it into
 * a SUSPENDED stretch until the next `running`.
 *
 * The model is deliberately two-state — running vs suspended — because a Podbay
 * pod runs 24/7 and the ONLY thing that legitimately stops it is the owner pressing
 * Suspend. It never sleeps itself. Everything else the log records about "down" time
 * is NOT off-time:
 *   - A platform restart (image update, resize, reboot) is recorded as
 *     `sleeping reason=reconciled` → `running`, but the pod was only restarting; that
 *     is normal operation, not the owner suspending, and it does NOT count as off.
 *   - The gap between a reconciler-observed sleep and the next observed wake is mostly
 *     UNOBSERVED time (reconcile only samples on page-load), so its duration is not
 *     even real downtime. Counting it as anything is a lie.
 * So reconciled/idle sleeps are ignored here entirely. Real trouble — an OOM, a crash,
 * a failed repair — is surfaced separately as an INCIDENT (see incidents.ts), shown as
 * a marker on the timeline, not folded into a suspended stretch of made-up length.
 *
 * Why derive rather than store: a counter updated on every transition drifts the
 * moment one write is missed (and ours are best-effort by design — observability
 * must never break a pod op). Replaying the log is always consistent with what we
 * actually observed, and it can be recomputed after a bug fix.
 */

/** One observed stretch in a pod's life. `to` is `now` for the open interval. */
export interface LifecycleInterval {
  /** Epoch ms — numbers, not ISO, because the only consumer does width math. */
  from: number;
  to: number;
  state: "running" | "suspended";
}

export interface PodUsage {
  podId: string;
  ownerId: string;
  /** Total ms the pod was running. */
  runningMs: number;
  /** Total ms the OWNER had it suspended, INCLUDING the still-open suspend up to
   * `now`. Time before the first recorded event is not counted — it's unobserved. */
  suspendedMs: number;
  /** How many times the owner suspended it. 0 with a live running interval = "never
   * suspended". Platform restarts are NOT counted. */
  suspends: number;
  /** Ms of the currently-open running interval, or null when not running. */
  currentRunningMs: number | null;
  /** Ms of the currently-open suspend, or null when not suspended. Exactly one of
   * currentRunningMs / currentSuspendedMs is non-null for a live pod. */
  currentSuspendedMs: number | null;
  destroyed: boolean;
  /** The running/suspended stretches these totals are made of, oldest first.
   * Emitted from the SAME fold that produces the totals so a timeline and the numbers
   * beside it cannot disagree. */
  intervals: LifecycleInterval[];
  /** ISO timestamp of the FIRST observed event — the start of the window these
   * totals cover. Time before it is unobserved (events only exist from the day
   * instrumentation shipped, no backfill), so the UI must label totals "since"
   * this, or a legacy pod's tiny early window reads as a wrong lifetime total. */
  since: string;
}

const OPENS = new Set(["created", "running"]);

const reasonOf = (e: PodEvent): unknown =>
  e.meta && typeof e.meta === "object" ? (e.meta as { reason?: unknown }).reason : undefined;

/**
 * Does this event represent the OWNER suspending the pod?
 *
 * Only a `sleeping` the owner performed counts. `reason: "reconciled"` is the
 * reconciler observing the machine down out of band (a restart/reboot/crash — never
 * the owner) and `reason: "idle"` is the retired Fly auto-suspend (a pod suspending
 * ITSELF, which 24/7 pods no longer do); both are ignored. A `sleeping` with no
 * reason is a legacy explicit suspend and is kept — we do not launder away user
 * actions to tidy a chart.
 */
function isOwnerSuspend(e: PodEvent): boolean {
  // `sleeping` is the legacy token for the same event, kept here so history logged
  // before the 2026-08-02 rename to `suspended` still folds (rows are migrated, but
  // the reader stays tolerant — the audit log is append-only and long-lived).
  if (e.type !== "suspended" && e.type !== "sleeping") return false;
  const reason = reasonOf(e);
  return reason !== "reconciled" && reason !== "idle";
}

/**
 * Fold one pod's events (any order) into usage. `now` closes a still-open interval
 * so a live pod reports real current uptime.
 *
 * `currentStatus` (the pod's authoritative live status) reconciles the trailing
 * interval with reality: the event log is best-effort and misses transitions before
 * it shipped, so what it implies about NOW can be flatly wrong; the live status wins
 * for the current interval only.
 */
export function usageForPod(
  events: PodEvent[],
  now = Date.now(),
  currentStatus?: PodStatus,
): PodUsage | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const first = sorted[0]!;

  // `openedAt` marks the start of the current running interval, `closedAt` the start
  // of the current suspend. Exactly one is non-null between transitions.
  let runningMs = 0;
  let suspendedMs = 0;
  let suspends = 0;
  let openedAt: number | null = null;
  let closedAt: number | null = null;
  let destroyed = false;
  const intervals: LifecycleInterval[] = [];
  // Zero-length stretches are dropped: they are transitions, not time spent, and a
  // sliver nobody can see still shifts every neighbour's width.
  const mark = (from: number, to: number, state: "running" | "suspended") => {
    if (to > from) intervals.push({ from, to, state });
  };

  for (const e of sorted) {
    const at = Date.parse(e.at);
    if (OPENS.has(e.type)) {
      // A repeat open (reconcile re-confirming "running", or a `running` after a
      // platform restart we ignored) is a no-op — the running interval just continues.
      if (openedAt === null) {
        openedAt = at;
        if (closedAt !== null) {
          // Resume from an owner suspend: close the suspend, reopen running.
          suspendedMs += at - closedAt;
          mark(closedAt, at, "suspended");
          closedAt = null;
        }
      }
    } else if (e.type === "destroyed") {
      if (openedAt !== null) {
        runningMs += at - openedAt;
        mark(openedAt, at, "running");
        openedAt = null;
      }
      closedAt = null; // gone, not suspended — stop the clock.
      destroyed = true;
    } else if (isOwnerSuspend(e)) {
      if (openedAt !== null) {
        // Running → suspended: close running, open a suspend.
        runningMs += at - openedAt;
        mark(openedAt, at, "running");
        suspends += 1;
        openedAt = null;
        closedAt = at;
      } else if (closedAt === null) {
        // Unpaired suspend — the log begins mid-suspend (no backfill). Mark when the
        // CURRENT suspend began so the next resume can measure it.
        closedAt = at;
      }
    }
    // Any other event (a reconciled/idle sleep, an update_started/updated, a
    // resize, an oom_killed, …) does NOT touch the running/suspended fold. Restarts
    // are normal running; incidents are surfaced separately.
  }

  // Reconcile the trailing interval with the pod's REAL status. The log misses
  // transitions from before it shipped, so what it implies about NOW can be wrong;
  // the live status is authoritative for the current interval.
  if ((currentStatus === "suspended" || currentStatus === "gone") && openedAt !== null) {
    // Log says running, reality says suspended/gone → hand the trailing span to the
    // suspend clock (its true running duration up to the suspend is unobserved, ~0).
    closedAt = openedAt;
    openedAt = null;
  } else if (currentStatus === "running" && openedAt === null && closedAt !== null) {
    // Log says suspended, reality says running → it resumed and we haven't logged it
    // yet; treat it as running from the last thing we saw.
    openedAt = closedAt;
    closedAt = null;
  }
  if (currentStatus === "gone") destroyed = true;

  // Close whichever interval is still open at `now`.
  const currentRunningMs = openedAt !== null ? Math.max(0, now - openedAt) : null;
  if (currentRunningMs !== null) {
    runningMs += currentRunningMs;
    mark(openedAt!, now, "running");
  }
  const currentSuspendedMs =
    openedAt === null && closedAt !== null && !destroyed ? Math.max(0, now - closedAt) : null;
  if (currentSuspendedMs !== null) {
    suspendedMs += currentSuspendedMs;
    mark(closedAt!, now, "suspended");
  }

  return {
    podId: first.podId,
    ownerId: first.ownerId,
    runningMs,
    suspendedMs,
    suspends,
    currentRunningMs,
    currentSuspendedMs,
    destroyed,
    intervals: intervals.sort((a, b) => a.from - b.from),
    since: sorted[0].at,
  };
}

/** Fold ALL events into per-pod usage (the fleet view). `statusByPod` supplies each
 * pod's authoritative live status so the trailing interval matches reality. */
export function usageByPod(
  events: PodEvent[],
  now = Date.now(),
  statusByPod?: Map<string, PodStatus>,
): PodUsage[] {
  const byPod = new Map<string, PodEvent[]>();
  for (const e of events) {
    const list = byPod.get(e.podId);
    if (list) list.push(e);
    else byPod.set(e.podId, [e]);
  }
  return [...byPod.entries()]
    .map(([podId, es]) => usageForPod(es, now, statusByPod?.get(podId)))
    .filter((u): u is PodUsage => u !== null);
}
