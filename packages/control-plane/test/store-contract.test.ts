import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, user } from "@podbay/db";
import { InMemoryPodStore } from "../src/store.js";
import { DrizzlePodStore } from "../src/drizzle-store.js";
import type { PodStore } from "../src/store.js";
import type { PodRecord } from "../src/types.js";

interface StoreCtx {
  store: PodStore;
  seedOwner: (id: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

function sample(id: string, ownerId: string, over: Partial<PodRecord> = {}): PodRecord {
  return {
    id,
    ownerId,
    environmentName: "nextjs-starter",
    name: null,
    status: "running",
    region: "fra",
    keepAwake: false,
    lifecycle: "auto",
    autoUpdate: "inherit",
    previewPublic: false,
    githubRepo: null,
    // Per-pod agent selection (migration 0023) — a real value, since these two are
    // jsonb and a null would not exercise the round-trip this test exists to prove.
    agents: ["claude-code", "codex"],
    agentAuth: "api-key",
    // Owner-confirmed Codex pairings (migration 0024).
    codexDevices: [{ name: "vels-iphone", at: "2026-01-02T03:04:05.000Z" }],
    authedAt: null,
    sessionUrl: null,
    authUrl: "https://claude.ai/oauth/authorize?code=abc",
    // The authoritative pod→machine link + the image it runs (migration 0012).
    machineId: "d5683049f12345",
    imageDigest: "sha256:deadbeef",
    // Durable image-update progress (migration 0021).
    updatingSince: "2026-01-02T03:04:05.000Z",
    maintenanceKind: "resize" as const,
    updateStage: "recreating",
    // Which SandboxProvider hosts the pod (migration 0015).
    provider: "incus",
    // Compute tier (migration 0016).
    size: "m",
    diskGb: 20,
    // Self-host explicit sizing (migration 0039); null ⇒ unlimited, the store round-trips it as null.
    cpus: null,
    memoryMb: null,
    provisionAttempts: 0,
    provisionLeaseUntil: null,
    provisionError: null,
    walkthroughSeenAt: null,
    position: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** One contract, two implementations — proves behavioral parity. */
function runContract(name: string, setup: () => Promise<StoreCtx>) {
  describe(name, () => {
    let ctx: StoreCtx;
    beforeEach(async () => {
      ctx = await setup();
    });
    afterEach(async () => {
      await ctx.cleanup();
    });

    it("create + read round-trips every field incl. timestamps", async () => {
      await ctx.seedOwner("owner-a");
      const rec = sample("p1", "owner-a");
      await ctx.store.create(rec);
      expect(await ctx.store.get("p1")).toEqual(rec);
    });

    it("get returns null for a missing record", async () => {
      expect(await ctx.store.get("nope")).toBeNull();
    });

    it("listByOwner is scoped to the owner", async () => {
      await ctx.seedOwner("owner-a");
      await ctx.seedOwner("owner-b");
      await ctx.store.create(sample("p1", "owner-a"));
      await ctx.store.create(sample("p2", "owner-a"));
      await ctx.store.create(sample("p3", "owner-b"));
      expect((await ctx.store.listByOwner("owner-a")).map((r) => r.id).sort()).toEqual(["p1", "p2"]);
      expect((await ctx.store.listByOwner("owner-b")).map((r) => r.id)).toEqual(["p3"]);
    });

    it("update reflects on read", async () => {
      await ctx.seedOwner("owner-a");
      await ctx.store.create(sample("p1", "owner-a"));
      const updated = await ctx.store.update("p1", {
        status: "suspended",
        keepAwake: true,
        previewPublic: true,
        lastActiveAt: "2026-02-02T00:00:00.000Z",
      });
      expect(updated.status).toBe("suspended");
      expect(updated.keepAwake).toBe(true);
      expect(updated.previewPublic).toBe(true);
      expect(updated.lastActiveAt).toBe("2026-02-02T00:00:00.000Z");
      expect((await ctx.store.get("p1"))?.status).toBe("suspended");
    });

    it("delete removes the record", async () => {
      await ctx.seedOwner("owner-a");
      await ctx.store.create(sample("p1", "owner-a"));
      await ctx.store.delete("p1");
      expect(await ctx.store.get("p1")).toBeNull();
    });

    it("claimProvisioning claims only provisioning+unleased pods, once, respecting the lease", async () => {
      await ctx.seedOwner("owner-a");
      const t = "2026-01-02T00:00:00.000Z";
      const lease = "2026-01-02T00:02:00.000Z";
      await ctx.store.create(sample("prov", "owner-a", { status: "provisioning" }));
      await ctx.store.create(sample("run", "owner-a", { status: "running" }));

      const first = await ctx.store.claimProvisioning(t, lease, 5);
      expect(first.map((r) => r.id)).toEqual(["prov"]);
      expect(first[0].provisionAttempts).toBe(1);
      expect(first[0].provisionLeaseUntil).toBe(lease);

      // Same instant: the lease is held → a second claim gets nothing (CAS).
      expect(await ctx.store.claimProvisioning(t, lease, 5)).toHaveLength(0);

      // After the lease expires it's claimable again, attempts keeps counting.
      const later = "2026-01-02T00:05:00.000Z";
      const again = await ctx.store.claimProvisioning(later, later, 5);
      expect(again.map((r) => r.id)).toEqual(["prov"]);
      expect(again[0].provisionAttempts).toBe(2);
    });
  });
}

runContract("InMemoryPodStore", async () => ({
  store: new InMemoryPodStore(),
  seedOwner: async () => {},
  cleanup: async () => {},
}));

runContract("DrizzlePodStore (pglite)", async () => {
  const { db, close } = await createTestDb();
  return {
    store: new DrizzlePodStore(db),
    // FK: a pod's owner must exist in the user table.
    seedOwner: async (id) => {
      await db.insert(user).values({ id, name: id, email: `${id}@example.com` });
    },
    cleanup: close,
  };
});
