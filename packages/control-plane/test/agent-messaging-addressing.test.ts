import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, user } from "@podbay/db";
import { FakeProvider } from "@podbay/provider";
import { PodService } from "../src/service.js";
import { DrizzlePodStore } from "../src/drizzle-store.js";
import { AgentMessages, resolvePodRef, MSG_PAIR_CAP, SYSTEM_SENDER } from "../src/agent-messages.js";
import type { OutboxLine } from "../src/agent-messaging.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "environments");

describe("resolvePodRef (the human→pod ladder)", () => {
  const fleet = [
    { id: "afisha-crawler-6bc4", name: "afisha crawler" },
    { id: "cheerful-donkey-9d41", name: null },
    { id: "web-scraper-1a2b", name: "Scraper" },
  ];

  it("matches an exact slug", () => {
    expect(resolvePodRef(fleet, "cheerful-donkey-9d41")).toEqual({ kind: "ok", id: "cheerful-donkey-9d41" });
  });
  it("matches a display name case- and space-insensitively", () => {
    expect(resolvePodRef(fleet, "Afisha Crawler")).toEqual({ kind: "ok", id: "afisha-crawler-6bc4" });
    expect(resolvePodRef(fleet, "scraper")).toEqual({ kind: "ok", id: "web-scraper-1a2b" });
  });
  it("matches an abbreviated slug by prefix ('cheerful donkey' → the suffixed slug)", () => {
    expect(resolvePodRef(fleet, "cheerful donkey")).toEqual({ kind: "ok", id: "cheerful-donkey-9d41" });
  });
  it("matches a token by substring ('crawler' → afisha-crawler)", () => {
    expect(resolvePodRef(fleet, "crawler")).toEqual({ kind: "ok", id: "afisha-crawler-6bc4" });
  });
  it("REFUSES an ambiguous reference rather than guessing", () => {
    const two = [
      { id: "afisha-crawler-6bc4", name: "afisha crawler" },
      { id: "web-crawler-1a2b", name: "web crawler" },
    ];
    const r = resolvePodRef(two, "crawler");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map((c) => c.id).sort()).toEqual(["afisha-crawler-6bc4", "web-crawler-1a2b"]);
  });
  it("returns none for a reference that matches nothing", () => {
    expect(resolvePodRef(fleet, "nonsense")).toEqual({ kind: "none" });
  });
  it("does not fall through to a looser tier once a tier matches (no wrong-pod risk)", () => {
    // "scraper" is an exact normalized name of web-scraper AND a substring of nothing else,
    // but were there a prefix collision the exact tier must still win. Guard the ordering.
    const f = [{ id: "scraper-x", name: "scraper" }, { id: "scraper-helper-y", name: null }];
    // "scraper" exact-matches the name of the first only → unambiguous despite the prefix pod.
    expect(resolvePodRef(f, "scraper")).toEqual({ kind: "ok", id: "scraper-x" });
  });
});

describe("addressing + rate guard on reconcile", () => {
  let svc: PodService;
  let provider: FakeProvider;
  let msgs: AgentMessages;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(user).values({ id: "u", name: "u", email: "u@example.com" });
    provider = new FakeProvider();
    msgs = new AgentMessages(t.db);
    svc = new PodService(provider, new DrizzlePodStore(t.db), { environmentsRoot: envRoot, agentMessages: msgs });
  });
  afterEach(async () => close());

  function primeOutbox(byPod: Record<string, OutboxLine[]>): void {
    provider.execHandler = (script, _cmd, id) => {
      if (script.includes("msg-outbox.jsonl.draining")) {
        const lines = byPod[id] ?? [];
        byPod[id] = [];
        return lines.map((l) => JSON.stringify(l)).join("\n");
      }
      return "";
    };
  }

  it("pushes the fleet roster down to the pod on reconcile", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    await svc.launchPod("u", "nextjs-starter", { name: "beta" });
    await svc.provisionPending();
    primeOutbox({});
    await svc.reconcile(alpha.id);
    const wrote = provider.execScripts.find((s) => s.includes("fleet.json"));
    expect(wrote).toBeTruthy();
    // base64-encoded roster decodes to JSON containing both pods.
    const b64 = wrote!.match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!;
    const roster = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { name: string | null }[];
    expect(roster.some((p) => p.name === "beta")).toBe(true);
  });

  it("bounces an ambiguous reference back to the sender (nothing delivered)", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter", { name: "web crawler" });
    const gamma = await svc.launchPod("u", "nextjs-starter", { name: "afisha crawler" });
    await svc.provisionPending();
    primeOutbox({ [alpha.id]: [{ id: "m1", to: "crawler", body: "ambiguous" }] });

    await svc.reconcile(alpha.id);

    expect(await msgs.pendingFor("u", beta.id)).toHaveLength(0);
    expect(await msgs.pendingFor("u", gamma.id)).toHaveLength(0);
    const bounces = await msgs.pendingFor("u", alpha.id);
    expect(bounces).toHaveLength(1);
    expect(bounces[0]!.fromPod).toBe(SYSTEM_SENDER);
    expect(bounces[0]!.body).toContain("matches 2");
  });

  it("bounces an unknown reference with the fleet listed", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    await svc.launchPod("u", "nextjs-starter", { name: "beta" });
    await svc.provisionPending();
    primeOutbox({ [alpha.id]: [{ id: "m1", to: "ghost", body: "nowhere" }] });

    await svc.reconcile(alpha.id);

    const bounces = await msgs.pendingFor("u", alpha.id);
    expect(bounces[0]!.body).toContain('no pod in your fleet matches "ghost"');
    expect(bounces[0]!.body).toContain("beta");
  });

  it("throttles a sender→recipient pair over the cap and bounces the overflow", async () => {
    const alpha = await svc.launchPod("u", "nextjs-starter");
    const beta = await svc.launchPod("u", "nextjs-starter", { name: "beta" });
    await svc.provisionPending();
    // Fill the window right up to the cap.
    const now = Date.now();
    for (let i = 0; i < MSG_PAIR_CAP; i++) {
      await msgs.route({ id: `pre${i}`, ownerId: "u", fromPod: alpha.id, toPod: beta.id, body: "x", createdAt: new Date(now - 1000) });
    }
    primeOutbox({ [alpha.id]: [{ id: "over", to: "beta", body: "one too many" }] });

    await svc.reconcile(alpha.id);

    // The overflow message was NOT routed to beta…
    expect((await msgs.pendingFor("u", beta.id)).some((m) => m.id === "over")).toBe(false);
    // …and the sender got a rate-limit bounce.
    const bounce = (await msgs.pendingFor("u", alpha.id)).find((m) => m.fromPod === SYSTEM_SENDER);
    expect(bounce?.body).toContain("Rate limit");
  });
});
