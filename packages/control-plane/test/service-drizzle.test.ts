import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, user, pods } from "@podbay/db";
import { eq } from "drizzle-orm";
import { PodService } from "../src/service.js";
import { DrizzlePodStore } from "../src/drizzle-store.js";
import { MockProvider } from "./mock-provider.js";

const environmentsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
);

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});

/** PodService must work unchanged over the Postgres store. */
describe("PodService over DrizzlePodStore", () => {
  it("launch → sleep → destroy persists/updates/removes DB rows", async () => {
    const { db, close: c } = await createTestDb();
    close = c;
    await db.insert(user).values({ id: "u1", name: "Vels", email: "vels@example.com" });

    const provider = new MockProvider();
    const svc = new PodService(provider, new DrizzlePodStore(db), { environmentsRoot });

    const rec = await svc.launchPod("u1", "nextjs-starter");
    // Row persisted immediately (before the machine finishes building).
    expect((await db.select().from(pods).where(eq(pods.id, rec.id)))[0]?.ownerId).toBe("u1");
    await svc.provisionPending(); // run the provisioner worker once (builds the just-enqueued pod)

    const slept = await svc.sleep("u1", rec.id);
    expect(slept.status).toBe("suspended");
    expect((await db.select().from(pods).where(eq(pods.id, rec.id)))[0]?.status).toBe("suspended");

    await svc.destroy("u1", rec.id);
    expect(await db.select().from(pods).where(eq(pods.id, rec.id))).toEqual([]);
    expect(provider.destroyed).toContain(rec.id);
  }, 30_000);

  it("onboarding milestones round-trip through the Postgres columns", async () => {
    const { db, close: c } = await createTestDb();
    close = c;
    await db.insert(user).values({ id: "u1", name: "Vels", email: "vels@example.com" });
    const svc = new PodService(new MockProvider(), new DrizzlePodStore(db), { environmentsRoot });

    const rec = await svc.launchPod("u1", "nextjs-starter");
    expect(rec.authedAt).toBeNull();
    expect(rec.sessionUrl).toBeNull();

    await svc.recordAuthed("u1", rec.id);
    await svc.recordSessionUrl("u1", rec.id, "https://claude.ai/code/session_xyz");

    // Re-read from a fresh getPod (goes through toRecord ← the timestamp/text cols).
    const after = await svc.getPod("u1", rec.id);
    expect(after.authedAt).not.toBeNull();
    expect(after.sessionUrl).toBe("https://claude.ai/code/session_xyz");
    const row = (await db.select().from(pods).where(eq(pods.id, rec.id)))[0];
    expect(row?.authedAt).toBeInstanceOf(Date);
    expect(row?.sessionUrl).toBe("https://claude.ai/code/session_xyz");
  }, 30_000);
});
