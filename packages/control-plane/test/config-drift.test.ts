import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PodService } from "../src/service.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

// Auto-sync config on drift (replaces the manual "Sync config" button): the reconcile sweep compares
// a running pod's stored config_hash against the env's current resolved layer and re-delivers in place
// when they differ. Semantics under test: null → baseline silently; stale → deliver + record + emit;
// equal → nothing. See PodService.reconcileConfigDrift.

const environmentsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
);
const ENV = "nextjs-starter";

describe("reconcile — auto-sync config on drift", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let svc: PodService;

  beforeEach(() => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    svc = new PodService(provider, store, { environmentsRoot });
  });

  /** A pod the PROVIDER knows about and reports running (so reconcile runs its running-block). */
  async function runningPod(owner = "u1"): Promise<string> {
    const rec = await svc.launchPod(owner, ENV);
    await svc.provisionPending(); // worker builds it on the provider → provider reports running
    await store.update(rec.id, { sessionUrl: "wss://mock/session" }); // onboarded (avoids the extra reconcile churn)
    return rec.id;
  }

  it("BASELINES a fresh pod (config_hash null) WITHOUT delivering", async () => {
    const id = await runningPod();
    expect((await store.get(id))!.configHash).toBeNull();

    await svc.reconcile(id);

    // No delivery, no event — the pod already booted with this layer.
    expect(provider.refreshConfigCalls).toHaveLength(0);
    const refreshedEvents = (await store.listEvents(id)).filter((e) => e.type === "config_refreshed");
    expect(refreshedEvents).toHaveLength(0);
    // But the hash is now recorded, so future drift can be detected.
    expect((await store.get(id))!.configHash).toBeTruthy();
  });

  it("DELIVERS + records + emits when the stored hash is stale (real drift)", async () => {
    const id = await runningPod();
    await svc.reconcile(id); // baseline
    const baseline = (await store.get(id))!.configHash!;
    expect(baseline).toBeTruthy();

    // Simulate the env layer having changed since last delivery: the stored hash no longer matches.
    await store.update(id, { configHash: "stale-deadbeef" });
    await svc.reconcile(id);

    expect(provider.refreshConfigCalls).toHaveLength(1);
    expect(provider.refreshConfigCalls[0].id).toBe(id);
    const ev = (await store.listEvents(id)).find((e) => e.type === "config_refreshed");
    expect(ev?.meta?.auto).toBe(true);
    // The hash converges back to the real current layer (== the baseline we captured).
    expect((await store.get(id))!.configHash).toBe(baseline);
  });

  it("does NOTHING when the pod is already in sync", async () => {
    const id = await runningPod();
    await svc.reconcile(id); // baseline → in sync
    await svc.reconcile(id);
    await svc.reconcile(id);
    expect(provider.refreshConfigCalls).toHaveLength(0);
  });

  it("does not auto-sync a NON-running pod", async () => {
    const rec = await svc.launchPod("u1", ENV);
    await svc.provisionPending();
    await store.update(rec.id, { configHash: "stale-deadbeef" });
    // reconcile trusts the PROVIDER's status — put the pod to sleep there so it reports suspended.
    await provider.sleep(rec.id);
    await svc.reconcile(rec.id);
    expect(provider.refreshConfigCalls).toHaveLength(0);
  });
});
