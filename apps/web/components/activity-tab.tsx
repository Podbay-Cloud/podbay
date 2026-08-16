"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPodActivity, type ActivityEvent } from "@/lib/pod-activity";

/**
 * The pod's full activity log — every classified event as a vertical TIMELINE, newest
 * first. This is the "retrace it later" surface: anything that isn't a live "the pod is
 * down NOW" signal lives here rather than nagging on the main cockpit. Incidents the owner
 * dismissed still appear here (marked), so a dismiss hides the banner without erasing the
 * record.
 *
 * Data comes seeded from the server (initialEvents) and refreshes on a slow poll while the
 * pod is running, so a crash while the tab is open shows up without a manual reload. Long
 * histories are paginated.
 */

const PAGE_SIZE = 12;

/** Time of day only, e.g. "16:55" / "04:55 PM" — the day lives in the group header. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A stable per-day key (local calendar day) for grouping. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** A human day heading: Today / Yesterday / "Thu, 14 Aug · 4d ago" (the relative age
 * lives HERE, on the day line, not repeated on every event). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
  return `${d.toLocaleDateString(undefined, opts)} · ${diff}d ago`;
}

/** Momentary "logging" statuses — a step WITHIN an operation, not an event that
 * happened. The Activity log shows what happened (updated, resized), never the
 * "Updating…" / "Resizing…" chatter that precedes it. */
const TRANSIENT_TYPES = new Set(["update_started", "update_stage", "resize_started"]);

/** A displayed row: an event plus how many identical events it stands in for. */
type Row = ActivityEvent & { count: number };

/** Collapse ADJACENT identical entries (same type + title, same dismissed-ness) into one row
 * with a count. Revealing/copying a secret audits every access, so toggling the eye a few times
 * spawns a run of identical "Viewed X" lines — one line with "×6" says the same thing without
 * burying the rest of the timeline. Non-adjacent repeats (a later, separate access) stay distinct.
 * The kept row is the newest of the run (the list is newest-first), so its time reads correctly. */
function coalesce(list: ActivityEvent[]): Row[] {
  const out: Row[] = [];
  for (const e of list) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.type === e.type &&
      prev.title === e.title &&
      Boolean(prev.dismissedAt) === Boolean(e.dismissedAt)
    ) {
      prev.count += 1;
    } else {
      out.push({ ...e, count: 1 });
    }
  }
  return out;
}

function SeverityIcon({ severity }: { severity: ActivityEvent["severity"] }) {
  if (severity === "critical") return <OctagonAlert className="size-4 text-destructive" />;
  if (severity === "warn") return <AlertTriangle className="size-4 text-warning" />;
  return <Info className="size-4 text-muted-foreground" />;
}

export default function ActivityTab({
  slug,
  initialEvents,
  running,
}: {
  slug: string;
  initialEvents: ActivityEvent[];
  running: boolean;
}) {
  // Only REAL events — drop the momentary "Updating…/Resizing…" logging statuses; the
  // completed "updated"/"resized" event is what happened.
  const real = (list: ActivityEvent[]) => list.filter((e) => !TRANSIENT_TYPES.has(e.type));
  const [events, setEvents] = useState<ActivityEvent[]>(() => real(initialEvents));
  const [page, setPage] = useState(0);
  // Client-only relative timestamps (avoid hydration mismatch): render "" until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = () =>
      void getPodActivity(slug)
        .then((a) => {
          if (stop || "error" in a) return;
          setEvents(real(a.events));
        })
        .catch(() => undefined);
    const t = setInterval(poll, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug, running]);

  // Collapse adjacent identical entries (e.g. a run of "Viewed X") BEFORE paging, so a page
  // holds 12 distinct things and the counts are whole.
  const rows = useMemo(() => coalesce(events), [events]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Clamp the page if the list shrank/grew under us (a poll can change length).
  const current = Math.min(page, pageCount - 1);
  const shown = useMemo(
    () => rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    [rows, current],
  );

  if (events.length === 0) {
    return (
      <Card className="py-4">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nothing has happened on this pod yet. Updates, resizes, restarts, and any incidents
          will show up here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-4">
      <CardContent className="py-0">
        <ol className="relative">
          {shown.map((e, i) => {
            const last = i === shown.length - 1;
            // Group by calendar day — a header before the first event of each day. Gated on
            // `mounted` (like the timestamps) so the server/first-client render stays flat and
            // there's no hydration mismatch from server-vs-browser timezone day boundaries.
            const prev = i > 0 ? shown[i - 1] : undefined;
            const next = last ? undefined : shown[i + 1];
            const startsDay = mounted && (!prev || dayKey(prev.at) !== dayKey(e.at));
            // The rail connects events WITHIN a day; it stops at a day boundary (and at the end).
            const connect = !last && (!mounted || dayKey(next!.at) === dayKey(e.at));
            return (
              <li key={e.id}>
                {startsDay && (
                  // Aligned with the timeline rail's left edge (where the activity line
                  // starts), not indented to the text — reads as a section marker.
                  <div
                    className={`text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                      prev ? "mt-3 border-t border-border/60 pt-3" : "pb-1"
                    }`}
                  >
                    {dayLabel(e.at)}
                  </div>
                )}
                <div className="flex gap-3">
                  {/* Timeline rail: the icon, and a connecting line down to the next event.
                      self-stretch makes the column fill the row height so flex-1 can draw the
                      full connector; a min height keeps it visible even for a short row. */}
                  <div className="flex flex-col items-center self-stretch">
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <SeverityIcon severity={e.severity} />
                    </span>
                    {connect && (
                      <span className="w-px flex-1 bg-muted-foreground/30" style={{ minHeight: 12 }} aria-hidden />
                    )}
                  </div>
                  {/* Content: time only (the day + "Nd ago" is on the group header),
                      description below. */}
                  <div className={last ? "min-w-0 flex-1 pb-1" : "min-w-0 flex-1 pb-5"}>
                    <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
                      <span className="tabular-nums">{mounted ? timeOf(e.at) : ""}</span>
                      {e.count > 1 && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {e.count}×
                        </span>
                      )}
                      {e.dismissedAt && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          dismissed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13.5px] font-medium">{e.title}</p>
                    {e.action?.kind === "resize" && (
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        A larger pod size (more memory) would help if this recurs — resize from
                        Settings.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">
            <span>
              {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, rows.length)} of{" "}
              {rows.length}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Newer
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Older
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
