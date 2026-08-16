import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-resize-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "podbay.yaml"), `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`);
  return root;
}

/** A resize cold-restarts the pod exactly like an update, so it must (a) ask the agent for
 * a handoff first and (b) leave a note about the new resources for the resumed agent. */
describe("resize: handoff + new-params note", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;
  const svc = () => new PodService(provider, store, { environmentsRoot: root });
  const noteWrite = () => provider.execCalls.map((c) => c[c.length - 1] ?? "").find((s) => s.includes("pod-resized.md"));
  const askedHandoff = () => provider.execCalls.some((c) => (c[c.length - 1] ?? "").includes("tmux list-windows"));

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  it("a RUNNING pod's resize requests a handoff and writes a resize note", async () => {
    const s = svc();
    const pod = await s.launchPod("u1", "plain", { size: "s" });
    await s.provisionPending();
    await store.update(pod.id, { status: "running" });

    await s.resizePod("u1", pod.id, "l");

    expect(askedHandoff(), "resize should request a handoff before restarting").toBe(true);
    const note = noteWrite();
    expect(note, "a resize note should be written").toBeTruthy();
    // The note carries the NEW tier's resources.
    expect(note).toContain("Large");
    expect(note).toContain("8 vCPU");
    expect(note).toContain("16 GB RAM");
    // …and it lands in the handoff dir the resume rule reads.
    expect(note).toContain("/.podbay/handoff/pod-resized.md");
    expect(provider.resized.at(-1)).toMatchObject({ cpus: 8, memoryGb: 16 });
  });

  it("disk is grow-only: a resize-DOWN keeps the larger disk in the note", async () => {
    const s = svc();
    const pod = await s.launchPod("u1", "plain", { size: "l" }); // diskGb 40
    await s.provisionPending();
    await store.update(pod.id, { status: "running" });

    await s.resizePod("u1", pod.id, "s"); // CPU/RAM shrink, disk stays 40

    const note = noteWrite() ?? "";
    expect(note).toContain("2 vCPU");
    expect(note).toContain("4 GB RAM");
    expect(note).toContain("40 GB disk"); // NOT small's default 10
    expect(provider.resized.at(-1)).toMatchObject({ cpus: 2, memoryGb: 4, diskGb: 40 });
  });

  it("a SUSPENDED pod's resize skips handoff + note (no live agent, no reachable machine)", async () => {
    const s = svc();
    const pod = await s.launchPod("u1", "plain", { size: "s" });
    await s.provisionPending();
    await store.update(pod.id, { status: "suspended" });

    await s.resizePod("u1", pod.id, "l");

    expect(askedHandoff()).toBe(false);
    expect(noteWrite()).toBeUndefined();
    // …but the resize itself still happens.
    expect(provider.resized.at(-1)).toMatchObject({ cpus: 8, memoryGb: 16 });
  });
});
