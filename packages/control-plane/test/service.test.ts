import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PodService } from "../src/service.js";
import { usageForPod } from "../src/metrics.js";
import { InMemoryPodStore, type PodStore } from "../src/store.js";
import type { PodRecord } from "../src/types.js";
import { MockProvider } from "./mock-provider.js";

const environmentsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
);
const ENV = "nextjs-starter";

let provider: MockProvider;
let store: InMemoryPodStore;
let svc: PodService;

beforeEach(() => {
  provider = new MockProvider();
  store = new InMemoryPodStore();
  svc = new PodService(provider, store, { environmentsRoot });
});

describe("launchPod", () => {
  it("persists the row immediately as provisioning, then builds the machine (4.1)", async () => {
    const rec = await svc.launchPod("user-1", ENV);
    expect(rec.ownerId).toBe("user-1");
    expect(rec.environmentName).toBe(ENV);
    // Row exists at once (durable + URL-addressable) while the machine builds.
    expect(rec.status).toBe("provisioning");
    expect((await store.get(rec.id))?.id).toBe(rec.id);
    // Background provisioning then creates the machine and flips to running.
    await svc.provisionPending(); // run the provisioner worker once (builds the just-enqueued pod)
    expect(provider.pods.has(rec.id)).toBe(true);
    expect((await store.get(rec.id))?.status).toBe("running");
  });

  it("rejects an unknown env with no side effects (4.1)", async () => {
    await expect(svc.launchPod("user-1", "does-not-exist")).rejects.toMatchObject({
      code: "invalid",
    });
    expect(provider.pods.size).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects an unsafe env name (path traversal)", async () => {
    await expect(svc.launchPod("user-1", "../secrets")).rejects.toMatchObject({ code: "invalid" });
    expect(provider.pods.size).toBe(0);
  });

  it("never builds a machine if the initial row write fails (4.7)", async () => {
    // The row is created FIRST (before any machine), so a failed write leaks
    // nothing to clean up — no provider pod was ever created.
    class FailingStore extends InMemoryPodStore {
      async create(): Promise<never> {
        throw new Error("db down");
      }
    }
    const failingStore: PodStore = new FailingStore();
    const s = new PodService(provider, failingStore, { environmentsRoot });
    await expect(s.launchPod("user-1", ENV)).rejects.toThrow("db down");
    expect(provider.pods.size).toBe(0);
    expect(provider.destroyed.length).toBe(0);
  });

  it("marks the pod errored and cleans up if the machine fails to build", async () => {
    class BadProvider extends MockProvider {
      async createPod(): Promise<never> {
        throw new Error("fly is down");
      }
    }
    const bad = new BadProvider();
    const s = new PodService(bad, store, { environmentsRoot });
    const rec = await s.launchPod("user-1", ENV);
    expect(rec.status).toBe("provisioning"); // returned before the machine failed
    await s.provisionPending(Date.now(), { maxAttempts: 1 }); // one try, then give up
    expect((await store.get(rec.id))?.status).toBe("error");
    expect((await store.get(rec.id))?.provisionError).toContain("fly is down");
    expect(bad.destroyed).toContain(rec.id); // best-effort cleanup ran
  });
});

describe("onboarding: capture the greeter's RC session URL server-side", () => {
  // The boot greeter enables remote control with NO client watching, so nothing
  // streams the URL through the gateway — a RUNNING pod that's logged in but has
  // no sessionUrl is still onboarding and must be reconciled to capture it.
  it("listPods reconciles a running, logged-in pod with no session URL yet", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending(); // → running
    await svc.recordAuthed("u", rec.id); // logged in
    provider.agentSession.set(rec.id, "https://claude.ai/code/session_ABC");

    const pods = await svc.listPods("u");

    expect(pods.find((p) => p.id === rec.id)?.sessionUrl).toBe("https://claude.ai/code/session_ABC");
  });

  it("getPod (cockpit page) captures it too, and stops reconciling once set", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await svc.recordAuthed("u", rec.id);
    provider.agentSession.set(rec.id, "https://claude.ai/code/session_XYZ");

    expect((await svc.getPod("u", rec.id)).sessionUrl).toBe("https://claude.ai/code/session_XYZ");

    // Once captured, a fresh (different) URL isn't chased — the pod is past
    // onboarding, so getPod no longer force-reconciles it.
    provider.agentSession.set(rec.id, "https://claude.ai/code/session_DIFFERENT");
    expect((await svc.getPod("u", rec.id)).sessionUrl).toBe("https://claude.ai/code/session_XYZ");
  });
});

describe("resizePod (compute tiers)", () => {
  it("launches at the chosen tier and hands the resolved resources to the provider", async () => {
    const rec = await svc.launchPod("u", ENV, { size: "l" });
    expect(rec.size).toBe("l");
    expect(rec.diskGb).toBe(40);
    await svc.provisionPending();
    expect(provider.created.find((c) => c.id === rec.id)?.resources).toEqual({
      cpus: 8,
      memoryGb: 16,
      diskGb: 40,
    });
  });

  it("defaults to Small when no size is given", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.size).toBe("s");
    expect(rec.diskGb).toBe(10);
  });

  it("resizes CPU/RAM down but keeps disk at the high-water mark", async () => {
    const rec = await svc.launchPod("u", ENV, { size: "l" }); // 8/16/40
    await svc.provisionPending();

    const back = await svc.resizePod("u", rec.id, "s"); // down to 2/4/10
    expect(back.size).toBe("s");
    expect(back.diskGb).toBe(40); // disk cannot shrink
    // provider was asked for Small CPU/RAM but the 40GB disk high-water mark
    expect(provider.resized.at(-1)).toEqual({ id: rec.id, cpus: 2, memoryGb: 4, diskGb: 40 });
  });

  it("refuses to resize a pod that isn't running or sleeping", async () => {
    const rec = await svc.launchPod("u", ENV);
    await store.update(rec.id, { status: "provisioning" });
    await expect(svc.resizePod("u", rec.id, "m")).rejects.toThrow(/can't be resized/);
  });

  it("is owner-scoped", async () => {
    const rec = await svc.launchPod("owner", ENV);
    await svc.provisionPending();
    await expect(svc.resizePod("intruder", rec.id, "m")).rejects.toThrow(/not found/);
  });
});

describe("retryProvision (recover a failed pod)", () => {
  it("re-enqueues a failed pod; a later tick rebuilds it once the box recovers", async () => {
    let down = true;
    class Recoverable extends MockProvider {
      async createPod(input: Parameters<MockProvider["createPod"]>[0]) {
        if (down) throw new Error("box is down");
        return super.createPod(input);
      }
    }
    const p = new Recoverable();
    const s = new PodService(p, store, { environmentsRoot });
    const rec = await s.launchPod("u", ENV);
    await s.provisionPending(Date.now(), { maxAttempts: 1 }); // fail → error
    expect((await store.get(rec.id))?.status).toBe("error");

    const back = await s.retryProvision("u", rec.id);
    expect(back.status).toBe("provisioning");
    expect(back.provisionError).toBeNull();
    expect(back.provisionAttempts).toBe(0); // fresh attempt budget

    down = false;
    await s.provisionPending(Date.now(), { maxAttempts: 1 }); // box healthy → running
    expect((await store.get(rec.id))?.status).toBe("running");
  });

  it("refuses to touch a pod that isn't in a failed state", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending(); // → running
    await expect(svc.retryProvision("u", rec.id)).rejects.toThrow(/failed state/);
  });

  it("is owner-scoped — another user's failed pod is not found", async () => {
    const rec = await svc.launchPod("owner", ENV);
    await store.update(rec.id, { status: "error", provisionError: "x" });
    await expect(svc.retryProvision("intruder", rec.id)).rejects.toThrow(/not found/);
  });
});

describe("provisioner worker (durable provisioning)", () => {
  it("retries with a backoff lease, then succeeds on a later tick", async () => {
    let calls = 0;
    class FlakyProvider extends MockProvider {
      async createPod(input: Parameters<MockProvider["createPod"]>[0]) {
        if (++calls === 1) throw new Error("transient");
        return super.createPod(input);
      }
    }
    const p = new FlakyProvider();
    const s = new PodService(p, store, { environmentsRoot });
    const rec = await s.launchPod("u", ENV);

    const t0 = Date.now();
    await s.provisionPending(t0, { backoffMs: 1000, maxAttempts: 3 });
    // First try failed → still provisioning, error recorded, lease pushed out.
    let row = await store.get(rec.id);
    expect(row?.status).toBe("provisioning");
    expect(row?.provisionError).toContain("transient");
    expect(row?.provisionAttempts).toBe(1);

    // Too soon (lease still held) → no claim, no build.
    await s.provisionPending(t0 + 500, { backoffMs: 1000, maxAttempts: 3 });
    expect((await store.get(rec.id))?.status).toBe("provisioning");
    expect(calls).toBe(1);

    // After the backoff → re-claimed and built.
    await s.provisionPending(t0 + 2000, { backoffMs: 1000, maxAttempts: 3 });
    row = await store.get(rec.id);
    expect(row?.status).toBe("running");
    expect(row?.provisionError).toBeNull();
  });

  // THE duplicate-provisioning leak: one pod ended up with 3 machines + 3 volumes,
  // all billing (2026-07-17). The machine was built, then the attempt died BEFORE
  // the row was updated; the retry couldn't see it (Fly's listMachines is
  // eventually consistent) and built another. The fix records the machine id the
  // instant it exists, so a retry ADOPTS it instead of racing a list.
  it("a retry after the machine exists ADOPTS it — never builds a second", async () => {
    class DiesAfterBuilding extends MockProvider {
      calls = 0;
      async createPod(input: Parameters<MockProvider["createPod"]>[0]) {
        const info = await super.createPod(input); // machine created (+ id recorded)
        if (++this.calls === 1) throw new Error("crashed after the machine existed");
        return info;
      }
    }
    const p = new DiesAfterBuilding();
    const s = new PodService(p, store, { environmentsRoot });
    const rec = await s.launchPod("u", ENV);

    const t0 = Date.now();
    await s.provisionPending(t0, { backoffMs: 1000, maxAttempts: 3 });
    // The attempt failed, but the machine id was persisted mid-flight — that link
    // is the whole point; without it the retry is blind.
    const afterCrash = await store.get(rec.id);
    expect(afterCrash?.status).toBe("provisioning");
    expect(afterCrash?.machineId).toBe("machine-1");
    expect(p.machinesBuilt).toEqual(["machine-1"]);

    // Retry → adopts machine-1, does NOT build machine-2.
    await s.provisionPending(t0 + 2000, { backoffMs: 1000, maxAttempts: 3 });
    const done = await store.get(rec.id);
    expect(done?.status).toBe("running");
    expect(done?.machineId).toBe("machine-1");
    expect(p.machinesBuilt).toEqual(["machine-1"]); // ← the leak: would be 2 without the fix
  });

  it("gives up after maxAttempts → error + cleanup", async () => {
    class DeadProvider extends MockProvider {
      async createPod(): Promise<never> {
        throw new Error("always fails");
      }
    }
    const p = new DeadProvider();
    const s = new PodService(p, store, { environmentsRoot });
    const rec = await s.launchPod("u", ENV);
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      await s.provisionPending(now, { backoffMs: 100, maxAttempts: 3 });
      now += 1000;
    }
    const row = await store.get(rec.id);
    expect(row?.status).toBe("error");
    expect(row?.provisionAttempts).toBe(3);
    expect(p.destroyed).toContain(rec.id);
  });

  it("a claimed pod isn't double-claimed by a concurrent worker tick", async () => {
    await svc.launchPod("u", ENV);
    // Two ticks at the same instant: the first claims+builds it, the second finds
    // the lease held and claims nothing.
    const [a, b] = await Promise.all([svc.provisionPending(1000), svc.provisionPending(1000)]);
    expect(a.length + b.length).toBe(1);
  });
});

describe("ownership isolation (4.2)", () => {
  it("list returns only the owner's pods", async () => {
    await svc.launchPod("owner-a", ENV);
    await svc.launchPod("owner-a", ENV);
    await svc.launchPod("owner-b", ENV);
    expect(await svc.listPods("owner-a")).toHaveLength(2);
    expect(await svc.listPods("owner-b")).toHaveLength(1);
  });

  it("cross-owner get/mutate is not-found", async () => {
    const rec = await svc.launchPod("owner-a", ENV);
    await svc.provisionPending();
    await expect(svc.getPod("owner-b", rec.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.destroy("owner-b", rec.id)).rejects.toMatchObject({ code: "not_found" });
    expect(provider.pods.has(rec.id)).toBe(true); // untouched
  });
});

// Multi-provider routing (infra-strategy.md M1): a pod's record.provider picks
// which SandboxProvider hosts it; unknown names degrade to the default.
describe("provider routing", () => {
  it("stamps the default provider name at launch", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.provider).toBe("fly");
  });

  it("routes calls to the provider named on the record", async () => {
    const incus = new MockProvider();
    const routed = new PodService(provider, store, {
      environmentsRoot,
      providers: { incus },
      defaultProviderName: "fly",
    });
    const rec = await routed.launchPod("u", ENV);
    await routed.provisionPending();
    // Simulate an M3-migrated pod: hosted on incus now (copy, not a shared ref).
    incus.pods.set(rec.id, { ...(await provider.getPod(rec.id))! });
    await store.update(rec.id, { provider: "incus" });

    await routed.sleep("u", rec.id);

    // The incus mock got the call; the fly mock's pod is untouched (running).
    expect(incus.pods.get(rec.id)?.status).toBe("suspended");
    expect(provider.pods.get(rec.id)?.status).toBe("running");
  });

  it("falls back to the default provider for an unknown name (never bricks an op)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await store.update(rec.id, { provider: "does-not-exist" });

    const slept = await svc.sleep("u", rec.id); // must not throw

    expect(slept.status).toBe("suspended");
  });

  it("listProviderPods merges machines across all providers", async () => {
    const incus = new MockProvider();
    const routed = new PodService(provider, store, {
      environmentsRoot,
      providers: { incus },
    });
    const rec = await routed.launchPod("u", ENV);
    await routed.provisionPending(); // one machine on fly
    incus.pods.set("incus-pod", {
      id: "incus-pod",
      status: "running",
      region: "hetzner-fsn1",
      endpoint: null,
      keepAwake: false,
    });

    const all = await routed.listProviderPods();

    expect(all.map((p) => p.id).sort()).toEqual(["incus-pod", rec.id].sort());
  });
});

// Backoffice v2 (B1): admin acts on ANY pod, but through the owner-scoped path so
// events stay attributed to the real owner, not the admin.
describe("admin-scoped pod control (backoffice)", () => {
  it("wakes/sleeps/updates/destroys a pod the admin does not own", async () => {
    const rec = await svc.launchPod("owner-a", ENV);
    await svc.provisionPending();

    expect((await svc.adminGetPod(rec.id)).ownerId).toBe("owner-a"); // no ownership check
    await svc.adminSleep(rec.id);
    expect((await svc.adminGetPod(rec.id)).status).toBe("suspended");
    await svc.adminWake(rec.id);
    await svc.adminUpdatePodImage(rec.id, "reg/pod:tag@sha256:newdigest");
    expect((await svc.adminGetPod(rec.id)).imageDigest).toBe("sha256:newdigest");

    await svc.adminDestroy(rec.id);
    expect(provider.destroyed).toContain(rec.id);
  });

  it("attributes lifecycle events to the real owner, not the admin", async () => {
    const rec = await svc.launchPod("owner-a", ENV);
    await svc.provisionPending();
    await svc.adminSleep(rec.id);

    const events = await store.listEvents(rec.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.ownerId === "owner-a")).toBe(true);
  });

  it("is not-found for an unknown pod", async () => {
    await expect(svc.adminWake("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.adminGetPod("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reads metrics + secret-set status for a pod the admin does not own (never values)", async () => {
    const rec = await svc.launchPod("owner-a", ENV);
    await svc.provisionPending();

    // Metrics are RESOURCE data via the provider, no ownership gate; null when not
    // running (nothing to read), otherwise a snapshot — never terminal content.
    await svc.adminSleep(rec.id);
    expect(await svc.adminPodMetrics(rec.id)).toBeNull();

    // Secret status: a list of {key, set} — the SecretStatus type carries NO value
    // field, so an admin can never read a secret's value, only whether it's set.
    const secrets = await svc.adminListSecrets(rec.id); // no throw for a non-owner
    expect(Array.isArray(secrets)).toBe(true);
    for (const s of secrets) expect(s).not.toHaveProperty("value");

    await expect(svc.adminPodMetrics("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.adminListSecrets("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("addAgent (multi-agent slice 3)", () => {
  const ENV_BOTH = "nextjs-starter"; // declares [claude-code, codex]

  it("adds a different-type agent to a running pod WITHOUT recreating it", async () => {
    const rec = await svc.launchPod("u", ENV_BOTH);
    await svc.provisionPending();
    const before = provider.updatedImages.length;

    const out = await svc.addAgent("u", rec.id, "codex");

    expect(out.agents).toEqual(expect.arrayContaining(["codex"]));
    // the whole point: no recreate, so the running agent's session survives
    expect(provider.updatedImages).toHaveLength(before);
  });

  it("does not DROP the implicit primary when the record has no agents yet", async () => {
    // Older rows have agents = null while the pod runs the env's primary. Adding a
    // second agent must JOIN it, not replace it — otherwise the cockpit loses the
    // running agent's card and offers to "add" what is already there.
    const rec = await svc.launchPod("u", ENV_BOTH);
    await svc.provisionPending();
    await store.update(rec.id, { agents: [] }); // simulate the legacy row

    const out = await svc.addAgent("u", rec.id, "codex");

    expect(out.agents).toEqual(["claude-code", "codex"]);
  });

  it("is idempotent in the DB — and re-adding HEALS: the provider is still asked", async () => {
    const rec = await svc.launchPod("u", ENV_BOTH);
    await svc.provisionPending();
    await svc.addAgent("u", rec.id, "codex");
    const twice = await svc.addAgent("u", rec.id, "codex");
    expect((twice.agents ?? []).filter((a) => a === "codex")).toHaveLength(1);
    // The provider call repeats on purpose (pod-side spawn is idempotent by
    // window name): it repairs a lost window after an update dropped it.
    expect(provider.addedAgents.filter((a) => a.agent === "codex")).toHaveLength(2);
  });

  it("refuses an agent the environment does not declare", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-agent-declaration-"));
    const dir = path.join(root, "claude-only");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "podbay.yaml"),
      "apiVersion: podbay/v0\nname: claude-only\nbase:\n  image: ubuntu:24.04\nagents: [claude-code]\n",
    );
    const claudeOnlySvc = new PodService(provider, store, { environmentsRoot: root });
    const rec = await claudeOnlySvc.launchPod("u", "claude-only");
    await claudeOnlySvc.provisionPending();
    await expect(claudeOnlySvc.addAgent("u", rec.id, "codex")).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("refuses an unknown agent name", async () => {
    const rec = await svc.launchPod("u", ENV_BOTH);
    await svc.provisionPending();
    await expect(svc.addAgent("u", rec.id, "emacs")).rejects.toMatchObject({ code: "invalid" });
  });

  it("is owner-scoped", async () => {
    const rec = await svc.launchPod("u", ENV_BOTH);
    await svc.provisionPending();
    await expect(svc.addAgent("someone-else", rec.id, "codex")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("agentStates + setCodexRc (agent-card truth)", () => {
  it("returns the provider's per-agent states for a running pod, [] otherwise", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.agentStatesResult = [
      { id: "claude-code", window: 0, authed: true, rcActive: false },
      { id: "codex", window: 1, authed: false, rcActive: false },
    ];
    expect(await svc.agentStates("u", rec.id)).toHaveLength(2);
    await svc.sleep("u", rec.id);
    expect(await svc.agentStates("u", rec.id)).toEqual([]); // asleep → no live truth
    await expect(svc.agentStates("intruder", rec.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("setCodexRc passes through on a running pod and refuses otherwise", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.setCodexRc("u", rec.id, false);
    expect(provider.codexRcToggles).toEqual([{ id: rec.id, on: false }]);
    await svc.sleep("u", rec.id);
    await expect(svc.setCodexRc("u", rec.id, true)).rejects.toMatchObject({ code: "invalid" });
    await expect(svc.setCodexRc("intruder", rec.id, true)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("admin actions are visible to the OWNER", () => {
  it("marks what PODBAY did, distinctly from what the owner did", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();

    await svc.sleep("u", rec.id);          // the owner suspends their own pod
    expect(await svc.podAdminActions("u", rec.id)).toHaveLength(0);

    await svc.adminWake(rec.id);           // …and Podbay resumes it
    const actions = await svc.podAdminActions("u", rec.id);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("resume");
  });

  it("records a rollback in language the owner can act on", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.adminUpdatePodImage(rec.id, "registry/pod@sha256:abc");
    const [latest] = await svc.podAdminActions("u", rec.id);
    expect(latest.action).toMatch(/image/i);
  });

  it("is owner-scoped — one owner cannot read another's", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.adminWake(rec.id);
    await expect(svc.podAdminActions("someone-else", rec.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("marks a resize as a RESIZE, not an update, and clears the kind when it ends", async () => {
    // The kind used to be a `resize:` prefix on the stage string — a contract between
    // the control plane and the cockpit that nothing enforced. It is a column now, so
    // this asserts the column: mid-flight it says resize, afterwards it says nothing.
    // A kind that outlives its operation would mislabel the next one.
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.startPodResize("u", rec.id, "l");

    const during = await svc.getPod("u", rec.id);
    expect(during.maintenanceKind).toBe("resize");
    expect(during.updatingSince).not.toBeNull();
    // The stage no longer carries the kind in its text.
    expect(during.updateStage ?? "").not.toContain("resize:");

    await new Promise((r) => setTimeout(r, 20));
    const after = await svc.getPod("u", rec.id);
    expect(after.maintenanceKind).toBeNull();
    expect(after.updatingSince).toBeNull();
    expect(after.size).toBe("l");
  });

  it("resizing to the CURRENT size marks nothing at all", async () => {
    // A no-op must not flash a transient state, or the cockpit goes read-only and the
    // pod reports "Resizing…" for an operation that never happens.
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.startPodResize("u", rec.id, rec.size);
    const after = await svc.getPod("u", rec.id);
    expect(after.maintenanceKind).toBeNull();
    expect(after.updatingSince).toBeNull();
  });

  it("admin resize is audited so the owner learns why their bill moved", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.adminResize(rec.id, "l");

    expect((await svc.getPod("u", rec.id)).size).toBe("l");
    // The owner must see it in THEIR activity. A size change moves what they are
    // billed, and an unexplained bill change is worse than the problem it fixed.
    // Readable to the OWNER: "…size to Large", not the tier id "l".
    expect((await svc.podAdminActions("u", rec.id))[0].action).toMatch(/size to Large/);
  });

  it("admin resize to the CURRENT size does nothing rather than restarting the pod", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.adminResize(rec.id, rec.size);
    // No restart, and no audit line for a change that did not happen — a "resize"
    // to the size it already is would cut a live agent session for nothing.
    expect(await svc.podAdminActions("u", rec.id)).toHaveLength(0);
  });

  it("admin doctor may check and fix SAFELY, but never invasively", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.doctorResult = {
      checked: 1,
      issues: [{ id: "x", severity: "warn", title: "t", detail: "d", fixed: false }],
    };
    await svc.adminRunDoctor(rec.id, "check");
    expect(await svc.podAdminActions("u", rec.id)).toHaveLength(0); // a check is not an action

    // A fix run that repairs NOTHING is also not an action — we tell the owner what
    // we CHANGED, not what we attempted.
    await svc.adminRunDoctor(rec.id, "safe");
    expect(await svc.podAdminActions("u", rec.id)).toHaveLength(0);

    provider.doctorResult = {
      checked: 1,
      issues: [{ id: "x", severity: "warn", title: "t", detail: "d", fixed: true }],
    };
    await svc.adminRunDoctor(rec.id, "safe");
    expect((await svc.podAdminActions("u", rec.id))[0].action).toMatch(/doctor/i);
    // there is deliberately no "invasive" mode on the admin path
    expect(provider.doctorCalls.map((c) => c.mode)).toEqual(["check", "safe", "safe"]);
  });
});

describe("adminFleetHealth — which pod should I look at?", () => {
  it("lists ONLY unhealthy pods, worst first, ignoring informational findings", async () => {
    const sick = await svc.launchPod("u", "nextjs-starter");
    const fine = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.issuesResult = [
      { id: "disk-low", severity: "warn", title: "Disk low", detail: "d", fixable: true },
      { id: "app-not-listening", severity: "info", title: "no app", detail: "d", fixable: false },
    ];

    const rows = await svc.adminFleetHealth({ maxAgeMs: 0 });

    // the mock answers for every pod, so both appear — the point here is the SHAPE
    expect(rows.every((r) => r.issues.every((i) => i.severity !== "info"))).toBe(true);
    expect(rows.map((r) => r.worst)).toEqual(rows.map((r) => r.worst).sort());
    expect(rows.some((r) => r.id === sick.id || r.id === fine.id)).toBe(true);
  });

  it("says nothing when every pod is healthy — a quiet fleet is the normal case", async () => {
    await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.issuesResult = [];
    expect(await svc.adminFleetHealth({ maxAgeMs: 0 })).toEqual([]);
  });

  it("reports an unreachable pod rather than dropping it — silence is the worst state", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    const boom = new MockProvider();
    boom.podHealth = async () => {
      throw new Error("unreachable");
    };
    const svc2 = new PodService(boom, store, { environmentsRoot });
    const rows = await svc2.adminFleetHealth({ maxAgeMs: 0 });
    expect(rows.find((r) => r.id === rec.id)).toMatchObject({
      worst: "critical",
      issues: [expect.objectContaining({ id: "unreachable" })],
    });
  });

  it("caches, so a page refresh doesn't sweep the whole fleet again", async () => {
    await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.issuesResult = [
      { id: "disk-low", severity: "warn", title: "Disk low", detail: "d", fixable: true },
    ];
    const first = await svc.adminFleetHealth({ maxAgeMs: 60_000 });
    provider.issuesResult = []; // pod recovers…
    const second = await svc.adminFleetHealth({ maxAgeMs: 60_000 });
    expect(second).toEqual(first); // …but the cached sweep is served
    expect(await svc.adminFleetHealth({ maxAgeMs: 0 })).toEqual([]); // fresh sees it
  });
});

describe("podHealth (one read, many surfaces)", () => {
  it("derives agents and issues from a SINGLE provider read", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.agentStatesResult = [{ id: "claude-code", window: 0, authed: true, rcActive: true }];
    provider.issuesResult = [
      { id: "disk-low", severity: "warn", title: "t", detail: "d", fixable: true },
    ];

    const [agents, issues] = await Promise.all([
      svc.agentStates("u", rec.id),
      svc.podIssues("u", rec.id),
    ]);

    expect(agents).toHaveLength(1);
    expect(issues).toHaveLength(1);
    const health = await svc.podHealth("u", rec.id);
    expect(health.agents).toEqual(agents);
    expect(health.issues).toEqual(issues);
  });

  it("an asleep pod reports empty, not an error — surfaces degrade, they don't break", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await svc.sleep("u", rec.id);
    expect(await svc.podHealth("u", rec.id)).toEqual({
      agents: [],
      issues: [],
      repairs: [],
      repairGaveUp: [],
    });
  });

  it("is owner-scoped", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await expect(svc.podHealth("intruder", rec.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("doctor", () => {
  it("an invasive run is a DIFFERENT mode — a safe fix can never become a destructive one", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.doctorResult = { checked: 0, issues: [] };
    await svc.runDoctor("u", rec.id, "safe");
    await svc.runDoctor("u", rec.id, "invasive");
    expect(provider.doctorCalls.map((c) => c.mode)).toEqual(["safe", "invasive"]);
  });


  it("passes the fix flag through and records what it repaired as an event", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.doctorResult = {
      checked: 2,
      issues: [
        { id: "codex-runtime-missing", severity: "warn", title: "t", detail: "d", fixed: true },
        { id: "disk-low", severity: "warn", title: "t", detail: "d", fixed: false },
      ],
    };

    const report = await svc.runDoctor("u", rec.id, "safe");

    expect(provider.doctorCalls).toEqual([{ id: rec.id, mode: "safe" }]);
    expect(report.issues).toHaveLength(2);
    const events = (await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired");
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ by: "doctor", fixed: ["codex-runtime-missing"] });
  });

  it("records NOTHING when a read-only run finds problems it did not fix", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.doctorResult = {
      checked: 1,
      issues: [{ id: "disk-low", severity: "warn", title: "t", detail: "d", fixed: false }],
    };
    await svc.runDoctor("u", rec.id, "check");
    expect((await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired")).toHaveLength(
      0,
    );
  });

  it("is owner-scoped and needs a running pod", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    await expect(svc.runDoctor("intruder", rec.id, "check")).rejects.toMatchObject({
      code: "not_found",
    });
    await svc.sleep("u", rec.id);
    await expect(svc.runDoctor("u", rec.id, "check")).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("watchdog repairs become owner-visible events", () => {
  it("emits one event per repair, and never the same repair twice", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.repairsResult = [
      { target: "claude-code", reason: "window_missing", at: "2026-07-29T03:00:00.000Z" },
      { target: "codex", reason: "window_missing", at: "2026-07-29T03:01:00.000Z" },
    ];

    await svc.reconcile(rec.id);
    const first = (await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired");
    expect(first).toHaveLength(2);

    // Reconciling again must NOT duplicate them — the pod keeps reporting the same
    // bounded list, so dedupe is what stops the timeline filling with repeats.
    await svc.reconcile(rec.id);
    const second = (await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired");
    expect(second).toHaveLength(2);

    // …but a NEWER repair is recorded.
    provider.repairsResult = [
      ...provider.repairsResult,
      { target: "claude-code", reason: "window_missing", at: "2026-07-29T04:00:00.000Z" },
    ];
    await svc.reconcile(rec.id);
    const third = (await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired");
    expect(third).toHaveLength(3);
  });

  it("says nothing when the pod repaired nothing", async () => {
    const rec = await svc.launchPod("u", "nextjs-starter");
    await svc.provisionPending();
    provider.repairsResult = [];
    await svc.reconcile(rec.id);
    expect((await svc.adminPodEvents(rec.id)).filter((e) => e.type === "pod_repaired")).toHaveLength(
      0,
    );
  });
});

describe("setName", () => {
  it("sets, trims, and clears a display name (empty → null → slug fallback)", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.name).toBeNull();
    expect((await svc.setName("u", rec.id, "  My Pod  ")).name).toBe("My Pod");
    expect((await svc.setName("u", rec.id, "   ")).name).toBeNull();
  });

  it("is owner-scoped", async () => {
    const rec = await svc.launchPod("owner-a", ENV);
    await expect(svc.setName("owner-b", rec.id, "hijack")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("spec freshness — post-launch mutations reach the pod's pod-spec.json", () => {
  it("setPreviewPublic pushes previewPublic into the pod spec (fixes stale `podbay info`)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.setPreviewPublic("u", rec.id, true);
    expect(provider.specPatches.get(rec.id)).toMatchObject({ previewPublic: true });
    await svc.setPreviewPublic("u", rec.id, false);
    expect(provider.specPatches.get(rec.id)).toMatchObject({ previewPublic: false });
  });

  it("setName pushes podName so the in-pod session title isn't stuck at launch", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.setName("u", rec.id, "My CRM");
    expect(provider.specPatches.get(rec.id)).toMatchObject({ podName: "My CRM" });
  });

  it("setLifecycle pushes lifecycle so the agent's persistence guidance is current", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.setLifecycle("u", rec.id, "always-on");
    expect(provider.specPatches.get(rec.id)).toMatchObject({ lifecycle: "always-on" });
  });
});

describe("onboarding milestones (durable wizard state)", () => {
  it("records authed once (idempotent) and is owner-scoped", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.authedAt).toBeNull();
    await svc.recordAuthed("u", rec.id);
    const first = (await svc.getPod("u", rec.id)).authedAt;
    expect(first).not.toBeNull();
    await svc.recordAuthed("u", rec.id); // idempotent — timestamp doesn't move
    expect((await svc.getPod("u", rec.id)).authedAt).toBe(first);
    await expect(svc.recordAuthed("other", rec.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("records the remote-control session URL and is owner-scoped", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.sessionUrl).toBeNull();
    const url = "https://claude.ai/code/session_abc123";
    await svc.recordSessionUrl("u", rec.id, url);
    expect((await svc.getPod("u", rec.id)).sessionUrl).toBe(url);
    await expect(svc.recordSessionUrl("other", rec.id, url)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("records the sign-in URL durably, then clears it once the pod is authed", async () => {
    const rec = await svc.launchPod("u", ENV);
    expect(rec.authUrl).toBeNull();
    const url = "https://claude.ai/oauth/authorize?code=xyz";
    await svc.recordAuthUrl("u", rec.id, url);
    // Durable on the pod → the cockpit's Sign-in step reads it, refresh-safe.
    expect((await svc.getPod("u", rec.id)).authUrl).toBe(url);
    await expect(svc.recordAuthUrl("other", rec.id, url)).rejects.toMatchObject({ code: "not_found" });

    // Once logged in, the URL is spent — recordAuthed clears it, and a late capture
    // never re-sets it.
    await svc.recordAuthed("u", rec.id);
    expect((await svc.getPod("u", rec.id)).authUrl).toBeNull();
    await svc.recordAuthUrl("u", rec.id, "https://claude.ai/oauth/authorize?code=late");
    expect((await svc.getPod("u", rec.id)).authUrl).toBeNull();
  });

  // Every cold boot mints a NEW bridge session, so reconcile must REFRESH the URL,
  // not just fill it once — else a restarted pod (wake, or an in-place image
  // update) serves a dead "Open in Claude app" link forever. Seen live 2026-07-17:
  // an image update moved session_013kWzFQ… → session_01GXQRNG….
  it("refreshes a STALE session URL after the pod restarts with a new session", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await svc.recordSessionUrl("u", rec.id, "https://claude.ai/code/session_OLD");

    // The pod rebooted: the agent now reports a different bridge session.
    provider.agentSession.set(rec.id, "https://claude.ai/code/session_NEW");
    const reconciled = await svc.reconcile(rec.id);

    expect(reconciled.sessionUrl).toBe("https://claude.ai/code/session_NEW");
    expect((await svc.getPod("u", rec.id)).sessionUrl).toBe("https://claude.ai/code/session_NEW");
  });
});

describe("lifecycle (4.3, 4.4)", () => {
  let rec: PodRecord;
  beforeEach(async () => {
    rec = await svc.launchPod("u", ENV);
    await svc.provisionPending(); // build the machine so lifecycle ops have one
  });

  it("wake/sleep delegate and update the record", async () => {
    const slept = await svc.sleep("u", rec.id);
    expect(slept.status).toBe("suspended");
    // wake is honest: it holds "waking" until the agent is confirmed reachable...
    const woke = await svc.wake("u", rec.id);
    expect(woke.status).toBe("waking");
    expect(Date.parse(woke.lastActiveAt)).toBeGreaterThanOrEqual(Date.parse(rec.lastActiveAt));
    // ...then reconcile flips it to "running" once agentReady is true.
    expect((await svc.reconcile(rec.id)).status).toBe("running");
  });

  it("getPod reconciles a waking pod itself (cockpit must not show stale waking)", async () => {
    await svc.sleep("u", rec.id);
    await svc.wake("u", rec.id); // → status "waking" in the store
    // A single-pod read settles it — no dashboard/listPods visit required.
    expect((await svc.getPod("u", rec.id)).status).toBe("running");
    expect((await store.get(rec.id))?.status).toBe("running"); // persisted
  });

  it("destroy tears down and removes the record", async () => {
    await svc.destroy("u", rec.id);
    expect(provider.destroyed).toContain(rec.id);
    expect(await store.get(rec.id)).toBeNull();
  });

  it("keepAwake is persisted to provider and record (4.4)", async () => {
    const updated = await svc.setKeepAwake("u", rec.id, true);
    expect(updated.keepAwake).toBe(true);
    expect(provider.pods.get(rec.id)?.keepAwake).toBe(true);
  });
});

describe("idle policy (4.5)", () => {
  it("sleeps idle pods and skips keepAwake", async () => {
    const idle = await svc.launchPod("u", ENV);
    const keep = await svc.launchPod("u", ENV);
    await svc.provisionPending(); // build both so they're running (idle-sleepable)
    // Make both look idle.
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await store.update(idle.id, { lastActiveAt: old });
    await store.update(keep.id, { lastActiveAt: old });
    await svc.setKeepAwake("u", keep.id, true);

    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).toEqual([idle.id]);
    expect((await store.get(idle.id))?.status).toBe("suspended");
    expect((await store.get(keep.id))?.status).toBe("running");
  });

  it("does not sleep recently-active pods", async () => {
    await svc.launchPod("u", ENV);
    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).toHaveLength(0);
  });

  it("never idle-sleeps a self-host `local` pod (go-forward, like incus)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    // Long idle by the gateway clock, but a self-host Docker pod must not auto-suspend.
    await store.update(rec.id, {
      provider: "local",
      lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).not.toContain(rec.id);
    expect((await store.get(rec.id))?.status).toBe("running");
  });

  it("does NOT sleep a pod the agent is actively working on (remote control)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    // Stale by the gateway clock (no client connected) …
    await store.update(rec.id, { lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    // … but the agent produced output 30s ago (working via the Claude app).
    provider.agentIdle.set(rec.id, 30_000);

    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).toHaveLength(0);
    expect((await store.get(rec.id))?.status).toBe("running");
    // The clock was bumped to the agent's real last activity, so it stays awake.
    expect(Date.now() - Date.parse((await store.get(rec.id))!.lastActiveAt)).toBeLessThan(60_000);
  });

  it("sleeps a stale pod once the agent is also idle", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await store.update(rec.id, { lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    provider.agentIdle.set(rec.id, 60 * 60 * 1000); // agent idle an hour too
    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).toEqual([rec.id]);
  });

  // The 5-hour cost leak, measured live 2026-07-17: a session parked at `waiting`
  // repaints every ~15–32s, so the OUTPUT clock never expires — but the agent is
  // not working, it's waiting on the human. Claude's own status is the truth.
  it("sleeps a pod parked at `waiting` even though its terminal keeps repainting", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await store.update(rec.id, { lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    provider.agentState.set(rec.id, "waiting"); // not working — waiting on the user
    provider.agentIdle.set(rec.id, 3_000); // TUI repainted 3s ago (the old signal lied)

    const slept = await svc.sleepIdlePods(30 * 60 * 1000);
    expect(slept).toEqual([rec.id]);
    expect((await store.get(rec.id))?.status).toBe("suspended");
  });

  it("does NOT sleep a `busy` agent, nor one running a foreground tool (`shell`)", async () => {
    for (const state of ["busy", "shell"]) {
      const rec = await svc.launchPod("u", ENV);
      await svc.provisionPending();
      await store.update(rec.id, {
        lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });
      provider.agentState.set(rec.id, state);
      // A long SILENT tool call: no output for an hour — the old signal would
      // have suspended it mid-work. Status is the truth.
      provider.agentIdle.set(rec.id, 60 * 60 * 1000);

      const slept = await svc.sleepIdlePods(30 * 60 * 1000);
      expect(slept, `state=${state}`).not.toContain(rec.id);
      expect((await store.get(rec.id))?.status, `state=${state}`).toBe("running");
    }
  });
});

describe("reconcile (4.6)", () => {
  it("updates a stale record from provider truth", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    provider.forceStatus(rec.id, "suspended"); // out-of-band change
    const reconciled = await svc.reconcile(rec.id);
    expect(reconciled.status).toBe("suspended");
    expect((await store.get(rec.id))?.status).toBe("suspended");
  });

  it("throws not-found for an unknown pod", async () => {
    await expect(svc.reconcile("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  // Pods created before machineId/imageDigest existed carry null in both, which
  // strands them: no update can be offered (null digest) and re-provision can't
  // adopt their machine (null id). Any reconcile must heal them from provider truth.
  it("backfills null machineId/imageDigest on a legacy row from provider truth", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    // Simulate the legacy shape: authoritative identity never got persisted.
    await store.update(rec.id, { machineId: null, imageDigest: null });

    const reconciled = await svc.reconcile(rec.id);

    expect(reconciled.machineId).toBeTruthy();
    expect(reconciled.imageDigest).toBe("sha256:test");
    const persisted = await store.get(rec.id);
    expect(persisted?.machineId).toBe(reconciled.machineId);
    expect(persisted?.imageDigest).toBe("sha256:test");
  });

  it("does not overwrite an existing digest (only fills nulls)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await store.update(rec.id, { imageDigest: "sha256:pinned-by-update" });

    const reconciled = await svc.reconcile(rec.id);

    expect(reconciled.imageDigest).toBe("sha256:pinned-by-update");
  });
});

describe("lifecycle events (backoffice log)", () => {
  let store: InMemoryPodStore;
  let provider: MockProvider;
  let svc: PodService;

  beforeEach(() => {
    store = new InMemoryPodStore();
    provider = new MockProvider();
    svc = new PodService(provider, store, { environmentsRoot });
  });

  it("emits created → running → sleeping, and derives usage from them", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await svc.sleep("u", rec.id);

    const events = await store.listEvents(rec.id);
    expect(events.map((e) => e.type)).toEqual(["created", "running", "suspended"]);
    expect(events.every((e) => e.ownerId === "u")).toBe(true);

    const usage = usageForPod(events);
    expect(usage?.suspends).toBe(1);
  });

  it("emits a reconcile-detected change — the out-of-band catcher", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    // Something outside our API suspended the machine (Fly, a crash, a human).
    provider.forceStatus(rec.id, "suspended");
    await svc.reconcile(rec.id);

    const types = (await store.listEvents(rec.id)).map((e) => e.type);
    expect(types).toContain("suspended"); // we never called sleep() — reconcile saw it
  });

  it("keeps history after the pod row is deleted (cost must stay attributable)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await svc.destroy("u", rec.id);

    expect(await store.get(rec.id)).toBeNull(); // pod row gone
    const events = await store.listEvents(rec.id);
    expect(events.map((e) => e.type)).toContain("destroyed"); // history survives
    expect(usageForPod(events)?.destroyed).toBe(true);
  });
});

describe("pod image update (P2.5)", () => {
  let store: InMemoryPodStore;
  let provider: MockProvider;
  let svc: PodService;
  const NEW_IMAGE = "registry.fly.io/podbay-pods:pod-base@sha256:newdigest";

  beforeEach(() => {
    store = new InMemoryPodStore();
    provider = new MockProvider();
    svc = new PodService(provider, store, { environmentsRoot });
  });

  // The image update now STARTS and returns (the recreate runs detached so a
  // server action can't freeze the dashboard). For deterministic assertions,
  // start it then wait for the event-log progress to go inactive.
  async function runUpdate(owner: string, id: string, image: string): Promise<void> {
    await svc.startPodImageUpdate(owner, id, image);
    for (let i = 0; i < 100; i++) {
      if (!(await svc.podUpdateProgress(owner, id)).active) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("update did not finish");
  }

  it("marks the pod updating ON THE ROW so the state is durable (not client-only)", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    expect((await store.get(rec.id))?.updatingSince).toBeNull();

    // Hold the update mid-flight so we can observe the row DURING it.
    let release: () => void = () => {};
    provider.updateImageGate = new Promise<void>((r) => (release = r));
    const done = svc.startPodImageUpdate("u", rec.id, NEW_IMAGE);

    // While in flight: the ROW says updating (any surface re-reading it — the pods
    // list, a re-entered cockpit — sees it; nothing is client-only).
    await new Promise((r) => setTimeout(r, 5));
    const mid = await store.get(rec.id);
    expect(mid?.updatingSince).toBeTruthy();
    const prog = await svc.podUpdateProgress("u", rec.id);
    expect(prog.active).toBe(true);
    expect(prog.startedAt).toBe(mid?.updatingSince);

    release();
    await done;
    for (let i = 0; i < 100 && (await store.get(rec.id))?.updatingSince; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // After it finishes the flag is cleared and the row is authoritative again.
    const after = await store.get(rec.id);
    expect(after?.updatingSince).toBeNull();
    expect(after?.updateStage).toBeNull();
    expect(after?.imageDigest).toBe("sha256:newdigest");
    expect((await svc.podUpdateProgress("u", rec.id)).active).toBe(false);
  });

  it("swaps the image in place, records the digest, and emits from→to", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    expect((await store.get(rec.id))?.imageDigest).toBe("sha256:test");

    await runUpdate("u", rec.id, NEW_IMAGE);

    expect(provider.updatedImages).toEqual([{ id: rec.id, image: NEW_IMAGE }]);
    expect(provider.destroyed).not.toContain(rec.id); // in place — NOT recreated
    expect((await store.get(rec.id))?.imageDigest).toBe("sha256:newdigest");

    // from→to is the rollback target + failure detector.
    const updated = (await store.listEvents(rec.id)).filter((e) => e.type === "updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].meta).toMatchObject({ from: "sha256:test", to: "sha256:newdigest" });
  });

  it("clears the stale session URL — the restart mints a new bridge session", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await svc.recordSessionUrl("u", rec.id, "https://claude.ai/code/session_OLD");

    await runUpdate("u", rec.id, NEW_IMAGE);
    // Serving the old link would open a session that no longer exists.
    expect((await store.get(rec.id))?.sessionUrl).toBeNull();
  });

  it("is owner-scoped", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    await expect(svc.startPodImageUpdate("someone-else", rec.id, NEW_IMAGE)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(provider.updatedImages).toHaveLength(0);
  });

  it("delivers the FRESHLY-resolved env .claude layer with the update (seed-on-update)", async () => {
    // Before this, an update refreshed only the image: the recreate wiped
    // /etc/podbay/claude and the volume's seed marker skipped a re-seed, so a
    // skill shipped after pod-creation never reached existing pods (live find
    // 2026-07-28). The update path must resolve the env NOW and hand the layer
    // to the provider.
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();

    await runUpdate("u", rec.id, NEW_IMAGE);

    expect(provider.updateClaudeFiles).toHaveLength(1);
    const delivered = provider.updateClaudeFiles[0].paths;
    // every delivered file is claude-layer only, from the CURRENT resolution
    expect(delivered.length).toBeGreaterThan(0);
    for (const p of delivered) expect(p.startsWith("/etc/podbay/claude/")).toBe(true);
    // the universal layer rides along (the class of file this fix exists for)
    expect(delivered.some((p) => p.includes("resume-from-handoff"))).toBe(true);
  });

  it("hands the provider the FRESHLY-resolved permissions so a preset fix propagates on update", async () => {
    // The spec is preserved verbatim across a recreate, which froze the preset a pod was
    // created with — the 2026-08-01 git-push-prompt removal never reached existing pods.
    // The update must resolve the env NOW and pass current permissions to updateImage
    // (the provider merges them into the preserved spec).
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();

    await runUpdate("u", rec.id, NEW_IMAGE);

    expect(provider.updatePermissions).toHaveLength(1);
    const perms = provider.updatePermissions[0] as { preset: string; rules: { ask: string[] } };
    expect(perms?.rules).toBeDefined();
    // the CURRENT guarded-open preset: no git-push prompt (proves it re-resolved, not frozen)
    expect(perms.rules.ask).toEqual([]);
  });

  it("a missing/renamed env does NOT fail the image update — the pod just keeps its layer", async () => {
    const rec = await svc.launchPod("u", ENV);
    await svc.provisionPending();
    // simulate the env being renamed out from under the live pod
    await store.update(rec.id, { environmentName: "no-such-env-anymore" });

    await runUpdate("u", rec.id, NEW_IMAGE); // must complete, not throw

    expect(provider.updatedImages).toHaveLength(1); // update itself happened
    expect(provider.updateClaudeFiles[0]?.paths ?? []).toHaveLength(0); // no layer, no crash
  });
});
