import { cn } from "@/lib/utils";
import { WIZARD_STEPS, WIZARD_STEP_LABELS, type WizardStep } from "@/lib/pod-onboarding";

/** The one progress line shared by the configure page and the setup page, so the
 * whole launch reads as a single flow no matter which route you're on. */
export default function WizardProgress({ current }: { current: WizardStep }) {
  const idx = WIZARD_STEPS.indexOf(current);
  const pct = (idx / (WIZARD_STEPS.length - 1)) * 100;
  return (
    <div aria-label="Launch progress">
      <div className="h-1 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-2.5 flex justify-between gap-1">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li
              key={s}
              className={cn(
                "flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs",
                done ? "text-success" : active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-[22px] shrink-0 place-items-center rounded-full border text-[12px]",
                  done ? "border-success text-success" : active ? "border-primary text-primary" : "border-border",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              {/* On phones only the current step keeps its label; dots always show. */}
              <span className={cn("truncate", !active && "hidden sm:inline")}>
                {WIZARD_STEP_LABELS[s]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
