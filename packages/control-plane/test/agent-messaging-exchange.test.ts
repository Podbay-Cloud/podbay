import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, user } from "@podbay/db";
import { FakeProvider } from "@podbay/provider";
import { PodService } from "../src/service.js";
import { DrizzlePodStore } from "../src/drizzle-store.js";
import { AgentMessages } from "../src/agent-messages.js";
import { drainOutbox, confirmDrain, MSG_OUTBOX, MSG_INBOX, type OutboxLine } from "../src/agent-messaging.js";
import type { SandboxProvider } from "@podbay/provider";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "environments");

let svc: PodService;
let provider: FakeProvider;
let msgs: AgentMessages;
let close: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  await t.db.insert(user).values({ id: "u", name: "u", email: "u@example.com" });
  await t.db.insert(user).values({ id: "v", name: "v", email: "v@example.com" });
  provider = new FakeProvider();
  msgs = new AgentMessages(t.db);
  svc = new PodService(provider, new DrizzlePodStore(t.db), { environmentsRoot: envRoot, agentMessages: msgs });
});
afterEach(async () => close());

/** Queue outbox lines on the pod and make the provider's exec drain them the way the
 * real mv+cat+rm script does — return the batch once, then the "file" is empty. */
function primeOutbox(lines: OutboxLine[]): void {
  let outbox = lines.slice();
  provider.execHandler = (script) => {
    if (script.includes("msg-outbox.jsonl.draining")) {
      const out = outbox.map((l) => JSON.stringify(l)).join("\n");
      outbox = []; // mv + rm cleared it
      return out;
    }
    return "";
  };
}

describe("agent-messaging drain + routing", () => {
  it("routes a message to a same-owner recipient and clears the outbox", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    primeOutbox([{ id: "m1", to: beta.id, body: "regenerate the sitemap" }]);

    await svc.reconcile(alpha.id);

    const pending = await msgs.pendingFor("u", beta.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "m1", fromPod: alpha.id, body: "regenerate the sitemap" });

    // Outbox cleared: a second poll finds nothing new, does not double-route.
    await svc.reconcile(alpha.id);
    expect(await msgs.pendingFor("u", beta.id)).toHaveLength(1);
  });

  it("bounces an over-long message (doesn't wedge the batch) and still routes the rest", async () => {
    // The bug this pins (2026-08-25): a >4000-char body throws `InvalidMessage` at route time, which
    // the drain treated as TRANSIENT → never confirmed → re-failed every poll → the poisoned batch
    // blocked ALL of the pod's subsequent sends (makore→first10 never landed). It must BOUNCE instead.
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    primeOutbox([
      { id: "big", to: beta.id, body: "x".repeat(4001) }, // over MSG_MAX_BODY
      { id: "ok", to: beta.id, body: "this one is fine" },
    ]);

    await svc.reconcile(alpha.id);

    // The good message routed; the over-long one did NOT reach the recipient.
    const toBeta = (await msgs.pendingFor("u", beta.id)).map((m) => m.id);
    expect(toBeta).toContain("ok");
    expect(toBeta).not.toContain("big");
    // The SENDER got a bounce explaining the length limit — not a silent loss, not a wedged queue.
    const toAlpha = await msgs.pendingFor("u", alpha.id);
    expect(toAlpha.some((m) => m.fromPod === "podbay" && /limit|characters|too long/i.test(m.body))).toBe(true);
  });

  it("attributes the sender from the drained pod, ignoring any forged `from` in the line", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    // The line claims to be from beta; the drain must attribute it to alpha (the pod drained).
    primeOutbox([{ id: "m1", to: beta.id, body: "x", ...({ from: beta.id } as object) }]);

    await svc.reconcile(alpha.id);

    expect((await msgs.pendingFor("u", beta.id))[0]!.fromPod).toBe(alpha.id);
  });

  it("resolves a recipient by display NAME within the owner's fleet", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter", { name: "makore" });
    await svc.provisionPending();
    primeOutbox([{ id: "m1", to: "makore", body: "hi by name" }]);

    await svc.reconcile(alpha.id);

    expect(await msgs.pendingFor("u", beta.id)).toHaveLength(1);
  });

  it("REFUSES a cross-owner recipient — nothing routed, existence not leaked", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const foreign = await svc.launchPod("v", "nextjs-starter"); // different owner
    await svc.provisionPending();
    primeOutbox([{ id: "m1", to: foreign.id, body: "cross-owner attempt" }]);

    await svc.reconcile(alpha.id);

    // Not delivered to the foreign pod (checked as ITS owner), and no row minted for u.
    expect(await msgs.pendingFor("v", foreign.id)).toHaveLength(0);
    expect(await msgs.pendingFor("u", foreign.id)).toHaveLength(0);
  });

  it("drops a message to a non-existent pod without discarding the rest of the drain", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    primeOutbox([
      { id: "bad", to: "no-such-pod", body: "dropped" },
      { id: "good", to: beta.id, body: "kept" },
    ]);

    await svc.reconcile(alpha.id);

    const pending = await msgs.pendingFor("u", beta.id);
    expect(pending.map((m) => m.id)).toEqual(["good"]);
  });

  it("works without agent messaging configured — degraded, never broken", async () => {
    const t2 = await createTestDb();
    await t2.db.insert(user).values({ id: "u2", name: "u2", email: "u2@example.com" });
    const bare = new PodService(new FakeProvider(), new DrizzlePodStore(t2.db), { environmentsRoot: envRoot });
    const rec = await bare.launchPod("u2", "nextjs-starter");
    await bare.provisionPending();
    await expect(bare.reconcile(rec.id)).resolves.toBeTruthy();
    await t2.close();
  });
});

describe("drainOutbox (the exec drain)", () => {
  function providerWith(handler: (script: string) => string): SandboxProvider {
    return { async exec(_id: string, cmd: string[]) {
      return { stdout: handler(cmd[cmd.length - 1] ?? ""), stderr: "", exitCode: 0 };
    } } as unknown as SandboxProvider;
  }

  it("parses valid JSONL lines and skips a malformed one", async () => {
    const p = providerWith(() =>
      [JSON.stringify({ id: "a", to: "beta", body: "ok" }), "{not json", JSON.stringify({ id: "b", to: "beta", body: "two" })].join("\n"),
    );
    const lines = await drainOutbox(p, "pod");
    expect(lines.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("skips a line missing required fields", async () => {
    const p = providerWith(() => JSON.stringify({ id: "a", body: "no recipient" }));
    expect(await drainOutbox(p, "pod")).toEqual([]);
  });

  it("returns [] on an empty outbox and never throws when exec fails", async () => {
    expect(await drainOutbox(providerWith(() => ""), "pod")).toEqual([]);
    const boom = { async exec() { throw new Error("unreachable"); } } as unknown as SandboxProvider;
    await expect(drainOutbox(boom, "pod")).resolves.toEqual([]);
  });

  it("snapshots atomically (mv) and emits WITHOUT deleting — the batch waits for an ack", async () => {
    let seen = "";
    const p = providerWith((s) => { seen = s; return ""; });
    await drainOutbox(p, "pod");
    // Moved aside then emitted (cat), but NEVER removed here — a crash before the DB insert must
    // leave the batch behind so it re-emits, not vanish (the first10 drop-loss, 2026-08-11).
    expect(seen).toContain("mv ");
    expect(seen).toContain("cat ");
    expect(seen).not.toContain("rm "); // no deletion in the drain pass
  });

  it("confirmDrain removes the .draining batch — the ack after a durable insert", async () => {
    let seen = "";
    const p = providerWith((s) => { seen = s; return ""; });
    await confirmDrain(p, "pod");
    expect(seen).toContain("rm -f");
    expect(seen).toContain("msg-outbox.jsonl.draining");
  });

  it("keeps both files on the PERSISTENT home volume", () => {
    // A queued message under /tmp would vanish on exactly the restart it must survive.
    expect(MSG_OUTBOX.startsWith("/home/dev/")).toBe(true);
    expect(MSG_INBOX.startsWith("/home/dev/")).toBe(true);
  });
});
