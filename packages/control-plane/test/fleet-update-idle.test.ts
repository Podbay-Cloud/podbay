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
    const p = await svc.launchPod(owner, "plain", { size: "s", slotCap: Infinity });
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

  it("INCLUDES a codex-only idle pod (Claude agentStatus null, codex idle) — was wrongly skipped", async () => {
    const id = await makePod("u1");
    provider.agentStatusResult = null; // no Claude session
    provider.codexStatusResult = "idle"; // codex is idle
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([id]);
  });

  it("excludes a pod whose CODEX is busy even if Claude reads idle (don't interrupt codex)", async () => {
    await makePod("u1");
    provider.agentStatusResult = "idle";
    provider.codexStatusResult = "busy";
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("excludes a pod with NO agent signal at all (neither idle) — stays conservative", async () => {
    await makePod("u1");
    provider.agentStatusResult = null;
    provider.codexStatusResult = null;
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

  it("excludes a pod stale on lastActiveAt but recently active per the agent's transcript", async () => {
    // lastActiveAt is 30 min ago (no client proxied it) BUT the agent's last transcript entry (a tool
    // result) was 1 min ago (recent RC/background work) → NOT eligible: effectively just used.
    await makePod("u1", { lastActiveAt: longAgo() });
    provider.lastActivityMsResult = 60_000; // agent active 1 min ago
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([]);
  });

  it("includes a pod whose agent activity is genuinely past the dwell", async () => {
    const id = await makePod("u1", { lastActiveAt: longAgo() });
    provider.lastActivityMsResult = 30 * 60 * 1000; // last transcript entry 30 min ago → past the dwell
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([id]);
  });

  it("falls back to lastActiveAt when the image doesn't report the transcript signal", async () => {
    const id = await makePod("u1", { lastActiveAt: longAgo() }); // 30 min ago, past the dwell
    provider.lastActivityMsResult = null; // older image: no lastActivityMs
    expect(await svc.updatableIdlePods("u1", PIN, DWELL)).toEqual([id]);
  });

  it("caps concurrent recreates (never a thundering herd) and still updates them all", async () => {
    // 5 eligible pods; make the provider aware of each so its updateImage can run (eligibility is
    // read from the store — makePod already set it — so no provisionPending, which would disturb it).
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await makePod("u1"));
    for (const id of ids) {
      provider.pods.set(id, {
        id,
        status: "running",
        region: "fra",
        endpoint: "http://x",
        keepAwake: false,
        machineId: `m-${id}`,
        imageDigest: "olddigest",
      });
    }
    // Gate updateImage so recreates pile up on the barrier where we can count them.
    let release!: () => void;
    provider.updateImageGate = new Promise<void>((r) => (release = r));

    const { started } = await svc.updateIdlePods("u1", PIN, DWELL, `pod-base@${PIN}`, 3);
    expect(started.length).toBe(5); // all eligible are queued immediately

    const waitFor = async (cond: () => boolean): Promise<void> => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
      if (!cond()) throw new Error("condition not met in time");
    };
    // The 3 lanes saturate on the gate; the other 2 wait their turn.
    await waitFor(() => provider.updatesInFlight === 3);
    expect(provider.maxUpdatesInFlight).toBe(3);

    release();
    await waitFor(() => provider.updatedImages.length === 5); // the remaining 2 flow through
    expect(provider.maxUpdatesInFlight).toBe(3); // never exceeded the cap
  });
});
