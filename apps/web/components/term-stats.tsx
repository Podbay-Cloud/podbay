"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { MetricsSnapshot } from "@podbay/shared/metrics-types";
import { apiGet } from "@/lib/api-fetch";
import { qk } from "@/lib/query-keys";

// How much the strip may shrink from its natural width before we hide it outright
// (a little graceful give, then it's gone — it never clips down to a stump). The
// name never yields at all, so the strip is always the thing that gives.
const SHRINK_GIVE = 40;
// Dead-band around the show/hide threshold so a 1px resize can't flip it back and forth.
const HYSTERESIS = 20;

/**
 * Compact live stats strip for the web terminal (desktop only). CPU + network as
 * mini sparklines; memory + disk as % of the reserved ceiling. A quick "healthy
 * right now?" read without leaving the terminal — the window toggle keeps it short
 * (1h) by default so spikes stay visible, but 3h/7h are a click away.
 */

const WINDOWS = [
  { label: "1h", ms: 3_600_000 },
  { label: "3h", ms: 10_800_000 },
  { label: "7h", ms: 25_200_000 },
];

function fmtRate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${Math.round(kbps)} kb/s`;
}

function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  const W = 74;
  const H = 22;
  if (values.length === 0) return <svg className="term-spark" viewBox={`0 0 ${W} ${H}`} />;
  const n = values.length;
  const m = max > 0 ? max : 1;
  const pts = values.map((v, i) => {
    const x = n === 1 ? W : (i / (n - 1)) * W;
    const y = H - Math.max(0, Math.min(1, v / m)) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="term-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={color} fillOpacity={0.14} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 100) : 0);

export default function TermStats({ podId }: { podId: string }) {
  const [windowMs, setWindowMs] = useState(WINDOWS[0]!.ms);
  // Shares the qk.metrics cache with the Stats tab — cached, polled every 15s, keepPreviousData so a
  // window switch keeps the strip populated. A reject retries then errors (values fall back to "—"),
  // never sticks.
  const { data: snap = null } = useQuery({
    queryKey: qk.metrics(podId, windowMs),
    queryFn: () => apiGet<MetricsSnapshot | null>(`/api/pods/${podId}/metrics?window=${windowMs}`),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef(0);
  const [fits, setFits] = useState(true);

  // Hide the strip whenever the bar's free space can't hold it. The name and the
  // Dashboard link on either side are BOTH non-shrinking (flex 0 0 auto), so their
  // offsetWidth is always their natural width — the free space we compute is real,
  // never overstated by a name that's already being squeezed. So the name never
  // ellipses; the strip is what gives, and it disappears just before it would clip.
  const measure = useCallback(() => {
    const el = rootRef.current;
    const bar = el?.closest<HTMLElement>(".term-bar");
    if (!el || !bar) return;
    // The strip's INTRINSIC content width — the span from the first child's left edge
    // to the last child's right edge. This is stable no matter how the flex box behaves:
    // when the bar is wide the box grows (flex-grow) but the children keep their natural
    // size and centre, and when it's tight the children clip — either way the span is the
    // real content width. (el.scrollWidth would instead report the stretched box, wildly
    // over-stating it on a wide bar and hiding the strip far too early.) Captured only
    // while visible — once hidden it's display:none, so keep the last known value.
    if (!el.classList.contains("term-stats-hidden") && el.children.length > 0) {
      const kids = el.children;
      const first = kids[0]!.getBoundingClientRect();
      const last = kids[kids.length - 1]!.getBoundingClientRect();
      const contentW = last.right - first.left;
      if (contentW > 0) naturalRef.current = Math.max(naturalRef.current, Math.round(contentW));
    }
    const natural = naturalRef.current;
    if (!natural) return; // nothing measured yet — leave it shown
    const left = bar.querySelector<HTMLElement>(".term-bar-left");
    const right = bar.querySelector<HTMLElement>(".term-bar-right");
    const cs = getComputedStyle(bar);
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const gap = parseFloat(cs.columnGap || cs.gap || "12") || 12;
    const avail = bar.clientWidth - padX - (left?.offsetWidth ?? 0) - (right?.offsetWidth ?? 0) - gap * 2;
    const threshold = natural - SHRINK_GIVE;
    // Hysteresis: once shown, keep it until clearly too tight; once hidden, only
    // bring it back with room to spare — so a jittery resize can't flip it.
    setFits((prev) => (prev ? avail >= threshold - HYSTERESIS : avail >= threshold + HYSTERESIS));
  }, []);

  useLayoutEffect(() => {
    const bar = rootRef.current?.closest<HTMLElement>(".term-bar");
    if (!bar) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [measure]);

  // The stat values change width as data loads (— → "28 kb/s"), which grows the
  // strip's natural width — re-measure so the hide threshold tracks the real size.
  useLayoutEffect(() => {
    measure();
  }, [snap, measure]);

  const series = snap?.series ?? [];
  const last = series[series.length - 1];
  const cpu = series.map((x) => x.cpuPct);
  const net = series.map((x) => x.netRxKbps + x.netTxKbps);
  const netMax = Math.max(1, ...net);
  const memPct = last ? pct(last.memUsedMb, last.memTotalMb) : 0;
  const diskPct = last ? pct(last.diskUsedMb, last.diskTotalMb) : 0;

  return (
    <div ref={rootRef} className={`term-stats${fits ? "" : " term-stats-hidden"}`}>
      <div className="term-stat">
        <span className="term-stat-label">CPU</span>
        <Spark values={cpu} max={100} color="#7aa2f7" />
        <span className="term-stat-val">{last ? `${Math.round(last.cpuPct)}%` : "—"}</span>
      </div>
      <div className="term-stat">
        <span className="term-stat-label">Net</span>
        <Spark values={net} max={netMax} color="#7ce3a4" />
        <span className="term-stat-val">{last ? fmtRate(last.netRxKbps + last.netTxKbps) : "—"}</span>
      </div>
      <div className="term-stat term-stat-gauge">
        <span className="term-stat-label">Mem</span>
        <span className="term-stat-bar">
          <i style={{ width: `${memPct}%` }} data-hot={memPct >= 90 ? "" : undefined} />
        </span>
        <span className="term-stat-val">{last ? `${memPct}%` : "—"}</span>
      </div>
      <div className="term-stat term-stat-gauge">
        <span className="term-stat-label">Disk</span>
        <span className="term-stat-bar">
          <i style={{ width: `${diskPct}%` }} data-hot={diskPct >= 90 ? "" : undefined} />
        </span>
        <span className="term-stat-val">{last ? `${diskPct}%` : "—"}</span>
      </div>
      <div className="term-stat-win" role="group" aria-label="Stats window">
        {WINDOWS.map((w) => (
          <button
            key={w.ms}
            type="button"
            className={windowMs === w.ms ? "on" : ""}
            onClick={() => setWindowMs(w.ms)}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
