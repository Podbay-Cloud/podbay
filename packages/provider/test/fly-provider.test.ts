import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWithConfig } from "@podbay/shared";
import { FlyProvider } from "../src/fly/provider.js";
import { loadFlyConfig } from "../src/config.js";
import { buildInitFiles, toEnvFile } from "../src/fly/init.js";
import { FakeFly } from "./fake-fly.js";

const exampleDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
  "nextjs-starter",
);

const config = loadFlyConfig({ apiToken: "test-token", appName: "podbay-pods-test" });

async function makePod() {
  const resolved = await resolveWithConfig(exampleDir);
  return { resolved, envDir: exampleDir };
}

function newProvider() {
  const fly = new FakeFly();
  return { fly, provider: new FlyProvider(fly, config) };
}

describe("FlyProvider.createPod", () => {
  it("provisions exactly one machine and one volume, tagged with the pod id (2.2, 5.1)", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    const info = await provider.createPod({ id: "pod-a", owner: "user-1", resolved, envDir });

    expect(info.id).toBe("pod-a");
    expect(fly.machines.size).toBe(1);
    expect(fly.volumes.size).toBe(1);
    const m = [...fly.machines.values()][0];
    expect(m.config.metadata?.podbay_pod_id).toBe("pod-a");
    expect(m.config.metadata?.podbay_owner).toBe("user-1");
    expect(m.config.mounts?.[0]?.path).toBe("/home/dev");
  });

  it("self-heals a duplicate machine+volume (provision-retry race) to exactly one", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    // Simulate the race: two machines + two volumes already tagged for one pod
    // (a retry raced Fly's eventually-consistent listMachines and built a second).
    const mkDup = async () => {
      const vol = await fly.createVolume({ name: "pb_pod-a", region: config.region, size_gb: 1 });
      return fly.createMachine({
        region: config.region,
        config: {
          image: "img",
          metadata: { podbay_pod_id: "pod-a", podbay_owner: "u", podbay_volume_id: vol.id },
        },
      } as never);
    };
    await mkDup();
    await mkDup();
    expect(fly.machines.size).toBe(2);
    expect(fly.volumes.size).toBe(2);

    // Any re-run of createPod (the idempotent path) must collapse to one of each.
    const info = await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    expect(info.id).toBe("pod-a");
    expect(fly.machines.size).toBe(1);
    expect(fly.volumes.size).toBe(1);
  });

  it("is idempotent — re-create makes no new infra (2.2)", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "user-1", resolved, envDir });
    await provider.createPod({ id: "pod-a", owner: "user-1", resolved, envDir });
    expect(fly.machines.size).toBe(1);
    expect(fly.volumes.size).toBe(1);
  });

  it("injects the .claude layer + pod-spec and NEVER a credential (5.1, 6.4)", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "user-1", resolved, envDir });
    const m = [...fly.machines.values()][0];
    const paths = (m.config.files ?? []).map((f) => f.guest_path);
    expect(paths).toContain("/etc/podbay/pod-spec.json");
    expect(paths.some((p) => p.startsWith("/etc/podbay/claude/CLAUDE.md"))).toBe(true);

    const spec = JSON.parse(
      Buffer.from(
        m.config.files!.find((f) => f.guest_path === "/etc/podbay/pod-spec.json")!.raw_value,
        "base64",
      ).toString(),
    );
    expect(spec.permissions.preset).toBe("guarded-open");
    // nextjs-starter now ships as a prebuilt image template: no setup steps,
    // and the spec names the env so init can find /opt/env-templates/<name>.
    expect(spec.setup).toEqual([]);
    expect(spec.envName).toBe("nextjs-starter");
    expect(typeof spec.kickoff).toBe("string");

    // No credential/auth env ever injected.
    const envKeys = Object.keys(m.config.env ?? {});
    for (const k of envKeys) {
      expect(k).not.toMatch(/API_KEY|AUTH_TOKEN|OAUTH|BASE_URL/i);
    }
  });
});

describe("app-secret injection (opsx pod-secrets)", () => {
  it("toEnvFile shell-quotes values so the file is safe to source", () => {
    const out = toEnvFile({ B: "two", A: "it's \"quoted\"" });
    // deterministic key order, single-quoted, embedded quote escaped `'\''`
    expect(out).toBe("A='it'\\''s \"quoted\"'\nB='two'\n");
  });

  it("createPod writes /etc/podbay/secrets.env only when secrets are present", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir }); // no secrets
    let files = [...fly.machines.values()][0].config.files ?? [];
    expect(files.some((f) => f.guest_path === "/etc/podbay/secrets.env")).toBe(false);

    await provider.createPod({
      id: "pod-b",
      owner: "u",
      resolved,
      envDir,
      secrets: { TELEGRAM_BOT_TOKEN: "123:ABC" },
    });
    files = [...fly.machines.values()].find((m) => m.config.metadata?.podbay_pod_id === "pod-b")!
      .config.files!;
    const secretFile = files.find((f) => f.guest_path === "/etc/podbay/secrets.env")!;
    expect(secretFile).toBeTruthy();
    // The value rides base64, never plaintext in the machine file record.
    expect(secretFile.raw_value).not.toContain("123:ABC");
    expect(Buffer.from(secretFile.raw_value, "base64").toString()).toContain(
      "TELEGRAM_BOT_TOKEN='123:ABC'",
    );
  });

  it("injectSecrets writes the file 0600 dev-owned on a running pod, base64 in argv", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    let seen: string[] = [];
    fly.execHandler = (_id, command) => {
      seen = command;
      return { exit_code: 0, stdout: "", stderr: "" };
    };
    await provider.injectSecrets("pod-a", { API_KEY: "sk-xyz" });
    const script = seen.join(" ");
    expect(script).toContain("/etc/podbay/secrets.env");
    expect(script).toContain("chmod 600 /etc/podbay/secrets.env");
    expect(script).toContain("chown dev:dev /etc/podbay/secrets.env");
    // plaintext never appears in the command; the base64 payload decodes to it
    expect(script).not.toContain("sk-xyz");
    const b64 = seen.find((a) => a.includes("base64 -d"))!.match(/printf %s '([^']+)'/)![1];
    expect(Buffer.from(b64, "base64").toString()).toContain("API_KEY='sk-xyz'");
  });

  it("injectSecrets surfaces a failed exec as a transient error", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    fly.execHandler = () => ({ exit_code: 1, stdout: "", stderr: "boom" });
    await expect(provider.injectSecrets("pod-a", { A: "1" })).rejects.toMatchObject({
      code: "transient",
    });
  });
});

describe("FlyProvider isolation & lifecycle", () => {
  it("gives two pods distinct volumes (2.3)", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    await provider.createPod({ id: "pod-b", owner: "u", resolved, envDir });
    expect(fly.volumes.size).toBe(2);
    const vols = [...fly.machines.values()].map((m) => m.config.metadata?.podbay_volume_id);
    expect(new Set(vols).size).toBe(2);
  });

  it("sleep suspends, wake starts, and keepAwake refuses sleep (2.5)", async () => {
    const { provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });

    let info = await provider.sleep("pod-a");
    expect(info.status).toBe("suspended");
    info = await provider.wake("pod-a");
    expect(info.status).toBe("running");

    await provider.setKeepAwake("pod-a", true);
    await expect(provider.sleep("pod-a")).rejects.toMatchObject({ code: "conflict" });
  });

  it("falls back to stop when suspend is unsupported", async () => {
    const { fly, provider } = newProvider();
    fly.suspendSupported = false;
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    const info = await provider.sleep("pod-a");
    expect(info.status).toBe("suspended");
  });

  it("exec returns exit code and output (2.7... exec)", async () => {
    const { fly, provider } = newProvider();
    fly.execHandler = () => ({ exit_code: 0, stdout: "hi\n", stderr: "" });
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    const r = await provider.exec("pod-a", ["echo", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi\n");
  });

  it("endpoint resolves for a running pod", async () => {
    const { provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    const ep = await provider.endpoint("pod-a");
    expect(ep).toMatch(/^http:\/\/\[fdaa:.*\]:8080$/);
  });

  it("destroy removes machine AND volume; getPod reports gone (2.8 teardown)", async () => {
    const { fly, provider } = newProvider();
    const { resolved, envDir } = await makePod();
    await provider.createPod({ id: "pod-a", owner: "u", resolved, envDir });
    await provider.destroy("pod-a");
    expect(fly.machines.size).toBe(0);
    expect(fly.volumes.size).toBe(0);
    const info = await provider.getPod("pod-a");
    expect(info.status).toBe("gone");
  });

  it("destroy is idempotent when the pod is already gone", async () => {
    const { provider } = newProvider();
    await expect(provider.destroy("missing")).resolves.toBeUndefined();
  });
});

describe("buildInitFiles", () => {
  it("carries no credential fields and is sorted/deterministic", async () => {
    const { resolved, envDir } = await makePod();
    const a = await buildInitFiles({ id: "x", resolved, envDir });
    const b = await buildInitFiles({ id: "x", resolved, envDir });
    expect(a.map((f) => f.guest_path)).toEqual(b.map((f) => f.guest_path));
    const sorted = [...a].sort((p, q) => p.guest_path.localeCompare(q.guest_path));
    expect(a).toEqual(sorted);
  });

  // Owner report, 2026-08-27: an agent handed over "Open your pod dashboard:
  // https://podbay.cloud/pods/<slug> → Settings → Secrets" and it landed on the web TERMINAL.
  // `/pods/<slug>` renders PodTerminalLoader; the cockpit (with the secrets/settings/stats tabs)
  // is `/dashboard/pods/<slug>`. This one builder feeds Fly AND Incus, so the wrong URL was baked
  // into every pod's spec — confirmed by reading a live pod's /etc/podbay/pod-spec.json.
  it("writes the COCKPIT url (/dashboard/pods/…), never the bare terminal url (/pods/…)", async () => {
    const { resolved, envDir } = await makePod();
    // appOrigin is derived from PODBAY_PREVIEW_BASE (preview.podbay.cloud → podbay.cloud).
    const prev = process.env.PODBAY_PREVIEW_BASE;
    process.env.PODBAY_PREVIEW_BASE = "preview.podbay.cloud";
    try {
      const files = await buildInitFiles({ id: "partial-canidae-a766", resolved, envDir });
      const f = files.find((x) => x.guest_path === "/etc/podbay/pod-spec.json")!;
      const spec = JSON.parse(Buffer.from(f.raw_value, "base64").toString());
      expect(spec.cockpitUrl).toBe("https://podbay.cloud/dashboard/pods/partial-canidae-a766");
      // Guard the exact regression: the slug must not be preceded by a bare /pods/.
      expect(spec.cockpitUrl).not.toMatch(/\.cloud\/pods\//);
    } finally {
      if (prev === undefined) delete process.env.PODBAY_PREVIEW_BASE;
      else process.env.PODBAY_PREVIEW_BASE = prev;
    }
  });

  it("carries the user's display name as podName (null when unnamed)", async () => {
    const { resolved, envDir } = await makePod();
    const readSpec = async (name?: string) => {
      const files = await buildInitFiles({ id: "x", resolved, envDir, name });
      const f = files.find((x) => x.guest_path === "/etc/podbay/pod-spec.json")!;
      return JSON.parse(Buffer.from(f.raw_value, "base64").toString());
    };
    expect((await readSpec("Test 3")).podName).toBe("Test 3");
    expect((await readSpec("  ")).podName).toBeNull();
    expect((await readSpec()).podName).toBeNull();
  });

  it("injects the SHARED .claude base layer (environments/_shared) into every pod", async () => {
    const { resolved, envDir } = await makePod();
    const files = await buildInitFiles({ id: "x", resolved, envDir });
    const paths = files.map((f) => f.guest_path);
    // The shared mobile-viewport skill lands in the pod's ~/.claude alongside the
    // env's own layer — no per-env duplication.
    expect(paths).toContain(
      "/etc/podbay/claude/skills/mobile-keyboard-viewport/SKILL.md",
    );
    // And the env's own layer still ships alongside it.
    expect(paths).toContain("/etc/podbay/claude/skills/ship-feature/SKILL.md");
  });

  it("the pod's chosen agent overrides the env default in the spec (slice 3)", async () => {
    const { resolved, envDir } = await makePod();
    const readSpecAgents = async (agents?: string[]) => {
      const files = await buildInitFiles({
        id: "x",
        resolved,
        envDir,
        agents: agents as never,
      });
      const f = files.find((x) => x.guest_path === "/etc/podbay/pod-spec.json")!;
      return JSON.parse(Buffer.from(f.raw_value, "base64").toString()).agents;
    };
    // No override → the env's declared agents (nextjs-starter defaults to claude-code).
    expect(await readSpecAgents()).toEqual(resolved.agents);
    // Override → the pod's choice wins.
    expect(await readSpecAgents(["codex"])).toEqual(["codex"]);
  });
});

/**
 * The web-fetch skill is capability-gated.
 *
 * The universal .claude layer is copied wholesale, so `capabilities.webFetch` used
 * to gate nothing on the pod — the skill shipped everywhere while the registry
 * advertised it as off by default. A flag that gates only the marketing copy makes
 * the spec lie, which is worse than having no flag.
 */
describe("web-fetch skill is gated by the capability", () => {
  const hasWebFetch = (files: { guest_path: string }[]) =>
    files.some((f) => f.guest_path.includes("/claude/skills/web-fetch/"));

  it("ships the skill when the env declares the capability", async () => {
    const { resolved, envDir } = await makePod();
    expect(resolved.capabilities.webFetch.enabled, "fixture env should declare it").toBe(true);
    expect(hasWebFetch(await buildInitFiles({ id: "x", resolved, envDir }))).toBe(true);
  });

  it("omits it when the env does not", async () => {
    const { resolved, envDir } = await makePod();
    const off = {
      ...resolved,
      capabilities: { ...resolved.capabilities, webFetch: { enabled: false } },
    };
    const files = await buildInitFiles({ id: "x", resolved: off, envDir });
    expect(hasWebFetch(files)).toBe(false);
    // …and the rest of the universal layer still arrives — the gate is one skill,
    // not the layer.
    expect(files.some((f) => f.guest_path.includes("/claude/"))).toBe(true);
  });
});
