import { and, eq, sql, desc, inArray } from "@podbay/db";
import { fetchMemory, type Database } from "@podbay/db";

/** The trusted global baseline: rows learned before multi-tenant scoping (podbay's own
 * pods). A plan is always global-baseline ∪ the recipient owner's own rows, so an
 * untrusted tenant can only steer its OWN owner's fetch ladder — never the whole fleet. */
const GLOBAL_OWNER = "";

/**
 * What the fleet has learned about fetching a given domain.
 *
 * The value is mostly in the NEGATIVE results. Knowing that a domain refuses this
 * network saves the whole ladder — several rungs and a minute or two — every time,
 * in every pod, instead of each agent rediscovering it alone.
 *
 * This is a capability map and not a research log, and the difference is enforced
 * here rather than trusted to callers: only a domain, a rung and an outcome are ever
 * written. A shared table containing URLs would be a fleet-wide record of what every
 * owner reads, which is precisely what would make sharing unacceptable.
 */

export type FetchRung = "api" | "direct" | "browser" | "archive" | "reader" | "relay";
export type FetchOutcome = "ok" | "blocked" | "challenged" | "login" | "empty";

const RUNGS = new Set<FetchRung>(["api", "direct", "browser", "archive", "reader", "relay"]);
const OUTCOMES = new Set<FetchOutcome>(["ok", "blocked", "challenged", "login", "empty"]);

/** These are TypeScript types, but the values arrive from a pod over a socket — i.e.
 * untrusted strings. `rung` is half the primary key, so an unvalidated value both
 * poisons a fleet-wide table and lets one pod mint unbounded distinct rows. Validate
 * at the boundary, not just in the type. */
export function isRung(v: unknown): v is FetchRung {
  return typeof v === "string" && RUNGS.has(v as FetchRung);
}
export function isOutcome(v: unknown): v is FetchOutcome {
  return typeof v === "string" && OUTCOMES.has(v as FetchOutcome);
}

/** A verdict older than this is re-checked rather than trusted. Decided 2026-07-30:
 * short enough that a site loosening its edge rules is noticed within a week, long
 * enough that skipping a ladder still pays. Derived, never stored — changing it is a
 * config change, not a migration. */
export const FETCH_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FetchPlan {
  domain: string;
  /** Rungs known to work, most recently confirmed first. */
  good: FetchRung[];
  /** Rungs known to fail, with why — so the agent can explain rather than just skip. */
  bad: { rung: FetchRung; outcome: FetchOutcome }[];
  /** Null when we know nothing (or everything we knew has expired). */
  lastVerified: string | null;
}

export interface FetchMemoryRow {
  domain: string;
  rung: FetchRung;
  okCount: number;
  failCount: number;
  lastOutcome: FetchOutcome;
  lastVerified: string;
  /** Derived: past its TTL, so the next attempt should re-verify. */
  stale: boolean;
}

/**
 * Reduce whatever a caller passed to a bare host.
 *
 * Accepts a full URL on purpose — callers naturally have one — and throws the rest
 * away. That way the privacy boundary is a property of this function rather than a
 * rule everyone has to remember, and a URL carrying a token in its query simply
 * cannot reach the table.
 */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) throw new Error("domain required");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.split("@").pop()!; // userinfo — never stored
  s = s.split(/[/?#]/)[0]!; // path, query, fragment
  s = s.split(":")[0]!; // port
  s = s.replace(/^www\./, "");
  if (!s || s.length > 253 || !/^[a-z0-9.-]+$/.test(s)) throw new Error(`not a domain: ${input}`);
  // A single grant of a bare TLD would lend half the web via endsWith; require a dot.
  if (!s.includes(".")) throw new Error(`not a domain: ${input}`);
  return s.replace(/\.$/, ""); // trailing dot is the same host, must not be a distinct row
}

export class FetchMemory {
  constructor(private readonly db: Database) {}

  /** Record one attempt. Counts accumulate so the admin view can show a rate rather
   * than only the latest verdict — a rung that works four times in five is a
   * different thing from one that has never worked. */
  async record(ownerId: string, domainOrUrl: string, rung: FetchRung, outcome: FetchOutcome): Promise<void> {
    // Reject unknown rungs/outcomes: they are part of the PK, so an unvalidated value
    // both skews a plan and lets one pod mint unbounded junk rows.
    if (!isRung(rung) || !isOutcome(outcome)) {
      throw new Error(`invalid fetch outcome: ${rung}/${outcome}`);
    }
    const domain = normalizeDomain(domainOrUrl);
    const ok = outcome === "ok";
    await this.db
      .insert(fetchMemory)
      .values({
        ownerId,
        domain,
        rung,
        okCount: ok ? 1 : 0,
        failCount: ok ? 0 : 1,
        lastOutcome: outcome,
        lastVerified: new Date(),
      })
      .onConflictDoUpdate({
        target: [fetchMemory.ownerId, fetchMemory.domain, fetchMemory.rung],
        set: {
          okCount: ok ? sql`${fetchMemory.okCount} + 1` : fetchMemory.okCount,
          failCount: ok ? fetchMemory.failCount : sql`${fetchMemory.failCount} + 1`,
          lastOutcome: outcome,
          lastVerified: new Date(),
        },
      });
  }

  /** What an agent should try for this domain, and what it should not bother with —
   * scoped to the owner's own verdicts plus the trusted global baseline. */
  async plan(ownerId: string, domainOrUrl: string, now = Date.now()): Promise<FetchPlan> {
    const domain = normalizeDomain(domainOrUrl);
    const rows = await this.db
      .select()
      .from(fetchMemory)
      .where(and(eq(fetchMemory.domain, domain), inArray(fetchMemory.ownerId, [GLOBAL_OWNER, ownerId])));

    const fresh = rows
      .map((r) => ({ ...r, at: r.lastVerified.getTime() }))
      .filter((r) => now - r.at < FETCH_MEMORY_TTL_MS)
      .sort((a, b) => b.at - a.at);

    return {
      domain,
      good: fresh.filter((r) => r.lastOutcome === "ok").map((r) => r.rung as FetchRung),
      bad: fresh
        .filter((r) => r.lastOutcome !== "ok")
        .map((r) => ({ rung: r.rung as FetchRung, outcome: r.lastOutcome as FetchOutcome })),
      // Only fresh rows count: an expired verdict is not knowledge, and reporting its
      // date would invite trusting it.
      lastVerified: fresh.length ? new Date(fresh[0]!.at).toISOString() : null,
    };
  }

  /** Fleet view for the admin surface: worst-behaved domains first, since those are
   * the ones worth looking at. */
  async all(limit = 200, now = Date.now()): Promise<FetchMemoryRow[]> {
    const rows = await this.db
      .select()
      .from(fetchMemory)
      .orderBy(desc(fetchMemory.failCount), desc(fetchMemory.lastVerified))
      .limit(limit);
    return rows.map((r) => ({
      domain: r.domain,
      rung: r.rung as FetchRung,
      okCount: r.okCount,
      failCount: r.failCount,
      lastOutcome: r.lastOutcome as FetchOutcome,
      lastVerified: r.lastVerified.toISOString(),
      stale: now - r.lastVerified.getTime() >= FETCH_MEMORY_TTL_MS,
    }));
  }

  /**
   * The plan pushed down to pods: fresh verdicts only, folded per domain.
   *
   * Single-sourced so the HTTP exchange and the control socket cannot compute a
   * different plan. Stale rows are dropped — an expired verdict is not knowledge, and
   * pushing it would tell a pod to trust something we no longer stand behind.
   */
  async fleetPlan(
    ownerId: string,
    limit = 500,
    now = Date.now(),
  ): Promise<{
    domains: Record<
      string,
      { good: FetchRung[]; bad: { rung: FetchRung; outcome: FetchOutcome }[]; lastVerified: string | null }
    >;
  }> {
    // Only the trusted global baseline + THIS owner's own verdicts — never another
    // tenant's. A tenant can steer only its own fetch ladder (M1).
    const rows = await this.db
      .select()
      .from(fetchMemory)
      .where(inArray(fetchMemory.ownerId, [GLOBAL_OWNER, ownerId]))
      .orderBy(desc(fetchMemory.failCount), desc(fetchMemory.lastVerified))
      .limit(limit);

    // The owner and the global baseline can hold different verdicts for the same
    // (domain, rung); keep the FRESHEST so the plan isn't self-contradictory (a rung in
    // both good and bad). The owner's newer report thus overrides a stale global one.
    const freshest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = `${r.domain} ${r.rung}`;
      const prev = freshest.get(k);
      if (!prev || r.lastVerified > prev.lastVerified) freshest.set(k, r);
    }

    const domains: Record<
      string,
      { good: FetchRung[]; bad: { rung: FetchRung; outcome: FetchOutcome }[]; lastVerified: string | null }
    > = {};
    for (const r of freshest.values()) {
      if (now - r.lastVerified.getTime() >= FETCH_MEMORY_TTL_MS) continue; // stale
      const lv = r.lastVerified.toISOString();
      const d = (domains[r.domain] ??= { good: [], bad: [], lastVerified: null });
      if (r.lastOutcome === "ok") d.good.push(r.rung as FetchRung);
      else d.bad.push({ rung: r.rung as FetchRung, outcome: r.lastOutcome as FetchOutcome });
      if (!d.lastVerified || lv > d.lastVerified) d.lastVerified = lv;
    }
    return { domains };
  }

  /** Operator "check this again": expire a verdict without deleting what we learned,
   * so the next attempt re-verifies but the history survives. */
  async expire(domainOrUrl: string, rung?: FetchRung): Promise<void> {
    const domain = normalizeDomain(domainOrUrl);
    const old = new Date(Date.now() - FETCH_MEMORY_TTL_MS - 1000);
    await this.db
      .update(fetchMemory)
      .set({ lastVerified: old })
      .where(
        rung
          ? and(eq(fetchMemory.domain, domain), eq(fetchMemory.rung, rung))
          : eq(fetchMemory.domain, domain),
      );
  }
}
