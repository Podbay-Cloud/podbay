"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { MetricsSnapshot, MetricSample } from "@podbay/shared/metrics-types";
import { getAdminPodMetrics } from "@/lib/admin-pod-actions";
import { apiGet } from "@/lib/api-fetch";
import { qk } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { activityShare, type ActivityShare } from "@/lib/activity-share";

/**
 * The redesigned Stats tab (docs/plans/stats-redesign-plan.md): resource charts against
 * the reserved-tier ceiling, disk breakdown, agent-activity strip, app health.
 * Running/suspended is demoted to a footer. Charts are inline SVG (no chart lib —
 * CSP + bundle). Polls /metrics via a server action while the tab is open.
 */

const AGENT_COLORS: Record<string, string> = {
  busy: "var(--success, #34d399)",
  shell: "var(--accent-light, #7aa2f7)",
  waiting: "var(--warning, #e0af68)",
  idle: "#526079",
};

function fmtGb(mb: number): string {
  return `${(mb / 1024).toFixed(mb < 10240 ? 1 : 0)} GB`;
}
/** Relative time for the peak-dot tooltip. */
function peakAgo(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function fmtRate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${Math.round(kbps)} kb/s`;
}

/**
 * Inline area sparkline. Values are plotted at equal spacing (index axis) so an
 * active stretch isn't compressed. When `times` + `gapMs` are given, a big jump in
 * timestamp between adjacent samples — a SUSPENDED stretch — breaks the line and
 * drops a faint dashed divider, so the history reads as "paused here" instead of a
 * misleading straight line across the gap.
 */
export function Area({
  values,
  max,
  stroke,
  times,
  gapMs,
  markPeak = false,
  formatValue,
}: {
  values: number[];
  max: number;
  stroke: string;
  times?: number[];
  gapMs?: number;
  /** Dot the highest point — the spike is usually why the chart was opened, and the
   * headline value (last sample) hides it. */
  markPeak?: boolean;
  /** Format a value for the peak dot's hover tooltip (e.g. "56%", "2.1 GB"). */
  formatValue?: (v: number) => string;
}) {
  const W = 100;
  const H = 30;
  if (values.length === 0) return <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" />;
  const n = values.length;
  const x = (i: number) => (n === 1 ? W : (i / (n - 1)) * W);
  const y = (v: number) => H - Math.min(1, Math.max(0, v / (max || 1))) * (H - 2) - 1;
  const peakIdx = markPeak ? values.reduce((best, v, i) => (v > values[best] ? i : best), 0) : -1;

  // Split into contiguous segments, breaking wherever the time gap exceeds gapMs.
  const breaks: number[] = []; // index i where a gap sits between i-1 and i
  if (times && gapMs) {
    for (let i = 1; i < n; i++) {
      if (times[i] - times[i - 1] > gapMs) breaks.push(i);
    }
  }
  const segments: number[][] = [];
  let start = 0;
  for (const b of breaks) {
    segments.push(range(start, b));
    start = b;
  }
  segments.push(range(start, n));

  return (
    <div className="relative h-9 w-full">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-9 w-full">
      {segments.map((seg, si) => {
        if (seg.length === 0) return null;
        const line = seg
          .map((i, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`)
          .join(" ");
        const x0 = x(seg[0]);
        const x1 = x(seg[seg.length - 1]);
        const fill = `${line} L${x1.toFixed(1)},${H} L${x0.toFixed(1)},${H} Z`;
        return (
          <g key={si}>
            <path d={fill} fill={stroke} opacity={0.12} />
            <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {breaks.map((b, i) => {
        const gx = (x(b - 1) + x(b)) / 2;
        return (
          <line
            key={`gap${i}`}
            x1={gx}
            y1={0}
            x2={gx}
            y2={H}
            stroke="var(--muted-foreground, #8891a5)"
            strokeWidth={0.6}
            strokeDasharray="1.5 1.5"
            opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
      {/* Peak dot as an HTML overlay, not an SVG <circle>: the chart uses
          preserveAspectRatio="none" (stretched ~7× wide), which would squash a circle into a
          flat ellipse. Positioning a round element in % keeps it perfectly round. */}
      {peakIdx >= 0 && (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full ring-1 ring-[var(--card,#0b0f17)]"
          style={{
            left: `${(x(peakIdx) / W) * 100}%`,
            top: `${(y(values[peakIdx]) / H) * 100}%`,
            background: stroke,
          }}
          title={`Peak ${formatValue ? formatValue(values[peakIdx]) : values[peakIdx]}${
            times?.[peakIdx] ? ` · ${peakAgo(times[peakIdx])}` : ""
          }`}
        />
      )}
    </div>
  );
}

function fmtAge(ms: number): string {
  if (ms < 60_000) return "now";
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** A real tick axis under each chart: ~5 tick marks with labels, so you can read
 * WHEN a spike happened, and — since all the over-time cards are the same width —
 * a tick lines up vertically across every chart above it.
 *
 * The charts plot by sample INDEX, not linear time (so a busy burst isn't squished
 * against a long idle stretch), so a naive linear time axis would lie. Instead each
 * tick sits at an index fraction and is labeled with the ACTUAL age of the sample
 * there — honest even when a sleep gap sits between two samples. */
function TickAxis({ times }: { times: number[] }) {
  const n = times.length;
  if (n < 2) return null;
  const now = times[n - 1];
  const COUNT = 5;
  const ticks = Array.from({ length: COUNT }, (_, k) => {
    const frac = k / (COUNT - 1);
    const idx = Math.round(frac * (n - 1));
    return { frac, label: k === COUNT - 1 ? "now" : fmtAge(now - times[idx]) };
  });
  return (
    <div className="relative h-4 w-full select-none pt-0.5">
      {ticks.map((t, i) => (
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center gap-0.5"
          style={{
            left: `${t.frac * 100}%`,
            transform:
              i === 0 ? "translateX(0)" : i === COUNT - 1 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          <span className="h-1.5 w-px bg-border/70" />
          <span className="text-[9.5px] tabular-nums text-muted-foreground/60">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The series' own resolution. Median, not mean: one real suspension gap would
 * drag a mean up far enough to hide every gap after it. */
export function medianStep(times: number[]): number {
  if (times.length < 2) return 0;
  const steps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

function MetricCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[13.5px] font-semibold tabular-nums">{value}</span>
      </div>
      {children}
      {sub && <span className="text-[11px] tabular-nums text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** Horizontal used/total bar with a warning tint as it fills. */
function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone = pct > 90 ? "bg-destructive" : pct > 75 ? "bg-warning" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Zoom levels. Each maps to a rollup tier on the pod, so a wider view is not a
 * bigger payload — it is a coarser one. */
const WINDOWS = [
  { label: "1h", ms: 60 * 60_000 },
  { label: "24h", ms: 24 * 60 * 60_000 },
  { label: "7d", ms: 7 * 24 * 60 * 60_000 },
  { label: "30d", ms: 30 * 24 * 60 * 60_000 },
] as const;

export default function PodStats({
  slug,
  footer,
  admin = false,
  oss = false,
  cpus = null,
  memoryMb = null,
}: {
  slug: string;
  /** Quiet running/suspended line (from the event-log usage). */
  footer?: string;
  /** Read through the ADMIN-scoped action: an operator is not the pod's owner, so
   * the owner action would 404 on someone else's pod. */
  admin?: boolean;
  /** Self-host: label limits honestly. `cpus`/`memoryMb` are the pod's explicit caps (null ⇒
   * unlimited — then the CPU/memory/disk readouts reflect the HOST, not a per-pod quota). */
  oss?: boolean;
  cpus?: number | null;
  memoryMb?: number | null;
}) {
  const [windowMs, setWindowMs] = useState<number>(WINDOWS[1].ms);

  // Metrics via react-query, keyed by window (each window is a different rollup tier on the pod, not
  // a bigger payload). Cache + keepPreviousData means switching windows or re-opening Stats paints the
  // last data instantly then refreshes; bounded retry replaces the old hand-rolled slow-timeout+retry
  // (a hung call is bounded by the 30s server-side incus timeout, then react-query retries).
  const { data: snap, isLoading } = useQuery({
    // The pod serves the requested window at ITS resolution — a month costs hourly points, not a month
    // of minutes (see pod-agent rollup.ts).
    queryKey: qk.metrics(slug, windowMs),
    // Owner path is a Route Handler (GET) so the stats poll runs on the parallel HTTP lane and isn't
    // starved by the live poll; the admin variant stays on its (admin-authed) server action.
    queryFn: () =>
      admin
        ? getAdminPodMetrics(slug, windowMs)
        : apiGet<MetricsSnapshot | null>(`/api/pods/${slug}/metrics?window=${windowMs}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  if (isLoading && !snap) {
    return (
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (!snap || snap.series.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3 text-[13px] text-muted-foreground">
          Metrics aren&rsquo;t available yet — they appear once the pod is running and reporting.
        </p>
        {footer && <p className="text-[12px] text-muted-foreground">{footer}</p>}
      </div>
    );
  }

  const s = snap.series;
  const last = s[s.length - 1];
  const cpu = s.map((x) => x.cpuPct);
  const mem = s.map((x) => x.memUsedMb);
  const net = s.map((x) => x.netRxKbps + x.netTxKbps);
  const times = s.map((x) => x.t);
  // A gap of >3 sample intervals between adjacent points = the pod was suspended
  // (samples only accrue while awake, on the persistent volume). Show it.
  //
  // The interval is read from the SERIES, not from snap.sampleIntervalMs: a wide
  // window is served from a coarser rollup tier, where points are 5 minutes or an
  // hour apart by design. Judging those against the 60s base interval would mark
  // every single point as a suspension and draw the whole 7d chart as dashes.
  const gapMs = Math.max(snap.sampleIntervalMs || 60_000, medianStep(times)) * 3;
  const diskPct = last.diskTotalMb > 0 ? (last.diskUsedMb / last.diskTotalMb) * 100 : 0;
  const activity = activityShare(s);

  return (
    <div className="flex flex-col gap-4">
      {/* Zoom. The label says what you asked for; the line under it says what the
          pod actually HAS — a 30d view of a pod that booted yesterday must not
          imply a month of history. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border/60 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setWindowMs(w.ms)}
              className={`rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${
                windowMs === w.ms
                  ? "bg-white/[0.06] text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Over-time group. CPU, Memory, Network and Agent activity all plot the SAME
          window — so they are stacked FULL WIDTH (same width) and each carries its own
          tick axis, so their timelines line up and a CPU spike sits under the "running a
          tool" band. Disk is a level, not a series, so it lives in its own group below. */}
      <div className="flex flex-col gap-2.5">
        <MetricCard
          label="CPU"
          value={`${last.cpuPct}%`}
          sub={
            oss
              ? cpus != null
                ? `peak ${Math.max(...cpu)}% · of ${cpus} reserved vCPU${cpus === 1 ? "" : "s"}`
                : `peak ${Math.max(...cpu)}% · no CPU limit (shares the host)`
              : `peak ${Math.max(...cpu)}% · of reserved vCPUs`
          }
        >
          <Area values={cpu} max={100} stroke="var(--accent-light, #7aa2f7)" times={times} gapMs={gapMs} markPeak formatValue={(v) => `${v}%`} />
          <TickAxis times={times} />
        </MetricCard>
        <MetricCard
          label="Memory"
          value={`${fmtGb(last.memUsedMb)} / ${fmtGb(last.memTotalMb)}`}
          sub={
            oss && memoryMb == null
              ? "no memory limit — showing the host’s memory"
              : last.memUsedMb / last.memTotalMb > 0.9
                ? oss
                  ? "near its memory limit"
                  : "near the ceiling — consider a larger tier"
                : `peak ${fmtGb(Math.max(...mem))}`
          }
        >
          <Area values={mem} max={last.memTotalMb} stroke="var(--success, #34d399)" times={times} gapMs={gapMs} markPeak formatValue={fmtGb} />
          <TickAxis times={times} />
        </MetricCard>
        <MetricCard label="Network" value={fmtRate(last.netRxKbps + last.netTxKbps)} sub="in + out">
          <Area values={net} max={Math.max(100, ...net)} stroke="var(--warning, #e0af68)" times={times} gapMs={gapMs} />
          <TickAxis times={times} />
        </MetricCard>

        {/* Agent activity — same window + width as the charts above. */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-muted-foreground">Agent activity</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {activity ? `${activity.activePct}% active` : "no reports yet"}
            </span>
          </div>
          <ActivityStrip series={s} gapMs={gapMs} />
          <TickAxis times={times} />
          {/* Percentages live ON the legend rather than in a sentence beside it. */}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 pt-0.5">
            {ACTIVITY_LEGEND.map((k) => (
              <span key={k.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ background: AGENT_COLORS[k.key] }} />
                {k.label}
                {activity && <span className="tabular-nums text-foreground/80">{k.pct(activity)}%</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Disk group — the level AND what's using it, together (a quota, not a timeline). */}
      <div className="flex flex-col gap-2.5">
        <MetricCard
          label="Disk"
          value={`${fmtGb(last.diskUsedMb)} / ${fmtGb(last.diskTotalMb)}`}
          sub={oss ? `${Math.round(diskPct)}% of the host disk (no per-pod limit)` : `${Math.round(diskPct)}% of your quota`}
        >
          <div className="pt-1.5">
            <UsageBar used={last.diskUsedMb} total={last.diskTotalMb} />
          </div>
        </MetricCard>
        {snap.disk.breakdown.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
            <span className="text-[12px] font-medium text-muted-foreground">What&rsquo;s using the disk</span>
            {snap.disk.breakdown
              .slice()
              .sort((a, b) => b.mb - a.mb)
              .map((d) => (
                <div key={d.label} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 truncate text-[12px]">{d.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.min(100, (d.mb / (last.diskTotalMb || 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {fmtGb(d.mb)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {footer && (
        <p className="border-t border-border/60 pt-3 text-[12px] text-muted-foreground">{footer}</p>
      )}
    </div>
  );
}

const ACTIVITY_LEGEND: { key: string; label: string; pct: (a: ActivityShare) => number }[] = [
  { key: "busy", label: "working", pct: (a) => a.busyPct },
  { key: "shell", label: "running a tool", pct: (a) => a.shellPct },
  { key: "waiting", label: "waiting on you", pct: (a) => a.waitingPct },
  { key: "idle", label: "idle", pct: (a) => a.idlePct },
];

/**
 * A horizontal timeline of agent state, proportional to TIME.
 *
 * One equal slice per sample would have been fine when every sample was a minute.
 * With tiered history it is a lie: an hourly sample stands for 60× a minute one, so
 * equal slices draw yesterday as a third of a month. Segments are sized by the gap
 * to the next sample, which is exactly that sample's resolution.
 *
 * A gap wider than the sampling interval means the pod was suspended — drawn as an
 * actual break, because carrying the last known state across it would assert the
 * agent was idle (or busy) during hours we recorded nothing.
 */
function ActivityStrip({ series, gapMs }: { series: MetricSample[]; gapMs: number }) {
  if (series.length === 0) return null;
  const segs: { w: number; state: string | null }[] = [];
  for (let i = 0; i < series.length; i++) {
    const next = series[i + 1];
    const step = next ? next.t - series[i].t : Math.min(gapMs / 3, 60_000);
    const state = series[i].agentStatus ?? "idle";
    if (step > gapMs) {
      segs.push({ w: gapMs / 3, state });
      segs.push({ w: step - gapMs / 3, state: null });
    } else {
      segs.push({ w: Math.max(step, 0), state });
    }
  }
  const total = segs.reduce((a, x) => a + x.w, 0) || 1;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded bg-white/[0.04]">
      {segs.map((seg, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: `${(seg.w / total) * 100}%`,
            background: seg.state ? (AGENT_COLORS[seg.state] ?? AGENT_COLORS.idle) : "transparent",
          }}
          title={seg.state ?? "pod was suspended — nothing recorded"}
        />
      ))}
    </div>
  );
}
