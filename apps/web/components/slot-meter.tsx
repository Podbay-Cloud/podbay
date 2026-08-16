"use client";

import { openSupportChat } from "@/lib/support-chat";

/**
 * The account's slot budget at a glance. A pod costs slots by size (Small 1, Medium 2,
 * Large 4); a suspended pod frees its slots. When the budget is full, the only way to add
 * a pod is to suspend one — or ask for more, which routes to support.
 *
 * Admins are unbounded, so they see a plain "unlimited" note rather than a meter that
 * would always read as maxed.
 */
export default function SlotMeter({
  used,
  cap,
  unlimited,
}: {
  used: number;
  cap: number;
  unlimited: boolean;
}) {
  if (unlimited) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="inline-flex h-2 w-2 rounded-full bg-success" />
        Slots: unlimited
      </div>
    );
  }

  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const full = used >= cap;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[12.5px]">
        <span className="font-medium">
          <span className="tabular-nums">{used} of {cap}</span>{" "}
          <span className="text-muted-foreground">slots used</span>
        </span>
        <button
          type="button"
          onClick={() => openSupportChat(`I'd like more than ${cap} slots on my Podbay account.`)}
          className="font-medium text-[var(--accent-light)] hover:underline"
        >
          Request more slots
        </button>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${full ? "bg-warning" : "bg-[var(--accent-light)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {full && (
        <p className="text-xs text-muted-foreground">
          You&rsquo;re using all your slots. Suspend a pod to free some, or ask support for more.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        A pod costs 1–4 slots by size (Small 1 · Medium 2 · Large 4). Suspended pods don&rsquo;t count.
      </p>
    </div>
  );
}
