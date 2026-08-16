import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, user } from "@podbay/db";
import { FakeProvider } from "@podbay/provider";
import { PodService } from "../src/service.js";
import { DrizzlePodStore } from "../src/drizzle-store.js";
import { FetchMemory } from "../src/fetch-memory.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "environments",
);

let svc: PodService;
let provider: FakeProvider;
let mem: FetchMemory;
let close: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  await t.db.insert(user).values({ id: "u", name: "u", email: "u@example.com" });
  provider = new FakeProvider();
  mem = new FetchMemory(t.db);
  svc = new PodService(provider, new DrizzlePodStore(t.db), {
    environmentsRoot: envRoot,
    fetchMemory: mem,
  });
});
afterEach(async () => close());

/**
 * The loop only pays off if it closes: a pod records an outcome, the fleet learns it,
 * and every other pod is told. This exercises the whole round trip on the poll that
 * already runs.
 */
describe("fetch memory round trip", () => {
  it("drains a pod's outcomes into the fleet's table", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.fetchReports = [
      { domain: "reddit.com", rung: "direct", outcome: "blocked" },
      { domain: "reddit.com", rung: "relay", outcome: "ok" },
    ];

    await svc.reconcile(rec.id);

    const plan = await mem.plan("u", "reddit.com");
    expect(plan.bad.map((b) => b.rung)).toContain("direct");
    expect(plan.good).toContain("relay");
  });

  it("pushes the fleet's plan back down, so the next pod does not re-learn it", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await mem.record("u", "reddit.com", "direct", "blocked");
    await mem.record("u", "reddit.com", "relay", "ok");

    await svc.reconcile(rec.id);

    const pushed = provider.pushedPlan as { domains: Record<string, { good: string[]; bad: unknown[] }> };
    expect(pushed.domains["reddit.com"]!.good).toEqual(["relay"]);
    expect(pushed.domains["reddit.com"]!.bad).toHaveLength(1);
  });

  it("does not push an expired verdict — stale knowledge is worse than none", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await mem.record("u", "old.com", "direct", "blocked");
    await mem.expire("old.com");

    await svc.reconcile(rec.id);

    const pushed = provider.pushedPlan as { domains: Record<string, unknown> };
    expect(pushed.domains["old.com"]).toBeUndefined();
  });

  it("survives a malformed report instead of losing the whole drain", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.fetchReports = [
      { domain: "not a domain!!", rung: "direct", outcome: "blocked" },
      { domain: "good.com", rung: "direct", outcome: "ok" },
    ];

    await svc.reconcile(rec.id);

    expect((await mem.plan("u", "good.com")).good).toContain("direct");
  });

  it("works without fetch memory configured — degraded, never broken", async () => {
    const t2 = await createTestDb();
    await t2.db.insert(user).values({ id: "u2", name: "u2", email: "u2@example.com" });
    const bare = new PodService(new FakeProvider(), new DrizzlePodStore(t2.db), {
      environmentsRoot: envRoot,
    });
    const rec = await bare.launchPod("u2", "nextjs-starter");
    await bare.provisionPending();
    await expect(bare.reconcile(rec.id)).resolves.toBeTruthy();
    await t2.close();
  });
});
