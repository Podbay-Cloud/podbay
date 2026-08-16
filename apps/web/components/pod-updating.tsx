"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { parseNotes, type UpdateInfo } from "@/components/update-info-dialog";

/**
 * Full-page state shown WHILE a pod is updating (or resizing) — it REPLACES the cockpit,
 * because during a transition the only thing that matters is the transition. Terminal, stats,
 * secrets, preview and settings are gone until it finishes (the parent flips back to the
 * cockpit automatically when `updating` clears). Reuses the real backend stages + elapsed.
 */

/** The real provider stages (packages/provider/src/incus/provider.ts), in order, with owner-
 * friendly labels. The backend emits the raw key as `update_stage`; we map it to this list. */
const STAGES: { key: string; label: string; hint?: string }[] = [
  { key: "stopping", label: "Stopping the pod" },
  { key: "recreating", label: "Recreating the machine", hint: "new image — your volume is kept" },
  { key: "starting", label: "Starting" },
  { key: "booting", label: "Booting the pod" },
  { key: "restarting agent", label: "Restarting the agent" },
  { key: "waiting for agent", label: "Waiting for the agent", hint: "until it reports ready" },
  { key: "finishing", label: "Finishing up" },
];

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PodUpdating({
  name,
  slug,
  environmentName,
  agentsLabel,
  kind,
  stage,
  elapsedSec,
  updateInfo,
}: {
  name: string | null;
  slug: string;
  environmentName: string;
  agentsLabel: string;
  kind: "update" | "resize";
  stage: string | null;
  elapsedSec: number;
  updateInfo: UpdateInfo | null;
}) {
  const verb = kind === "resize" ? "Resizing" : "Updating";
  // Active stage = the emitted key; unknown/null → treat as the first (we've only just started).
  const activeIdx = Math.max(0, STAGES.findIndex((s) => s.key === stage));
  const pct = Math.min(100, Math.round(((activeIdx + 0.5) / STAGES.length) * 100));

  // A live seconds tick so the elapsed counter moves even between the parent's poll cycles.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const notes = parseNotes(updateInfo?.target?.notes ?? updateInfo?.images?.[0]?.notes ?? null);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning/60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-warning" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">{name || slug}</h1>
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-warning">
          {verb}
        </span>
      </div>
      <p className="font-mono text-[12px] text-muted-foreground/70">
        {environmentName} · {agentsLabel}
      </p>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        {kind === "resize" ? "Resizing this pod" : "Updating to a new pod image"}. Your workspace stays
        exactly as it is — the cockpit comes back automatically when it&apos;s done.
      </p>

      <div className="mt-6 mb-1.5 flex items-baseline gap-2.5">
        <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
          {mmss(elapsedSec)}
        </span>
        <span className="text-[12px] text-muted-foreground/70">elapsed · usually ~1–2 min</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-warning transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      <Card>
        <CardContent className="py-1">
          <ul className="flex flex-col">
            {STAGES.map((st, i) => {
              const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
              return (
                <li
                  key={st.key}
                  className="flex items-start gap-3 border-t border-border py-2.5 first:border-t-0"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                    {state === "done" ? (
                      <Check className="size-4 text-success" />
                    ) : state === "active" ? (
                      <Loader2 className="size-4 animate-spin text-warning" />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground/25" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[13.5px] ${state === "pending" ? "text-muted-foreground" : "font-medium"}`}
                    >
                      {st.label}
                    </div>
                    {st.hint && (
                      <div className="text-[12px] text-muted-foreground/70">{st.hint}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {!notes.empty && notes.entries.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
            What&apos;s new in this update
          </h3>
          <ul className="ml-4 list-disc space-y-1 text-[12.5px] text-muted-foreground">
            {notes.entries.slice(0, 6).map((e, i) => (
              <li key={i}>
                {e.area && <span className="font-medium text-foreground">{e.area}: </span>}
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground">
        <span aria-hidden>🛟</span>
        <span>
          <span className="font-medium text-foreground">Nothing is lost.</span> Your files in{" "}
          <code className="font-mono text-[11.5px]">~/work</code>, your git state and your settings are
          on a volume that survives the update. Your agent restarts fresh when it finishes.
        </span>
      </div>
    </div>
  );
}
