"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseNotes, NoteList, updateSummaryLine, shortDigest, fmtDate, fmtSize } from "@/components/update-info-dialog";
import { imageVersionLabel } from "@/lib/pod-image";

/** The image every eligible pod updates TO (the current pod-base). A serializable slice of the
 * manifest row — passed from the dashboard server component. */
export interface BulkTargetImage {
  digest: string | null;
  summary: string | null;
  notes: string | null;
  version: string | null;
  builtAt: string | null; // ISO
  sizeBytes: number | null;
}

export interface BulkPod {
  name: string;
  /** The pod's CURRENT image digest (what it's leaving), for the secondary column. */
  digest: string | null;
  /** The agent's TRUE idle duration in ms (session-file mtime) — NOT lastActiveAt (which only
   * tracks client-proxied terminal traffic and goes stale). Null when unknown. */
  idleMs: number | null;
}

/** "idle 2h" / "idle 40m" / "idle 3d" — short and forgiving. */
function idleLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "idle";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "idle <1m";
  if (m < 60) return `idle ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `idle ${h}h`;
  return `idle ${Math.floor(h / 24)}d`;
}

/**
 * The bulk "Update N idle pods" confirm. Replaces the old one-sentence prose with the same
 * image-update panel the cockpit shows (target build + what's new, technical changes collapsed) plus
 * a scannable list of exactly which pods update — so the owner sees WHAT changes and WHICH pods before
 * committing. Controlled by the parent (the button owns open state + the eligible-pod list).
 */
export function BulkUpdateDialog({
  open,
  onOpenChange,
  count,
  target,
  pods,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  target: BulkTargetImage | null;
  pods: BulkPod[];
  busy?: boolean;
  onConfirm: () => void;
}) {
  const parsed = parseNotes(target?.notes);
  const summary = target?.summary?.trim() || null;
  const builtAt = fmtDate(target?.builtAt ?? null);
  const size = fmtSize(target?.sizeBytes ?? null);
  const plural = count === 1 ? "" : "s";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>
            Update {count} idle pod{plural}
          </DialogTitle>
          <DialogDescription>
            They all update to the latest build below. Working, waiting, and auto-update-off pods are
            left alone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* Target build — same shape as the cockpit's "Updates to" row. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-white/[0.02] p-3 text-[13px]">
            <span className="w-20 shrink-0 text-muted-foreground">Updates to</span>
            <span className="font-medium text-warning">{builtAt ?? "the latest build"}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {imageVersionLabel(target?.version, target?.digest ?? null)}
            </span>
            {size && <span className="text-[12px] text-muted-foreground">· {size}</span>}
          </div>

          {/* What's new — summary-first, technical changes collapsed (mirrors the cockpit). */}
          {(summary || !parsed.empty) && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                What&rsquo;s new
              </p>
              <div className="rounded-lg border border-border/60 bg-white/[0.02] p-3">
                {summary ? (
                  <p className="whitespace-pre-line text-[13px] leading-relaxed">{summary}</p>
                ) : (
                  // No hand-written summary: say what KIND of changes these are rather than a bare
                  // count ("2 fixes · agent runtime" beats "2 changes in this build").
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {updateSummaryLine(target?.notes)}
                  </p>
                )}
                {!parsed.empty && (
                  <details className="group mt-2">
                    <summary className="cursor-pointer list-none text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
                      <span className="group-open:hidden">Technical changes ▾</span>
                      <span className="hidden group-open:inline">Technical changes ▴</span>
                    </summary>
                    <div className="mt-2">
                      <NoteList entries={parsed.entries} />
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}

          {/* The list — WHICH pods, scannable, replacing the comma-joined sentence. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {count} pod{plural} will update
            </p>
            <ul className="overflow-hidden rounded-lg border border-border/60">
              {pods.map((p, i) => (
                <li
                  key={`${p.name}-${i}`}
                  className="flex items-center gap-2.5 border-b border-border/40 px-3 py-2 text-[13px] last:border-b-0"
                >
                  <span
                    aria-hidden
                    className="size-[7px] shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="ml-auto flex items-baseline gap-2 text-[12px] text-muted-foreground">
                    <span className="text-[11.5px]">{idleLabel(p.idleMs)}</span>
                    <span className="font-mono text-[11px]">{shortDigest(p.digest)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="-mx-6 -mb-6 flex flex-none flex-col gap-2 border-t border-border/60 bg-background px-6 pt-3 pb-6">
          <p className="rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-warning">
            Each restarts (~1 min) and its agent resumes where it left off — your files are kept.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Starting…" : `Update ${count} pod${plural}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
