import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

/** Temp env root; `lifecycleYaml` is the raw value for the `lifecycle:` key. */
async function envRoot(name: string, lifecycleYaml: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-launchlc-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\nlifecycle: ${lifecycleYaml}\n`,
  );
  return root;
}

describe("launch lifecycle (default + lock)", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  const svc = (root: string) => new PodService(provider, store, { environmentsRoot: root });

  beforeEach(() => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
  });

  it("unlocked env: user can choose a lifecycle at launch", async () => {
    const s = svc(await envRoot("plain", "auto"));
    const rec = await s.launchPod("u1", "plain", { lifecycle: "always-on" });
    expect(rec.lifecycle).toBe("always-on");
    expect(rec.keepAwake).toBe(true);
  });

  it("unlocked env: no choice falls back to the env default", async () => {
    const s = svc(await envRoot("plain", "auto"));
    expect((await s.launchPod("u1", "plain")).lifecycle).toBe("auto");
  });

  it("locked env: forces its policy and rejects a different launch choice", async () => {
    const s = svc(await envRoot("bot", "\n  default: always-on\n  locked: true"));
    // No choice ⇒ the locked default.
    expect((await s.launchPod("u1", "bot")).lifecycle).toBe("always-on");
    // A conflicting choice is rejected before provisioning.
    await expect(s.launchPod("u1", "bot", { lifecycle: "auto" })).rejects.toThrow(/requires/i);
  });

  it("setLifecycle is blocked on a locked env, allowed on an unlocked one", async () => {
    const locked = svc(await envRoot("bot", "\n  default: always-on\n  locked: true"));
    const b = await locked.launchPod("u1", "bot");
    await expect(locked.setLifecycle("u1", b.id, "auto")).rejects.toThrow(/locked/i);

    const open = svc(await envRoot("plain", "auto"));
    const p = await open.launchPod("u1", "plain");
    expect((await open.setLifecycle("u1", p.id, "always-on")).lifecycle).toBe("always-on");
  });
});
