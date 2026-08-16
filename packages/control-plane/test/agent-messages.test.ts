import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, user } from "@podbay/db";
import { AgentMessages, InvalidMessage, MSG_MAX_BODY } from "../src/agent-messages.js";

let msgs: AgentMessages;
let close: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  await t.db.insert(user).values({ id: "u", name: "u", email: "u@example.com" });
  msgs = new AgentMessages(t.db);
  close = t.close;
});
afterEach(async () => close());

const base = { id: "m1", ownerId: "u", fromPod: "alpha", toPod: "beta", body: "hi" };

describe("AgentMessages store", () => {
  it("routes a message and lists it as pending for the recipient", async () => {
    expect(await msgs.route(base)).toBe(true);
    const pending = await msgs.pendingFor("u", "beta");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "m1", fromPod: "alpha", body: "hi" });
  });

  it("is idempotent on the message id — a re-drained outbox routes once", async () => {
    expect(await msgs.route(base)).toBe(true);
    expect(await msgs.route({ ...base, body: "changed on re-drain" })).toBe(false);
    const pending = await msgs.pendingFor("u", "beta");
    expect(pending).toHaveLength(1);
    // The FIRST body wins; a re-drain cannot overwrite an already-routed message.
    expect(pending[0]!.body).toBe("hi");
  });

  it("scopes pending strictly by owner — no cross-tenant leak", async () => {
    await msgs.route(base);
    // Same recipient slug, different owner: must not see u's message.
    expect(await msgs.pendingFor("other-owner", "beta")).toHaveLength(0);
  });

  it("delivered messages drop out of the pending scan and never re-appear", async () => {
    await msgs.route(base);
    await msgs.markDelivered("m1");
    expect(await msgs.pendingFor("u", "beta")).toHaveLength(0);
    // markDelivered is idempotent — a second call is a no-op, not an error.
    await msgs.markDelivered("m1");
    expect(await msgs.pendingFor("u", "beta")).toHaveLength(0);
  });

  it("orders pending oldest-first (best-effort by created_at)", async () => {
    await msgs.route({ ...base, id: "old", body: "first", createdAt: new Date(1000) });
    await msgs.route({ ...base, id: "new", body: "second", createdAt: new Date(9000) });
    const pending = await msgs.pendingFor("u", "beta");
    expect(pending.map((m) => m.id)).toEqual(["old", "new"]);
  });

  it("counts recent traffic per sender→recipient pair for the rate guard", async () => {
    const now = Date.now();
    await msgs.route({ ...base, id: "a", createdAt: new Date(now - 1000) });
    await msgs.route({ ...base, id: "b", createdAt: new Date(now - 500) });
    // A message on a DIFFERENT pair must not count toward alpha→beta.
    await msgs.route({ ...base, id: "c", fromPod: "alpha", toPod: "gamma", createdAt: new Date(now) });
    expect(await msgs.pairCountSince("u", "alpha", "beta", new Date(now - 5000))).toBe(2);
    expect(await msgs.pairCountSince("u", "alpha", "beta", new Date(now - 600))).toBe(1);
  });

  it("rejects malformed messages at the boundary (values arrive from a pod)", async () => {
    await expect(msgs.route({ ...base, id: "bad id with spaces" })).rejects.toBeInstanceOf(InvalidMessage);
    await expect(msgs.route({ ...base, body: "" })).rejects.toBeInstanceOf(InvalidMessage);
    await expect(msgs.route({ ...base, body: "x".repeat(MSG_MAX_BODY + 1) })).rejects.toBeInstanceOf(
      InvalidMessage,
    );
    await expect(msgs.route({ ...base, toPod: "" })).rejects.toBeInstanceOf(InvalidMessage);
  });
});
