import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

async function envRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-maint-"));
  await fs.mkdir(path.join(root, "e"), { recursive: true });
  await fs.writeFile(
    path.join(root, "e", "podbay.yaml"),
    "apiVersion: podbay/v0\nname: e\nbase:\n  image: ubuntu:24.04\n",
  );
  return root;
}

const DAY = 24 * 60 * 60 * 1000;

describe("maintenance wake", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let svc: PodService;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    svc = new PodService(provider, store, { environmentsRoot: await envRoot() });
  });

  /** Launch a pod and force it to a sleeping state last active `ageDays` ago. */
  async function sleepingPod(ageDays: number): Promise<string> {
    const rec = await svc.launchPod("u1", "e");
    await svc.provisionPending(); // run the provisioner worker once (builds the just-enqueued pod)
    await store.update(rec.id, {
      status: "suspended",
      lastActiveAt: new Date(Date.now() - ageDays * DAY).toISOString(),
    });
    return rec.id;
  }

  it("wakes a pod dormant beyond the threshold; leaves fresher ones asleep", async () => {
    const old = await sleepingPod(10);
    const fresh = await sleepingPod(1);
    const woken = await svc.maintenanceWakePods(7 * DAY);
    expect(woken).toEqual([old]);
    expect((await store.get(old))!.status).toBe("waking");
    expect((await store.get(fresh))!.status).toBe("suspended");
  });

  it("resets lastActiveAt so a pod isn't re-woken until it's dormant again", async () => {
    const id = await sleepingPod(10);
    await svc.maintenanceWakePods(7 * DAY);
    // Immediately sleeping again but freshly-touched ⇒ not dormant.
    await store.update(id, { status: "suspended" });
    expect(await svc.maintenanceWakePods(7 * DAY)).toEqual([]);
  });

  it("forces a token refresh (tiny CLI call) on each woken pod", async () => {
    await sleepingPod(10);
    await svc.maintenanceWakePods(7 * DAY);
    // A `claude -p` was execd to trigger the on-demand refresh.
    const refreshed = provider.execCalls.some((c) => c.join(" ").includes("claude -p"));
    expect(refreshed).toBe(true);
  });

  it("caps the number woken per sweep", async () => {
    for (let i = 0; i < 4; i++) await sleepingPod(10);
    expect((await svc.maintenanceWakePods(7 * DAY, 2)).length).toBe(2);
  });

  it("skips always-on (keepAwake) pods and is disabled when dormantMs<=0", async () => {
    const id = await sleepingPod(10);
    await store.update(id, { keepAwake: true });
    expect(await svc.maintenanceWakePods(7 * DAY)).toEqual([]); // keepAwake skipped
    await store.update(id, { keepAwake: false });
    expect(await svc.maintenanceWakePods(0)).toEqual([]); // disabled
  });
});
