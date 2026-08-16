import { describe, expect, it, beforeEach } from "vitest";
import { generateCredKey } from "@podbay/shared/crypto";
import { SecretVault, type SecretStore } from "../src/index.js";

/** In-memory secret store for the vault. */
class MemStore implements SecretStore {
  rows = new Map<string, string>(); // `${podId} ${key}` -> blob
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

describe("secret vault", () => {
  let mem: MemStore;
  let vault: SecretVault;

  beforeEach(() => {
    mem = new MemStore();
    vault = new SecretVault(mem, KEY);
  });

  it("encrypts at rest — the store never holds plaintext", async () => {
    await vault.set("pod1", "TELEGRAM_BOT_TOKEN", "123:ABC-secret");
    expect([...mem.rows.values()][0]).not.toContain("123:ABC-secret");
    expect(await vault.retrieveAll("pod1")).toEqual({ TELEGRAM_BOT_TOKEN: "123:ABC-secret" });
  });

  it("listKeys returns which keys are set (never values); clear removes one", async () => {
    await vault.set("pod1", "A_KEY", "1");
    await vault.set("pod1", "B_KEY", "2");
    expect(await vault.listKeys("pod1")).toEqual(["A_KEY", "B_KEY"]);
    await vault.clear("pod1", "A_KEY");
    expect(await vault.listKeys("pod1")).toEqual(["B_KEY"]);
    expect(await vault.retrieveAll("pod1")).toEqual({ B_KEY: "2" });
  });

  it("is scoped per pod", async () => {
    await vault.set("pod1", "K", "one");
    await vault.set("pod2", "K", "two");
    expect(await vault.retrieveAll("pod1")).toEqual({ K: "one" });
    expect(await vault.retrieveAll("pod2")).toEqual({ K: "two" });
  });

  it("updating a key overwrites the value", async () => {
    await vault.set("pod1", "K", "old");
    await vault.set("pod1", "K", "new");
    expect(await vault.retrieveAll("pod1")).toEqual({ K: "new" });
    expect(await vault.listKeys("pod1")).toEqual(["K"]);
  });
});
