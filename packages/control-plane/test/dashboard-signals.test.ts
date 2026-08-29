import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-signals-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

describe("manual dashboard order (setPodOrder)", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  it("hand order wins over the default status/recency sort", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });
    const c = await svc.launchPod("u1", "plain", { size: "s" });

    await svc.setPodOrder("u1", [c.id, a.id, b.id]);

    const ids = (await svc.listPods("u1")).map((p) => p.id);
    expect(ids).toEqual([c.id, a.id, b.id]);
  });

  it("a NEW pod (never hand-placed) floats above the hand-ordered ones", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.setPodOrder("u1", [b.id, a.id]);

    const fresh = await svc.launchPod("u1", "plain", { size: "s" });

    const ids = (await svc.listPods("u1")).map((p) => p.id);
    expect(ids).toEqual([fresh.id, b.id, a.id]);
  });

  it("ignores ids the caller doesn't own — no cross-tenant scramble", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const mine = await svc.launchPod("u1", "plain", { size: "s" });
    const theirs = await svc.launchPod("u2", "plain", { size: "s" });
    const theirsBefore = (await store.get(theirs.id))?.position;

    await svc.setPodOrder("u1", [theirs.id, mine.id]);

    // Unowned id UNTOUCHED. (It has a real position of its own now — every pod is placed at
    // creation — so the assertion is "unchanged", not "still null".)
    expect((await store.get(theirs.id))?.position).toBe(theirsBefore);
    expect((await store.get(mine.id))?.position).toBe(0); // owned ids compact from 0
  });

  // The owner's report (2026-08-27): "the dashboard brings those bluish cards to the top?!?! our
  // dashboard is manually sorted only". Root cause was `position: null` at creation — such a pod
  // sorted ABOVE the manual order AND re-sorted itself by STATUS RANK, so a card physically moved
  // as its pod went Working → Waiting → Idle.
  it("every pod is placed at creation — no pod is ever left unpositioned", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });

    expect((await store.get(a.id))?.position).not.toBeNull();
    expect((await store.get(b.id))?.position).not.toBeNull();
    // newest first, and strictly above the older one
    expect((await store.get(b.id))!.position!).toBeLessThan((await store.get(a.id))!.position!);
  });

  it("a placed pod does NOT move when its status changes — manual order is authoritative", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const a = await svc.launchPod("u1", "plain", { size: "s" });
    const b = await svc.launchPod("u1", "plain", { size: "s" });
    const c = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.setPodOrder("u1", [a.id, b.id, c.id]);
    const before = (await svc.listPods("u1")).map((p) => p.id);

    // Drive the middle pod to a different lifecycle status (the old sort ranked `error` FIRST and
    // `suspended` after `running`, so this is exactly the input that used to reshuffle a card).
    await store.update(b.id, { status: "error" });
    await store.update(c.id, { status: "suspended" });

    expect((await svc.listPods("u1")).map((p) => p.id)).toEqual(before);
  });

  it("per-owner positioning: one owner's placements never shift another's", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const mine1 = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.launchPod("u2", "plain", { size: "s" });
    const mine2 = await svc.launchPod("u1", "plain", { size: "s" });

    // u1's newest sits above u1's older one, and u2's pod is nowhere in u1's list.
    expect((await svc.listPods("u1")).map((p) => p.id)).toEqual([mine2.id, mine1.id]);
  });
});

describe("ownerLiveSignals (dashboard card sweep)", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  it("carries lifecycle for EVERY pod, and probes only running ones for activity", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const run = await svc.launchPod("u1", "plain", { size: "s" });
    const asleep = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    await svc.sleep("u1", asleep.id);

    provider.agentStatusResult = "busy";
    provider.appListeningResult = true;
    provider.issuesResult = [
      { id: "disk", severity: "critical", title: "Disk almost full", detail: "9.8/10GB", fixable: false },
    ];

    const rows = await svc.ownerLiveSignals("u1");
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Both pods present, each with its lifecycle status — the card reflects a
    // transition on the next poll, not only on a full reload.
    expect(byId.get(run.id)).toMatchObject({ status: "running", agentStatus: "busy", appListening: true });
    expect(byId.get(run.id)!.criticalIssue).toMatchObject({ title: "Disk almost full" });
    // The suspended pod is present (lifecycle only), NOT probed → no live claims.
    expect(byId.get(asleep.id)).toMatchObject({ status: "suspended", agentStatus: null, appListening: null });
  });

  it("advances lastActiveAt to the honest transcript activity (lastActivityMs), even when idle NOW", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const run = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    await store.update(run.id, { lastActiveAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    provider.agentStatusResult = "idle"; // idle THIS instant…
    provider.lastActivityMsResult = 5_000; // …but the last transcript entry (a tool result) was 5s ago

    await svc.ownerLiveSignals("u1");
    expect(Date.now() - Date.parse((await store.get(run.id))!.lastActiveAt)).toBeLessThan(60_000);
  });

  it("does NOT bump when the transcript shows no recent activity (spinner idleMs is ignored)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const run = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    const stale = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
    await store.update(run.id, { lastActiveAt: stale });
    provider.agentStatusResult = "idle";
    provider.idleMsResult = 20_000; // terminal spinner output — MUST be ignored now
    provider.lastActivityMsResult = 8 * 24 * 3600_000; // real last transcript entry: 8 days ago

    await svc.ownerLiveSignals("u1");
    expect((await store.get(run.id))!.lastActiveAt).toBe(stale); // untouched — genuinely idle
  });

  it("old image (no lastActivityMs): READS the agent transcript via exec — bumps + reports that, ignores flickery busy", async () => {
    // No busy-fallback (agentStatus flickers "busy" for an idle agent and pinned idle pods to "now" —
    // the makore.app prod bug). Instead we exec a transcript reader in the pod: an un-updated pod still
    // gets its honest agent time WITHOUT a recreate, driving BOTH the card and the lastActiveAt bump.
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    await store.update(pod.id, { lastActiveAt: new Date(Date.now() - 5 * 3600_000).toISOString() });
    provider.lastActivityMsResult = null; // old image: healthz doesn't report it
    provider.agentStatusResult = "busy"; // flicker — must NOT be used as an activity signal
    provider.execStdout = String(5 * 60_000); // the exec reader: newest transcript entry 5 min ago

    const [row] = await svc.ownerLiveSignals("u1");
    expect(row!.agentIdleMs).toBe(5 * 60_000); // card shows the transcript time, not terminal noise
    expect(Date.now() - Date.parse((await store.get(pod.id))!.lastActiveAt)).toBeLessThan(6 * 60_000);
    expect(Date.now() - Date.parse((await store.get(pod.id))!.lastActiveAt)).toBeGreaterThan(4 * 60_000);
  });

  it("old image with NO transcript at all (exec prints -1): leaves lastActiveAt untouched", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    const stale = new Date(Date.now() - 5 * 3600_000).toISOString();
    await store.update(pod.id, { lastActiveAt: stale });
    provider.lastActivityMsResult = null;
    provider.agentStatusResult = "busy";
    provider.execStdout = "-1"; // fresh pod / no transcript → no signal

    const [row] = await svc.ownerLiveSignals("u1");
    expect(row!.agentIdleMs).toBeNull();
    expect((await store.get(pod.id))!.lastActiveAt).toBe(stale); // untouched
  });

  it("never moves lastActiveAt BACKWARD (older transcript time can't erase recent activity)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const run = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    const recent = new Date(Date.now() - 10_000).toISOString();
    await store.update(run.id, { lastActiveAt: recent });
    provider.lastActivityMsResult = 3600_000; // transcript says 1h ago — OLDER than recorded

    await svc.ownerLiveSignals("u1");
    expect((await store.get(run.id))!.lastActiveAt).toBe(recent); // unchanged
  });

  it("degrades to unknown (never a false claim) when neither healthz nor metrics report it", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.agentStatusResult = null;
    provider.appListeningResult = undefined; // old image: healthz field absent
    // metricsAppListening unset → fetchMetrics returns null too

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row!.agentStatus).toBeNull();
    expect(row!.appListening).toBeNull(); // unknown — not false
  });

  it("carries codexStatus (activity from the rollout mtime) for a running pod", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.codexStatusResult = "busy";

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row!.codexStatus).toBe("busy");
    expect(row!.id).toBe(pod.id);
  });

  it("falls back to METRICS app.listening when healthz doesn't report it (old image)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.appListeningResult = undefined; // healthz: absent (old image)
    provider.metricsAppListening.set(pod.id, false); // but /metrics knows nothing's on :3000

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    // Same source the cockpit preview card uses — so the card gates preview correctly
    // even before the pod updates, and the two never disagree.
    expect(row!.appListening).toBe(false);
  });

  it("a pod that doesn't answer is unreachable, not dropped", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await svc.provisionPending();
    provider.podHealth = async () => {
      throw new Error("connect refused");
    };

    const [row] = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(row).toMatchObject({ id: pod.id, unreachable: true, appListening: null });
  });

  it("is owner-scoped", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    await svc.launchPod("u1", "plain", { size: "s" });
    const theirs = await svc.launchPod("u2", "plain", { size: "s" });
    await svc.provisionPending();

    const rows = await svc.ownerLiveSignals("u1", { maxAgeMs: 0 });
    expect(rows.find((r) => r.id === theirs.id)).toBeUndefined();
  });
});
