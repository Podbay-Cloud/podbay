"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import type { PodIssue } from "@podbay/shared";
import { getPodIssues } from "@/lib/actions";

/**
 * Pod-level health, shown ONLY when something is wrong.
 *
 * Green is invisible on purpose: the cockpit's happy path is the agent-card stack,
 * and a permanent "all good" banner trains people to ignore the one place we will
 * later need them to look. The strip's presence IS the signal.
 *
 * Per-agent problems are deliberately not rendered here — they belong on that
 * agent's card, which already has a state machine for them. This carries what has
 * no other home: disk, session, scheduler, and "automatic repair gave up".
 * `info` issues stay out of the cockpit entirely; they live in the Admin list.
 */
export default function HealthStrip({ slug, running }: { slug: string; running: boolean }) {
  const [issues, setIssues] = useState<PodIssue[]>([]);

  useEffect(() => {
    if (!running) {
      setIssues([]);
      return;
    }
    let stop = false;
    const poll = () =>
      void getPodIssues(slug)
        .then((i) => !stop && setIssues(i))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug, running]);

  // Only LIVE, pod-level, "not working right now" trouble stays pinned on the cockpit —
  // unreachable/down, disk full, auto-repair gave up. Warn-level live issues are not
  // "the pod is down", so they don't belong on the happy path; they remain in Admin ›
  // Pod health. Past/recovered incidents (OOM, restarts) are the Activity tab's job, not
  // this strip's. (Triage decision 2026-08-15: main cockpit = super-critical only.)
  const shown = issues.filter((i) => i.severity === "critical" && !i.agent);
  if (shown.length === 0) return null;

  const critical = true;

  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${
        critical ? "border-destructive/50 bg-destructive/[0.06]" : "border-warning/50 bg-warning/[0.06]"
      }`}
    >
      {shown.map((i) => (
        <div key={i.id} className="flex items-start gap-2.5">
          {i.severity === "critical" ? (
            <OctagonAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">{i.title}</span>
            <span className="text-[12.5px] leading-relaxed text-muted-foreground">{i.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
