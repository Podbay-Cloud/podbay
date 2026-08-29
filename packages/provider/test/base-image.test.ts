import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const podBase = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pod-base");
const initSh = path.join(podBase, "init.sh");
const refreshLib = path.join(podBase, "refresh-common.sh");
const cliDriftCanary = path.resolve(podBase, "../../../scripts/incus/cli-drift-canary.sh");

describe("CLI drift canary", () => {
  it("installs the exact requested candidates as root and fails closed", async () => {
    const src = await fs.readFile(cliDriftCanary, "utf8");
    expect(src).toContain('CLAUDE_CANDIDATE="${CLAUDE_CANDIDATE:-latest}"');
    expect(src).toContain('CODEX_CANDIDATE="${CODEX_CANDIDATE:-latest}"');
    expect(src).toContain(
      'incus exec "$NAME" -- npm i -g "@anthropic-ai/claude-code@$CLAUDE_CANDIDATE" "@openai/codex@$CODEX_CANDIDATE"',
    );
    expect(src).not.toMatch(/su - dev -c ['"]npm i -g/);
    expect(src).not.toMatch(/npm i -g[^\n]+\|\| true/);
    expect(src).toContain("candidate version mismatch");
  });
});

/** Task 5.3: wake must not re-run setup — the init contract uses run-once markers. */
describe("pod-base first-boot init", () => {
  it("guards seeding and setup behind markers on the persistent volume", async () => {
    const src = await fs.readFile(initSh, "utf8");
    expect(src).toContain("MARKER=/home/dev/.podbay-seeded");
    expect(src).toContain("SETUP_MARKER=/home/dev/.podbay-setup-done");
    // Seed phase skips when already seeded and stamps its marker after.
    expect(src).toMatch(/if \[ -f "\$MARKER" \]/);
    expect(src).toContain('touch "$MARKER"');
    // Clone+setup phase is guarded by its own marker and stamps it when done.
    expect(src).toMatch(/\[ ! -f "\$SETUP_MARKER" \]/);
    expect(src).toContain('touch "$SETUP_MARKER"');
  });

  it("runs repo clone + setup in the background so the terminal isn't blocked", async () => {
    const src = await fs.readFile(initSh, "utf8");
    // The clone/setup subshell is backgrounded and logged.
    expect(src).toMatch(/\) >> "\$SETUP_LOG" 2>&1 &/);
    expect(src).toContain("git clone");
    // Clone goes via a temp dir so a non-empty workspace can't break it.
    expect(src).toContain(".podbay-clone");
  });

  it("never bakes or injects credentials (per-pod login: each pod does /login)", async () => {
    const src = await fs.readFile(initSh, "utf8");
    expect(src).not.toMatch(/ANTHROPIC_API_KEY|OAUTH_TOKEN|AUTH_TOKEN=/);
    // The credential-injection phase is gone: no /etc/podbay/credentials handling.
    expect(src).not.toContain("/etc/podbay/credentials");
  });

  it("locks the app-secrets file 0600 dev-owned and wires the universal loader", async () => {
    const src = await fs.readFile(initSh, "utf8");
    // The secrets file is dev-owned and unreadable by others.
    expect(src).toContain("chmod 600 /etc/podbay/secrets.env");
    expect(src).toContain("chown dev:dev /etc/podbay/secrets.env");
    // One loader sourced by every shell type under `set -a` (secrets-load.sh via
    // BASH_ENV + profile.d + ~/.bashrc) so values reach process.env everywhere.
    expect(src).toContain("set -a; . /etc/podbay/secrets.env; set +a");
    expect(src).toContain("BASH_ENV=/etc/podbay/secrets-load.sh");
    expect(src).toContain("/etc/profile.d/podbay-secrets.sh");
    // Added idempotently to ~/.bashrc (persistent), never written into ~/work.
    expect(src).toContain("grep -q 'secrets-load.sh'");
    expect(src).not.toMatch(/work\/\.env/);
  });

  it("enforces egress every boot (not marker-guarded) and drops sudo when locked down", async () => {
    const src = await fs.readFile(initSh, "utf8");
    // Gated on the resolved policy, not a run-once marker (iptables is ephemeral).
    expect(src).toContain('.get("egress")');
    expect(src).toMatch(/EGRESS_ENFORCE[\s\S]*if \[ -n "\$EGRESS_ENFORCE" \]/);
    expect(src).not.toMatch(/EGRESS_MARKER|podbay-egress-done/);
    // The transparent-redirect contract: REDIRECT 80/443, spare the redirected
    // hop to :3129 (the fix that made allowed traffic actually reach the proxy),
    // exclude the proxy's own marked dials, and REJECT everything else.
    expect(src).toContain("REDIRECT --to-ports 3129");
    expect(src).toContain("--dport 3129 -j ACCEPT");
    expect(src).toContain("--mark 0x1 -j RETURN");
    expect(src).toContain("-j REJECT");
    // Fly's control net + hallpass SSH stay reachable so `fly ssh`/logs survive
    // the REJECT-all (ESTABLISHED alone doesn't match hallpass replies here).
    expect(src).toContain("fdaa::/16 -j ACCEPT");
    expect(src).toContain("--sport 22 -j ACCEPT");
    // Root would let the agent flush the rules, so enforcement removes dev sudo.
    expect(src).toContain("rm -f /etc/sudoers.d/dev");
  });
});

describe("pod-base runtime-literacy layer", () => {
  const dockerfile = path.join(podBase, "Dockerfile");
  const cli = path.join(podBase, "podbay");

  it("bakes the podbay CLI (on PATH) and the runtime rules into the image", async () => {
    const df = await fs.readFile(dockerfile, "utf8");
    expect(df).toContain("/usr/local/bin/podbay");
    expect(df).toContain("/opt/podbay/runtime-rules.md");
    expect(df).toContain("chmod +x /usr/local/bin/podbay-init /usr/local/bin/podbay");
  });

  /**
   * Regression guard for the 2026-07-24 outage (pod prime-cat-8ba8). Claude Code writes
   * ~/.claude.json itself during /login, so a `[ ! -f ]` create-branch never ran and the
   * repair pass covered only the two remote-control keys. `bypassPermissionsModeAccepted`
   * was therefore never set, the pod hit the "Bypass Permissions mode" accept screen whose
   * DEFAULT is "No, exit", Claude exited, and the scripted RC + kickoff keystrokes went to
   * bash. The seed must therefore REPAIR an existing config, not just create a missing one.
   */
  describe("claude first-run config seeding", () => {
    async function runSeed(dir: string, existing?: unknown) {
      const src = await fs.readFile(initSh, "utf8");
      const after = src.split(">>> podbay:claude-config-seed")[1];
      expect(after, "sentinel-delimited claude-config-seed block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:claude-config-seed")[0];
      const heredoc = block.split("<<'PY'")[1];
      expect(heredoc, "python heredoc must be extractable").toBeTruthy();
      // drop the rest of the `python3 - <<'PY' || true` line before the body starts
      const py = heredoc.slice(heredoc.indexOf("\n") + 1).split("\nPY")[0];
      const cfgPath = path.join(dir, ".claude.json");
      if (existing !== undefined) await fs.writeFile(cfgPath, JSON.stringify(existing));
      else await fs.rm(cfgPath, { force: true });
      const script = path.join(dir, "seed.py");
      await fs.writeFile(script, py!);
      execFileSync("python3", [script], { env: { ...process.env, PODBAY_CLAUDE_JSON: cfgPath } });
      return JSON.parse(await fs.readFile(cfgPath, "utf8"));
    }

    it("creates the config when absent", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-cfg-"));
      try {
        const cfg = await runSeed(dir);
        expect(cfg.bypassPermissionsModeAccepted).toBe(true);
        expect(cfg.remoteControlAtStartup).toBe(true);
        expect(cfg.projects["/home/dev/work"].hasTrustDialogAccepted).toBe(true);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("REPAIRS a config Claude Code created during /login (the outage case)", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-cfg-"));
      try {
        // exactly what the broken pod had: Claude's own file, no bypass flag
        const cfg = await runSeed(dir, { hasCompletedOnboarding: true, projects: {} });
        expect(cfg.bypassPermissionsModeAccepted).toBe(true);
        expect(cfg.projects["/home/dev/work"].hasTrustDialogAccepted).toBe(true);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("never clobbers a choice the user actually made", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-cfg-"));
      try {
        const cfg = await runSeed(dir, { theme: "light", remoteControlAtStartup: false });
        expect(cfg.theme).toBe("light");
        expect(cfg.remoteControlAtStartup).toBe(false);
        expect(cfg.bypassPermissionsModeAccepted).toBe(true); // still repaired
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * Codex's "Do you trust the contents of this directory?" gate blocks the post-login
   * session until a keypress (reported live 2026-07-26). It's suppressed by a trusted-project
   * entry in ~/.codex/config.toml, verified on codex-cli 0.145.0. The seed must survive codex
   * writing that file itself, so — like the claude seed — this runs the real block against a
   * temp config, covering create, append-alongside-codex's-own-settings, and respect-decline.
   */
  describe("codex directory-trust seeding", () => {
    /** Read a TOML file as JSON via python's tomllib, so node can assert on it. */
    function readToml(file: string): Record<string, any> {
      const out = execFileSync(
        "python3",
        ["-c", "import tomllib,json,sys;print(json.dumps(tomllib.load(open(sys.argv[1],'rb'))))", file],
        { encoding: "utf8" },
      );
      return JSON.parse(out);
    }

    async function runSeed(dir: string, existing?: string) {
      const src = await fs.readFile(initSh, "utf8");
      const after = src.split(">>> podbay:codex-config-seed")[1];
      expect(after, "sentinel-delimited codex-config-seed block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:codex-config-seed")[0];
      const heredoc = block.split("<<'PY'")[1];
      expect(heredoc, "python heredoc must be extractable").toBeTruthy();
      const py = heredoc.slice(heredoc.indexOf("\n") + 1).split("\nPY")[0];
      const cfgPath = path.join(dir, "config.toml");
      if (existing !== undefined) await fs.writeFile(cfgPath, existing);
      else await fs.rm(cfgPath, { force: true });
      const script = path.join(dir, "seed_codex.py");
      await fs.writeFile(script, py!);
      execFileSync("python3", [script], { env: { ...process.env, PODBAY_CODEX_TOML: cfgPath } });
      return readToml(cfgPath);
    }

    it("creates the config and trusts the workspace + fallback when absent", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-codex-"));
      try {
        const cfg = await runSeed(dir);
        expect(cfg.projects["/home/dev/work"].trust_level).toBe("trusted");
        expect(cfg.projects["/home/dev"].trust_level).toBe("trusted");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("appends trust alongside a config codex wrote, preserving its settings", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-codex-"));
      try {
        const cfg = await runSeed(dir, '[tui]\ntheme = "dark"\n');
        expect(cfg.tui.theme).toBe("dark"); // codex's own setting untouched
        expect(cfg.projects["/home/dev/work"].trust_level).toBe("trusted");
        expect(cfg.projects["/home/dev"].trust_level).toBe("trusted");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("never overrides a path the user already decided (present → skip)", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-codex-"));
      try {
        // user explicitly declined trust for the workspace on a prior boot
        const cfg = await runSeed(dir, '[projects."/home/dev/work"]\ntrust_level = "untrusted"\n');
        expect(cfg.projects["/home/dev/work"].trust_level).toBe("untrusted"); // respected
        expect(cfg.projects["/home/dev"].trust_level).toBe("trusted"); // fallback still added
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * Codex reads neither ~/.claude/CLAUDE.md nor ~/work/CLAUDE.md — only AGENTS.md. Codex
   * DOES read the global ~/.codex/AGENTS.md (verified live on codex-cli 0.145.0), so the
   * universal + env rules are assembled there in a delimited podbay block: non-destructive,
   * idempotent, codex-only. This runs the real block against temp paths.
   */
  describe("codex AGENTS.md rule assembly", () => {
    async function runAssemble(
      dir: string,
      agent: string,
      opts: { rules?: Record<string, string>; runtime?: string; existing?: string } = {},
    ) {
      const src = await fs.readFile(refreshLib, "utf8");
      const after = src.split(">>> podbay:codex-agents-rules")[1];
      expect(after, "sentinel-delimited codex-agents-rules block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:codex-agents-rules")[0];
      const heredoc = block.split("<<'PY'")[1];
      const py = heredoc.slice(heredoc.indexOf("\n") + 1).split("\nPY")[0];
      const runtimePath = path.join(dir, "runtime-rules.md");
      await fs.writeFile(runtimePath, opts.runtime ?? "UNIVERSAL: confirm before outbound.");
      const rulesDir = path.join(dir, "rules");
      await fs.mkdir(rulesDir, { recursive: true });
      for (const [name, body] of Object.entries(opts.rules ?? {})) {
        await fs.writeFile(path.join(rulesDir, name), body);
      }
      const dst = path.join(dir, "AGENTS.md");
      if (opts.existing !== undefined) await fs.writeFile(dst, opts.existing);
      else await fs.rm(dst, { force: true });
      const script = path.join(dir, "agents.py");
      await fs.writeFile(script, py!);
      execFileSync("python3", [script], {
        env: {
          ...process.env,
          PODBAY_AGENT: agent,
          PODBAY_CODEX_AGENTS: dst,
          PODBAY_RUNTIME_RULES: runtimePath,
          PODBAY_ENV_RULES_DIR: rulesDir,
        },
      });
      return fs.readFile(dst, "utf8").catch(() => null);
    }

    it("assembles universal + env rules into ~/.codex/AGENTS.md for a codex pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-agents-"));
      try {
        const out = await runAssemble(dir, "codex", {
          rules: { "web-build-discipline.md": "ENV RULE: verify the build." },
        });
        expect(out).toContain("UNIVERSAL: confirm before outbound.");
        expect(out).toContain("ENV RULE: verify the build.");
        expect(out).toContain("BEGIN:podbay-runtime");
        expect(out).toContain("END:podbay-runtime");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    /**
     * The DERIVATION of CODEX_SA_AGENT from the pod spec — which runSeed bypasses by
     * injecting the value. It was `agents[0]`, so a Claude pod that later gained
     * Codex never got the daemon binary and its remote control could never start.
     */
    it("derives 'codex' when codex is ANY declared agent, not just the primary", async () => {
      const src = await fs.readFile(initSh, "utf8");
      const m = src.match(/CODEX_SA_AGENT="\$\{CODEX_SA_AGENT:-\$\(python3 -c '([^']+)'/);
      expect(m, "the spec-derivation one-liner must be findable").toBeTruthy();
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-sa-derive-"));
      try {
        const derive = async (agents: string[] | null): Promise<string> => {
          const specPath = path.join(dir, "pod-spec.json");
          await fs.writeFile(specPath, JSON.stringify(agents === null ? {} : { agents }));
          const code = m![1].replace('"/etc/podbay/pod-spec.json"', JSON.stringify(specPath));
          return execFileSync("python3", ["-c", code]).toString().trim();
        };
        expect(await derive(["claude-code", "codex"])).toBe("codex"); // the live failure
        expect(await derive(["codex", "claude-code"])).toBe("codex");
        expect(await derive(["codex"])).toBe("codex");
        expect(await derive(["claude-code"])).toBe("claude-code"); // still no seed for it
        expect(await derive([])).toBe("");
        expect(await derive(null)).toBe("");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("does nothing for a non-codex pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-agents-"));
      try {
        expect(await runAssemble(dir, "claude-code")).toBeNull();
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("replaces its own block and preserves content outside it (non-destructive)", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-agents-"));
      try {
        const existing =
          "# My own notes\nkeep me\n\n<!-- BEGIN:podbay-runtime (authored by Podbay - do not edit; regenerated each boot) -->\nOLD RULES\n<!-- END:podbay-runtime -->\n";
        const out = await runAssemble(dir, "codex", {
          runtime: "UNIVERSAL v2.",
          existing,
        });
        expect(out).toContain("# My own notes");
        expect(out).toContain("keep me");
        expect(out).toContain("UNIVERSAL v2.");
        expect(out).not.toContain("OLD RULES");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * The universal runtime rules must REFRESH, not seed-once. This replaced a source-grep
   * test that asserted `[ ! -f ~/.claude/CLAUDE.md ]` — i.e. it encoded the bug as the
   * spec. /home/dev is a persistent volume, so "write only if absent" meant a pod created
   * once never received a rules update: the confirm-before-outbound security rule shipped
   * 2026-07-23 and reached ZERO live pods. So this runs the real block against temp paths.
   */
  describe("universal runtime rules refresh (not seed-once)", () => {
    /** Extract the sentinel-delimited block from init.sh and run it with overridden paths. */
    async function runRefresh(dir: string, rulesText: string) {
      const src = await fs.readFile(refreshLib, "utf8");
      const after = src.split(">>> podbay:runtime-rules-refresh")[1];
      expect(after, "sentinel-delimited rules-refresh block must exist in init.sh").toBeTruthy();
      // drop the remainder of the sentinel's own comment line, else it runs as a command
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:runtime-rules-refresh")[0];
      const rulesSrc = path.join(dir, "runtime-rules.md");
      await fs.writeFile(rulesSrc, rulesText);
      const script = path.join(dir, "run-block.sh");
      await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
      execFileSync("bash", [script], {
        env: {
          ...process.env,
          RULES_SRC: rulesSrc,
          CLAUDE_MD: path.join(dir, "claude", "CLAUDE.md"),
          RULES_MARKER: path.join(dir, "claude", ".podbay-runtime-hash"),
          // don't attempt dev:dev in a test sandbox
          RULES_OWNER: `${os.userInfo().username}`,
        },
      });
      const read = async (p: string) => fs.readFile(path.join(dir, "claude", p), "utf8").catch(() => null);
      return { claudeMd: await read("CLAUDE.md"), sidecar: await read("podbay-runtime.md") };
    }

    it("writes the rules on a fresh pod, refreshes them on update, and never clobbers user edits", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-rules-"));
      try {
        // fresh pod → rules installed
        expect((await runRefresh(dir, "RULES v1")).claudeMd).toBe("RULES v1");

        // THE REGRESSION: rules updated, file untouched since we wrote it → must refresh
        expect((await runRefresh(dir, "RULES v2 outbound gate")).claudeMd).toBe("RULES v2 outbound gate");

        // user edited their CLAUDE.md → preserve it, deliver the update alongside
        await fs.writeFile(path.join(dir, "claude", "CLAUDE.md"), "MY OWN NOTES");
        const edited = await runRefresh(dir, "RULES v3");
        expect(edited.claudeMd).toBe("MY OWN NOTES");
        expect(edited.sidecar).toBe("RULES v3");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * $WORK/CLAUDE.md assembly (env rules → project CLAUDE.md). Was seed-once on the
   * persistent volume — a rule change never reached existing pods (the "shipped but
   * never delivered" class; 2026-07-28 seed-once audit). Now the same hash-marker
   * policy as the runtime rules above: refresh when our last write is untouched,
   * never clobber a user edit. Runs the REAL init.sh block against temp dirs.
   */
  describe("settings.json permission refresh (not seed-once)", () => {
    const GUARDED = {
      defaultMode: "acceptEdits",
      allow: ["Read(~/**)", "Edit(~/**)", "Bash(*)"],
      deny: ["Bash(git push --force*)"],
      ask: [],
    };
    /** Run the REAL init.sh settings-refresh block against temp paths. `existing`
     * undefined = leave whatever is on disk (for multi-run marker tests). */
    async function runSettings(dir: string, rules: object, existing?: object) {
      const src = readFileSync(refreshLib, "utf8");
      const after = src.split(">>> podbay:settings-refresh")[1];
      expect(after, "sentinel-delimited settings-refresh block must exist in init.sh").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:settings-refresh")[0];
      const spec = path.join(dir, "pod-spec.json");
      await fs.writeFile(spec, JSON.stringify({ permissions: { rules } }));
      const settings = path.join(dir, "settings.json");
      if (existing !== undefined) await fs.writeFile(settings, JSON.stringify(existing));
      const script = path.join(dir, "run-settings.sh");
      await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
      execFileSync("bash", [script], {
        env: {
          ...process.env,
          SETTINGS_SPEC: spec,
          SETTINGS_JSON: settings,
          SETTINGS_MARKER: path.join(dir, ".podbay-settings-hash"),
          SETTINGS_OWNER: os.userInfo().username,
        },
      });
      return JSON.parse(await fs.readFile(settings, "utf8"));
    }

    it("creates settings from the preset on a fresh pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-set-"));
      try {
        const s = await runSettings(dir, GUARDED);
        expect(s.permissions.ask).toEqual([]);
        expect(s.permissions.deny).toContain("Bash(git push --force*)");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("MIGRATES a stale podbay default (drops the git-push prompt) and preserves app keys", async () => {
      // The exact pre-2026-08-01 shape, no marker — the case that stranded existing pods.
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-set-"));
      try {
        const stale = {
          defaultMode: "acceptEdits",
          permissions: {
            allow: ["Read(~/**)", "Edit(~/**)", "Bash(*)"],
            deny: ["Bash(git push --force*)"],
            ask: ["Bash(git push*)"],
          },
          skipDangerousModePermissionPrompt: true,
          agentPushNotifEnabled: true,
        };
        const s = await runSettings(dir, GUARDED, stale);
        expect(s.permissions.ask).toEqual([]); // migrated: no more git-push prompt
        expect(s.skipDangerousModePermissionPrompt).toBe(true); // non-managed keys preserved
        expect(s.agentPushNotifEnabled).toBe(true);
        expect(s.permissions.deny).toContain("Bash(git push --force*)"); // force-push still denied
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("never clobbers a user's own edit to the managed permissions", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-set-"));
      try {
        await runSettings(dir, GUARDED); // podbay writes + marker
        // user tightens their own policy
        const settings = path.join(dir, "settings.json");
        const mine = JSON.parse(await fs.readFile(settings, "utf8"));
        mine.permissions.ask = ["Bash(rm *)"];
        await fs.writeFile(settings, JSON.stringify(mine));
        const s = await runSettings(dir, GUARDED); // refresh must back off
        expect(s.permissions.ask).toEqual(["Bash(rm *)"]);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("PROPAGATES a new deny to an unedited pod (the security-propagation win)", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-set-"));
      try {
        await runSettings(dir, GUARDED); // baseline + marker
        const tightened = { ...GUARDED, deny: [...GUARDED.deny, "Bash(curl evil*)"] };
        const s = await runSettings(dir, tightened); // preset gained a deny → must propagate
        expect(s.permissions.deny).toContain("Bash(curl evil*)");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("work-rules refresh (env rules → $WORK/CLAUDE.md)", () => {
    async function runWorkRules(dir: string, rules: Record<string, string>, opts: { byo?: boolean } = {}) {
      const src = await fs.readFile(refreshLib, "utf8");
      const after = src.split(">>> podbay:work-rules-refresh")[1];
      expect(after, "sentinel-delimited work-rules block must exist in init.sh").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("# <<< podbay:work-rules-refresh")[0];
      const work = path.join(dir, "work");
      await fs.mkdir(path.join(work, ".claude", "rules"), { recursive: true });
      // reset the rules dir to exactly `rules` (models the freshly-pushed layer)
      for (const f of await fs.readdir(path.join(work, ".claude", "rules"))) {
        await fs.rm(path.join(work, ".claude", "rules", f));
      }
      for (const [name, body] of Object.entries(rules)) {
        await fs.writeFile(path.join(work, ".claude", "rules", name), body);
      }
      const script = path.join(dir, "run-work-rules.sh");
      await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
      execFileSync("bash", [script], {
        env: { ...process.env, WORK: work, GH_REPO: opts.byo ? "user/repo" : "" },
      });
      return fs.readFile(path.join(work, "CLAUDE.md"), "utf8").catch(() => null);
    }

    it("seeds fresh, refreshes on a rule change, never clobbers a user edit, skips BYO", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-workrules-"));
      try {
        // fresh pod → assembled
        const v1 = await runWorkRules(dir, { "a.md": "RULE A v1" });
        expect(v1).toContain("RULE A v1");

        // THE REGRESSION: a rule changes; our file untouched → must refresh
        const v2 = await runWorkRules(dir, { "a.md": "RULE A v2 tightened" });
        expect(v2).toContain("RULE A v2 tightened");
        expect(v2).not.toContain("RULE A v1");

        // user edited CLAUDE.md → theirs wins, forever
        const work = path.join(dir, "work");
        await fs.writeFile(path.join(work, "CLAUDE.md"), "USER'S OWN CLAUDE.MD");
        const v3 = await runWorkRules(dir, { "a.md": "RULE A v3" });
        expect(v3).toBe("USER'S OWN CLAUDE.MD");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("never writes into a BYO repo, and never clobbers a pre-marker CLAUDE.md it can't attribute", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-workrules-"));
      try {
        expect(await runWorkRules(dir, { "a.md": "RULE" }, { byo: true })).toBeNull();
        // pre-marker pod: CLAUDE.md exists but no hash marker → ambiguous ownership → hands off
        const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-workrules-"));
        const work2 = path.join(dir2, "work");
        await fs.mkdir(path.join(work2, ".claude", "rules"), { recursive: true });
        await fs.writeFile(path.join(work2, "CLAUDE.md"), "PRE-EXISTING, PROVENANCE UNKNOWN");
        expect(await runWorkRules(dir2, { "a.md": "RULE" })).toBe("PRE-EXISTING, PROVENANCE UNKNOWN");
        await fs.rm(dir2, { recursive: true, force: true });
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * The Codex RC daemon (`remote-control start`) needs the STANDALONE build seeded onto
   * the volume; the image stages it and init.sh copies it, repointing the installer's
   * ABSOLUTE `current` symlink to a relative one so it resolves after the move. Runs the
   * real block against temp dirs.
   */
  /**
   * The pod's hostname becomes the label the Codex app shows for it — captured at
   * FIRST remote-control enrollment and then immutable server-side, so it has to be
   * right before the daemon ever starts.
   */
  /**
   * The standalone codex build SELF-UPDATES — it downloads a release onto the
   * volume and repoints `current`. A pod that swaps a component we depend on for
   * pairing is not reproducible, so boot re-pins it.
   */
  describe("codex standalone pin enforcement", () => {
    it("undoes a self-update, is idempotent, and keeps the newer release on disk", async () => {
      const src = await fs.readFile(initSh, "utf8");
      const after = src.split(">>> podbay:codex-standalone-pin")[1];
      expect(after, "sentinel-delimited pin block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:codex-standalone-pin")[0];

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-pin-"));
      try {
        const srcTree = path.join(dir, "src", "standalone");
        const dst = path.join(dir, "dst", "standalone");
        await fs.mkdir(path.join(srcTree, "releases", "0.146.0", "bin"), { recursive: true });
        await fs.mkdir(path.join(dst, "releases", "0.146.0", "bin"), { recursive: true });
        await fs.mkdir(path.join(dst, "releases", "0.147.0", "bin"), { recursive: true });
        // the self-updater leaves an ABSOLUTE symlink at a newer release
        await fs.symlink(path.join(dst, "releases", "0.147.0"), path.join(dst, "current"));

        const script = path.join(dir, "pin.sh");
        await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
        const run = () =>
          execFileSync("bash", [script], {
            env: {
              ...process.env,
              CODEX_SA_SRC: srcTree,
              CODEX_SA_DST: dst,
              CODEX_SA_OWNER: os.userInfo().username,
            },
          }).toString();

        expect(run()).toMatch(/pinning codex standalone/);
        expect(await fs.readlink(path.join(dst, "current"))).toBe("releases/0.146.0");
        expect(run(), "second run must be a no-op").not.toMatch(/pinning/);
        // never delete what the pod downloaded — that is evidence, and disk we
        // did not ask to reclaim
        expect(await fs.readdir(path.join(dst, "releases"))).toContain("0.147.0");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("guest hostname from the pod name", () => {
    async function sanitize(name: string): Promise<string> {
      const src = await fs.readFile(initSh, "utf8");
      const after = src.split(">>> podbay:pod-hostname")[1];
      expect(after, "sentinel-delimited pod-hostname block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:pod-hostname")[0];
      // run the block's sanitiser only (skip the `hostname` call, which needs root)
      const line = block.split("\n").find((l) => l.startsWith("POD_HOSTNAME="));
      expect(line, "sanitiser line must exist").toBeTruthy();
      const out = execFileSync("bash", ["-c", `POD_NAME_RAW=${JSON.stringify(name)}; ${line}; printf '%s' "$POD_HOSTNAME"`]);
      return out.toString();
    }

    it("makes an RFC-1123 hostname out of a human pod name", async () => {
      expect(await sanitize("byo test")).toBe("byo-test");
      expect(await sanitize("My First Pod!")).toBe("my-first-pod");
      expect(await sanitize("UPPER_Case--Name")).toBe("upper-case-name");
    });

    it("yields nothing for a nameless pod, so the slug is left alone", async () => {
      expect(await sanitize("")).toBe("");
      expect(await sanitize("   ")).toBe("");
      expect(await sanitize("!!!")).toBe("");
    });

    it("caps the length (hostnames are bounded)", async () => {
      expect((await sanitize("x".repeat(200))).length).toBe(63);
    });
  });

  describe("codex standalone build seeding", () => {
    async function runSeed(dir: string, agent: string) {
      const src = await fs.readFile(initSh, "utf8");
      const after = src.split(">>> podbay:codex-standalone-seed")[1];
      expect(after, "sentinel-delimited codex-standalone-seed block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:codex-standalone-seed")[0];
      // stage a fake standalone tree with an ABSOLUTE `current` symlink (as the installer makes)
      const srcTree = path.join(dir, "src", "standalone");
      const rel = "0.145.0-x86_64-unknown-linux-musl";
      await fs.mkdir(path.join(srcTree, "releases", rel, "bin"), { recursive: true });
      await fs.writeFile(path.join(srcTree, "releases", rel, "bin", "codex"), "#!/bin/sh\n");
      await fs.chmod(path.join(srcTree, "releases", rel, "bin", "codex"), 0o755);
      await fs.symlink(path.join(srcTree, "releases", rel), path.join(srcTree, "current")); // absolute
      await fs.symlink("bin/codex", path.join(srcTree, "releases", rel, "codex")); // current/codex -> bin/codex
      const dst = path.join(dir, "dst", "standalone");
      const script = path.join(dir, "run-block.sh");
      await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
      execFileSync("bash", [script], {
        env: {
          ...process.env,
          CODEX_SA_AGENT: agent,
          CODEX_SA_SRC: srcTree,
          CODEX_SA_DST: dst,
          CODEX_SA_OWNER: os.userInfo().username,
        },
      });
      return dst;
    }
    const exists = (p: string) => fs.access(p).then(() => true).catch(() => false);

    it("copies the standalone tree and makes `current` resolve after the move (codex)", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-sa-"));
      try {
        const dst = await runSeed(dir, "codex");
        // current/codex resolves (via current -> releases/<ver>, then -> bin/codex)
        expect(await exists(path.join(dst, "current", "codex"))).toBe(true);
        const cur = await fs.readlink(path.join(dst, "current"));
        expect(cur.startsWith("/"), "current must be RELATIVE so it survives the move").toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("does nothing for a non-codex pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-sa-"));
      try {
        const dst = await runSeed(dir, "claude-code");
        expect(await exists(dst)).toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  /**
   * A Codex pod gets none of its env's skills unless they're copied into ~/.codex/skills
   * (Codex never reads the Claude layer). Verified on codex-cli 0.145.0 that a dropped-in
   * skill dir is auto-discovered and Claude's frontmatter is tolerated, so translation is a
   * plain per-dir copy — this runs the real block against temp dirs.
   */
  describe("codex skills translation", () => {
    async function runTranslate(dir: string, agent: string) {
      const src = await fs.readFile(refreshLib, "utf8");
      const after = src.split(">>> podbay:codex-skills-translate")[1];
      expect(after, "sentinel-delimited codex-skills-translate block must exist").toBeTruthy();
      const block = after.slice(after.indexOf("\n") + 1).split("<<< podbay:codex-skills-translate")[0];
      const script = path.join(dir, "run-block.sh");
      await fs.writeFile(script, `#!/usr/bin/env bash\nset -u\n${block}\n`);
      execFileSync("bash", [script], {
        env: {
          ...process.env,
          CODEX_SKILLS_AGENT: agent,
          CODEX_SKILLS_SRC: path.join(dir, "src"),
          CODEX_SKILLS_DEST: path.join(dir, "dest"),
          CODEX_SKILLS_OWNER: os.userInfo().username, // no dev:dev in the sandbox
        },
      });
    }
    const exists = (p: string) =>
      fs.access(p).then(() => true).catch(() => false);

    async function seedSrc(dir: string) {
      // one env skill (with a support file) + codex's reserved built-in
      await fs.mkdir(path.join(dir, "src", "ship-feature", "references"), { recursive: true });
      await fs.writeFile(path.join(dir, "src", "ship-feature", "SKILL.md"), "---\nname: ship-feature\n---\n");
      await fs.writeFile(path.join(dir, "src", "ship-feature", "references", "guide.md"), "notes");
      await fs.mkdir(path.join(dir, "src", ".system", "skill-creator"), { recursive: true });
      await fs.writeFile(path.join(dir, "src", ".system", "skill-creator", "SKILL.md"), "builtin");
    }

    it("runs on EVERY boot, not only inside the first-boot seed", async () => {
      // Seed-only meant a codex added at RUNTIME never got the env's skills, and a reboot
      // did not heal it (the seed marker already existed). The translation must therefore be
      // invoked from a call site OUTSIDE the `already seeded` guard — same property AGENTS.md
      // assembly already has.
      const src = await fs.readFile(initSh, "utf8");
      expect(src).toMatch(/^translate_codex_skills\(\)\s*\{/m); // defined as a function
      const seedGuard = src.indexOf('if [ -f "$MARKER" ]; then');
      const callSites = [...src.matchAll(/^\s*translate_codex_skills\s*$/gm)].map((m) => m.index ?? 0);
      expect(callSites.length).toBeGreaterThanOrEqual(2); // seed + every-boot
      expect(callSites.some((i) => i > seedGuard)).toBe(true);
      // The every-boot call must not itself be nested in the seed's run-once branch.
      const lastCall = callSites[callSites.length - 1]!;
      expect(src.slice(lastCall - 400, lastCall)).not.toContain("already seeded");
    });

    it("copies env skills (with support files) into ~/.codex/skills for a codex pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-cxsk-"));
      try {
        await seedSrc(dir);
        await runTranslate(dir, "codex");
        expect(await exists(path.join(dir, "dest", "ship-feature", "SKILL.md"))).toBe(true);
        expect(await exists(path.join(dir, "dest", "ship-feature", "references", "guide.md"))).toBe(true);
        // codex's reserved .system built-ins are never shadowed
        expect(await exists(path.join(dir, "dest", ".system"))).toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("does nothing for a non-codex (claude) pod", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-cxsk-"));
      try {
        await seedSrc(dir);
        await runTranslate(dir, "claude-code");
        expect(await exists(path.join(dir, "dest"))).toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  it("CLI prints the preview URL and env from a pod-spec, hardcoding nothing", async () => {
    const spec = path.join(os.tmpdir(), `podbay-spec-${Date.now()}.json`);
    await fs.writeFile(
      spec,
      JSON.stringify({
        slug: "brave-otter-4f2a",
        previewUrl: "https://brave-otter-4f2a.preview.podbay.cloud",
        envName: "nextjs-starter",
        agents: { claude: {} },
        network: { policy: "full" },
      }),
    );
    try {
      const run = (args: string[]) =>
        execFileSync("bash", [cli, ...args], { env: { ...process.env, PODBAY_SPEC: spec } })
          .toString();
      const info = run(["info"]);
      expect(info).toContain("brave-otter-4f2a");
      expect(info).toContain("nextjs-starter");
      expect(info).toContain("https://brave-otter-4f2a.preview.podbay.cloud");
      // Literacy: info must surface the relay egress + the wider CLI, so an agent that
      // reaches here (the rules point it at `podbay info`) learns the tools exist.
      expect(info).toContain("relay:");
      expect(info).toContain("PODBAY_RELAY_PROXY");
      expect(info).toMatch(/tools:.*podbay msg/);
      expect(run(["preview"]).trim()).toBe("https://brave-otter-4f2a.preview.podbay.cloud");
    } finally {
      await fs.rm(spec, { force: true });
    }
  });
});

/**
 * Runtime-literacy content guard: the always-loaded rules must name the capabilities an
 * agent is otherwise liable to reinvent (runtime-literacy-v0 spec). The specific trigger
 * — an agent restoring tailscale for egress while the podbay relay ran — is why the relay
 * MUST be named in the always-in-context layer, not just an on-demand skill.
 */
describe("runtime-rules.md names the podbay capability surface", () => {
  const rules = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pod-base", "runtime-rules.md"),
    "utf8",
  );
  it("names the relay as the sanctioned egress and warns off tailscale/VPN", () => {
    expect(rules).toContain("PODBAY_RELAY_PROXY");
    expect(rules).toContain("podbay relay status");
    expect(rules).toMatch(/tailscale/i);
    expect(rules).toMatch(/not evasion|opposite of/i); // the reconciliation with the no-evasion rule
  });
  it("names inter-pod messaging, fetch, and the secrets command", () => {
    expect(rules).toContain("podbay msg");
    expect(rules).toContain("podbay fetch get");
    expect(rules).toContain("podbay secrets");
  });
});

/**
 * A codex SECONDARY agent must be configured too.
 *
 * Three init.sh blocks answer "which agent is this pod's codex?" and they had
 * drifted: the standalone RC binary used ANY declared agent, while the skills copy
 * and the AGENTS.md assembly used agents[0]. So every `agents: [claude-code, codex]`
 * pod — byo-project and nextjs-starter, i.e. everything we ship with two agents —
 * ran codex with no skills and none of the podbay runtime rules, including
 * confirm-before-outbound. These pin the DEFAULT derivation from the spec, with no
 * explicit override, because the override is what the old tests supplied and the
 * default is what was wrong.
 */
describe("codex config reaches a codex SECONDARY agent", () => {
  async function block(marker: string): Promise<string> {
    // codex-skills-translate + codex-agents-rules now live in refresh-common.sh (shared with
    // podbay-refresh); init.sh sources + calls them.
    const src = await fs.readFile(refreshLib, "utf8");
    const after = src.split(`>>> podbay:${marker}`)[1];
    expect(after, `sentinel block ${marker} must exist`).toBeTruthy();
    return after!.slice(after!.indexOf("\n") + 1).split(`<<< podbay:${marker}`)[0]!;
  }
  async function spec(dir: string, agents: string[]): Promise<string> {
    const p = path.join(dir, "pod-spec.json");
    await fs.writeFile(p, JSON.stringify({ agents }));
    return p;
  }

  async function runSkills(dir: string, agents: string[]): Promise<boolean> {
    await fs.mkdir(path.join(dir, "src", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "demo", "SKILL.md"), "x");
    execFileSync("bash", ["-c", await block("codex-skills-translate")], {
      env: {
        ...process.env,
        PODBAY_SPEC: await spec(dir, agents),
        CODEX_SKILLS_SRC: path.join(dir, "src"),
        CODEX_SKILLS_DEST: path.join(dir, "dest"),
        CODEX_SKILLS_OWNER: os.userInfo().username,
      },
    });
    return fs
      .stat(path.join(dir, "dest", "demo", "SKILL.md"))
      .then(() => true)
      .catch(() => false);
  }

  it("copies skills when codex is declared but NOT primary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-sec-"));
    expect(await runSkills(dir, ["claude-code", "codex"])).toBe(true);
  });

  it("still copies nothing for a claude-only pod", async () => {
    // The fix must not turn every pod into a codex pod — that would ship codex
    // config to pods that cannot run it.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-sec-"));
    expect(await runSkills(dir, ["claude-code"])).toBe(false);
  });

  it("writes the AGENTS.md rules block when codex is declared but NOT primary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-sec-"));
    const raw = await block("codex-agents-rules");
    const heredoc = raw.split("<<'PY'")[1]!;
    const py = heredoc.slice(heredoc.indexOf("\n") + 1).split("\nPY")[0]!;
    const script = path.join(dir, "agents.py");
    await fs.writeFile(script, py);
    const runtime = path.join(dir, "runtime-rules.md");
    await fs.writeFile(runtime, "UNIVERSAL: confirm before outbound.");
    const rulesDir = path.join(dir, "rules");
    await fs.mkdir(rulesDir, { recursive: true });
    const dst = path.join(dir, "AGENTS.md");
    // PODBAY_AGENT deliberately NOT set — the spec is the only signal, which is
    // exactly the path that was broken.
    execFileSync("python3", [script], {
      env: {
        ...process.env,
        PODBAY_SPEC: await spec(dir, ["claude-code", "codex"]),
        PODBAY_CODEX_AGENTS: dst,
        PODBAY_RUNTIME_RULES: runtime,
        PODBAY_ENV_RULES_DIR: rulesDir,
      },
    });
    const out = await fs.readFile(dst, "utf8").catch(() => null);
    expect(out, "codex secondary must still get the podbay rules block").toBeTruthy();
    expect(out).toContain("confirm before outbound");
  });
});

// Regression guard (2026-08-18): init.sh sources refresh-common.sh under `set -e`, so the Incus
// payload MUST ship every file podbay-init needs, or every pod fails to boot. A boot-breaking image
// shipped once because make-payload.sh's copy list didn't include refresh-common.sh / podbay-refresh
// (they were only in the Dockerfile). This asserts the packaging list covers what init.sh sources.
describe("pod-base packaging ships what init.sh needs", () => {
  it("make-payload.sh copies every file podbay-init sources at boot", async () => {
    const init = await fs.readFile(initSh, "utf8");
    const payload = await fs.readFile(path.join(podBase, "../../../scripts/incus/make-payload.sh"), "utf8");
    // Files init.sh `. `-sources from /usr/local/bin (the ones a missing copy would brick boot on).
    const sourced = [...init.matchAll(/^\s*\.\s+\/usr\/local\/bin\/([\w.-]+)/gm)].map((m) => m[1]);
    expect(sourced, "init.sh should source at least refresh-common.sh").toContain("refresh-common.sh");
    for (const f of sourced) {
      expect(
        payload.includes(`/usr/local/bin/${f}`),
        `make-payload.sh must stage /usr/local/bin/${f} (init.sh sources it under set -e)`,
      ).toBe(true);
    }
    // podbay-refresh is the on-demand entry the control plane execs — ship it too.
    expect(payload).toContain("/usr/local/bin/podbay-refresh");
  });
});
