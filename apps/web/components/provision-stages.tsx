"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The staged "your pod is being created" checklist (machine → boot → agent),
 * shown both during the pre-pod launch call and on the setup page's "creating"
 * step. Times are approximate — real machine events are a follow-up; `sinceMs`
 * lets the setup page anchor progress to the pod's createdAt so a refresh keeps
 * the stages roughly in place rather than restarting. The active stage shows a
 * live elapsed counter; the open-ended last stage ("Starting <agent>") also shows
 * a hint, since first boot legitimately takes up to ~a minute and a silent
 * spinner reads as "stuck". The agent is named because a Codex pod saying
 * "Starting Claude" is simply wrong.
 */
function stages(agentName: string): { label: string; doneAt: number | null; hint?: string }[] {
  return [
    { label: "Creating machine + volume", doneAt: 6 },
    { label: "Booting the pod", doneAt: 18 },
    {
      label: `Starting ${agentName}`,
      doneAt: null,
      hint: "First boot compiles your app and starts the agent — this can take up to a minute.",
    },
  ];
}

export default function ProvisionStages({
  sinceMs = 0,
  agent,
}: {
  sinceMs?: number;
  /** Active agent id, so the last stage names the right CLI. */
  agent?: string;
}) {
  const STAGES = stages(agent === "codex" ? "Codex" : "Claude");
  const [secs, setSecs] = useState(Math.floor(sinceMs / 1000));
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const firstPending = STAGES.findIndex((s) => s.doneAt === null || secs < s.doneAt);
  // Elapsed within the active stage (since the previous stage's doneAt).
  const prevDoneAt = firstPending > 0 ? (STAGES[firstPending - 1].doneAt ?? 0) : 0;
  const stageSecs = Math.max(0, secs - prevDoneAt);

  return (
    <ul className="flex flex-col gap-2.5">
      {STAGES.map((st, i) => {
        const done = st.doneAt !== null && secs >= st.doneAt;
        const active = i === firstPending;
        return (
          <li key={st.label} className="flex flex-col gap-1">
            <div
              className={cn(
                "flex items-center gap-2.5 text-sm",
                done ? "text-success" : active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
                {done ? "✓" : active ? <Loader2 className="size-4 animate-spin" /> : "○"}
              </span>
              <span>{st.label}</span>
              {active && (
                <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
                  {stageSecs}s
                </span>
              )}
            </div>
            {active && st.hint && (
              <p className="pl-[30px] text-xs leading-snug text-muted-foreground">{st.hint}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
