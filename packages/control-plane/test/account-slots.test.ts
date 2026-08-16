import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { ControlError } from "../src/types.js";
import { MockProvider } from "./mock-provider.js";

/** Minimal env so launch resolves. */
async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-slots-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

/**
 * Account slot budget. A pod costs slots by size (Small 1, Medium 2, Large 4); each
 * account has 4. Suspending frees slots; resuming/resizing must still fit. Admins pass
 * slotCap: Infinity and are never limited.
 */
describe("account slots", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;
  const svc = () => new PodService(provider, store, { environmentsRoot: root });

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  const suspend = (id: string) => store.update(id, { status: "suspended" });

  it("counts slots by size and excludes suspended pods", async () => {
    const s = svc();
    const small = await s.launchPod("u1", "plain", { size: "s" }); // 1
    await s.launchPod("u1", "plain", { size: "m" }); // 2 → used 3
    expect((await s.accountSlotUsage("u1")).used).toBe(3);
    await suspend(small.id);
    expect((await s.accountSlotUsage("u1")).used).toBe(2); // small freed
  });

  it("refuses a launch that would exceed the 4-slot budget", async () => {
    const s = svc();
    await s.launchPod("u1", "plain", { size: "l" }); // 4 → full
    await expect(s.launchPod("u1", "plain", { size: "s" })).rejects.toMatchObject({
      code: "slot_limit",
    });
    // …and the failed launch wrote nothing.
    expect((await s.accountSlotUsage("u1")).used).toBe(4);
  });

  it("four small pods fill the budget; a fifth is refused", async () => {
    const s = svc();
    for (let i = 0; i < 4; i++) await s.launchPod("u1", "plain", { size: "s" });
    await expect(s.launchPod("u1", "plain", { size: "s" })).rejects.toBeInstanceOf(ControlError);
  });

  it("suspending a pod frees its slots for a new one", async () => {
    const s = svc();
    const big = await s.launchPod("u1", "plain", { size: "l" }); // full
    await expect(s.launchPod("u1", "plain", { size: "s" })).rejects.toMatchObject({ code: "slot_limit" });
    await suspend(big.id);
    // Now there's room.
    await expect(s.launchPod("u1", "plain", { size: "s" })).resolves.toBeTruthy();
  });

  it("resuming a suspended pod is blocked when the freed slots got taken", async () => {
    const s = svc();
    const big = await s.launchPod("u1", "plain", { size: "l" }); // 4
    await suspend(big.id); // freed → used 0
    await s.launchPod("u1", "plain", { size: "l" }); // another large → used 4
    // Resuming the first large would need 4 more — no room.
    await expect(s.wake("u1", big.id)).rejects.toMatchObject({ code: "slot_limit" });
  });

  it("refuses a resize-up that would not fit", async () => {
    const s = svc();
    const small = await s.launchPod("u1", "plain", { size: "s" }); // 1
    await store.update(small.id, { status: "running" });
    await s.launchPod("u1", "plain", { size: "m" }); // 2 → used 3
    // s→l swaps 1 for 4 → 3-1+4 = 6 > 4.
    await expect(s.startPodResize("u1", small.id, "l")).rejects.toMatchObject({ code: "slot_limit" });
  });

  it("is scoped per account — one owner's pods don't spend another's", async () => {
    const s = svc();
    await s.launchPod("u1", "plain", { size: "l" }); // u1 full
    await expect(s.launchPod("u2", "plain", { size: "l" })).resolves.toBeTruthy(); // u2 unaffected
  });

  it("admins (Infinity cap) are never limited", async () => {
    const s = svc();
    for (let i = 0; i < 3; i++) await s.launchPod("admin", "plain", { size: "l", slotCap: Infinity }); // 12
    expect((await s.accountSlotUsage("admin")).used).toBe(12);
    await expect(s.launchPod("admin", "plain", { size: "l", slotCap: Infinity })).resolves.toBeTruthy();
  });
});
