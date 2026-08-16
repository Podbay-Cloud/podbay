import type { LifecycleInterval } from "@podbay/control-plane";

/**
 * A pod's running/suspended history as a proportional bar, since launch.
 *
 * A Podbay pod runs 24/7 and the ONLY thing that stops it is the owner pressing
 * Suspend — so the bar is two states, running and suspended, nothing else. Updates,
 * resizes and reboots keep the pod running and are NOT drawn as downtime (they're
 * normal operation, and the reconciler's observation gaps aren't real off-time
 * anyway). Real trouble — an OOM, a failed repair — is a CRASH: a red marker on the
 * timeline, visible as such, distinct from a deliberate suspend.
 *
 * Drawn since launch (a different, longer span than the windowed resource charts),
 * so it's labeled and separated rather than stacked flush.
 */

const fmt = (ms: number): string => {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = ms / 60_000;
  if (m < 90) return `${Math.round(m)}m`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

const BAND: Record<string, string> = {
  running: "var(--success, #34d399)",
  suspended: "var(--muted, #3a4358)",
};
const LABEL: Record<string, string> = {
  running: "Running",
  suspended: "Suspended (you paused it)",
};

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function LifecycleTimeline({
  intervals,
  suspends,
  crashes = [],
  maintenance = [],
}: {
  intervals: LifecycleInterval[];
  suspends: number;
  /** Critical incidents (OOM, failed repair) to mark on the bar, epoch ms. Kept for
   * the admin view; the owner cockpit folds these into `maintenance` (orange). */
  crashes?: { at: number; title: string }[];
  /** Momentary events that kept the pod RUNNING — updates, restarts, resizes (and, for
   * the owner view, OOMs the pod survived). Thin ORANGE marks: things happened, but not
   * downtime. Only a suspend (gray) is real off-time. */
  maintenance?: { at: number; title: string }[];
}) {
  if (intervals.length === 0) {
    return (
      <p className="py-1 text-[12.5px] text-muted-foreground">
        No lifecycle history recorded yet.
      </p>
    );
  }

  const start = intervals[0].from;
  const end = intervals[intervals.length - 1].to;
  const total = Math.max(1, end - start);
  const sum = (state: string) =>
    intervals.filter((i) => i.state === state).reduce((a, i) => a + (i.to - i.from), 0);
  const running = sum("running");
  const suspended = sum("suspended");
  const marks = crashes.filter((c) => c.at >= start && c.at <= end);
  const mnt = maintenance.filter((c) => c.at >= start && c.at <= end);
  const ORANGE = "var(--warning, #f59e0b)";

  return (
    <div className="flex flex-col gap-2 py-1">
      {/* The bar, with crash markers overlaid on top of it. */}
      <div className="relative h-4 w-full overflow-hidden rounded bg-white/[0.04]">
        <div className="flex h-full w-full">
          {intervals.map((i, n) => (
            <div
              key={n}
              className="h-full"
              style={{
                width: `${((i.to - i.from) / total) * 100}%`,
                background: BAND[i.state] ?? BAND.running,
              }}
              title={`${LABEL[i.state] ?? i.state} ${fmt(i.to - i.from)} — ${when(i.from)}`}
            />
          ))}
        </div>
        {/* Orange = a momentary event (update/restart/resize/OOM-survived): the pod kept
            running. Thin, so a busy pod isn't a wall of marks. */}
        {mnt.map((c, i) => (
          <span
            key={`m${i}`}
            className="absolute top-0 h-full w-px -translate-x-1/2"
            style={{ left: `${((c.at - start) / total) * 100}%`, background: ORANGE }}
            title={`${c.title} — ${when(c.at)}`}
          />
        ))}
        {marks.map((c, i) => (
          <span
            key={i}
            className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-destructive"
            style={{ left: `${((c.at - start) / total) * 100}%` }}
            title={`${c.title} — ${when(c.at)}`}
          />
        ))}
      </div>

      {/* Start and end sit UNDER the ends of the bar they describe. */}
      <div
        data-testid="lifecycle-window"
        className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/60"
      >
        <span>{when(start)}</span>
        <span>{when(end)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: BAND.running }} />
          running <span className="tabular-nums text-foreground/80">{fmt(running)}</span>
        </span>
        {suspended > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: BAND.suspended }} />
            suspended <span className="tabular-nums text-foreground/80">{fmt(suspended)}</span>
            {suspends > 0 && <span>· {suspends}×</span>}
          </span>
        )}
        {mnt.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-px" style={{ background: ORANGE }} />
            {mnt.length} update{mnt.length > 1 ? "s" : ""}/restart{mnt.length > 1 ? "s" : ""}
          </span>
        )}
        {marks.length > 0 && (
          <span className="flex items-center gap-1.5 text-destructive">
            <span className="h-2 w-[2px] bg-destructive" />
            {marks.length} crash{marks.length > 1 ? "es" : ""}
          </span>
        )}
        <span className="ml-auto tabular-nums">{fmt(total)} since launch</span>
      </div>

      {/* Say what the bar does NOT show, so its all-green doesn't read as "nothing
          ever happened". Updates/restarts are orange marks, not downtime; only a suspend is. */}
      <p className="text-[11px] text-muted-foreground/70">
        Your pod runs continuously. Updates and restarts keep it running (not shown as downtime);
        only a suspend you trigger interrupts it.
      </p>
    </div>
  );
}
