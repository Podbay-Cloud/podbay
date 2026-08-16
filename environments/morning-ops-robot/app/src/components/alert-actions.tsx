"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlertState } from "@/lib/types";

/** Acknowledge / resolve an alert (PATCH /api/alerts). Optimistic + hides on resolve. */
export function AlertActions({ id, state }: { id: string; state: AlertState }) {
  const [cur, setCur] = useState<AlertState>(state);
  const [busy, setBusy] = useState(false);

  async function set(next: AlertState) {
    setBusy(true);
    setCur(next);
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, state: next }),
    });
    setBusy(false);
  }

  if (cur === "resolved") return <span className="text-xs text-muted-foreground">resolved</span>;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {cur === "firing" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => set("acknowledged")}>
          Ack
        </Button>
      )}
      {cur === "acknowledged" && <span className="text-xs text-muted-foreground">acked</span>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("resolved")}>
        Resolve
      </Button>
    </div>
  );
}
