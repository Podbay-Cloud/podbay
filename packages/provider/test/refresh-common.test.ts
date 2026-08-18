import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Live config-refresh (docs/plans/live-config-refresh.md): refresh-common.sh holds the idempotent,
// hash-guarded refresh functions that BOTH init.sh (at boot) and podbay-refresh (on demand, no
// restart) run. These tests SOURCE the real file and drive each function against temp dirs — so the
// exact code the control plane execs on a running pod is covered, not a paraphrase.

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, "../pod-base/refresh-common.sh");

/** Source refresh-common.sh and run one function with env overrides pointing at temp paths. */
function run(fn: string, env: Record<string, string>): void {
  execFileSync("bash", ["-c", `set -u; . "${lib}"; ${fn}`], {
    env: { ...process.env, SETTINGS_OWNER: os.userInfo().username, RULES_OWNER: os.userInfo().username, ...env },
    stdio: "pipe",
  });
}

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pb-refresh-"));
}

describe("refresh-common.sh — shared config-refresh ops", () => {
  it("pb_refresh_runtime_rules writes CLAUDE.md and is idempotent", async () => {
    const dir = await tmp();
    try {
      const src = path.join(dir, "rules.md");
      const md = path.join(dir, "CLAUDE.md");
      await fs.writeFile(src, "# universal rules v1\n");
      const env = { RULES_SRC: src, CLAUDE_MD: md, RULES_MARKER: path.join(dir, ".h") };
      run("pb_refresh_runtime_rules", env);
      expect(await fs.readFile(md, "utf8")).toContain("universal rules v1");
      run("pb_refresh_runtime_rules", env); // idempotent
      expect(await fs.readFile(md, "utf8")).toContain("universal rules v1");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("pb_refresh_settings merges the managed permission slice and preserves other keys", async () => {
    const dir = await tmp();
    try {
      const spec = path.join(dir, "spec.json");
      const settings = path.join(dir, "settings.json");
      await fs.writeFile(
        spec,
        JSON.stringify({ permissions: { rules: { defaultMode: "acceptEdits", allow: ["Read"], deny: ["Bash(x)"], ask: [] } } }),
      );
      // A podbay-shaped file (allow matches the preset's signature) with a NON-managed key and a
      // STALE deny — the refresh should update the managed slice and preserve someAppKey. (A file
      // WITHOUT the podbay allow-signature is treated as user-owned and left untouched — by design.)
      await fs.writeFile(
        settings,
        JSON.stringify({ someAppKey: true, defaultMode: "acceptEdits", permissions: { allow: ["Read"], deny: [], ask: [] } }),
      );
      const env = { SETTINGS_SPEC: spec, SETTINGS_JSON: settings, SETTINGS_MARKER: path.join(dir, ".sh"), STOP_HOOK: path.join(dir, "absent.py") };
      run("pb_refresh_settings", env);
      const s = JSON.parse(await fs.readFile(settings, "utf8"));
      expect(s.permissions.deny).toContain("Bash(x)"); // managed slice refreshed from the preset
      expect(s.someAppKey).toBe(true); // non-managed key preserved
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("pb_refresh_claude_skills mirrors delivered skills into place", async () => {
    const dir = await tmp();
    try {
      const src = path.join(dir, "skills");
      const dest = path.join(dir, "dest");
      await fs.mkdir(path.join(src, "demo"), { recursive: true });
      await fs.writeFile(path.join(src, "demo", "SKILL.md"), "skill v1\n");
      run("pb_refresh_claude_skills", { CLAUDE_SKILLS_SRC: src, CLAUDE_SKILLS_DEST: dest, SPEC: path.join(dir, "nospec.json") });
      expect(await fs.readFile(path.join(dest, "demo", "SKILL.md"), "utf8")).toContain("skill v1");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("pb_refresh_work_rules assembles project rules (non-BYO) and never clobbers a user edit", async () => {
    const dir = await tmp();
    try {
      const work = path.join(dir, "work");
      await fs.mkdir(path.join(work, ".claude", "rules"), { recursive: true });
      await fs.writeFile(path.join(work, ".claude", "rules", "web.md"), "# web rule\nbody\n");
      const spec = path.join(dir, "spec.json");
      await fs.writeFile(spec, JSON.stringify({ agents: ["claude-code"] })); // no githubRepo → non-BYO
      const env = { WORK: work, SPEC: spec };
      run("pb_refresh_work_rules", env);
      const claudeMd = path.join(work, "CLAUDE.md");
      expect(await fs.readFile(claudeMd, "utf8")).toContain("web rule");
      // user edits it → refresh must leave it alone
      await fs.writeFile(claudeMd, "MY EDIT");
      run("pb_refresh_work_rules", env);
      expect(await fs.readFile(claudeMd, "utf8")).toBe("MY EDIT");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
