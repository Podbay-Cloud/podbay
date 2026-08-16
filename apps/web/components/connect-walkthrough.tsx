"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A once-per-pod "how it works" tour, shown when a pod first reaches ready. A light
 * coach-mark (so it pops off the dark app) with an arrow pointing at the real control,
 * positioned MANUALLY from the target's rect — deterministic placement that follows on
 * scroll/resize, rather than relying on a floating library's collision heuristics.
 * Steps whose target isn't on the page are skipped; Done/Escape marks it seen.
 */

/** `agent` restricts a step to pods running that agent. The connect step differs per agent
 * and the two are mutually exclusive: Claude hands off with one button, Codex needs pairing
 * plus app-side setup. Filtering up front (rather than relying on the skip-missing-target
 * fallback) matters because that fallback polls ~3s before giving up — so a Codex user would
 * stare at nothing before their FIRST and most important step appeared. */
type Step = { tour: string; title: string; body: string; agent?: string };

const STEPS: Step[] = [
  {
    tour: "continue-in-claude",
    agent: "claude-code",
    title: "Work with your agent",
    body: "Open this session to work with the agent on your pod — in the browser or your Claude desktop app. It opens from the Claude mobile app too.",
  },
  {
    tour: "pair-codex",
    agent: "codex",
    title: "Connect your Codex app",
    body: "Codex has no one-click hand-off: pair your phone or desktop app with the code here. On phone that's it — the pod shows up in your Projects. On desktop there's one extra step, spelled out below the code.",
  },
  {
    tour: "tab-settings",
    title: "Settings",
    body: "Suspend or resize the pod, set preview access, connect GitHub, and manage the relay.",
  },
  {
    tour: "tab-secrets",
    title: "Secrets",
    body: "The environment variables your app needs — set them here; the agent can request one too.",
  },
  {
    tour: "tab-stats",
    title: "Stats",
    body: "Live CPU, memory, disk and network for the pod over the last hours.",
  },
  {
    tour: "tab-activity",
    title: "Activity",
    body: "Everything that has happened to the pod — updates, restarts, resizes, and any incidents like running out of memory. Dismiss a notice from the cockpit and you can always retrace it here.",
  },
  {
    tour: "tab-details",
    title: "Details",
    body: "The pod's image, region and size, plus its skills and rules.",
  },
  {
    tour: "tab-admin",
    title: "Terminal & admin",
    body: "For advanced use, the Admin tab opens a raw terminal straight to the pod.",
  },
];

const CARD_W = 300;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Pos = { top: number; left: number; arrowX: number; below: boolean };

export default function ConnectWalkthrough({
  onDone,
  agents = [],
}: {
  onDone: () => void;
  /** Agents this pod runs — decides which connect step is shown. */
  agents?: string[];
}) {
  // Steps for an agent this pod does not run are dropped, not skipped-at-runtime.
  const steps = useMemo(
    () => STEPS.filter((s) => !s.agent || agents.includes(s.agent)),
    [agents],
  );
  const [i, setI] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Position the card from the current step's target rect (below it, else above).
  const place = useCallback((): Pos | null => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${steps[i]!.tour}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const h = cardRef.current?.offsetHeight ?? 168;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = r.left + r.width / 2;
    const left = clamp(cx - CARD_W / 2, 12, Math.max(12, vw - CARD_W - 12));
    const below = vh - r.bottom > h + gap + 12 || r.top < h + gap + 12;
    const top = below ? r.bottom + gap : r.top - gap - h;
    return { top, left, arrowX: clamp(cx - left, 22, CARD_W - 22), below };
  }, [i, steps]);

  // Resolve the step's target — polling for a late-rendering one (the Continue button
  // appears once the agent is linked) and skipping any that never show.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${steps[i]!.tour}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        const p = place();
        if (p) setPos(p);
        return;
      }
      if (++tries < 10) {
        window.setTimeout(tick, 300);
        return;
      }
      let n = i + 1;
      while (n < steps.length && !document.querySelector(`[data-tour="${steps[n]!.tour}"]`)) n++;
      if (n < steps.length) setI(n);
      else onDone();
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [i, place, onDone, steps]);

  // Re-place once the card has a real height, and whenever the page scrolls/resizes.
  useLayoutEffect(() => {
    const p = place();
    if (p) setPos(p);
  }, [i, place]);
  useEffect(() => {
    const onMove = () => {
      const p = place();
      if (p) setPos(p);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [place]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  if (!pos) return null;
  const step = steps[i]!;
  const last = i >= steps.length - 1;

  return (
    <div
      ref={cardRef}
      data-testid="connect-walkthrough"
      role="dialog"
      aria-label="How it works"
      className="fixed z-50 rounded-xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-black/10"
      style={{ top: pos.top, left: pos.left, width: CARD_W }}
    >
      {/* Arrow: a white triangle at the card edge, pointing at the target. */}
      <span
        aria-hidden
        className="absolute h-0 w-0"
        style={
          pos.below
            ? {
                top: -8,
                left: pos.arrowX - 8,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderBottom: "8px solid white",
              }
            : {
                bottom: -8,
                left: pos.arrowX - 8,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: "8px solid white",
              }
        }
      />
      <p className="text-sm font-semibold text-slate-900">{step.title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{step.body}</p>
      <div className="mt-3.5 flex items-center justify-between">
        {/* LEFT = the way out. Skip is a DISMISSIVE action and Back/Next are progressive
            ones, so they sit on opposite sides: a mis-click on "Next" must never be able to
            land on the control that ends the tour. Offered from step one and on every pod —
            Escape already dismissed the tour at any stage, so gating a visible Skip would
            only hide an existing exit from the people least likely to guess it, and a tour
            nobody can leave earns impatient clicking, not attention. */}
        <div className="flex items-center gap-2.5">
          {!last && (
            <button
              type="button"
              onClick={onDone}
              className="rounded-md text-[13px] font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Skip
            </button>
          )}
          <span className="text-[12px] font-medium text-slate-400">
            {i + 1} / {steps.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI((n) => Math.max(0, n - 1))}
              className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900"
            >
              Back
            </button>
          )}
          <Button size="sm" onClick={() => (last ? onDone() : setI((n) => n + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
