import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

// Fleet-updates (A + C): the shared eligibility predicate behind the bulk "update idle pods"
// button — behind + running + not-updating + not-excluded + agent idle + idle for the dwell.

const PIN = "newdigest01"; // the current pinned image; "olddigest" pods are "behind" it
const DWELL = 10 * 60 * 1000;
const longAgo = () => new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min → past the dwell

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-fleetupd-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

describe("updatableIdlePods — bulk idle-update eligibility", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;
  let svc: PodService;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
    svc = new PodService(provider, store, { environmentsRoot: root });
    provider.agentStatusResult = "idle"; // the agent reports idle unless a test overrides it
  });

  /** Launch a pod and force it into a given post-launch state (launchPod starts it
   * "provisioning" with a null digest; we set the fields the predicate reads). */
  async function makePod(
    owner: string,
    over: { imageDigest?: string; status?: string; autoUpdate?: "inherit" | "off"; lastActiveAt?: string } = {},
  ): Promise<string> {
    const p = await svc.launchPod(owner, "plain", { size: "s" });
    await store.update(p.id, {
      status: (over.status ?? "running") as never,
      // Non-null sessionUrl so listPods doesn't reconcile a running+session-less pod against the
      // (never-provisioned) mock provider and flip it to "gone" — launch is fire-and-forget here.
      sessionUrl: "wss://mock/session",
      imageDigest: over.imageDigest ?? "olddigest",
      autoUpdate: over.autoUpdate ?? "inherit",
      lastActiveAt: over.lastActiveAt ?? longAgo(),
    });
    return p.id;
  }

  it("includes a behind, running, idle-past-dwell pod", async () => {
    const id = await makePod("u1");
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([id]);
  });

  it("excludes a pod on the current pin (not behind)", async () => {
    await makePod("u1", { imageDigest: PIN });
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("excludes an auto-update=off pod (the exclude toggle)", async () => {
    await makePod("u1", { autoUpdate: "off" });
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("excludes a pod whose agent is busy", async () => {
    await makePod("u1");
    provider.agentStatusResult = "busy";
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("excludes a pod idle for LESS than the dwell (a pause between turns)", async () => {
    await makePod("u1", { lastActiveAt: new Date().toISOString() });
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("excludes a non-running pod", async () => {
    await makePod("u1", { status: "suspended" });
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("returns nothing when the pin is null (no target build)", async () => {
    await makePod("u1");
    expect(await svc.updatableIdlePods("u1", null, DWELL)).toEqual([]);
  });

  it("never crosses tenants", async () => {
    await makePod("u1");
    expect(await svc.updatableIdlePods("u2", PIN, DWELL)).toEqual([]);
  });

  it("updateIdlePods starts an update on exactly the eligible pods", async () => {
    const eligible = await makePod("u1");
    await makePod("u1", { autoUpdate: "off" }); // excluded
    const image = `pod-base@${PIN}`;
    const { started } = await svc.updateIdlePods("u1", PIN, DWELL, image);
    expect(started).toEqual([eligible]);
  });
});
