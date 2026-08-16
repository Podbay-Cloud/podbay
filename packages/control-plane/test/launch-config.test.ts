import { describe, expect, it, beforeEach } from "vitest";
import { generateCredKey } from "@podbay/shared/crypto";
import { SecretVault, PodService, type SecretStore } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

/** In-memory secret store (mirrors secret-vault.test's MemStore). */
class MemSecretStore implements SecretStore {
  rows = new Map<string, string>();
  private k(p: string, key: string) {
    return `${p} ${key}`;
  }
  async get(p: string, key: string) {
    const blob = this.rows.get(this.k(p, key));
    return blob ? { blob } : null;
  }
  async upsert(p: string, key: string, blob: string) {
    this.rows.set(this.k(p, key), blob);
  }
  async delete(p: string, key: string) {
    this.rows.delete(this.k(p, key));
  }
  async listKeys(p: string) {
    return [...this.rows.keys()].filter((k) => k.startsWith(`${p} `)).map((k) => k.split(" ")[1]).sort();
  }
  async all(p: string) {
    return [...this.rows.entries()]
      .filter(([k]) => k.startsWith(`${p} `))
      .map(([k, blob]) => ({ key: k.split(" ")[1], blob }));
  }
}

const KEY = Buffer.from(generateCredKey(), "base64");
const ENV_ROOT = new URL("../../../environments", import.meta.url).pathname;
// doc-qa declares a REQUIRED secret ANTHROPIC_API_KEY; nextjs-starter declares none.

describe("launch config", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let mem: MemSecretStore;
  let svc: PodService;

  beforeEach(() => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    mem = new MemSecretStore();
    svc = new PodService(provider, store, {
      environmentsRoot: ENV_ROOT,
      secretVault: new SecretVault(mem, KEY),
    });
  });

  it("applies name and injects+persists the env's required secret at launch", async () => {
    const rec = await svc.launchPod("u1", "doc-qa", {
      name: "  Chef Salt  ",
      secrets: { ANTHROPIC_API_KEY: "sk-test-123" },
    });
    expect(rec.name).toBe("Chef Salt"); // trimmed
    await svc.provisionPending(); // run the provisioner worker once (builds the just-enqueued pod)
    // Injected into the boot (createPod) so the app has it from the first process:
    expect(provider.lastSecrets).toEqual({ ANTHROPIC_API_KEY: "sk-test-123" });
    // And persisted (encrypted) under the pod id for wake re-injection:
    expect(await mem.listKeys(rec.id)).toEqual(["ANTHROPIC_API_KEY"]);
    expect([...mem.rows.values()][0]).not.toContain("sk-test-123"); // ciphertext at rest
  });

  it("allows launching with a required secret unset (run now, add later) — UI guards this", async () => {
    const rec = await svc.launchPod("u1", "doc-qa", { name: "x" });
    expect(rec.name).toBe("x");
    expect(provider.lastSecrets).toBeUndefined(); // nothing injected, pod still launches
  });

  it("drops a blank value rather than injecting an empty secret", async () => {
    const rec = await svc.launchPod("u1", "doc-qa", { secrets: { ANTHROPIC_API_KEY: "   " } });
    expect(provider.lastSecrets).toBeUndefined();
    expect(await mem.listKeys(rec.id)).toEqual([]);
  });

  it("rejects an undeclared secret key (typo / injection guard), before provisioning", async () => {
    await expect(
      svc.launchPod("u1", "doc-qa", { secrets: { ANTHROPIC_API_KEY: "k", EVIL: "x" } }),
    ).rejects.toThrow(/unknown secret/i);
    expect(await store.list()).toEqual([]); // no pod created
  });

  it("no-config launch still works (name defaults to slug, no secrets)", async () => {
    const rec = await svc.launchPod("u1", "nextjs-starter");
    expect(rec.name).toBeNull();
    expect(provider.lastSecrets).toBeUndefined();
  });
});
