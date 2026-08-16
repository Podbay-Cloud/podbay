import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEnvironment,
  resolve,
  resolveWithConfig,
  serializeResolved,
} from "../src/index.js";

const MINIMAL = `apiVersion: podbay/v0
name: hello-env
base:
  devcontainer: .devcontainer/devcontainer.json
`;

async function tmpEnv(yaml: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pbenv-"));
  await fs.writeFile(path.join(dir, "podbay.yaml"), yaml);
  return dir;
}

const exampleDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
  "nextjs-starter",
);

describe("validateEnvironment", () => {
  it("accepts a minimal valid environment (4.1)", () => {
    const r = validateEnvironment(MINIMAL);
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("hello-env");
  });

  it("accepts declared secrets (key/description/required)", () => {
    const r = validateEnvironment(
      MINIMAL + "secrets:\n  - key: TELEGRAM_BOT_TOKEN\n    description: BotFather token\n    required: true\n",
    );
    expect(r.ok).toBe(true);
    expect(r.value?.secrets?.[0]).toMatchObject({ key: "TELEGRAM_BOT_TOKEN", required: true });
  });

  it("rejects a secret key that isn't UPPER_SNAKE_CASE", () => {
    const r = validateEnvironment(MINIMAL + "secrets:\n  - key: bot-token\n");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/UPPER_SNAKE|secret/i);
  });

  it("rejects a missing required field, naming it (4.1)", () => {
    const r = validateEnvironment(`apiVersion: podbay/v0\nbase:\n  image: ubuntu:24.04\n`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("name");
  });

  it("rejects base with more than one source", () => {
    const r = validateEnvironment(
      `apiVersion: podbay/v0\nname: x\nbase:\n  image: ubuntu\n  dockerfile: ./Dockerfile\n`,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("exactly one");
  });

  it("rejects a credential / auth-override field with a ToS error (4.2)", () => {
    const withKey = validateEnvironment(
      `apiVersion: podbay/v0\nname: x\nbase:\n  image: ubuntu\nanthropic_api_key: sk-secret\n`,
    );
    expect(withKey.ok).toBe(false);
    expect(withKey.errors.join(" ").toLowerCase()).toContain("credentials or auth");

    const withEnvKey = validateEnvironment(
      `apiVersion: podbay/v0\nname: x\nbase:\n  image: ubuntu\nenv:\n  ANTHROPIC_API_KEY: sk-x\n`,
    );
    expect(withEnvKey.ok).toBe(false);
    expect(withEnvKey.errors.join(" ")).toContain("ANTHROPIC_API_KEY");
  });

  it("warns (not fails) on unknown top-level fields", () => {
    const r = validateEnvironment(MINIMAL + "surprise: 1\n");
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("surprise");
  });

  it("defaults capabilities.browserTesting to true (every current env ships a UI)", () => {
    const r = validateEnvironment(MINIMAL);
    expect(r.ok).toBe(true);
    expect(r.value?.capabilities.browserTesting).toBe(true);
  });

  it("lets a non-UI env opt out of browser testing", () => {
    const r = validateEnvironment(MINIMAL + "capabilities:\n  browserTesting: false\n");
    expect(r.ok).toBe(true);
    expect(r.value?.capabilities.browserTesting).toBe(false);
  });

  it("defaults capabilities.webFetch to OFF (a code env must not fetch the web unprompted)", () => {
    const r = validateEnvironment(MINIMAL);
    expect(r.ok).toBe(true);
    expect(r.value?.capabilities.webFetch.enabled).toBe(false);
    expect(r.value?.capabilities.webFetch.rungs).toBeUndefined();
  });

  it("preserves web-fetch capability through environment resolution", async () => {
    const dir = await tmpEnv(
      MINIMAL +
        "capabilities:\n  webFetch:\n    enabled: true\n    rungs: [api, direct, service]\n",
    );
    const resolved = await resolve(dir);
    expect(resolved.capabilities.webFetch).toEqual({
      enabled: true,
      rungs: ["api", "direct", "service"],
    });
  });

  it("a research env opts in, optionally RESTRICTING which rungs the ladder may use", () => {
    const r = validateEnvironment(
      MINIMAL + "capabilities:\n  webFetch:\n    enabled: true\n    rungs: [api, direct]\n",
    );
    expect(r.ok).toBe(true);
    expect(r.value?.capabilities.webFetch.enabled).toBe(true);
    // the restriction is a privacy control: no URL may reach a third-party reader
    expect(r.value?.capabilities.webFetch.rungs).toEqual(["api", "direct"]);
  });

  it("rejects an unknown rung name", () => {
    const r = validateEnvironment(
      MINIMAL + "capabilities:\n  webFetch:\n    enabled: true\n    rungs: [api, telepathy]\n",
    );
    expect(r.ok).toBe(false);
  });

  it("does NOT warn on schema fields that real envs use (shared, byoRepo, capabilities)", () => {
    // These were in the schema but missing from KNOWN_TOP_LEVEL_KEYS, so byo-project
    // drew bogus "unknown field" warnings. Guards the two lists staying in step.
    const r = validateEnvironment(
      MINIMAL + "shared: [universal]\nbyoRepo: true\ncapabilities:\n  browserTesting: true\n",
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).not.toContain("unknown field");
  });

  it("rejects custom egress with an empty allow list (4.3)", () => {
    const r = validateEnvironment(
      `apiVersion: podbay/v0\nname: x\nbase:\n  image: ubuntu\nnetwork:\n  policy: custom\n`,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("custom");
  });
});

describe("resolve", () => {
  it("applies default posture and egress (4.3)", async () => {
    const dir = await tmpEnv(MINIMAL);
    const pod = await resolve(dir);
    expect(pod.permissions.preset).toBe("guarded-open");
    expect(pod.permissions.rules.defaultMode).toBe("acceptEdits");
    expect(pod.network.policy).toBe("trusted");
    expect(pod.agents).toEqual(["claude-code"]);
  });

  it("is deterministic byte-for-byte (4.4)", async () => {
    const dir = await tmpEnv(MINIMAL);
    const a = serializeResolved(await resolve(dir));
    const b = serializeResolved(await resolve(dir));
    expect(a).toBe(b);
  });

  it("carries the kickoff prompt; null when absent", async () => {
    const withKickoff = await tmpEnv(MINIMAL + 'kickoff: "Greet the user and propose builds"\n');
    expect((await resolve(withKickoff)).kickoff).toBe("Greet the user and propose builds");
    const without = await tmpEnv(MINIMAL);
    expect((await resolve(without)).kickoff).toBeNull();
  });
});

describe("reference example environment (5.1)", () => {
  let pod: Awaited<ReturnType<typeof resolveWithConfig>>;
  beforeAll(async () => {
    pod = await resolveWithConfig(exampleDir);
  });

  it("validates and resolves", () => {
    expect(pod.name).toBe("nextjs-starter");
    expect(pod.claudeConfig.present).toBe(true);
    expect(pod.claudeConfig.files).toContain(".claude/CLAUDE.md");
  });

  it("is portable: base needs no podbay-hosting-only field (4.5)", () => {
    // A portable base is an image / dockerfile / devcontainer buildable by
    // standard tooling. v0 defines no required hosting-only field.
    const HOSTING_ONLY_REQUIRED: string[] = [];
    for (const key of HOSTING_ONLY_REQUIRED) {
      expect(pod).not.toHaveProperty(key);
    }
    expect("devcontainer" in pod.base || "dockerfile" in pod.base || "image" in pod.base).toBe(
      true,
    );
  });
});
