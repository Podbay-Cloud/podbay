import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-signals-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

describe("manual dashboard order (setPodOrder)", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  it("hand order wins over the default status/recency sort", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });
    const c = await svc.launchPod("u1", "plain", { size: "s" });

    await svc.setPodOrder("u1", [c.id, a.id, b.id]);

    const ids = (await svc.listPods("u1")).map((p) => p.id);
    expect(ids).toEqual([c.id, a.id, b.id]);
  });

  it("a NEW pod (never hand-placed) floats above the hand-ordered ones", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.setPodOrder("u1", [b.id, a.id]);

    const fresh = await svc.launchPod("u1", "plain", { size: "s" });

    const ids = (await svc.listPods("u1")).map((p) => p.id);
    expect(ids).toEqual([fresh.id, b.id, a.id]);
  });

  it("ignores ids the caller doesn't own — no cross-tenant scramble", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const mine = await svc.launchPod("u1", "plain", { size: "s" });
    const theirs = await svc.launchPod("u2", "plain", { size: "s" });

    await svc.setPodOrder("u1", [theirs.id, mine.id]);

    expect((await store.get(theirs.id))?.position ?? null).toBeNull(); // untouched
    expect((await store.get(mine.id))?.position).toBe(0); // owned ids compact from 0
  });
});

describe("ownerLiveSignals (dashboard card sweep)", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  it("carries lifecycle for EVERY pod, and probes only running ones for activity", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const run = await svc.launchPod("u1", "plain", { size: "s" });
    const asleep = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    await svc.sleep("u1", asleep.id);

    provider.agentStatusResult = "busy";
    provider.appListeningResult = true;
    provider.issuesResult = [
      { id: "disk", severity: "critical", title: "Disk almost full", detail: "9.8/10GB", fixable: false },
    ];

    const rows = await svc.ownerLiveSignals("u1");
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Both pods present, each with its lifecycle status — the card reflects a
    // transition on the next poll, not only on a full reload.
    expect(byId.get(run.id)).toMatchObject({ status: "running", agentStatus: "busy", appListening: true });
    expect(byId.get(run.id)!.criticalIssue).toMatchObject({ title: "Disk almost full" });
    // The suspended pod is present (lifecycle only), NOT probed → no live claims.
    expect(byId.get(asleep.id)).toMatchObject({ status: "suspended", agentStatus: null, appListening: null });
  });

  it("degrades to unknown (never a false claim) when neither healthz nor metrics report it", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.agentStatusResult = null;
    provider.appListeningResult = undefined; // old image: healthz field absent
    // metricsAppListening unset → fetchMetrics returns null too

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row!.agentStatus).toBeNull();
    expect(row!.appListening).toBeNull(); // unknown — not false
  });

  it("carries codexStatus (activity from the rollout mtime) for a running pod", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.codexStatusResult = "busy";

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row!.codexStatus).toBe("busy");
    expect(row!.id).toBe(pod.id);
  });

  it("falls back to METRICS app.listening when healthz doesn't report it (old image)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.appListeningResult = undefined; // healthz: absent (old image)
    provider.metricsAppListening.set(pod.id, false); // but /metrics knows nothing's on :3000

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    // Same source the cockpit preview card uses — so the card gates preview correctly
    // even before the pod updates, and the two never disagree.
    expect(row!.appListening).toBe(false);
  });

  it("a pod that doesn't answer is unreachable, not dropped", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.podHealth = async () => {
      throw new Error("connect refused");
    };

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row).toMatchObject({ id: pod.id, unreachable: true, appListening: null });
  });

  it("is owner-scoped", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    await svc.launchPod("u1", "plain", { size: "s" });
    const theirs = await svc.launchPod("u2", "plain", { size: "s" });
    await svc.provisionPending();

    const rows = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(rows.find((r) => r.id === theirs.id)).toBeUndefined();
  });
});
