/**
 * Pod compute tiers. The launch/resize picker offers three presets. CPU and RAM
 * are RESERVED per pod (so we price per tier); disk is the hard quota and can
 * only GROW — a pod that was Large and later resized down to Medium keeps its
 * larger disk, so a pod is stored as (size, diskGb) where diskGb may exceed the
 * size's own disk. See docs/strategy/pricing-model.md.
 */

export type PodSize = "s" | "m" | "l";

export interface PodResources {
  cpus: number;
  memoryGb: number;
  diskGb: number;
}

export const POD_TIERS: Record<PodSize, PodResources & { label: string }> = {
  s: { label: "Small", cpus: 2, memoryGb: 4, diskGb: 10 },
  m: { label: "Medium", cpus: 4, memoryGb: 8, diskGb: 20 },
  l: { label: "Large", cpus: 8, memoryGb: 16, diskGb: 40 },
};

export const POD_SIZES: PodSize[] = ["s", "m", "l"];
/** Old fixed sizing was 2/4/10 == Small, so this is also the backfill value. */
export const DEFAULT_POD_SIZE: PodSize = "s";

/**
 * Account slot budget. Each account gets a fixed number of SLOTS; a pod occupies
 * slots by size (memory/4 → Small 1, Medium 2, Large 4), so the budget spends the same
 * whether it's four small pods, two mediums, or one large. A SUSPENDED pod frees its
 * slots — resuming it needs enough free slots to fit again. Over budget ⇒ contact support.
 * This is the same unit the box uses for density (BoxStats.slots = memGb/4).
 *
 * Default 4; `PODBAY_ACCOUNT_SLOT_CAP` overrides it (tune the global cap without a deploy).
 * Read server-side only — the client receives the cap as a prop, never this constant.
 */
export const ACCOUNT_SLOT_CAP =
  Number(typeof process !== "undefined" ? process.env?.PODBAY_ACCOUNT_SLOT_CAP : undefined) || 4;

/** Slots a pod of this size occupies (memory GB / 4). */
export function slotsForSize(size: PodSize): number {
  return POD_TIERS[size].memoryGb / 4;
}

export function isPodSize(x: unknown): x is PodSize {
  return x === "s" || x === "m" || x === "l";
}

/**
 * Resolve a stored (size, diskGb) to the concrete resources a provider needs.
 * diskGb is passed through (it's the high-water mark and may be larger than the
 * size's default); CPU/RAM come from the size preset.
 */
export function resolveResources(size: PodSize, diskGb: number): PodResources {
  const t = POD_TIERS[size];
  return { cpus: t.cpus, memoryGb: t.memoryGb, diskGb: Math.max(diskGb, t.diskGb) };
}

/** Human label for a stored (size, diskGb): the tier name, plus a disk note when
 * the pod kept a larger disk than its current size implies (a resize-down). */
export function labelForPod(size: PodSize, diskGb: number): string {
  const t = POD_TIERS[size];
  return diskGb > t.diskGb ? `${t.label} · ${diskGb} GB disk` : t.label;
}
