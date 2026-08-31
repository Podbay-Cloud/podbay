import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

// syncGithubToOwnedPods — the fan-out that makes the durable account connection the single source of
// truth: connect/reconnect installs the token on every owned pod, disconnect clears it from all,
// best-effort per pod (global-github-connection).

/** A provider that RECORDS which pods got a set/clear, and can throw for chosen pods (an unreachable
 * / suspended pod) so we can assert best-effort behavior. */
class RecordingProvider extends MockProvider {
  setCalls: string[] = [];
  clearCalls: string[] = [];
  throwFor = new Set<string>();
  override async setGithubToken(id: string): Promise<{ login: string }> {
    if (this.throwFor.has(id)) throw new Error("pod unreachable");
    this.setCalls.push(id);
    return { login: "octocat" };
  }
  override async clearGithubToken(id: string): Promise<void> {
    if (this.throwFor.has(id)) throw new Error("pod unreachable");
    this.clearCalls.push(id);
  }
}

async function envRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-ghfan-"));
  const dir = path.join(root, "plain");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "podbay.yaml"), "apiVersion: podbay/v0\nname: plain\nbase:\n  image: ubuntu:24.04\n");
  return root;
}

describe("syncGithubToOwnedPods", () => {
  let provider: RecordingProvider;
  let store: InMemoryPodStore;
  let svc: PodService;

  beforeEach(async () => {
    provider = new RecordingProvider();
    store = new InMemoryPodStore();
    svc = new PodService(provider, store, { environmentsRoot: await envRoot() });
  });

  async function makePod(owner: string): Promise<string> {
    const p = await svc.launchPod(owner, "plain", { size: "s", slotCap: Infinity });
    await store.update(p.id, { status: "running" as never, sessionUrl: "wss://mock/session" });
    return p.id;
  }

  it("installs the token on every owned pod (connect/reconnect)", async () => {
    const a = await makePod("u1");
    const b = await makePod("u1");
    const r = await svc.syncGithubToOwnedPods("u1", "tok-123");
    expect(r).toEqual({ synced: 2, total: 2 });
    expect(provider.setCalls.sort()).toEqual([a, b].sort());
    expect(provider.clearCalls).toEqual([]);
  });

  it("clears the token from every owned pod (disconnect, token=null)", async () => {
    const a = await makePod("u1");
    const b = await makePod("u1");
    const r = await svc.syncGithubToOwnedPods("u1", null);
    expect(r).toEqual({ synced: 2, total: 2 });
    expect(provider.clearCalls.sort()).toEqual([a, b].sort());
    expect(provider.setCalls).toEqual([]);
  });

  it("is best-effort: an unreachable pod is skipped, not fatal", async () => {
    const a = await makePod("u1");
    const b = await makePod("u1");
    provider.throwFor.add(b); // b is suspended / unreachable
    const r = await svc.syncGithubToOwnedPods("u1", "tok");
    expect(r).toEqual({ synced: 1, total: 2 }); // reached a, skipped b — no throw
    expect(provider.setCalls).toEqual([a]);
  });

  it("only touches the owner's OWN pods", async () => {
    const mine = await makePod("u1");
    await makePod("u2"); // someone else's pod
    const r = await svc.syncGithubToOwnedPods("u1", "tok");
    expect(r).toEqual({ synced: 1, total: 1 });
    expect(provider.setCalls).toEqual([mine]);
  });
});
