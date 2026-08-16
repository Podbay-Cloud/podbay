import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

/** Write a temp env root with one env declaring the given lifecycle. */
async function envRoot(name: string, lifecycle?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-lifecycle-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n` +
      (lifecycle ? `lifecycle: ${lifecycle}\n` : ""),
  );
  return root;
}

describe("lifecycle model", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;

  beforeEach(() => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
  });

  it("launch carries the env's declared lifecycle; default is auto", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: await envRoot("plain") });
    const rec = await svc.launchPod("u1", "plain");
    expect(rec.lifecycle).toBe("auto");
    expect(rec.keepAwake).toBe(false);
  });

  it("an always-on env launches keepAwake (never idle-slept)", async () => {
    const svc = new PodService(provider, store, {
      environmentsRoot: await envRoot("bot", "always-on"),
    });
    const rec = await svc.launchPod("u1", "bot");
    expect(rec.lifecycle).toBe("always-on");
    expect(rec.keepAwake).toBe(true);
    // stays up past the idle threshold
    await store.update(rec.id, { lastActiveAt: new Date(0).toISOString() });
    expect(await svc.sleepIdlePods(1000)).not.toContain(rec.id);
  });

  it("setLifecycle syncs keepAwake and is owner-scoped", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: await envRoot("plain") });
    const rec = await svc.launchPod("u1", "plain");
    const on = await svc.setLifecycle("u1", rec.id, "always-on");
    expect(on.lifecycle).toBe("always-on");
    expect(on.keepAwake).toBe(true);
    const off = await svc.setLifecycle("u1", rec.id, "auto");
    expect(off.lifecycle).toBe("auto");
    expect(off.keepAwake).toBe(false);
    await expect(svc.setLifecycle("u1", rec.id, "bogus" as never)).rejects.toThrow(/invalid lifecycle/i);
    await expect(svc.setLifecycle("intruder", rec.id, "always-on")).rejects.toThrow();
  });
});
