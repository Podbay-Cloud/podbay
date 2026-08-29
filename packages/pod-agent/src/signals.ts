import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

/** Login state for the agent's credentials file: exists? + a short content
 * hash the gateway uses to detect a new/refreshed login (never the secret). */
export function credentialState(agent: string, credsPath: string): {
  agent: string;
  authed: boolean;
  hash: string;
  /** The credentials file exists but its token is DEAD (past its hard expiry) — the agent is
   * effectively logged out even though the file is present. This is the blind spot that hid an
   * expired claude login on a prod pod for weeks (2026-08-22): `authed` used to be file-presence. */
  expired: boolean;
  /** The HARD-expiry epoch (ms) of the refresh token, when the credential shape exposes it — the
   * moment past which no refresh is possible. Drives the "sign-in expiring soon" fault (the
   * keepalive isn't keeping up). null when unknown (odd shape, API key, or unreadable). */
  expiresAt: number | null;
} {
  try {
    const content = readFileSync(credsPath, "utf8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    if (content.trim().length === 0) return { agent, authed: false, hash, expired: false, expiresAt: null };
    const expiresAt = credentialExpiresAt(agent, content);
    const expired = expiresAt != null && expiresAt < Date.now();
    return { agent, authed: !expired, hash, expired, expiresAt };
  } catch {
    return { agent, authed: false, hash: "", expired: false, expiresAt: null };
  }
}

/** The hard-expiry epoch (ms) from a credential blob, or null when the shape doesn't expose one.
 * Same fields credentialExpired reads — factored so both the expired check and the "expiring soon"
 * fault share ONE definition of where the ceiling lives. */
function credentialExpiresAt(agent: string, content: string): number | null {
  try {
    const j = JSON.parse(content) as Record<string, unknown>;
    if (agent === "codex") {
      const t = ((j.tokens as Record<string, unknown>) ?? j) as Record<string, unknown>;
      return num(t.refresh_token_expires_at) ?? num(t.expires_at) ?? num(t.expiry);
    }
    const o = ((j.claudeAiOauth as Record<string, unknown>) ?? j) as Record<string, unknown>;
    return num(o.refreshTokenExpiresAt);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Chars that may legally continue a URL on the next screen row (no whitespace). */
const URL_CONTINUATION = /^[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]+$/;

export interface TmuxExecOpts {
  /** Run tmux as this uid/gid — MUST match the uid the session was spawned
   * with: tmux's server socket lives in /tmp/tmux-<uid>, so a root process
   * querying a dev-owned session finds no server and silently sees nothing. */
  uid?: number;
  gid?: number;
}

function tmux(args: string[], opts: TmuxExecOpts = {}): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "tmux",
      args,
      { maxBuffer: 4 * 1024 * 1024, uid: opts.uid, gid: opts.gid },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
}

/**
 * Extract the most recent URLs from a tmux session. Two wrapping regimes:
 * - Plain output wrapped by tmux: joined-line capture (`-J`) recovers it whole.
 * - TUI screens (e.g. the Claude login box) draw a long URL as SEPARATE
 *   full-width rows — nothing is "wrapped" from tmux's perspective, so `-J`
 *   can't help. We rejoin those: while a URL match runs to the end of a
 *   full-width row and the next row is pure URL-charset, append it.
 * Returns up to `limit` most-recent unique URLs (most recent last); fragments
 * that are strict prefixes of a longer recovered URL are dropped.
 */
export async function extractLinks(
  sessionName: string,
  opts: { scrollback?: number; limit?: number } & TmuxExecOpts = {},
): Promise<string[]> {
  const scrollback = opts.scrollback ?? 200;
  const limit = opts.limit ?? 5;
  const exec: TmuxExecOpts = { uid: opts.uid, gid: opts.gid };

  const text = await tmux(["capture-pane", "-pJ", "-S", `-${scrollback}`, "-t", sessionName], exec);
  if (!text) return [];

  const lines = text.split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(line))) {
      let url = m[0];
      // The claude /login TUI slices a long URL across consecutive rows, each cut at the pane boundary
      // — but ~2 chars SHORT of the full pane width, so the OLD gate `line.length >= paneWidth - 1`
      // never fired (and its `next.length < paneWidth - 1` broke on every middle row): the trailing
      // `&state=…` was dropped, the URL never completed, and the wizard hung on "Getting the sign-in
      // link…", flaky by pane width (velsa, 2026-08-25). Now: if the match runs to the row end, keep
      // appending the following PURE-URL rows — with NO width math. A row that isn't wholly URL-charset
      // (empty, a shell prompt with its trailing space, or prose with spaces) ends the rejoin, which is
      // exactly the real URL's boundary.
      if (m.index + m[0].length === line.length) {
        for (let row = i + 1; row < lines.length; row++) {
          const next = lines[row];
          if (!next || !URL_CONTINUATION.test(next)) break;
          url += next;
          i = row; // consumed — don't re-scan these rows as fresh fragments
        }
      }
      found.push(url);
    }
  }

  const unique = [...new Set(found)];
  // Drop truncated fragments when a longer version was recovered.
  const complete = unique.filter((u) => !unique.some((v) => v !== u && v.startsWith(u)));
  return complete.slice(-limit);
}

/**
 * Non-whitespace characters currently VISIBLE in the pane (no scrollback).
 * ~0 while a TUI agent is still cold-starting on a blank screen — the client
 * uses this to show a "starting the CLI…" state until something paints.
 */
export async function paneCharCount(sessionName: string, opts: TmuxExecOpts = {}): Promise<number> {
  const text = await tmux(["capture-pane", "-p", "-t", sessionName], opts);
  return (text.match(/\S/g) ?? []).length;
}

/** The pane's visible text (the current screen). Used for the terminal recorder. */
export async function capturePane(sessionName: string, opts: TmuxExecOpts = {}): Promise<string> {
  return tmux(["capture-pane", "-p", "-t", sessionName], opts);
}

export interface RawWindow {
  index: number;
  name: string;
  active: boolean;
}

/** tmux list-windows format string: index<TAB>name<TAB>active. */
export const WINDOW_FORMAT = "#{window_index}\t#{window_name}\t#{window_active}";

/** Parse `tmux list-windows -F WINDOW_FORMAT` output. Pure — unit-tested. A window
 * name may itself contain tabs? No: tmux names can't contain a literal tab in -F
 * output, so split on \t is safe. Bad lines are dropped, result sorted by index. */
export function parseWindowList(out: string): RawWindow[] {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [idx, name, active] = l.split("\t");
      return { index: Number(idx), name: name ?? "", active: active === "1" };
    })
    .filter((w) => Number.isInteger(w.index))
    .sort((a, b) => a.index - b.index);
}

/** The session's tmux windows, in index order — the source of the web terminal's
 * tab strip (docs/plans/multi-agent-plan.md, "cheap-tabs"). tmux is the multiplexer;
 * this just reads its window list. Returns [] on any tmux error (never throws into
 * the tick loop). */
export async function listWindows(
  sessionName: string,
  opts: TmuxExecOpts = {},
): Promise<RawWindow[]> {
  try {
    return parseWindowList(
      await tmux(["list-windows", "-t", sessionName, "-F", WINDOW_FORMAT], opts),
    );
  } catch {
    return [];
  }
}

/** The tmux target for the AGENT's window. The agent boots in the lowest-index
 * window (the launcher's); everything that must reach the AGENT specifically —
 * the greeter's RC/kickoff typing, scheduled-job injection, the kickoff respawn —
 * must target it, NOT `main` (which resolves to whatever window the user switched
 * to). This is the fix for the Exp-1 finding that `-t main` follows the active
 * window. `windows` MUST be index-sorted (listWindows/parseWindowList are). Falls
 * back to the bare session (active window) when the list is empty — correct when
 * there is only one window. */
export function targetForWindows(sessionName: string, windows: RawWindow[]): string {
  return windows.length > 0 ? `${sessionName}:${windows[0].index}` : sessionName;
}

/** Resolve the agent's window target live from tmux. */
export async function agentWindowTarget(
  sessionName: string,
  opts: TmuxExecOpts = {},
): Promise<string> {
  return targetForWindows(sessionName, await listWindows(sessionName, opts));
}

/**
 * Start an agent in a NEW tmux window on a LIVE session (multi-agent slice 3).
 *
 * Deliberately additive: we do NOT recreate the pod to change its agent set, because
 * a recreate kills the running agent's session — the very session the user is adding
 * a partner to. Creating a window leaves the existing agent untouched.
 *
 * Idempotent by NAME: the window is named after the agent, so a repeated add finds
 * the existing window and returns its index rather than spawning a second copy.
 * Returns the window index, or null if tmux refused.
 */
export async function spawnAgentWindow(
  sessionName: string,
  agent: string,
  command: string,
  opts: TmuxExecOpts = {},
): Promise<number | null> {
  const existing = (await listWindows(sessionName, opts)).find((w) => w.name === agent);
  if (existing) return existing.index;
  try {
    // -d: create it in the background so we do not yank the user's active tab
    // out from under them mid-task.
    await tmux(
      ["new-window", "-d", "-t", sessionName, "-n", agent, "-c", "/home/dev/work", command],
      opts,
    );
  } catch {
    return null;
  }
  return (await listWindows(sessionName, opts)).find((w) => w.name === agent)?.index ?? null;
}

/** Switch the session's active window (a tab click). No-op safe: tmux errors are swallowed. */
export async function selectWindow(
  sessionName: string,
  index: number,
  opts: TmuxExecOpts = {},
): Promise<void> {
  try {
    await tmux(["select-window", "-t", `${sessionName}:${index}`], opts);
  } catch {
    /* window may have closed between list and click — ignore */
  }
}

/** Open a new shell window in the session, rooted at ~/work, and make it active
 * (the tab strip's "+"). Best-effort — a tmux hiccup shouldn't crash the client. */
export async function newWindow(sessionName: string, opts: TmuxExecOpts = {}): Promise<void> {
  try {
    await tmux(["new-window", "-t", sessionName, "-c", "/home/dev/work"], opts);
  } catch {
    /* ignore — the client re-reads the window list on the next refresh */
  }
}

/** Cheap non-crypto hash so the recorder only writes when the screen changed. */
export function paneHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

export interface IdleStatus {
  idleMs: number;
  idle: boolean;
  ready: boolean;
}

export function idleStatus(idleMs: number, thresholdMs: number, ready: boolean): IdleStatus {
  return { idleMs, idle: idleMs >= thresholdMs, ready };
}

/** Where Claude Code records each session, incl. the RC bridge id once active. */
const SESSIONS_DIR = "/home/dev/.claude/sessions";

/**
 * Is this session file's owning process still running? `<pid>.json` files are
 * left behind on exit, so "the file exists" says nothing about the session. On
 * Linux /proc is the cheap, permission-free answer (we share the pod with the
 * CLI, so no cross-user surprises).
 */
function pidAlive(name: string): boolean {
  return /^\d+$/.test(name) && existsSync(`/proc/${name}`);
}

/**
 * Claude Code's own view of a session, read from `~/.claude/sessions/<pid>.json`
 * rather than scraped from the terminal.
 *
 * - `bridgeSessionId` ("session_…") appears once remote control is active → the
 *   hand-off URL is `https://claude.ai/code/<bridgeSessionId>`. Robust where
 *   pane-scraping isn't: the printed URL wraps across Claude's TUI box padding.
 * - `status` is the agent's REAL state — `busy` | `shell` | `idle` | `waiting`.
 *   This is the honest "is it working?" signal. Terminal output is NOT: measured
 *   live 2026-07-17, a session sitting at `waiting` repaints every ~15–32s, so
 *   output-based idle resets forever and the pod never sleeps (5h+ observed),
 *   while `busy` pairs with ~0ms idle. See docs/plans/pre-alpha-plan.md P0.1.
 *
 * Files are named `<pid>.json` and OUTLIVE their process (a killed/restarted CLI
 * leaves its last state behind), so we only read sessions whose pid is still
 * alive. A stale file otherwise reports a dead session's `busy` (pod never
 * sleeps) or its `bridgeSessionId` (we believe remote control is on when it
 * isn't, and hand out a dead URL).
 */
export function sessionStateFromDisk(): { url?: string; status?: string; waitingFor?: string } {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR);
  } catch {
    return {};
  }
  const out: { url?: string; status?: string; waitingFor?: string } = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    if (!pidAlive(f.slice(0, -".json".length))) continue;
    try {
      const j = JSON.parse(readFileSync(`${SESSIONS_DIR}/${f}`, "utf8")) as {
        bridgeSessionId?: unknown;
        status?: unknown;
        waitingFor?: unknown;
      };
      // `waitingFor: "dialog open"` — the CLI telling us a modal is blocking the
      // session. Read live 2026-07-17 off a pod stuck on the Remote Control menu.
      if (!out.waitingFor && typeof j.waitingFor === "string") out.waitingFor = j.waitingFor;
      if (!out.url && typeof j.bridgeSessionId === "string" && j.bridgeSessionId.startsWith("session_")) {
        out.url = `https://claude.ai/code/${j.bridgeSessionId}`;
      }
      // Any session that's actively working wins — a pod is "working" if ANY of
      // its sessions is busy/running a shell.
      if (typeof j.status === "string" && (!out.status || j.status === "busy" || j.status === "shell")) {
        out.status = j.status;
      }
    } catch {
      // skip unreadable/partial files
    }
  }
  return out;
}

const CLAUDE_PROJECTS_DIR = "/home/dev/.claude/projects";
const CODEX_SESSIONS_DIR = "/home/dev/.codex/sessions";

/** Parse the timestamp of the LAST entry in a Claude transcript. Reads only the file's TAIL so a huge
 * transcript costs a bounded read, not a full slurp. Claude appends one JSON object per line, each
 * with a top-level `"timestamp":"<ISO>"`. Returns epoch ms of the newest line that has one, else 0. */
function lastTimestampInJsonl(file: string): number {
  let fd = -1;
  try {
    const size = statSync(file).size;
    if (size === 0) return 0;
    const readBytes = Math.min(size, 65536);
    fd = openSync(file, "r");
    const buf = Buffer.alloc(readBytes);
    readSync(fd, buf, 0, readBytes, size - readBytes);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/"timestamp"\s*:\s*"([^"]+)"/);
      if (m) {
        const t = Date.parse(m[1]);
        if (Number.isFinite(t)) return t;
      }
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd >= 0) try { closeSync(fd); } catch { /* already closed */ }
  }
}

/**
 * The HONEST "last active" signal: ms since the agent's most recent transcript entry — a message,
 * tool CALL, or tool RESULT — across Claude and Codex. This is the same source the Claude app shows
 * ("active 5h ago"), and it correctly reports a pod that's mid-task (running a tool logs entries) as
 * recent, while a genuinely-quiet pod ages. It is NOT `idleMs` (terminal OUTPUT time — spinners and
 * redraws tick it) and NOT the file mtime (touched by non-message re-saves). Claude carries a
 * per-entry ISO `timestamp` we parse; Codex has no such field we read, so its rollout file MTIME
 * stands in (honest per codexActivityFromDisk). Returns null when nothing has been written yet.
 */
export function lastAgentActivityMs(
  now = Date.now(),
  claudeRoot = CLAUDE_PROJECTS_DIR,
  codexRoot = CODEX_SESSIONS_DIR,
): number | null {
  let newest = 0;
  const walk = (dir: string, depth: number, maxDepth: number, onFile: (path: string, name: string) => void): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = `${dir}/${name}`;
      try {
        const st = statSync(p);
        if (st.isDirectory()) {
          if (depth < maxDepth) walk(p, depth + 1, maxDepth, onFile);
        } else {
          onFile(p, name);
        }
      } catch {
        /* skip */
      }
    }
  };
  // Claude: newest per-entry timestamp across all transcripts.
  walk(claudeRoot, 0, 5, (p, name) => {
    if (!name.endsWith(".jsonl")) return;
    const ts = lastTimestampInJsonl(p);
    if (ts > newest) newest = ts;
  });
  // Codex: rollout file mtime (no parseable per-entry timestamp).
  walk(codexRoot, 0, 3, (p, name) => {
    if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) return;
    try {
      const m = statSync(p).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* skip */
    }
  });
  if (newest === 0) return null;
  return Math.max(0, now - newest);
}
/** Codex writes NO live state file (unlike Claude), and its TUI can't be reliably scraped
 * (stripped binary; the pane is often not even rendering). But it APPENDS to a rollout log
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` as it works — every message / tool call /
 * tool result. So the newest rollout's MTIME is an honest activity signal that survives
 * Codex version bumps: fresh ⇒ working, stale ⇒ idle. Null when Codex has no session yet. */
const CODEX_BUSY_MS = 60_000;
export function codexActivityFromDisk(
  now = Date.now(),
  root = CODEX_SESSIONS_DIR,
): "busy" | "idle" | null {
  let newest = 0;
  const walk = (dir: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = `${dir}/${name}`;
      try {
        const st = statSync(p);
        if (st.isDirectory()) {
          if (depth < 3) walk(p, depth + 1); // YYYY/MM/DD nesting, bounded
        } else if (name.startsWith("rollout-") && name.endsWith(".jsonl")) {
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        }
      } catch {
        /* skip */
      }
    }
  };
  walk(root, 0);
  if (newest === 0) return null; // no session written yet — Codex is present but hasn't run
  return now - newest < CODEX_BUSY_MS ? "busy" : "idle";
}
