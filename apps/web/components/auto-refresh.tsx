"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current by re-fetching it on an adaptive
 * interval: fast while anything is mid-transition (destroying/provisioning/
 * waking), slow otherwise, paused while the tab is hidden.
 *
 * This is the v0 of dashboard realtime (see docs/plans/dashboard-realtime-plan.md);
 * the SSE/LISTEN-NOTIFY design replaces the timer later — the component stays,
 * only its trigger changes.
 *
 * `idleMs: 0` turns the slow tick OFF, for pages whose render is expensive. The
 * admin drill-in reconciles against the PROVIDER on every load, so an unconditional
 * heartbeat there is a provider call per open tab forever; it wants liveness only
 * while something is actually moving.
 */
export default function AutoRefresh({ fast, idleMs = 15000 }: { fast: boolean; idleMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const ms = fast ? 2500 : idleMs;
    if (!ms) return;
    const t = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [fast, idleMs, router]);
  return null;
}
