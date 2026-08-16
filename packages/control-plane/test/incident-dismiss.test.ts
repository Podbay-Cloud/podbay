import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { PodService } from "../src/index.js";
import { InMemoryPodStore } from "../src/store.js";
import { MockProvider } from "./mock-provider.js";

async function envRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-dismiss-"));
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "podbay.yaml"),
    `apiVersion: podbay/v0\nname: ${name}\nbase:\n  image: ubuntu:24.04\n`,
  );
  return root;
}

/**
 * Dismissing an OOM banner must clear the WHOLE cascade. One kill propagates up every
 * ancestor cgroup, so it can land as several oom_killed events at the same instant
 * (session-*.scope / user-1000.slice / user.slice). If dismiss only cleared one, the
 * banner (most-recent undismissed OOM) resurfaced the next sibling on reload — the exact
 * makore bug (2026-08-07).
 */
describe("dismissing an OOM incident clears the whole cascade", () => {
  let provider: MockProvider;
  let store: InMemoryPodStore;
  let root: string;

  beforeEach(async () => {
    provider = new MockProvider();
    store = new InMemoryPodStore();
    root = await envRoot("plain");
  });

  const addOom = async (podId: string, owner: string, id: string, victim: string, at: string) =>
    store.appendEvent({ id, podId, ownerId: owner, type: "oom_killed", at, meta: { victim, victimIsAgent: false }, dismissedAt: null });

  it("dismissing one sibling dismisses the others from the same kill", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    const at = "2026-08-07T01:02:03.000Z";
    await addOom(pod.id, "u1", "e-scope", "session-c6.scope", at);
    await addOom(pod.id, "u1", "e-user1000", "user-1000.slice", at);
    await addOom(pod.id, "u1", "e-user", "user.slice", at);

    await svc.dismissIncident("u1", pod.id, "e-scope");

    const events = await store.listEvents(pod.id);
    const oom = events.filter((e) => e.type === "oom_killed");
    expect(oom.length).toBe(3);
    expect(oom.every((e) => e.dismissedAt)).toBe(true); // all three cleared, not just one
  });

  it("dismissing an OLDER event leaves newer ones (dismiss clears up to that point)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await addOom(pod.id, "u1", "e-old", "user.slice", "2026-08-07T01:02:03.000Z");
    await addOom(pod.id, "u1", "e-new", "user.slice", "2026-08-07T01:20:00.000Z"); // 18 min later

    await svc.dismissIncident("u1", pod.id, "e-old");

    const byId = new Map((await store.listEvents(pod.id)).map((e) => [e.id, e]));
    expect(byId.get("e-old")?.dismissedAt).toBeTruthy();
    expect(byId.get("e-new")?.dismissedAt).toBeFalsy(); // dismiss only clears at-or-before the target
  });

  // The cockpit dismiss button passes the BANNER's id — always the most-recent incident.
  // Dismissing it must clear the whole pile in one click (a pod that OOMs repeatedly over
  // hours accrues many separate incidents; before, each needed its own dismiss + reload).
  it("dismissing the current banner clears every older incident in one click", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await addOom(pod.id, "u1", "e-1", "user.slice", "2026-08-07T01:00:00.000Z");
    await addOom(pod.id, "u1", "e-2", "user.slice", "2026-08-07T02:00:00.000Z");
    await addOom(pod.id, "u1", "e-3", "user.slice", "2026-08-07T03:00:00.000Z"); // newest = the banner

    await svc.dismissIncident("u1", pod.id, "e-3");

    const oom = (await store.listEvents(pod.id)).filter((e) => e.type === "oom_killed");
    expect(oom.every((e) => e.dismissedAt)).toBe(true); // all three cleared, not one-at-a-time
  });

  // Per the triage decision: a genuinely NEW occurrence after a dismiss still surfaces, so
  // the owner never misses a recurring problem.
  it("a fresh incident AFTER a dismiss still surfaces (not silently swallowed)", async () => {
    const svc = new PodService(provider, store, { environmentsRoot: root });
    const pod = await svc.launchPod("u1", "plain", { size: "s" });
    await addOom(pod.id, "u1", "e-1", "user.slice", "2026-08-07T01:00:00.000Z");
    await svc.dismissIncident("u1", pod.id, "e-1"); // owner clears what they've seen
    await addOom(pod.id, "u1", "e-2", "user.slice", "2026-08-07T05:00:00.000Z"); // a new kill, hours later

    const byId = new Map((await store.listEvents(pod.id)).map((e) => [e.id, e]));
    expect(byId.get("e-1")?.dismissedAt).toBeTruthy();
    expect(byId.get("e-2")?.dismissedAt).toBeFalsy(); // the new one is undismissed → banner returns
  });
});
