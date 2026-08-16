/**
 * OOM detection via cgroup v2 `memory.events` — the signal that IS readable inside an
 * Incus container.
 *
 * The old detector read `dmesg`, but a container cannot read the host kernel ring
 * buffer (`dmesg: read kernel buffer failed: Operation not permitted`) — even as root —
 * so on the entire Incus fleet `scan()` threw and silently recorded NOTHING. Verified
 * in prod 2026-08-04: a pod that OOM'd had 0 oom events, and 2 existed fleet-wide ever.
 *
 * cgroup v2 exposes a monotonic `oom_kill` counter per cgroup (readable from inside the
 * container), so we poll it and treat a positive delta as fresh kill(s). Trade-off: the
 * counter is just a number — no victim name or RSS (dmesg had those, but is dead here).
 * Attribution is the cgroup the kill landed in (e.g. the agent's own slice, which holds
 * the workspace processes). Pure parse + diff so it's tested without a kernel; the
 * actual /sys/fs/cgroup walk is injected by the caller (see server.ts).
 */

/** Pull the `oom_kill N` count out of a cgroup v2 `memory.events` file body. */
export function parseOomKillCount(memoryEvents: string): number {
  const m = /^oom_kill (\d+)$/m.exec(memoryEvents);
  return m ? parseInt(m[1]!, 10) : 0;
}

export interface FreshCgroupOom {
  /** The cgroup the kill was counted in, e.g. `/system.slice/podbay-agent.service`. */
  cgroup: string;
  /** How many new kills since the cursor. */
  count: number;
}

/**
 * Diff current per-cgroup `oom_kill` counts against the persisted cursor. A counter that
 * went UP yields that many fresh kills; one that dropped (a container recreate resets the
 * cgroup counters to 0) rebaselines silently. The returned cursor is the current counts,
 * to persist for next time.
 *
 * `firstRun` (no cursor persisted yet) baselines everything — start counting from now
 * rather than replaying whatever historical count a cgroup already carries.
 */
export function newCgroupOomKills(
  current: Record<string, number>,
  cursor: Record<string, number>,
  firstRun = false,
): { fresh: FreshCgroupOom[]; cursor: Record<string, number> } {
  if (firstRun) return { fresh: [], cursor: { ...current } };
  const raw: FreshCgroupOom[] = [];
  for (const [cgroup, count] of Object.entries(current)) {
    const prev = cursor[cgroup] ?? 0;
    if (count > prev) raw.push({ cgroup, count: count - prev });
  }
  // A single OOM kill increments the `oom_kill` counter at EVERY ANCESTOR cgroup —
  // cgroup v2 propagates it up the tree — so one kill in `…/session-c6.scope` also bumps
  // `user-1000.slice`, `user.slice`, and the root, and the raw diff reports it once per
  // level. That surfaced as a burst of near-identical OOM banners (verified on makore
  // 2026-08-06: one kill → 3 events user.slice/user-1000.slice/session-c6.scope). Keep
  // only LEAF cgroups — a fresh cgroup that is not a path-ancestor of another fresh one —
  // so the kill is reported ONCE, attributed where it actually landed. Genuinely distinct
  // kills in sibling subtrees stay separate (each is its own leaf).
  const norm = (c: string) => c.replace(/\/+$/, "");
  const isAncestorOfAnother = (c: string) =>
    raw.some((o) => o.cgroup !== c && (norm(o.cgroup) + "/").startsWith(norm(c) + "/"));
  const fresh = raw.filter((o) => !isAncestorOfAnother(o.cgroup));
  return { fresh, cursor: { ...current } };
}

/** A human-ish victim label from the cgroup path — the leaf name (`podbay-agent.service`),
 * or "a process" when there's nothing better. */
export function cgroupLabel(cgroup: string): string {
  const base = cgroup.replace(/\/+$/, "").split("/").pop();
  return base && base.length > 0 ? base : "a process";
}
