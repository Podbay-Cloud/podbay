import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@podbay/db";
import { FetchMemory, normalizeDomain, FETCH_MEMORY_TTL_MS } from "../src/fetch-memory.js";

let mem: FetchMemory;
let close: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  mem = new FetchMemory(t.db);
  close = t.close;
});
afterEach(async () => close());

/**
 * The point of this table is to stop every pod rediscovering the same refusal. The
 * negative results carry most of that value, so they are tested hardest.
 */
describe("fetch memory", () => {
  it("tells an agent which rung to skip, and why", async () => {
    await mem.record("u", "reddit.com", "direct", "blocked");
    await mem.record("u", "reddit.com", "reader", "blocked");
    await mem.record("u", "reddit.com", "relay", "ok");

    const plan = await mem.plan("u", "reddit.com");
    expect(plan.good).toEqual(["relay"]);
    // "why" matters: the agent should be able to say what happened, not just skip.
    expect(plan.bad.map((b) => b.rung).sort()).toEqual(["direct", "reader"]);
    expect(plan.bad.every((b) => b.outcome === "blocked")).toBe(true);
  });

  it("knows nothing about a domain it has never seen", async () => {
    const plan = await mem.plan("u", "example.com");
    expect(plan.good).toEqual([]);
    expect(plan.bad).toEqual([]);
    // Not a date — reporting one would invite trusting knowledge we don't have.
    expect(plan.lastVerified).toBeNull();
  });

  it("forgets a verdict once it is older than the TTL", async () => {
    // A site that tightened its rules in March must not be believed forever.
    await mem.record("u", "slow-to-change.com", "direct", "blocked");
    const later = Date.now() + FETCH_MEMORY_TTL_MS + 1000;
    const plan = await mem.plan("u", "slow-to-change.com", later);
    expect(plan.bad).toEqual([]);
    expect(plan.lastVerified).toBeNull();
  });

  it("accumulates counts so a flaky rung reads differently from a dead one", async () => {
    for (const o of ["ok", "ok", "ok", "blocked"] as const) await mem.record("u", "flaky.com", "direct", o);
    const row = (await mem.all()).find((r) => r.domain === "flaky.com" && r.rung === "direct")!;
    expect(row.okCount).toBe(3);
    expect(row.failCount).toBe(1);
    // The latest verdict is what the plan acts on, even when the history is mostly good.
    expect(row.lastOutcome).toBe("blocked");
  });

  it("lets an operator re-check without losing the history", async () => {
    await mem.record("u", "changed-its-mind.com", "direct", "blocked");
    await mem.expire("changed-its-mind.com");
    expect((await mem.plan("u", "changed-its-mind.com")).bad).toEqual([]);
    // The counts survive — expiring is "check again", not "forget".
    const row = (await mem.all()).find((r) => r.domain === "changed-its-mind.com")!;
    expect(row.failCount).toBe(1);
    expect(row.stale).toBe(true);
  });
});

describe("the privacy boundary is enforced here, not trusted to callers", () => {
  it("reduces a full URL to its host, discarding path and query", () => {
    // A caller naturally has a URL, and a URL can carry a token. Accepting one and
    // throwing the rest away means the table CANNOT hold a research log even if
    // every caller is careless.
    expect(normalizeDomain("https://www.reddit.com/r/programming/?token=secret123#x")).toBe(
      "reddit.com",
    );
    expect(normalizeDomain("http://user:pw@Example.COM:8443/path")).toBe("example.com");
  });

  it("stores only the host, even when handed a URL", async () => {
    await mem.record("u", "https://news.ycombinator.com/item?id=1&auth=abc", "api", "ok");
    const rows = await mem.all();
    expect(rows[0]!.domain).toBe("news.ycombinator.com");
    expect(JSON.stringify(rows)).not.toMatch(/auth|abc|item/);
  });

  it("refuses input that is not a domain at all", () => {
    expect(() => normalizeDomain("")).toThrow();
    expect(() => normalizeDomain("not a domain")).toThrow();
  });
});

describe("record refuses junk that would poison a fleet-wide table", () => {
  it("rejects an unknown rung — it is half the primary key", async () => {
    await expect(mem.record("u", "a.com", "telepathy" as never, "ok")).rejects.toThrow();
  });
  it("rejects an unknown outcome", async () => {
    await expect(mem.record("u", "a.com", "direct", "kinda" as never)).rejects.toThrow();
  });
  it("rejects a bare TLD that endsWith would lend the whole web", () => {
    expect(() => normalizeDomain("com")).toThrow();
  });
  it("collapses a trailing dot to the same host, not a distinct row", () => {
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });
  it("refuses an over-long domain", () => {
    expect(() => normalizeDomain("a".repeat(260) + ".com")).toThrow();
  });
});

describe("owner-scoping (M1 — untrusted tenants can't poison the fleet)", () => {
  it("one owner's verdict never reaches another owner's plan", async () => {
    // owner A (a hostile pod) lies: github.com is blocked on 'direct'.
    await mem.record("owner-a", "github.com", "direct", "blocked");
    // owner B's plan must NOT contain A's verdict.
    const planB = await mem.fleetPlan("owner-b");
    expect(planB.domains["github.com"]).toBeUndefined();
    // A's own plan does see A's own verdict (self-scope).
    const planA = await mem.fleetPlan("owner-a");
    expect(planA.domains["github.com"]?.bad.map((b) => b.rung)).toContain("direct");
  });

  it("the trusted global baseline (owner '') is shared with every owner", async () => {
    await mem.record("", "reddit.com", "direct", "blocked"); // podbay-seeded baseline
    for (const owner of ["owner-a", "owner-b"]) {
      const plan = await mem.fleetPlan(owner);
      expect(plan.domains["reddit.com"]?.bad.map((b) => b.rung)).toContain("direct");
    }
  });

  it("an owner's FRESHER verdict overrides a stale global one (no self-contradiction)", async () => {
    const t0 = Date.now();
    await mem.record("", "site.com", "direct", "blocked"); // global says blocked
    await mem.record("owner-a", "site.com", "direct", "ok"); // A later finds it works
    const plan = await mem.fleetPlan("owner-a", 500, t0 + 1000);
    // exactly one verdict for direct — the fresher (A's ok), not both
    expect(plan.domains["site.com"]?.good).toContain("direct");
    expect(plan.domains["site.com"]?.bad.map((b) => b.rung)).not.toContain("direct");
  });
});
