/**
 * Read out-of-memory kills out of the kernel log.
 *
 * The pod-agent runs as root, so it can read `dmesg`/`/dev/kmsg`. When memory is
 * exhausted the kernel logs a line like (seen on makore, 2026-08-01):
 *
 *   [127688.540184] Out of memory: Killed process 196850 (next-server (v1) \
 *     total-vm:69990212kB, anon-rss:3242600kB, file-rss:256kB, ...
 *
 * We pull the pid, the (truncated) process name, and its resident memory. Whether the
 * kill actually interrupted the OWNER — i.e. it was the agent — is decided by the
 * caller, which knows the agent's pid; this parser is pure so the format handling is
 * tested against captured log text with no kernel involved.
 */

export interface OomKill {
  /** Seconds-since-boot from the `[ktime]` prefix, or 0 if the log had none. Monotonic
   * within a boot; resets on reboot — the caller uses it as a cursor and treats a value
   * that jumps backwards as a fresh boot. */
  ktime: number;
  pid: number;
  /** The kernel `comm` (truncated to ~15 chars), e.g. `next-server (v1`, `chrome`, `node`. */
  victim: string;
  /** Resident anonymous memory of the victim at kill time, in MB. */
  rssMb: number;
}

// The kernel logs two shapes: a GLOBAL OOM ("[ktime] Out of memory: Killed process")
// and a CGROUP OOM ("[ktime] Memory cgroup out of memory: Killed process"). The
// optional "Memory cgroup " keeps the ktime attached to BOTH — without it, a memcg
// kill's ktime landed 0 (the words intervene) and newOomKills dropped it as "seen".
const OOM_RE =
  /(?:\[\s*(\d+(?:\.\d+)?)\]\s*)?(?:Memory cgroup )?Out of memory: Killed process (\d+) \(([^)]+)\)[^\n]*?anon-rss:(\d+)kB/gi;

export function parseOomKills(dmesg: string): OomKill[] {
  const out: OomKill[] = [];
  let m: RegExpExecArray | null;
  OOM_RE.lastIndex = 0;
  while ((m = OOM_RE.exec(dmesg)) !== null) {
    out.push({
      ktime: m[1] ? parseFloat(m[1]) : 0,
      pid: parseInt(m[2]!, 10),
      victim: m[3]!.trim(),
      rssMb: Math.round(parseInt(m[4]!, 10) / 1024),
    });
  }
  return out;
}

/**
 * Filter to kills newer than a cursor, handling a reboot (ktime jumps backwards) by
 * treating everything as new. Returns the kept kills and the cursor to persist next.
 */
export function newOomKills(kills: OomKill[], cursor: number): { fresh: OomKill[]; cursor: number } {
  const maxKtime = kills.reduce((m, k) => Math.max(m, k.ktime), 0);
  // A reboot resets ktime near 0; if the newest kill is BELOW the cursor, the log has
  // rolled over, so none of these were seen before.
  const rebooted = maxKtime > 0 && maxKtime < cursor;
  const fresh = rebooted ? kills : kills.filter((k) => k.ktime > cursor);
  return { fresh, cursor: Math.max(rebooted ? 0 : cursor, maxKtime) };
}
