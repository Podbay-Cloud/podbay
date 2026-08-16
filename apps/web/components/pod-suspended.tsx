"use client";

import { useEffect, useState } from "react";
import { Play, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Full-page state shown while a pod is SUSPENDED — it REPLACES the cockpit. A suspended pod
 * runs nothing, so there is nothing to operate: no terminal, stats, secrets or preview. Just
 * the state, when/how-long it's been paused, a couple of at-a-glance facts, and the one action
 * that matters — Resume. Reassurance that the workspace is preserved.
 */

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Fact({ k, v, u }: { k: string; v: string; u?: string }) {
  return (
    <div className="bg-card px-3.5 py-2.5">
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">{k}</div>
      <div className="mt-0.5 text-[13.5px] font-medium tabular-nums">
        {v}
        {u && <span className="ml-1 text-[11.5px] font-normal text-muted-foreground/70">{u}</span>}
      </div>
    </div>
  );
}

export default function PodSuspended({
  name,
  slug,
  environmentName,
  agentsLabel,
  sizeLabel,
  currentSuspendedMs,
  runningMs,
  suspends,
  lastActiveAt,
  onResume,
  resuming,
}: {
  name: string | null;
  slug: string;
  environmentName: string;
  agentsLabel: string;
  sizeLabel: string;
  currentSuspendedMs: number | null;
  runningMs: number;
  suspends: number;
  lastActiveAt: string;
  onResume: () => void;
  resuming: boolean;
}) {
  // All time-relative text is client-only (computed after mount) so SSR and the client agree.
  const [t, setT] = useState<{ when: string; at: string; last: string } | null>(null);
  useEffect(() => {
    const ms = currentSuspendedMs ?? 0;
    const at = new Date(Date.now() - ms);
    setT({
      when: ms > 0 ? fmtDur(ms) : "moments",
      at: at.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      last: ago(lastActiveAt),
    });
  }, [currentSuspendedMs, lastActiveAt]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="size-2.5 rounded-full bg-muted-foreground/50" />
        <h1 className="text-lg font-semibold tracking-tight">{name || slug}</h1>
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Suspended
        </span>
      </div>
      <p className="font-mono text-[12px] text-muted-foreground/70">
        {environmentName} · {agentsLabel}
      </p>

      <div className="mt-6 flex flex-col items-center text-center">
        <div className="mb-3.5 flex size-13 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
          <Moon className="size-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Paused &amp; saved</h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {t ? (
            <>
              Suspended <span className="font-medium text-foreground">{t.when} ago</span> · was up for{" "}
              <span className="font-medium text-foreground">{fmtDur(runningMs)}</span>
            </>
          ) : (
            <span className="opacity-0">Suspended · was up for</span>
          )}
        </p>
      </div>

      <Button
        size="lg"
        className="mt-5 w-full text-[15px]"
        disabled={resuming}
        onClick={onResume}
      >
        <Play className="size-4" />
        {resuming ? "Resuming…" : "Resume pod"}
        {!resuming && (
          <span className="ml-1.5 font-mono text-[11.5px] font-normal opacity-75">
            ~ back in a few seconds
          </span>
        )}
      </Button>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <Fact k="Suspended at" v={t?.at ?? "—"} />
        <Fact k="Idle for" v={t?.when ?? "—"} />
        <Fact k="Last active" v={t?.last ?? "—"} />
        <Fact k="Lifetime running" v={fmtDur(runningMs)} />
        <Fact k="Environment" v={environmentName} />
        <Fact k="Size" v={sizeLabel} />
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground">
        <span aria-hidden>💾</span>
        <span>
          <span className="font-medium text-foreground">Your workspace is safe.</span> Everything in{" "}
          <code className="font-mono text-[11.5px]">~/work</code> persists. While suspended the pod uses
          no compute and frees its slot; Resume brings it back with a fresh agent session.
          {suspends > 1 && ` Suspended ${suspends} times since launch.`}
        </span>
      </div>
      <p className="mt-3 text-center text-[12px] text-muted-foreground/60">
        Terminal, stats, secrets and the preview are hidden while suspended — Resume to bring them back.
      </p>
    </div>
  );
}
