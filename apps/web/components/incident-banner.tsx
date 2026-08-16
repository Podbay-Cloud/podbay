"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";
import { dismissPodIncident } from "@/lib/actions";
import type { ActivityEvent } from "@/lib/pod-activity";

/** Relative age of an incident. Computed on the client only (in an effect) so it never
 * causes a hydration mismatch, and reads naturally ("2h ago"). */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * A recent unplanned incident, shown on the pod's own cockpit page. Recommends the fix in
 * words; dismissible — and the dismissal is DURABLE and CROSS-DEVICE: it's recorded on the
 * event server-side (`dismissedAt`), so the banner derivation stops surfacing it on any
 * device or reload. A NEW incident (new event id) still shows. Per the owner's decision it
 * does NOT auto-resize.
 */
export default function IncidentBanner({ slug, incident }: { slug: string; incident: ActivityEvent }) {
  const [hidden, setHidden] = useState(false);
  const [ts, setTs] = useState("");
  const [, start] = useTransition();

  useEffect(() => setTs(ago(incident.at)), [incident.at]);

  if (hidden) return null;

  const critical = incident.severity === "critical";
  const tone = critical
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-warning/40 bg-warning/10 text-warning";

  const dismiss = () => {
    setHidden(true); // optimistic; the action persists it so it won't come back on reload
    start(() => {
      void dismissPodIncident(slug, incident.id);
    });
  };

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {incident.title}
          {ts && <span className="ml-2 font-normal text-muted-foreground">· {ts}</span>}
        </p>
        {incident.action?.kind === "resize" && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            If this keeps happening, a larger pod size (more memory) will stop it — resize from this
            pod&apos;s settings.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/[0.06]"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
