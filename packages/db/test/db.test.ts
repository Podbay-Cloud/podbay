import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  user,
  session,
  landingExperimentAssignments,
  landingExperimentAudit,
  landingExperimentEvents,
  landingExperimentRuns,
  podBaseImages,
  type Database,
} from "../src/index.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});

async function freshDb(): Promise<Database> {
  const t = await createTestDb();
  close = t.close;
  return t.db;
}

describe("db foundation (pglite, no network)", () => {
  it("applies the schema via migrate() on an in-process Postgres (4-tables)", async () => {
    const db = await freshDb();
    // A query against every table proves the schema applied.
    expect(await db.select().from(user)).toEqual([]);
    expect(await db.select().from(session)).toEqual([]);
    expect(await db.select().from(landingExperimentRuns)).toEqual([]);
    expect(await db.select().from(landingExperimentAssignments)).toEqual([]);
    expect(await db.select().from(landingExperimentEvents)).toEqual([]);
    expect(await db.select().from(landingExperimentAudit)).toEqual([]);
  });

  it("defaults approved to false for new users", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "u_x", name: "X", email: "x@example.com" });
    const rows = await db.select().from(user).where(eq(user.id, "u_x"));
    expect(rows[0]?.approved).toBe(false);
  });

  it("round-trips a user + session (2.3)", async () => {
    const db = await freshDb();
    await db.insert(user).values({
      id: "u_1",
      name: "Vels",
      email: "vels@example.com",
      emailVerified: true,
    });
    await db.insert(session).values({
      id: "s_1",
      userId: "u_1",
      token: "tok_abc",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const found = await db.select().from(user).where(eq(user.id, "u_1"));
    expect(found[0]?.email).toBe("vels@example.com");

    const sess = await db.select().from(session).where(eq(session.token, "tok_abc"));
    expect(sess[0]?.userId).toBe("u_1");
  });

  it("enforces the unique email constraint", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "u_1", name: "A", email: "dup@example.com" });
    await expect(
      db.insert(user).values({ id: "u_2", name: "B", email: "dup@example.com" }),
    ).rejects.toThrow();
  });

  it("cascades session deletion when a user is removed", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "u_1", name: "A", email: "a@example.com" });
    await db.insert(session).values({
      id: "s_1",
      userId: "u_1",
      token: "t",
      expiresAt: new Date(Date.now() + 1000),
    });
    await db.delete(user).where(eq(user.id, "u_1"));
    expect(await db.select().from(session)).toEqual([]);
  });
});

describe("pod_base_images carries an optional version (release-versioning migration 0050)", () => {
  it("defaults version to NULL — every pre-versioning row, which is the common path", async () => {
    const db = await freshDb();
    await db.insert(podBaseImages).values({ digest: "d1", env: "pod-base", status: "current" });
    const [row] = await db.select().from(podBaseImages).where(eq(podBaseImages.digest, "d1"));
    expect(row.version).toBeNull();
  });

  it("stores and reads back a version when a build is cut as a release", async () => {
    const db = await freshDb();
    await db
      .insert(podBaseImages)
      .values({ digest: "d2", env: "pod-base", status: "current", version: "0.1.0" });
    const [row] = await db.select().from(podBaseImages).where(eq(podBaseImages.digest, "d2"));
    expect(row.version).toBe("0.1.0");
  });
});
