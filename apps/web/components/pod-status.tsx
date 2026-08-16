import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  // Not a DB status: an in-flight image update, which the surfaces pass in place
  // of the raw status. Showing "RUNNING · updating…" side by side read as two
  // competing states and made people ask which one was true (owner, 2026-07-29).
  updating: "Updating…",
  // A resize restarts the pod exactly like an update; it read "Running" for the
  // minutes it was actually down. Its own label because "Updating…" during a resize
  // sends the owner looking for an image change that isn't happening.
  resizing: "Resizing…",
  suspended: "Suspended",
  waking: "Resuming…",
  provisioning: "Building…",
  destroying: "Removing…",
  error: "Failed",
  gone: "Gone",
};

type Tone = "green" | "amber" | "red" | "grey";

/** States that are mid-transition — their dot pulses to signal "working". A
 * suspended pod is NOT transitional (it's a stable resting state), so its dot is
 * static even though it shares the amber tone. */
const TRANSITIONAL = new Set(["waking", "provisioning", "destroying", "updating", "resizing"]);

function toneOf(status: string): Tone {
  if (status === "running") return "green";
  if (status === "error" || status === "gone") return "red";
  // Suspended is a calm RESTING state — muted/grey, NOT amber. Amber is reserved for
  // in-flight work (updating/resizing/provisioning), so a suspended pod is never
  // confused with one mid-update. (Matches the cockpit's muted suspended treatment.)
  if (status === "suspended") return "grey";
  return "amber"; // provisioning / waking / destroying / updating / resizing
}

const DOT: Record<Tone, string> = {
  green: "bg-success shadow-[0_0_6px_rgba(52,211,153,0.7)]",
  amber: "bg-warning",
  red: "bg-destructive",
  grey: "bg-[#526079]",
};

/** Flat status TAG colors. Deliberately borderless + filled so a status reads as
 * a label, never as one of the (bordered, sentence-case) action buttons next to it. */
const TAG: Record<Tone, string> = {
  green: "text-success bg-success/12",
  amber: "text-warning bg-warning/12",
  red: "text-destructive bg-destructive/12",
  grey: "text-muted-foreground bg-white/[0.05]",
};

/** A live status dot — green running, amber suspended (static), amber pulsing mid-transition. */
export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        DOT[toneOf(status)],
        TRANSITIONAL.has(status) && "animate-pulse",
        className,
      )}
      title={STATUS_LABEL[status] ?? status}
      aria-hidden
    />
  );
}

/** The status label — a flat, sentence-case, borderless tag (not a pill/button), so it
 * is visually unmistakable from the action buttons it sits beside. Shared by the
 * card, the cockpit, and the admin drill-in. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid="pod-status"
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        TAG[toneOf(status)],
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
