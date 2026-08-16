import type { OomKill } from "./oom.js";

/**
 * Turn a restart into an OWNER-facing notice on the resume nudge — the PRIMARY
 * observability channel (design.md §3). The owner lives in the agent session, not the
 * cockpit, so when the pod restarts BECAUSE of an incident (today: an OOM that killed
 * the agent) we prepend a "Podbay system notice" to the nudge the greeter types on
 * resume. Purely functional (no I/O) so the wording + attribution are unit-tested
 * without a kernel — main.ts feeds it dmesg + uptime.
 */

export interface OomAttribution {
  victim: string;
  rssMb: number;
  /** Seconds-since-boot of the kill. */
  ktime: number;
  /** ≥2 agent OOMs in the recency window = a loop → escalate the wording. */
  loop: boolean;
}

/** An OOM within this many seconds BEFORE the process came up plausibly caused the
 * restart. Wide enough to survive slow boots, tight enough not to blame an old kill. */
export const OOM_RECENCY_SEC = 180;

/**
 * Did a recent OOM of the AGENT plausibly cause this restart? Considers only kills
 * whose ktime sits within `recencySec` of the current uptime — i.e. just before we
 * came back up. `isAgent` decides whether a victim comm is the agent (claude/codex).
 *
 * Note: this only catches a process-OOM where the VM did NOT reboot (dmesg retains
 * the line and ktime stays comparable to uptime). A full OOM-triggered VM reboot
 * clears dmesg, so it can't be attributed here — that path would need a persisted
 * record and is out of scope for v1 (record-only in the cockpit still covers it).
 */
export function attributeRestartToOom(
  kills: OomKill[],
  uptimeSec: number,
  isAgent: (comm: string) => boolean,
  recencySec: number = OOM_RECENCY_SEC,
): OomAttribution | null {
  const recent = kills.filter(
    (k) => k.ktime > 0 && isAgent(k.victim) && uptimeSec - k.ktime <= recencySec && uptimeSec - k.ktime >= 0,
  );
  if (recent.length === 0) return null;
  const last = recent.reduce((a, b) => (b.ktime > a.ktime ? b : a));
  return { victim: last.victim, rssMb: last.rssMb, ktime: last.ktime, loop: recent.length >= 2 };
}

/**
 * Compose the resume nudge. With no attribution it's the plain base nudge (the pod
 * restarted for a benign reason — an update, a manual restart — so no alarm). With an
 * OOM attribution it leads with the owner notice, then the normal orient nudge, so the
 * agent surfaces WHY on resume. Escalates on a loop. One notice per restart (the
 * greeter types this once), satisfying the "state a cause once" dedup.
 */
export function composeResumeNudge(
  base: string,
  attribution: OomAttribution | null,
  cockpitUrl?: string | null,
): string {
  if (!attribution) return base;
  const link = cockpitUrl ? ` (cockpit: ${cockpitUrl})` : "";
  const notice = attribution.loop
    ? `Podbay system notice: this pod keeps running out of memory — the agent has been OOM-killed and restarted more than once. Please tell the owner and recommend resizing to a larger compute tier to stop it${link}.`
    : `Podbay system notice: this pod just restarted because it ran out of memory — the agent was OOM-killed. Please tell the owner this happened; if it recurs, a larger compute tier will fix it${link}.`;
  return `${notice} ${base}`;
}
