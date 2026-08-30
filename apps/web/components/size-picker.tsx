"use client";

import { POD_TIERS, POD_SIZES, type PodSize } from "@podbay/shared/tiers";
import { cn } from "@/lib/utils";

/**
 * The three compute tiers as selectable cards — used at launch and in the
 * cockpit's resize dialog. `disabledSizes` greys out choices that aren't
 * offered in context (e.g. the current size, or tiers whose disk would shrink).
 */
export default function SizePicker({
  value,
  onChange,
  disabledSizes = [],
  note,
}: {
  value: PodSize;
  onChange: (s: PodSize) => void;
  disabledSizes?: PodSize[];
  /** Optional per-size footnote (e.g. "keeps 40 GB disk"). */
  note?: (s: PodSize) => string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {POD_SIZES.map((s) => {
        const t = POD_TIERS[s];
        const disabled = disabledSizes.includes(s);
        const active = value === s;
        const footnote = note?.(s);
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(s)}
            className={cn(
              "flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
              active ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
              disabled && "cursor-not-allowed opacity-40 hover:border-border",
            )}
          >
            <span className="text-[13.5px] font-semibold">{t.label}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {t.cpus} vCPU · {t.memoryGb} GB RAM
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{t.diskGb} GB disk</span>
            {footnote && <span className="mt-0.5 text-[11px] text-primary/80">{footnote}</span>}
          </button>
        );
      })}
    </div>
  );
}
