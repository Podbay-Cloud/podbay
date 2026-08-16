import { describe, it, expect } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { listEnvironments, getEnvironmentDetail } from "../lib/environments";

const repoEnvs = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
);

describe("listEnvironments", () => {
  it("lists valid first-party environments with metadata", async () => {
    const list = await listEnvironments(repoEnvs);
    expect(list.length).toBeGreaterThan(0);
    const nx = list.find((e) => e.name === "nextjs-starter");
    expect(nx).toBeTruthy();
    expect(nx?.tags).toContain("nextjs");
  });

  it("skips directories without a valid podbay.yaml", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pbenvs-"));
    await fs.mkdir(path.join(dir, "not-an-env"));
    await fs.writeFile(path.join(dir, "not-an-env", "README.md"), "nope");
    await fs.mkdir(path.join(dir, "good"));
    await fs.writeFile(
      path.join(dir, "good", "podbay.yaml"),
      "apiVersion: podbay/v0\nname: good\nbase:\n  image: ubuntu:24.04\n",
    );
    const list = await listEnvironments(dir);
    expect(list.map((e) => e.name)).toEqual(["good"]);
  });

  it("returns empty for a missing root", async () => {
    expect(await listEnvironments("/no/such/dir")).toEqual([]);
  });

  it("derives a capability summary + author on each entry", async () => {
    const list = await listEnvironments(repoEnvs);
    const chat = list.find((e) => e.name === "doc-qa");
    expect(chat).toBeTruthy();
    expect(chat?.capability.agents).toContain("Claude Code");
    expect(chat?.capability.base).toBe("devcontainer");
    // doc-qa declares one REQUIRED secret (ANTHROPIC_API_KEY); ADMIN_PASSWORD is optional.
    expect(chat?.capability.requiredSecretCount).toBe(1);
    expect(chat?.author).toBe("podbay");
    const ops = list.find((e) => e.name === "morning-ops-robot");
    expect(ops?.capability.webFetch).toBe(true);
  });

  it("classifies BYO Project as a workspace and keeps catalog pitches concise", async () => {
    const list = await listEnvironments(repoEnvs);
    expect(list.find((e) => e.name === "byo-project")?.kind).toBe("engine");

    for (const name of ["byo-project", "doc-qa", "first-10-customers", "morning-ops-robot"]) {
      const entry = list.find((e) => e.name === name);
      expect(entry, `${name} missing from catalog`).toBeTruthy();
      expect(entry?.description.length, `${name} pitch is too long for a selection card`).toBeLessThanOrEqual(180);
    }
  });
});

describe("getEnvironmentDetail", () => {
  it("resolves a known env's full pitch (capability + .claude skills/rules)", async () => {
    const d = await getEnvironmentDetail("doc-qa", repoEnvs);
    expect(d).toBeTruthy();
    expect(d?.capability.agents).toContain("Claude Code");
    expect(d?.secrets.some((s) => s.key === "ANTHROPIC_API_KEY" && s.required)).toBe(true);
    // Every shipped env now declares web-fetch (2026-07-29). The flag is no longer
    // decorative — it decides whether the skill reaches the pod at all — so this
    // asserts the declaration, not a default.
    expect(d?.capability.webFetch).toBe(true);
    // The env wires the ground-and-cite skill in its .claude layer.
    expect(d?.skills).toContain("ground-and-cite");
    expect(Array.isArray(d?.rules)).toBe(true);
  });

  it("returns null for an unknown or unsafe name", async () => {
    expect(await getEnvironmentDetail("no-such-env", repoEnvs)).toBeNull();
    expect(await getEnvironmentDetail("../secrets", repoEnvs)).toBeNull();
  });
});
