import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService, envMissingMessage } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

/**
 * Provisioning-failure handling — the graceful path behind the 2026-07-24
 * incident: an env renamed out from under a live pod (ai-chat → doc-qa) sent a
 * retry through the retry budget on ENOENT, and the give-up cleanup destroyed a
 * real, booted pod + its volume. Two guarantees are locked here:
 *   1. A MISSING environment fails fast + clearly, never retried, never destroyed.
 *   2. A pod that already had a machine is NEVER destroyed on provisioning failure.
 */

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-provfail-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\nlifecycle: auto\n`,
  );
  return root;
}

describe("provisioning failure handling", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;

  beforeEach(() => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
  });

  it("a renamed/removed env fails fast+clearly — no retry, no destroy", async () => {
    const root = await envRoot("ai-chat");
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "ai-chat"); // env exists at launch
    await svc.provisionPending(); // builds the machine
    expect((await store.get(pod.id))!.status).toBe("running");
    expect(provider.machinesBuilt.length).toBe(1);

    // The env is renamed away (the real incident); the pod errored on the failed
    // update and the user hits Try again.
    await fs.rm(path.join(root, "ai-chat"), { recursive: true, force: true });
    await store.update(pod.id, { status: "error" });
    await svc.retryProvision("u1", pod.id);
    await svc.provisionPending();

    const rec = (await store.get(pod.id))!;
    expect(rec.status).toBe("error");
    expect(rec.provisionError).toBe(envMissingMessage("ai-chat"));
    // Fast-fail (one claim), NOT a loop through the whole retry budget, and the
    // machine is intact.
    expect(rec.provisionAttempts).toBeLessThan(3);
    expect(provider.created).toHaveLength(1); // never even attempted a rebuild
    expect(provider.destroyed).not.toContain(pod.id);
  });

  it("re-provision that keeps failing NEVER destroys a pre-existing machine", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: await envRoot("plain") });
    const pod = await svc.launchPod("u1", "plain");
    await svc.provisionPending(); // machine built, running
    const machineId = (await store.get(pod.id))!.machineId;
    expect(machineId).toBeTruthy();

    // The pod errored (e.g. a failed update) but keeps its machine + volume.
    await store.update(pod.id, { status: "error" });
    // Now every re-provision fails (a transient-looking error, NOT env-missing).
    provider.failCreate = "boom: box unreachable";
    await svc.retryProvision("u1", pod.id);
    // Exhaust the retry budget (maxAttempts default 3); advance the clock each pass
    // so the backoff lease has expired and the pod is re-claimable.
    let t = 1_000_000;
    for (let i = 0; i < 6; i++) {
      await svc.provisionPending(t, { backoffMs: 1000 });
      t += 200_000;
    }

    const rec = (await store.get(pod.id))!;
    expect(rec.status).toBe("error"); // gave up
    expect(provider.destroyed).not.toContain(pod.id); // but the live machine survives
    expect(rec.machineId).toBe(machineId); // still linked
  });

  it("a FRESH pod that fails to build IS cleaned up (no orphan machine leak)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: await envRoot("plain") });
    provider.failCreate = "boom during first build";
    const pod = await svc.launchPod("u1", "plain"); // provisioning row, no machine yet
    let t = 1_000_000;
    for (let i = 0; i < 6; i++) {
      await svc.provisionPending(t, { backoffMs: 1000 });
      t += 200_000;
    }
    const rec = (await store.get(pod.id))!;
    expect(rec.status).toBe("error");
    // No prior machine → the give-up cleanup runs, so a half-built machine can't leak.
    expect(provider.destroyed).toContain(pod.id);
  });
});
