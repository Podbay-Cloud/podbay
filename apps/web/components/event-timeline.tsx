"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import { eventSentence } from "@/lib/event-sentence";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TimelineEvent {
  id: string;
  type: string;
  at: string;
  meta: Record<string, unknown> | null;
  /** Classified server-side (classifyEvent). When present, a severity dot is shown and
   * `title` is used as the row's sentence. */
  severity?: "info" | "warn" | "critical";
  title?: string;
}

const SEV_DOT: Record<string, string> = {
  critical: "bg-destructive",
  warn: "bg-warning",
  info: "bg-border",
};

function shortDigest(v: unknown): string {
  return typeof v === "string" && /^[0-9a-f]{16,}$/i.test(v) ? v.slice(0, 12) + "…" : String(v);
}

/** A human one-liner from the event's meta — the useful bits inline, no raw JSON. */
function summarize(e: TimelineEvent): string {
  const m = e.meta;
  if (!m) return "";
  if (e.type === "updated" && ("from" in m || "to" in m)) {
    return `${shortDigest(m.from) || "?"} → ${shortDigest(m.to) || "?"}`;
  }
  const parts: string[] = [];
  if (typeof m.reason === "string") parts.push(m.reason);
  if (typeof m.from === "string" && e.type !== "updated") parts.push(`from ${m.from}`);
  if (typeof m.environmentName === "string") parts.push(m.environmentName);
  if (typeof m.lifecycle === "string") parts.push(m.lifecycle);
  if (parts.length) return parts.join(" · ");
  // Fallback: compact key list so the row still says something.
  return Object.keys(m).slice(0, 3).join(", ");
}

function when(iso: string): { rel: string; full: string } {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  const rel =
    m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
  return { rel, full: d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) };
}

export default function EventTimeline({ events }: { events: TimelineEvent[] }) {
  const [open, setOpen] = useState<TimelineEvent | null>(null);

  if (events.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No events recorded.</p>;
  }

  return (
    <>
      {events.map((e) => {
        const t = when(e.at);
        const summary = summarize(e);
        return (
          <div
            key={e.id}
            className="flex items-center justify-between gap-3 border-t border-border/60 py-2.5 text-sm first:border-t-0"
          >
            {/* A sentence, not a type + a list of meta KEYS. The old row said
                "update_stage · stage, agent", which proved data existed without
                saying what happened. The raw JSON stays one click away. */}
            <div className="flex min-w-0 items-center gap-2">
              {e.severity && (
                <span
                  className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? "bg-border"}`}
                  title={e.severity}
                />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`truncate ${e.severity === "critical" ? "text-destructive" : e.severity === "warn" ? "text-warning" : ""}`}>
                  {e.title ?? eventSentence(e)}
                </span>
                {summary && summary !== (e.title ?? eventSentence(e)) && (
                  <span className="truncate font-mono text-[11.5px] text-muted-foreground">{e.type}</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {e.meta && Object.keys(e.meta).length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen(e)}
                  title="View raw JSON"
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-white/[0.04]"
                >
                  <Braces className="h-3 w-3" /> JSON
                </button>
              )}
              <span className="tabular-nums text-[12px] text-muted-foreground" title={t.full}>
                {t.rel}
              </span>
            </div>
          </div>
        );
      })}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {open?.type} · {open ? when(open.at).full : ""}
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border/60 bg-black/30 p-3 font-mono text-[12px] leading-relaxed">
            {open ? JSON.stringify(open.meta, null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
