"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { myRelayLive, type MyRelayLive } from "@/lib/relay-actions";

/**
 * The relay row's live right-hand side. Owns the whole state — connected or not, tunnel
 * health, usage — and POLLS it on a short interval so the cockpit is near-realtime with
 * no button for the owner to press. Read-only: polling never opens a connection through
 * their machine (see myRelayLive), so watching the dashboard costs them nothing.
 *
 * Kept deliberately terse: one status line, and a usage line only when there's traffic.
 * The what/why/limits live behind the ⓘ and in the README, not here.
 */
function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const POLL_MS = 10_000;

export function RelayStatus({ initial, settingsHref }: { initial: MyRelayLive; settingsHref: string }) {
  const [live, setLive] = useState<MyRelayLive>(initial);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Skip while a fetch is in flight or the tab is hidden — no point polling a
      // dashboard nobody is looking at, and it keeps us off the owner's machine.
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const next = await myRelayLive();
        if (alive) setLive(next);
      } catch {
        /* transient — keep the last good value rather than flicker */
      } finally {
        busy.current = false;
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!live.connected) {
    return (
      <span className="flex flex-col items-end gap-1 text-right">
        <span className="text-[12.5px] text-muted-foreground">Not connected</span>
        <Link
          href={settingsHref}
          className="text-[11px] font-medium text-[var(--accent-light)] hover:underline"
        >
          Set up on your computer →
        </Link>
      </span>
    );
  }

  const failing = live.health?.state === "failed";
  const u = live.usage;
  const bytes = u ? u.bytesUp + u.bytesDown : 0;

  return (
    <span className="flex flex-col items-end gap-0.5 text-right">
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] ${failing ? "text-destructive" : "text-success"}`}
        // A one-word state in the row; the specific cause (timed out, disconnected, …)
        // rides the tooltip so the small space stays legible but the detail isn't lost.
        title={failing ? live.health?.reason ?? undefined : undefined}
      >
        <span className={`h-2 w-2 rounded-full ${failing ? "bg-destructive" : "bg-success"}`} />
        {failing ? "Relay failure" : "Connected"}
      </span>
      {/* Usage only when there's something to say. A healthy, idle relay is just
          "Connected" — no clutter. The row's desc already says "through your
          computer", so the number stands alone. */}
      {u && (u.open > 0 || u.connections > 0) && (
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {u.open > 0 ? `${u.open} active · ` : ""}
          {fmtBytes(bytes)}
        </span>
      )}
    </span>
  );
}
