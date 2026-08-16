import { describe, expect, it, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateCredKey } from "@podbay/shared/crypto";
import { PodService, SecretVault, type SecretStore } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

/** In-memory secret store (mirrors the vault unit test). */
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

/** A tmp environments root with one env that declares a secret. */
async function envRootDeclaring(secretsYaml: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-secret-env-"));
  const dir = path.join(root, "bot-env");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: bot-env\nbase:\n  image: ubuntu:24.04\n${secretsYaml}`,
  );
  return root;
}

describe("PodService app secrets", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let vault: SecretVault;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    vault = new SecretVault(new MemSecretStore(), KEY);
    root = await envRootDeclaring(
      "secrets:\n  - key: TELEGRAM_BOT_TOKEN\n    description: BotFather token\n    required: true\n",
    );
  });

  function svc() {
    return new PodService(provider, store, { environmentsRoot: root, secretVault: vault });
  }

  it("lists an env's declared secrets as not-set until a value is stored", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    expect(await s.listSecrets("u1", rec.id)).toEqual([
      {
        key: "TELEGRAM_BOT_TOKEN",
        description: "BotFather token",
        required: true,
        set: false,
        url: null,
        declared: true,
      },
    ]);
  });

  it("setting a secret encrypts it and (running pod) pushes it live", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.provisionPending(); // run the provisioner worker once (builds the just-enqueued pod)
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "123:ABC");
    // stored encrypted — the raw store never holds plaintext
    expect([...(vault as unknown as { store: MemSecretStore }).store.rows.values()][0]).not.toContain("123:ABC");
    // pushed to the running pod as an env var
    expect(provider.injectedSecrets).toEqual({ TELEGRAM_BOT_TOKEN: "123:ABC" });
    const listed = await s.listSecrets("u1", rec.id);
    expect(listed[0]).toMatchObject({ key: "TELEGRAM_BOT_TOKEN", set: true });
  });

  it("never returns the stored value to the caller (only set/not-set)", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "super-secret");
    const listed = await s.listSecrets("u1", rec.id);
    expect(JSON.stringify(listed)).not.toContain("super-secret");
  });

  it("api-key launch persists agentAuth + stores the BYO key as a hidden reserved secret", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env", { agentAuth: "api-key", agentApiKey: "sk-ant-byo-123" });
    expect(rec.agentAuth).toBe("api-key");
    // Stored encrypted under the reserved name (claude → ANTHROPIC), never plaintext.
    const rows = (vault as unknown as { store: MemSecretStore }).store.rows;
    const entry = [...rows.entries()].find(([k]) => k.includes("PODBAY_AGENT_ANTHROPIC_KEY"));
    expect(entry).toBeTruthy();
    expect(entry![1]).not.toContain("sk-ant-byo-123");
    // Hidden from the owner's secret list (reserved plumbing, not a user secret).
    const listed = await s.listSecrets("u1", rec.id);
    expect(listed.some((x) => x.key === "PODBAY_AGENT_ANTHROPIC_KEY")).toBe(false);
  });

  it("reveals a single decrypted value for the owner and records an audit event", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "super-secret");
    expect(await s.revealSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN")).toBe("super-secret");
    const events = await s.podEvents("u1", rec.id);
    expect(events.some((e) => e.type === "secret_revealed" && (e.meta as { key?: string })?.key === "TELEGRAM_BOT_TOKEN")).toBe(true);
  });

  it("reveal is owner-scoped and 404s an unset key", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "v");
    await expect(s.revealSecret("u2", rec.id, "TELEGRAM_BOT_TOKEN")).rejects.toThrow(/not found/);
    await expect(s.revealSecret("u1", rec.id, "NOT_SET_KEY")).rejects.toThrow(/not set/);
  });

  it("re-injects on wake for a pod whose secret was set while asleep", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.provisionPending();
    await s.sleep("u1", rec.id);
    provider.injectedSecrets = undefined;
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "asleep-set");
    expect(provider.injectedSecrets).toBeUndefined(); // not pushed while sleeping
    await s.wake("u1", rec.id); // → status "waking"
    await s.reconcile(rec.id); // agent reachable → "running" + inject
    expect(provider.injectedSecrets).toEqual({ TELEGRAM_BOT_TOKEN: "asleep-set" });
  });

  it("clearing a secret removes it and re-pushes the remaining set", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await s.provisionPending();
    await s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "v");
    await s.clearSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN");
    expect(provider.injectedSecrets).toEqual({}); // pushed empty set
    expect((await s.listSecrets("u1", rec.id))[0].set).toBe(false);
  });

  it("is owner-scoped: a non-owner cannot set, list, or clear", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await expect(s.setSecret("u2", rec.id, "TELEGRAM_BOT_TOKEN", "x")).rejects.toThrow(/not found/);
    await expect(s.listSecrets("u2", rec.id)).rejects.toThrow(/not found/);
    await expect(s.clearSecret("u2", rec.id, "TELEGRAM_BOT_TOKEN")).rejects.toThrow(/not found/);
  });

  it("rejects a non-UPPER_SNAKE secret key", async () => {
    const s = svc();
    const rec = await s.launchPod("u1", "bot-env");
    await expect(s.setSecret("u1", rec.id, "bot-token", "x")).rejects.toThrow(/invalid secret key/);
  });

  it("without a secret vault, set is refused and list shows declared-not-set", async () => {
    const s = new PodService(provider, store, { environmentsRoot: root });
    const rec = await s.launchPod("u1", "bot-env");
    await expect(s.setSecret("u1", rec.id, "TELEGRAM_BOT_TOKEN", "x")).rejects.toThrow(/not configured/);
    expect((await s.listSecrets("u1", rec.id))[0]).toMatchObject({ key: "TELEGRAM_BOT_TOKEN", set: false });
  });
});
