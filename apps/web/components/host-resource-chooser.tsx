"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The Docker host's compute + what running podbay pods have reserved. Mirrors
 * @podbay/provider's HostCapacity (kept local so this client component doesn't import the
 * server-only provider). null ⇒ docker unreachable / capacity unknown. */
export type HostCapacity = {
  cpus: number;
  memoryGb: number;
  allocatedCpus: number;
  allocatedMemoryGb: number;
};

function fmt(n: number): string {
  // Trim trailing .0 so "8" not "8.0", but keep one decimal for fractions (e.g. "1.5").
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Keep stepper arithmetic clean (0.5 steps drift to 3.0000001 in float). */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Self-host size step (self-host-pod-sizing): instead of cloud tiers, the owner sizes a pod
 * against the REAL host it runs on. Two limits — CPU cores and memory (GB) — each defaulting to
 * "No limit" (the pod uses what it needs; the OSS default). We show host total / free and warn
 * (never block) when a chosen limit exceeds free capacity, since unlimited pods aren't reserved
 * and the host may be overcommitted deliberately.
 *
 * State lives in the parent as `cpus` (cores, null ⇒ unlimited) and `memoryMb` (MB, null ⇒
 * unlimited); this component only edits those two values.
 */
export default function HostResourceChooser({
  capacity,
  cpus,
  memoryMb,
  onCpus,
  onMemoryMb,
}: {
  capacity: HostCapacity | null;
  cpus: number | null;
  memoryMb: number | null;
  onCpus: (v: number | null) => void;
  onMemoryMb: (v: number | null) => void;
}) {
  const freeCpus = capacity ? Math.max(0, capacity.cpus - capacity.allocatedCpus) : null;
  const freeMemGb = capacity ? Math.max(0, capacity.memoryGb - capacity.allocatedMemoryGb) : null;
  const memGb = memoryMb != null ? memoryMb / 1024 : null;
  const cpuOver = freeCpus != null && cpus != null && cpus > freeCpus;
  const memOver = freeMemGb != null && memGb != null && memGb > freeMemGb;

  return (
    <div className="flex flex-col gap-4">
      {capacity ? (
        <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] tabular-nums text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">This machine:</span>{" "}
            {fmt(capacity.cpus)} vCPU · {fmt(capacity.memoryGb)} GB RAM
          </div>
          <div>
            <span className="font-medium text-foreground">Free:</span> {fmt(freeCpus ?? 0)} vCPU ·{" "}
            {fmt(freeMemGb ?? 0)} GB
            {(capacity.allocatedCpus > 0 || capacity.allocatedMemoryGb > 0) && (
              <span className="text-[11px]">
                {" "}
                ({fmt(capacity.allocatedCpus)} vCPU · {fmt(capacity.allocatedMemoryGb)} GB reserved by
                running pods)
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          Couldn’t read host capacity (is Docker reachable?). You can still set limits — they’ll
          apply as <code className="text-[11px]">--cpus</code> / <code className="text-[11px]">--memory</code>.
        </div>
      )}

      <LimitRow
        label="CPU"
        unit="cores"
        value={cpus}
        onChange={onCpus}
        step={0.5}
        min={0.5}
        placeholder={freeCpus != null ? fmt(freeCpus) : "e.g. 2"}
        over={cpuOver}
        overNote={freeCpus != null ? `Only ${fmt(freeCpus)} vCPU free — pod may contend.` : null}
      />
      <LimitRow
        label="Memory"
        unit="GB"
        value={memGb}
        onChange={(v) => onMemoryMb(v == null ? null : Math.round(v * 1024))}
        step={0.5}
        min={0.5}
        placeholder={freeMemGb != null ? fmt(freeMemGb) : "e.g. 4"}
        over={memOver}
        overNote={freeMemGb != null ? `Only ${fmt(freeMemGb)} GB free — pod may contend.` : null}
      />

      <p className="text-[11px] text-muted-foreground">
        Leave a limit off and the pod uses whatever the host has spare (the default). A limit caps
        the container; unlimited pods aren’t counted as reserved.
      </p>
    </div>
  );
}

function LimitRow({
  label,
  unit,
  value,
  onChange,
  step,
  min,
  placeholder,
  over,
  overNote,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
  min: number;
  placeholder: string;
  over: boolean;
  overNote: string | null;
}) {
  const limited = value != null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="w-16 text-[13px] font-medium">{label}</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-border text-[12px]">
          <button
            type="button"
            aria-pressed={!limited}
            onClick={() => onChange(null)}
            className={cn(
              "px-3 py-1.5 transition-colors",
              !limited ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
            )}
          >
            No limit
          </button>
          <button
            type="button"
            aria-pressed={limited}
            onClick={() => onChange(value ?? (Number(placeholder) || min))}
            className={cn(
              "border-l border-border px-3 py-1.5 transition-colors",
              limited ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
            )}
          >
            Limit
          </button>
        </div>
        {limited && (
          <div className="flex items-center gap-1.5">
            {/* Stepper: −/+ around the field, native browser spin-buttons hidden (webkit + firefox). */}
            <div
              className={cn(
                "flex items-center overflow-hidden rounded-lg border border-border",
                over && "border-amber-500",
              )}
            >
              <button
                type="button"
                aria-label={`Decrease ${label}`}
                onClick={() => onChange(round(Math.max(min, (value ?? min) - step)))}
                className="flex h-8 w-8 items-center justify-center text-[15px] text-muted-foreground hover:bg-muted"
              >
                −
              </button>
              <Input
                type="number"
                inputMode="decimal"
                step={step}
                min={min}
                value={value ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(e.target.value === "" || Number.isNaN(n) ? null : Math.max(0, n));
                }}
                className={cn(
                  "h-8 w-16 rounded-none border-0 border-x border-border text-center tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0",
                  "[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none",
                )}
                placeholder={placeholder}
              />
              <button
                type="button"
                aria-label={`Increase ${label}`}
                onClick={() => onChange(round((value ?? min) + step))}
                className="flex h-8 w-8 items-center justify-center text-[15px] text-muted-foreground hover:bg-muted"
              >
                +
              </button>
            </div>
            <span className="text-[12px] text-muted-foreground">{unit}</span>
          </div>
        )}
      </div>
      {limited && over && overNote && (
        <p className="ml-[76px] text-[11px] text-amber-600 dark:text-amber-500">{overNote}</p>
      )}
    </div>
  );
}
