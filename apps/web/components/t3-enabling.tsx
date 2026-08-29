"use client";

import { useEffect, useState } from "react";
import { PhaseHeader } from "@/components/phase-header";
import { Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Full-page state shown WHILE T3 Code control is being enabled (or turned off) — it REPLACES the
 * cockpit, the same pattern as PodUpdating, because enabling downloads t3 and starts a backend and
 * that can take a minute or two. The parent flips back to the cockpit automatically when the durable
 * `t3Since` clears. Stages come straight from the backend (control-plane runT3Enable / disable).
 */

/** Enable stages emitted by runT3Enable, in order, with owner-friendly labels. */
const ENABLE_STAGES: { key: string; label: string; hint?: string }[] = [
  { key: "preparing", label: "Preparing the pod", hint: "handing the agents to T3" },
  { key: "downloading", label: "Downloading the T3 runtime", hint: "first run only — can take a few minutes" },
  { key: "starting", label: "Starting the T3 backend", hint: "on :3000" },
];

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function T3Enabling({
  name,
  slug,
  environmentName,
  agentsLabel,
  stage,
  elapsedSec,
}: {
  name: string | null;
  slug: string;
  environmentName: string;
  agentsLabel: string;
  stage: string | null;
  elapsedSec: number;
}) {
  // A live seconds tick so elapsed moves between the parent's poll cycles.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // The download stage carries a live percentage as `downloading:<pct>` (the server measures the npx
  // cache growing). Split it off so the stage still matches ENABLE_STAGES and the bar can show REAL
  // progress instead of a spinner that reads as stuck.
  const [baseStage, pctRaw] = (stage ?? "").split(":");
  const dlPct = Number.parseInt(pctRaw ?? "", 10);
  const hasDlPct = baseStage === "downloading" && Number.isFinite(dlPct);
  const disabling = baseStage === "stopping";
  const verb = disabling ? "Turning off" : "Enabling";
  // A stage not in the list (null mid-handoff, or a terminal "ready"/"starting-done" the parent hasn't
  // transitioned off yet) must NOT fall back to index 0 — that rendered a FINISHED enable as its own
  // first step ("Preparing the pod") and looked like the wizard reverted (t3ttt, 2026-08-25). Show the
  // LAST step instead, so an unmatched stage always reads as "nearly done", never "back to the start".
  const foundIdx = ENABLE_STAGES.findIndex((s) => s.key === baseStage);
  const activeIdx = disabling ? 0 : foundIdx === -1 ? ENABLE_STAGES.length - 1 : foundIdx;
  // Bar: the real download % while downloading (floored so it never looks empty), else a stage estimate.
  const pct = disabling
    ? 60
    : hasDlPct
      ? Math.max(5, dlPct)
      : Math.min(100, Math.round(((activeIdx + 0.5) / ENABLE_STAGES.length) * 100));

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <PhaseHeader title={name || slug} label="T3 Code" tone="enable" />
      <p className="font-mono text-[12px] text-muted-foreground/70">
        {environmentName} · {agentsLabel}
      </p>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        {verb} T3 Code control. Your workspace and agent logins stay intact. The cockpit will return
        automatically when {disabling ? "Podbay is back in control" : "T3 is ready"}.
      </p>

      <div className="mt-6 mb-1.5 flex items-baseline gap-2.5">
        <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
          {mmss(elapsedSec)}
        </span>
        <span className="text-[12px] text-muted-foreground/70">elapsed · usually ~1–2 min</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-enable transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {disabling ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-3">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-enable" />
            <div className="text-[13.5px]">
              <div className="font-medium">Handing control back to Podbay</div>
              <div className="text-[12px] text-muted-foreground/70">
                Stopping T3, restoring the dev server and Podbay&apos;s own agent controls.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-1">
            <ul className="flex flex-col">
              {ENABLE_STAGES.map((st, i) => {
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
                        <Loader2 className="size-4 animate-spin text-enable" />
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
                        <div className="text-[12px] text-muted-foreground/70">
                          {st.key === "downloading" && state === "active" && hasDlPct
                            ? `${st.hint} · ${Math.max(5, dlPct)}%`
                            : st.hint}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
