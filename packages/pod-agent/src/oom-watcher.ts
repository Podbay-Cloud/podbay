import { newCgroupOomKills, cgroupLabel } from "./oom-cgroup.js";

/**
 * Watches for OOM kills via cgroup v2 `memory.events` and keeps a small, deduped recent
 * history.
 *
 * Two jobs:
 *  - report each kill so the control plane records an incident;
 *  - answer "was there an OOM just now?" so a watchdog agent-respawn can be ATTRIBUTED
 *    to out-of-memory (the reliable signal — the agent process dying around an OOM —
 *    rather than fragile pid matching).
 *
 * Detection source is the cgroup `oom_kill` counter, NOT dmesg: a container can't read
 * the host kernel ring buffer, so the old dmesg watcher was blind on the whole Incus
 * fleet (see oom-cgroup.ts). The counter carries no victim/RSS — attribution is the
 * cgroup the kill landed in. IO is injected so the glue is testable; the parse/diff is
 * the already-tested oom-cgroup.ts.
 */

export interface OomEvent {
  /** Best-effort label — the cgroup the kill landed in (cgroup gives no victim name). */
  victim: string;
  /** Resident MB of the victim — unavailable from the cgroup counter, so always 0. */
  rssMb: number;
  /** Whether the victim was the agent itself. The cgroup counter can't tell, so this is
   * always false here; a genuine agent death is attributed via the respawn + sawOomSince
   * path (a pod_repaired event with cause=oom), which stays accurate. */
  victimIsAgent: boolean;
  /** A synthetic, unique, restart-safe dedup key (wall-clock ms + intra-scan index). The
   * control plane dedups OOM events by this field; the cgroup counter has no kernel
   * ktime, and wall-clock never collides across pod-agent restarts. */
  ktime: number;
  /** Wall-clock ISO of when we noticed it. */
  at: string;
}

export interface OomWatcherDeps {
  /** Current cgroup-v2 `oom_kill` counts, keyed by cgroup path (a /sys/fs/cgroup walk). */
  readOomCounts: () => Record<string, number>;
  /** The persisted per-cgroup cursor (last-seen counts), or null when never written yet
   * (first run — we baseline instead of replaying historical counts). */
  readCursor: () => Record<string, number> | null;
  writeCursor: (c: Record<string, number>) => void;
  now: () => number;
}

const MAX_EVENTS = 20;
const RECENT_WINDOW_MS = 5 * 60_000;

export class OomWatcher {
  private events: OomEvent[] = [];
  private recentAt: number[] = [];

  constructor(private readonly deps: OomWatcherDeps) {}

  /** Scan the cgroup counters for new kills since the persisted cursor; record them.
   * Idempotent per kill (the cursor advances to the current counts each scan). */
  scan(): void {
    let current: Record<string, number>;
    try {
      current = this.deps.readOomCounts();
    } catch {
      return;
    }
    const prior = this.deps.readCursor();
    const { fresh, cursor } = newCgroupOomKills(current, prior ?? {}, prior === null);
    try {
      this.deps.writeCursor(cursor);
    } catch {
      /* best-effort; a re-report is better than a lost report, but the cursor usually persists */
    }
    if (fresh.length === 0) return;
    const now = this.deps.now();
    let seq = 0;
    for (const { cgroup, count } of fresh) {
      const victim = cgroupLabel(cgroup);
      for (let i = 0; i < count; i++) {
        this.events.push({
          victim,
          rssMb: 0,
          victimIsAgent: false,
          ktime: now + seq++, // unique per kill this scan; monotonic across scans/restarts
          at: new Date(now).toISOString(),
        });
        this.recentAt.push(now);
      }
    }
    this.events = this.events.slice(-MAX_EVENTS);
    this.recentAt = this.recentAt.filter((t) => now - t < RECENT_WINDOW_MS);
  }

  /** The recent OOM record, for the health report. */
  list(): OomEvent[] {
    return this.events;
  }

  /** Was there an OOM within the window? Used to attribute an agent respawn to memory. */
  sawOomSince(withinMs: number): boolean {
    const now = this.deps.now();
    return this.recentAt.some((t) => now - t <= withinMs);
  }
}
