import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";
import { ControlError } from "../src/types.js";

// Live config-refresh (docs/plans/live-config-refresh.md): refreshPodConfig delivers the current
// env layer to a RUNNING pod via provider.refreshConfig (no recreate) and records a config_refreshed
// event — the software-orchestration contract. The in-pod re-apply is verified on a real pod.

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-cfgrefresh-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

describe("refreshPodConfig — live config refresh", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let svc: PodService;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    svc = new PodService(provider, store, { environmentsRoot: await envRoot("plain") });
  });

  async function runningPod(owner = "u1"): Promise<string> {
    const p = await svc.launchPod(owner, "plain", { size: "s" });
    await store.update(p.id, { status: "running" as never, sessionUrl: "wss://mock/session" });
    return p.id;
  }

  it("delivers via provider.refreshConfig and emits config_refreshed", async () => {
    const id = await runningPod();
    const result = await svc.refreshPodConfig("u1", id);

    expect(result.refreshed).toBe(true);
    expect(provider.refreshConfigCalls).toHaveLength(1);
    expect(provider.refreshConfigCalls[0].id).toBe(id);

    const events = await store.listEvents(id);
    const ev = events.find((e) => e.type === "config_refreshed");
    expect(ev).toBeTruthy();
    expect(ev?.meta?.refreshed).toBe(true);
  });

  it("surfaces an older-image note (refreshed:false) without throwing", async () => {
    const id = await runningPod();
    provider.refreshConfigResult = { refreshed: false, note: "refresh script not present" };
    const result = await svc.refreshPodConfig("u1", id);
    expect(result.refreshed).toBe(false);
    expect(result.note).toMatch(/not present/);
    const ev = (await store.listEvents(id)).find((e) => e.type === "config_refreshed");
    expect(ev?.meta?.note).toMatch(/not present/);
  });

  it("refuses on a non-running pod", async () => {
    const p = await svc.launchPod("u1", "plain", { size: "s" });
    await store.update(p.id, { status: "suspended" as never });
    await expect(svc.refreshPodConfig("u1", p.id)).rejects.toBeInstanceOf(ControlError);
    expect(provider.refreshConfigCalls).toHaveLength(0);
  });

  it("never crosses tenants", async () => {
    const id = await runningPod("u1");
    await expect(svc.refreshPodConfig("u2", id)).rejects.toBeTruthy();
    expect(provider.refreshConfigCalls).toHaveLength(0);
  });
});
