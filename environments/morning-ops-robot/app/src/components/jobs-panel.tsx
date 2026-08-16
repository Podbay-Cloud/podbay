"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Job } from "@/lib/types";

function scheduleLabel(j: Job): string {
  const tz = j.schedule.timezone ? ` ${j.schedule.timezone}` : "";
  if (j.schedule.times?.length) return `daily ${j.schedule.times.join(", ")}${tz}`;
  if (j.schedule.everyMinutes) return `every ${j.schedule.everyMinutes} min`;
  return "no schedule";
}

export function JobsPanel({ jobs }: { jobs: Job[] }) {
  const [items, setItems] = useState(jobs);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    setItems((xs) => xs.map((j) => (j.id === id ? { ...j, enabled } : j)));
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    setBusy(null);
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Tell the bot what to watch or check, and it&apos;ll set them up here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y">
      {items.map((j) => (
        <li key={j.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{j.name}</span>
              <Badge variant="secondary" className="shrink-0 capitalize">
                {j.mode}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">{scheduleLabel(j)}</div>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={j.enabled}
              disabled={busy === j.id}
              onChange={(e) => toggle(j.id, e.target.checked)}
              className="size-4"
            />
            {j.enabled ? "on" : "off"}
          </label>
        </li>
      ))}
    </ul>
  );
}
