import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtySession } from "../src/session.js";
import { driveLoginMenu } from "../src/greeter.js";
import { extractLinks } from "../src/signals.js";

/**
 * The REAL-CLI golden path (agent-cli-drift-guard). Unlike the fake-stack web e2e, this boots the
 * ACTUAL claude/codex binary and runs the pod-agent's OWN onboarding + login-drive + link capture
 * against it — so it fails EXACTLY when a CLI version bump changes the TUI enough to break sign-in
 * (the v2.1.215 theme picker did, and the fake stack couldn't see it). Ceiling: it validates only up
 * to the sign-in ARTIFACT (a complete OAuth URL / device code) — it does NOT complete the browser
 * OAuth (no creds in CI). It SKIPS cleanly where a real tmux/PTY/binary isn't available.
 */

const sessions: PtySession[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.killSession().catch(() => {});
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function have(bin: string): boolean {
  try {
    execFileSync("bash", ["-lc", `command -v ${bin}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A real tmux + PTY must be usable, or the drive/capture can't be exercised. */
function canRunRealCli(bin: string): boolean {
  if (!have("tmux") || !have(bin)) return false;
  try {
    // A no-TTY sandbox throws posix_spawnp here — that's a SKIP, not a failure.
    const s = new PtySession({ sessionName: `probe_${Date.now()}`, bootCommand: "true" });
    void s.killSession();
    return true;
  } catch {
    return false;
  }
}

function throwawayHome(): string {
  const h = mkdtempSync(join(tmpdir(), "gp-home-"));
  homes.push(h);
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OAUTH_RE = /https:\/\/(claude\.(com|ai)|[a-z.]*anthropic\.com)\/[^\s]*(oauth|login)/i;
const isComplete = (u: string) => /[?&]redirect_uri=/.test(u) && /[?&]state=/.test(u);

/** Boot real `claude /login` with a throwaway HOME, let the pod-agent's driveLoginMenu handle the
 * theme picker + API-key prompt + method menu, and poll extractLinks for a COMPLETE OAuth URL. */
async function runClaudeGoldenPath(): Promise<{ ok: boolean; url?: string; pane: string }> {
  const home = throwawayHome();
  const name = `gp_claude_${Date.now()}`;
  const s = new PtySession({ sessionName: name, cols: 100, rows: 40, bootCommand: `HOME=${home} claude /login` });
  sessions.push(s);
  await sleep(500);
  // The pod-agent's PRODUCTION drive: dismisses the theme picker + API-key prompt, then the menu.
  await driveLoginMenu({ sessionName: name, waitTimeoutMs: 45_000, confirmMs: 10_000 }).catch(() => {});
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const links = await extractLinks(name);
    const url = links.find((u) => OAUTH_RE.test(u) && isComplete(u));
    if (url) return { ok: true, url, pane: "" };
    await sleep(1_000);
  }
  const pane = execFileSync("tmux", ["capture-pane", "-pJ", "-t", name]).toString();
  return { ok: false, pane };
}

/** Boot real `codex login --device-auth`; assert the device URL + one-time code are produced. */
async function runCodexGoldenPath(): Promise<{ ok: boolean; url?: string; code?: string; pane: string }> {
  const home = throwawayHome();
  const name = `gp_codex_${Date.now()}`;
  const s = new PtySession({ sessionName: name, cols: 100, rows: 40, bootCommand: `HOME=${home} codex login --device-auth` });
  sessions.push(s);
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const pane = execFileSync("tmux", ["capture-pane", "-pJ", "-t", name]).toString();
    const links = await extractLinks(name);
    const url = links.find((u) => /https?:\/\/[^\s]*(openai|chatgpt|codex|device)/i.test(u));
    const code = pane.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
    if (url && code) return { ok: true, url, code, pane };
    await sleep(1_000);
  }
  const pane = execFileSync("tmux", ["capture-pane", "-pJ", "-t", name]).toString();
  return { ok: false, pane };
}

describe("agent CLI golden path (real binary + tmux)", () => {
  it.runIf(canRunRealCli("claude"))(
    "claude: onboarding is auto-handled and a COMPLETE OAuth URL is produced + captured",
    async () => {
      const r = await runClaudeGoldenPath();
      // On failure, the pane is the diagnostics a build gate / canary would surface.
      expect(r.ok, `no complete OAuth URL captured. Pane:\n${r.pane}`).toBe(true);
      expect(isComplete(r.url!)).toBe(true);
    },
    90_000,
  );

  it.runIf(canRunRealCli("codex"))(
    "codex: device-auth URL + one-time code are produced + captured",
    async () => {
      const r = await runCodexGoldenPath();
      expect(r.ok, `no device URL + code captured. Pane:\n${r.pane}`).toBe(true);
    },
    90_000,
  );

  it.skipIf(canRunRealCli("claude") || canRunRealCli("codex"))(
    "skips cleanly where the real CLI/tmux is unavailable (no spurious failure)",
    () => {
      expect(true).toBe(true);
    },
  );
});
