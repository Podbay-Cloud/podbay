import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWithConfig, type ResolvedPod } from "@podbay/shared";
import { IncusProvider, refreshSpecPermissions, type IncusConfig } from "../src/incus/provider.js";
import type { IncusApi, IncusInstance } from "../src/incus/http-client.js";

const exampleDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
  "nextjs-starter",
);

/**
 * IncusProvider against a scripted fake IncusApi (M1 prep — the REST client
 * itself gets verified on the real box in M0; these tests lock the provider's
 * SEMANTICS: idempotent create, upgrade-keeps-volume, destroy ordering).
 */

const CONFIG: IncusConfig = {
  pool: "podbay",
  imageAlias: "pod-base",
  imageDigest: "sha256:testimage",
  region: "hetzner-fsn1",
  agentPort: 8080,
  cpus: 2,
  memoryGb: 4,
  homeVolumeGb: 10,
};

let RESOLVED: ResolvedPod;
// A real resolved environment (same fixture the Fly tests use) — buildInitFiles
// reads deep into it (lifecycle.default, preview, agents…), so no stub survives.
RESOLVED = await resolveWithConfig(exampleDir);

function fakeIncus() {
  let refuseGracefulStop = false;
  const instances = new Map<string, IncusInstance>();
  const volumes = new Set<string>();
  const calls: string[] = [];
  const pushed: { path: string; instance: string }[] = [];

  const api = {
    async createInstance(spec: {
      name: string;
      imageAlias: string;
      config: Record<string, string>;
      devices: Record<string, Record<string, string>>;
    }) {
      calls.push(`create:${spec.name}:${spec.imageAlias}`);
      if (instances.has(spec.name)) throw new Error("already exists");
      instances.set(spec.name, {
        name: spec.name,
        status: "Stopped",
        status_code: 102,
        config: spec.config,
        devices: spec.devices,
      });
    },
    async getInstance(name: string) {
      return instances.get(name) ?? null;
    },
    async listInstances() {
      return [...instances.values()];
    },
    async instanceState(name: string) {
      const i = instances.get(name);
      if (!i) return null;
      return {
        status: i.status,
        network: i.status === "Running"
          ? { enp5s0: { addresses: [{ family: "inet", address: "10.200.0.5", scope: "global" }] } }
          : {},
      };
    },
    async setState(
      name: string,
      action: "start" | "stop" | "restart",
      opts?: { stateful?: boolean; force?: boolean },
    ) {
      calls.push(
        `state:${name}:${action}${opts?.stateful ? ":stateful" : ""}${opts?.force ? ":force" : ""}`,
      );
      // Lets a test model a guest that will not shut down politely.
      if (action === "stop" && !opts?.force && refuseGracefulStop) throw new Error("stop timed out");
      const i = instances.get(name);
      if (!i) throw new Error("no instance");
      i.status = action === "start" ? "Running" : "Stopped";
    },
    async deleteInstance(name: string) {
      calls.push(`delete-instance:${name}`);
      instances.delete(name);
    },
    async patchInstance(name: string, patch: { config?: Record<string, string> }) {
      const i = instances.get(name)!;
      Object.assign(i.config, patch.config ?? {});
    },
    async pushFile(instance: string, guestPath: string) {
      pushed.push({ instance, path: guestPath });
      calls.push(`push:${guestPath}`);
    },
    async exec(_id: string, command: string[]) {
      calls.push(`exec:${command.join(" ")}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async createVolume(_pool: string, name: string) {
      calls.push(`create-volume:${name}`);
      volumes.add(name);
    },
    async getVolume(_pool: string, name: string) {
      return volumes.has(name) ? { name } : null;
    },
    async deleteVolume(_pool: string, name: string) {
      calls.push(`delete-volume:${name}`);
      volumes.delete(name);
    },
    async snapshotVolume(_pool: string, volume: string, snap: string) {
      calls.push(`snap:${volume}:${snap}`);
    },
    async resizeVolume(_pool: string, volume: string, sizeGb: number) {
      calls.push(`resize-volume:${volume}:${sizeGb}`);
    },
  } as unknown as IncusApi;

  return {
    api,
    instances,
    volumes,
    calls,
    pushed,
    refuseGracefulStop: (v: boolean) => {
      refuseGracefulStop = v;
    },
  };
}

const input = (id: string) => ({ id, owner: "u1", resolved: RESOLVED });

/** Build a provider whose post-restart health poll resolves instantly — unit
 * tests have no real pod to curl, so agentReady() must be stubbed or the
 * createPod health-wait would time out. */
function mkProvider(f: ReturnType<typeof fakeIncus>): IncusProvider {
  const prov = new IncusProvider(f.api, CONFIG);
  (prov as unknown as { agentReady: () => Promise<boolean> }).agentReady = async () => true;
  return prov;
}

describe("IncusProvider", () => {
  it("creates volume + instance, pushes init files, starts", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);

    const created: string[] = [];
    const info = await p.createPod({ ...input("pod-a"), onMachineCreated: async (m) => void created.push(m) });

    expect(info.status).toBe("running");
    expect(f.volumes.has("pod-a-home")).toBe(true);
    expect(created).toEqual(["pod-a"]); // machineId == instance name
    expect(f.pushed.some((x) => x.path === "/etc/podbay/pod-spec.json")).toBe(true);
    expect(f.calls).toContain("state:pod-a:start");
  });

  it("injects init files AFTER the VM is running, then reloads the agent", async () => {
    // The whole bug: Incus drops file pushes to a STOPPED VM, so the pod-spec must
    // land AFTER start (guest agent up), and the agent must be reloaded to read it.
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));

    const started = f.calls.indexOf("state:pod-a:start");
    const firstPush = f.calls.findIndex((c) => c.startsWith("push:"));
    expect(started).toBeGreaterThanOrEqual(0);
    expect(firstPush).toBeGreaterThan(started); // push strictly after start
    expect(f.calls).toContain("exec:systemctl restart podbay-agent");
    expect(f.instances.get("pod-a")!.config["user.podbay.configured"]).toBe("true");
  });

  it("clears a boot-time seed marker after pushing, BEFORE reloading the agent", async () => {
    // init.sh runs once at boot — before the pushes above exist. Older base images
    // wrote ~/.podbay-seeded on that empty pass, so the reload said "already seeded"
    // and the env's .claude layer (skills + rules) never landed: the byo-project
    // dogfood agent reported /codebase-onboarding "not registered" (2026-07-23).
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));

    const lastPush = f.calls.map((c) => c.startsWith("push:")).lastIndexOf(true);
    const cleared = f.calls.indexOf("exec:rm -f /home/dev/.podbay-seeded");
    const reload = f.calls.indexOf("exec:systemctl restart podbay-agent");
    expect(cleared).toBeGreaterThan(lastPush); // marker dropped after the files land
    expect(reload).toBeGreaterThan(cleared); // …and before init.sh re-runs
  });

  it("createPod is idempotent — a retry adopts, never builds a second machine or reconfigures", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));
    const createsBefore = f.calls.filter((c) => c.startsWith("create:")).length;
    const pushesBefore = f.calls.filter((c) => c.startsWith("push:")).length;

    await p.createPod(input("pod-a")); // the retry

    expect(f.calls.filter((c) => c.startsWith("create:")).length).toBe(createsBefore); // no new create
    expect(f.calls.filter((c) => c.startsWith("push:")).length).toBe(pushesBefore); // no re-push (marker)
    expect(f.instances.size).toBe(1);
  });

  it("sleep is a PLAIN stop (suspend verb; data on the volume persists) and wake cold-boots", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));

    const slept = await p.sleep("pod-a");
    expect(slept.status).toBe("suspended");
    // NOT stateful — a filesystem home volume is incompatible with stateful stop
    // (verified on the box), and cold-restore + `claude --continue` is the model.
    expect(f.calls).toContain("state:pod-a:stop");
    expect(f.calls).not.toContain("state:pod-a:stop:stateful");

    const woke = await p.wake("pod-a");
    expect(woke.status).toBe("running");
  });

  it("updateImage recreates the instance but NEVER touches the home volume", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));

    const info = await p.updateImage("pod-a", "pod-base-v2");

    expect(f.calls).toContain("delete-instance:pod-a");
    expect(f.calls).toContain("create:pod-a:pod-base-v2");
    expect(f.calls.filter((c) => c.startsWith("delete-volume:"))).toEqual([]); // volume untouched
    expect(f.volumes.has("pod-a-home")).toBe(true);
    expect(info.status).toBe("running"); // was running → restarted
    // keepAwake + owner survive the recreation
    expect(f.instances.get("pod-a")!.config["user.podbay.owner"]).toBe("u1");
  });

  it("updateImage delivers the CURRENT .claude layer and clears the seed marker", async () => {
    // The recreate wipes /etc/podbay/claude (ephemeral rootfs) while the home volume
    // keeps ~/.podbay-seeded — so before this behavior, an update NEVER refreshed
    // skills/rules and a skill shipped after pod-creation was unreachable by update
    // (found live 2026-07-28). The provider must push the fresh layer, clear the
    // marker, and restart the agent so init.sh re-seeds.
    const f = fakeIncus();
    // preservedSpec is read via `cat pod-spec.json` — return one so the re-push
    // branch (where the layer delivery lives) actually runs.
    const origExec = f.api.exec.bind(f.api);
    f.api.exec = async (id: string, command: string[]) => {
      if (command.join(" ").includes("cat /etc/podbay/pod-spec.json")) {
        f.calls.push("exec:cat-spec");
        return { exitCode: 0, stdout: '{"podId":"pod-a"}', stderr: "" };
      }
      return origExec(id, command);
    };
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));
    f.pushed.length = 0; // only count update-time pushes

    await p.updateImage("pod-a", "pod-base-v2", undefined, {
      claudeFiles: [
        {
          guest_path: "/etc/podbay/claude/skills/handoff/SKILL.md",
          raw_value: Buffer.from("skill").toString("base64"),
        },
        {
          guest_path: "/etc/podbay/claude/rules/resume-from-handoff.md",
          raw_value: Buffer.from("rule").toString("base64"),
        },
      ],
    });

    const updatePushes = f.pushed.map((x) => x.path);
    expect(updatePushes).toContain("/etc/podbay/pod-spec.json");
    expect(updatePushes).toContain("/etc/podbay/claude/skills/handoff/SKILL.md");
    expect(updatePushes).toContain("/etc/podbay/claude/rules/resume-from-handoff.md");
    // parent dirs are created (Incus push 404s into a missing dir)
    expect(f.calls.some((c) => c.startsWith("exec:mkdir -p /etc/podbay/claude/"))).toBe(true);
    // the volume's seed marker is cleared so init.sh re-seeds on the restart…
    const rmIdx = f.calls.indexOf("exec:rm -f /home/dev/.podbay-seeded");
    expect(rmIdx).toBeGreaterThan(-1);
    // …and the agent restart comes AFTER the marker clear (ordering is the fix)
    const restartIdx = f.calls.lastIndexOf("exec:systemctl restart podbay-agent");
    expect(restartIdx).toBeGreaterThan(rmIdx);
  });

  it("updateImage without claudeFiles behaves exactly as before (no layer push, no marker clear)", async () => {
    const f = fakeIncus();
    const origExec = f.api.exec.bind(f.api);
    f.api.exec = async (id: string, command: string[]) => {
      if (command.join(" ").includes("cat /etc/podbay/pod-spec.json")) {
        return { exitCode: 0, stdout: '{"podId":"pod-a"}', stderr: "" };
      }
      return origExec(id, command);
    };
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));
    const markerClearsBefore = f.calls.filter((c) => c.includes("rm -f /home/dev/.podbay-seeded")).length;
    f.pushed.length = 0; // only count update-time pushes

    await p.updateImage("pod-a", "pod-base-v2");

    const markerClearsAfter = f.calls.filter((c) => c.includes("rm -f /home/dev/.podbay-seeded")).length;
    expect(markerClearsAfter).toBe(markerClearsBefore); // createPod's clear only — update added none
    // only the preserved pod-spec is re-pushed; no claude-layer files
    expect(f.pushed.map((x) => x.path)).toEqual(["/etc/podbay/pod-spec.json"]);
  });

  it("destroy removes instance THEN volume; getPod on gone id reports gone", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));

    await p.destroy("pod-a");

    const iDel = f.calls.indexOf("delete-instance:pod-a");
    const vDel = f.calls.indexOf("delete-volume:pod-a-home");
    expect(iDel).toBeGreaterThanOrEqual(0);
    expect(vDel).toBeGreaterThan(iDel); // volume strictly after instance
    expect((await p.getPod("pod-a")).status).toBe("gone");
  });

  it("createPod honors a per-pod tier (limits + volume size) over the config defaults", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod({ ...input("pod-a"), resources: { cpus: 8, memoryGb: 16, diskGb: 40 } });
    expect(f.calls).toContain("create-volume:pod-a-home"); // (size asserted below)
    const inst = f.instances.get("pod-a")!;
    expect(inst.config["limits.cpu"]).toBe("8");
    expect(inst.config["limits.memory"]).toBe("16GiB");
  });

  it("resize suspends, patches CPU/RAM, grows the volume, then restarts a running pod", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a")); // ends Running

    const info = await p.resize("pod-a", { cpus: 8, memoryGb: 16, diskGb: 40 });

    expect(f.calls).toContain("state:pod-a:stop"); // brief suspend
    expect(f.calls).toContain("resize-volume:pod-a-home:40"); // grow-only disk
    expect(f.calls).toContain("state:pod-a:start"); // was running → back up
    const inst = f.instances.get("pod-a")!;
    expect(inst.config["limits.cpu"]).toBe("8");
    expect(inst.config["limits.memory"]).toBe("16GiB");
    expect(info.status).toBe("running");
  });

  it("podAddress resolves the bridge IPv4 for a running pod", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-a"));
    expect(await p.podAddress("pod-a", 3000)).toBe("http://10.200.0.5:3000");
  });

  it("updating a pod flushes and shuts the guest down CLEANLY, never power-cutting it", async () => {
    // An owner's pod came back from an update with 20 of 23 node_modules/.bin shims
    // at ZERO BYTES, timestamped minutes earlier (2026-07-29). Cause: the update
    // stopped the VM with force, which for a VM is a power cut — ext4 keeps the
    // metadata of recently written files and loses their data. We promise files
    // survive an update, so this path may not cut power while data is unflushed.
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-u"));
    f.calls.length = 0;

    await p.updateImage("pod-u", "pod-base", { resolved: RESOLVED, owner: "u1" });

    const stops = f.calls.filter((c) => c.startsWith("state:pod-u:stop"));
    expect(stops, "update must not force-stop a healthy pod").toEqual(["state:pod-u:stop"]);
    // …and the flush must come BEFORE the stop, or it protects nothing.
    expect(f.calls.indexOf("exec:sync")).toBeGreaterThanOrEqual(0);
    expect(f.calls.indexOf("exec:sync")).toBeLessThan(f.calls.indexOf("state:pod-u:stop"));
  });

  it("still stops a pod that refuses to shut down — after the flush", async () => {
    // A wedged guest must not block an update forever. Force stays as the FALLBACK,
    // by which point the sync has already narrowed the damage window.
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-w"));
    f.calls.length = 0;
    f.refuseGracefulStop(true);

    await p.updateImage("pod-w", "pod-base", { resolved: RESOLVED, owner: "u1" });

    expect(f.calls.filter((c) => c.startsWith("state:pod-w:stop"))).toEqual([
      "state:pod-w:stop",
      "state:pod-w:stop:force",
    ]);
  });

  it("resize stops cleanly too — it is the same power cut on the same volume", async () => {
    const f = fakeIncus();
    const p = mkProvider(f);
    await p.createPod(input("pod-r"));
    f.calls.length = 0;

    await p.resize("pod-r", { cpus: 4, memoryGb: 8, diskGb: 20 });

    expect(f.calls.filter((c) => c.startsWith("state:pod-r:stop"))).toEqual(["state:pod-r:stop"]);
  });
});
describe("refreshSpecPermissions", () => {
  const stale = JSON.stringify({
    slug: "dual-bear-fb14",
    envName: "byo-project",
    permissions: { preset: "guarded-open", mode: "acceptEdits", rules: { ask: ["Bash(git push*)"] } },
    other: { nodeModules: "/x", kickoff: "do stuff" },
  });
  const fresh = { preset: "guarded-open", mode: "acceptEdits", rules: { ask: [], deny: ["Bash(git push --force*)"] } };

  it("replaces ONLY permissions, preserving every other field", () => {
    const out = JSON.parse(refreshSpecPermissions(stale, fresh));
    expect(out.permissions.rules.ask).toEqual([]); // the frozen git-push prompt is gone
    expect(out.permissions.rules.deny).toContain("Bash(git push --force*)");
    expect(out.other).toEqual({ nodeModules: "/x", kickoff: "do stuff" }); // untouched
    expect(out.slug).toBe("dual-bear-fb14");
  });
  it("returns the spec unchanged when permissions is nullish (never break an update)", () => {
    expect(refreshSpecPermissions(stale, undefined)).toBe(stale);
    expect(refreshSpecPermissions(stale, null)).toBe(stale);
  });
  it("returns an unparseable spec unchanged", () => {
    expect(refreshSpecPermissions("{not json", fresh)).toBe("{not json");
  });

  // A dashboard rename updates the DB but the on-pod spec is preserved verbatim across an update, so
  // the greeter re-applied the STALE podName as the Claude-app session title on every fresh session —
  // reverting the user's rename after each update (owner report 2026-08-30). Refresh it from the DB.
  it("refreshes podName from the current pod record", () => {
    const named = JSON.stringify({ slug: "x", podName: "first10", other: 1 });
    const out = JSON.parse(refreshSpecPermissions(named, undefined, "podbay first10"));
    expect(out.podName).toBe("podbay first10");
    expect(out.other).toBe(1); // everything else preserved
  });
  it("leaves podName untouched when no name is passed (e.g. live config-refresh)", () => {
    const named = JSON.stringify({ podName: "first10" });
    expect(refreshSpecPermissions(named, undefined)).toBe(named); // unchanged
  });
  it("clears podName when the name is null (dashboard name removed → greeter falls back to slug)", () => {
    const named = JSON.stringify({ podName: "first10" });
    const out = JSON.parse(refreshSpecPermissions(named, undefined, null));
    expect(out.podName).toBeNull();
  });

  // buildInitFiles wrote `<origin>/pods/<slug>` — the bare web TERMINAL — as cockpitUrl for every
  // pod on every provider until 2026-08-27. Fixing the builder only helps NEW pods, because
  // updateImage preserves the spec verbatim (the very reason this function exists). Heal it here so
  // an existing pod picks up the right link on its next update.
  const withBadUrl = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      slug: "partial-canidae-a766",
      cockpitUrl: "https://podbay.cloud/pods/partial-canidae-a766",
      other: { kickoff: "do stuff" },
      ...extra,
    });

  it("heals a cockpitUrl that points at the terminal, preserving everything else", () => {
    const out = JSON.parse(refreshSpecPermissions(withBadUrl(), fresh));
    expect(out.cockpitUrl).toBe("https://podbay.cloud/dashboard/pods/partial-canidae-a766");
    expect(out.other).toEqual({ kickoff: "do stuff" });
    expect(out.slug).toBe("partial-canidae-a766");
  });

  it("heals the url even when permissions are nullish — the update is the only chance to fix it", () => {
    const out = JSON.parse(refreshSpecPermissions(withBadUrl(), undefined));
    expect(out.cockpitUrl).toBe("https://podbay.cloud/dashboard/pods/partial-canidae-a766");
  });

  it("leaves an ALREADY-correct cockpitUrl exactly as it is (no double-prefixing)", () => {
    const good = JSON.stringify({ cockpitUrl: "https://podbay.cloud/dashboard/pods/x" });
    expect(refreshSpecPermissions(good, undefined)).toBe(good);
    expect(JSON.parse(refreshSpecPermissions(good, fresh)).cockpitUrl).toBe(
      "https://podbay.cloud/dashboard/pods/x",
    );
  });

  it("does not touch an absent url, or a shape it does not recognise", () => {
    const noUrl = JSON.stringify({ slug: "x" });
    expect(refreshSpecPermissions(noUrl, undefined)).toBe(noUrl);
    // A deeper path is not the bug being fixed — never rewrite something we didn't produce.
    const deeper = JSON.stringify({ cockpitUrl: "https://podbay.cloud/pods/a/b/c" });
    expect(refreshSpecPermissions(deeper, undefined)).toBe(deeper);
  });
});
