import { cn } from "@/lib/utils";

/**
 * The header row shared by the full-page phase views (T3Enabling / PodUpdating / PodSuspended):
 * a status dot, the pod title, and an uppercase status pill — identical markup that had drifted
 * across three copies (0audit UI-drift #6). One tone map keeps the dot + pill in lockstep; `enable`
 * and `warning` pulse (an in-progress phase), `muted` is a static neutral (a resting phase).
 * See `.claude/rules/ui-patterns.md` (Chips / pills).
 */
const TONE = {
  enable: { dot: "bg-enable", ping: "bg-enable/60", pill: "border-enable/40 bg-enable/10 text-enable", pulse: true },
  warning: { dot: "bg-warning", ping: "bg-warning/60", pill: "border-warning/40 bg-warning/10 text-warning", pulse: true },
  muted: { dot: "bg-muted-foreground/50", ping: "", pill: "border-border bg-muted/40 text-muted-foreground", pulse: false },
} as const;

export function PhaseHeader({
  title,
  label,
  tone,
}: {
  title: string;
  label: string;
  tone: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <div className="mb-1 flex items-center gap-2.5">
      {t.pulse ? (
        <span className="relative flex size-2.5">
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full", t.ping)} />
          <span className={cn("relative inline-flex size-2.5 rounded-full", t.dot)} />
        </span>
      ) : (
        <span className={cn("size-2.5 rounded-full", t.dot)} />
      )}
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider",
          t.pill,
        )}
      >
        {label}
      </span>
    </div>
  );
}
