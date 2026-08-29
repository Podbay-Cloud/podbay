import http from "node:http";
import { existsSync, appendFileSync, statSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { OomWatcher } from "./oom-watcher.js";
import { parseOomKillCount } from "./oom-cgroup.js";
import { TunnelMux } from "./relay-tunnel.js";
import { RelayProxy } from "./relay-proxy.js";
import { hostname } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { handleControlMessage, takeOutcomes, type ControlDeps } from "./control-link.js";
import { parseClientMessage, RELAY_LIMITS, type AgentMessage, type WindowInfo } from "@podbay/shared";
import { createLogger, type Logger } from "@podbay/shared/log";
import { PtySession, type PtySessionOptions } from "./session.js";
import {
  extractLinks,
  idleStatus,
  paneCharCount,
  capturePane,
  paneHash,
  credentialState,
  sessionStateFromDisk,
  codexActivityFromDisk,
  lastAgentActivityMs,
  listWindows,
  selectWindow,
  newWindow,
  spawnAgentWindow,
} from "./signals.js";
import { runGreeter, driveLoginMenu, startResumeWatch, type GreeterOptions } from "./greeter.js";
import { classifyGate, authFailureInPane, agentGone, type GateKind } from "@podbay/shared/pane";
import type { RcState } from "@podbay/shared/protocol";
import { classifyRcState, isOrphanedRcYield, shouldAttemptRcRestore } from "./rc-state.js";
import { credentialsPathForAgent, sanitizeSessionName } from "./boot.js";
import { shouldRepair, pruneHistory, isCapped, recoveryDue, type RepairAttempt } from "./repair-policy.js";
import {
  collectDescendants,
  devServerProcess,
  declaredStartupProcesses,
  leadingCdPath,
  isSupervisionPaused,
  nextCacheDir,
  parseListeningPids,
  pausePath,
  pidfileState,
  respawnStartupProcess,
  shouldCleanNextCache,
  SUPERVISE_PAUSE_DIR,
  type StartupProcess,
} from "./startup-supervisor.js";
import { computeIssues } from "./health-checks.js";
import { parseMem } from "./metrics.js";
import { MetricsSampler, realSamplerDeps } from "./metrics.js";
import { PreviewShotter } from "./preview-shot.js";
import { setGithubToken, githubStatus, clearGithubToken, listRepos, cloneRepo, ghDeviceStart, ghDevicePoll } from "./gh-auth.js";
import { readRequests, addRequest, removeRequest, setKeysIn } from "./secret-requests.js";

/** The remote-control hand-off URL Claude Code prints when `/remote-control` is active. */
const SESSION_URL_RE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;
/** Claude's OAuth sign-in URL (same shape the gateway matches on the links frame). */
const AUTH_URL_RE = /https:\/\/(claude\.(com|ai)|[a-z.]*anthropic\.com)\/[^\s]*(oauth|login)/i;
/** A captured OAuth URL is only usable once the WHOLE thing has painted. The claude TUI hard-wraps
 * the sign-in URL across ~6 pane lines, so a health tick that samples MID-RENDER can grab a partial —
 * and the partial is CACHED STICKILY, so a truncated URL sticks forever. `redirect_uri` alone is not
 * enough: it appears EARLY (line 2), so a 5-of-6-line capture ending at `…code_challenge_method=S256`
 * still has it but is missing the trailing `&state=…`, which OAuth requires — Claude then rejects it
 * as "Missing state parameter" (velsa hit this on afisha, 2026-08-22). `state` is the LAST param, so
 * requiring BOTH redirect_uri AND state proves the URL painted end-to-end before we cache it. We keep
 * re-capturing each tick until then. Non-oauth `/login` URLs pass through unchanged. */
const isCompleteAuthUrl = (u: string): boolean =>
  !/oauth/i.test(u) || (/[?&]redirect_uri=/.test(u) && /[?&]state=/.test(u));
/** Strip ANSI so a device code isn't split by colour escapes. */
const stripAnsiText = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

/** Walk the container's cgroup-v2 tree and read every `memory.events` `oom_kill` count,
 * keyed by cgroup path. This is the OOM signal readable INSIDE an Incus container (dmesg
 * is not). Records even a 0 so a later increment on that cgroup is detectable. Cheap:
 * a pod's tree is a handful of small files. */
function readCgroupOomCounts(root = "/sys/fs/cgroup"): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (dir: string, rel: string): void => {
    try {
      out[rel || "/"] = parseOomKillCount(readFileSync(`${dir}/memory.events`, "utf8"));
    } catch {
      /* no memory.events at this level (e.g. the cgroup-ns root) — skip */
    }
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}/${e.name}`, `${rel}/${e.name}`);
      }
    } catch {
      /* unreadable dir — skip */
    }
  };
  walk(root, "");
  return out;
}

/** The Codex STANDALONE build's binary — the daemon (`remote-control start`) hard-fails
 * without it (the npm codex can't daemonize). init.sh seeds it here from the image. */
const CODEX_STANDALONE = "/home/dev/.codex/packages/standalone/current/codex";
/** Owner turned Codex remote control OFF (cockpit toggle). Lives on the home
 * volume so the choice survives restarts/updates — ensureCodexDaemon honors it
 * on every boot/wake instead of silently re-enabling. */
const CODEX_RC_OFF = "/home/dev/.podbay/codex-rc-off";
/** Podbay has YIELDED Claude's remote-control to an external harness (T3 Code):
 * stop re-running the `/remote-control` greeter on boot/resume so Podbay and the
 * harness don't fight for the tmux session. Symmetric to CODEX_RC_OFF; on the
 * home volume so the yield survives restart/resume. Credentials are NOT touched —
 * the agent stays signed in and the harness drives it with the same on-disk login.
 * Cleared when control is handed back. */
const CLAUDE_RC_OFF = "/home/dev/.podbay/claude-rc-off";
const PODBAY_STARTUP_JSON = "/home/dev/.podbay/startup.json";
/** The two CLIs a pod can host. A tmux window NAMED after one hosts that agent
 * (spawnAgentWindow names added-agent windows this way — the pod-side registry). */
const AGENT_IDS = ["claude-code", "codex"] as const;

/** Owner-facing label for a stuck gate the watchdog surfaces (3b). */
function gateLabel(gate: GateKind): string {
  switch (gate) {
    case "login-menu": return "the sign-in menu";
    case "api-key": return "the API-key prompt";
    case "bypass": return "the permissions prompt";
    case "trust": return "the folder-trust prompt";
    case "proceed": return "a confirmation only you can answer";
    case "login-continue": return "the post-login continue prompt";
    case "oauth-retry": return "a rejected sign-in code — reconnect to try again";
  }
}

/** Rolling, timestamped record of the terminal (on-change pane snapshots), so the
 * Claude CLI's transient states (a /login prompt, a billing-mode flip) are
 * inspectable post-mortem instead of gone by the time anyone SSHes in. Bounded;
 * owner-scoped on the pod's volume. */
const TERMINAL_LOG = "/home/dev/.podbay-terminal.log";
const TERMINAL_LOG_CAP = 1_000_000; // ~1MB; truncated to the last half when exceeded


export interface AgentServerOptions extends PtySessionOptions {
  /** Bind host — pod-internal by default (control plane is the security boundary). */
  host?: string;
  port?: number;
  idleThresholdMs?: number;
  /** How often to push status + refresh links (ms). */
  tickMs?: number;
  /** Login→kickoff separation: when the pod boots unauthenticated and this is
   * set, the window is respawned into `command` once `credsPath` appears —
   * the login process dies and an agent-led kickoff session starts fresh. */
  authedRespawn?: { credsPath: string; command: string };
  /** The pod's agent + its credentials file, so status reports login state
   * (clients — and later the launch wizard — read it; nothing is captured). */
  credential?: { agent: string; path: string };
  /** The pod's user-facing display name — what the Codex app should show for this
   * pod's remote-control device. Codex exposes NO --name flag (verified on 0.145.0:
   * `remote-control start` takes only -c overrides), so the pod reports it at pairing
   * time. Absent → the machine hostname, which is the pod slug. Claude already uses
   * the same name for its RC session title, so both apps now agree with the dashboard. */
  displayName?: string;
  /** Every agent the pod's SPEC declares (primary first). The watchdog compares
   * against this — deriving the list from running windows would make a missing
   * agent invisible to the check meant to notice it (caught in live testing,
   * 2026-07-29: killing an agent's window produced no repair at all). */
  declaredAgents?: string[];
  /** Builds the boot command for an agent being ADDED to a live pod (slice 3).
   * main.ts owns the pod-spec (permission mode etc.), so it supplies this rather
   * than the server guessing. Absent → /agent/add is unavailable. */
  agentCommandFor?: (agent: string) => string;
  /** Greeter (claude only): once an AUTHED session is up, enable remote control
   * + seed the kickoff trigger, with verification (see greeter.ts). Runs at
   * boot when already authed, or right after the login→kickoff respawn. */
  greeter?: Pick<GreeterOptions, "rcTitle" | "agentAuth" | "kickoffTrigger" | "resumeTrigger" | "greetedMarkerPath">;
  /** The app port the preview proxies to (Stats app-health probe). Default 3000. */
  appPort?: number | null;
}

/**
 * The in-pod terminal server: one persistent PTY/tmux session mirrored to N
 * WebSocket clients, plus sidecar status/link/health signals. No end-user auth —
 * it binds internally and trusts the control-plane connection.
 */
/** Read a request body with a hard size cap. An unauthenticated agent that binds on
 * the private network must not be OOM-able by a peer streaming an endless body. */
function readBounded(req: import("node:http").IncomingMessage, maxBytes = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      b += c;
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

export class AgentServer {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly session: PtySession;
  private readonly clients = new Set<WebSocket>();
  /** Relay fetches this pod is waiting on, by request id. */
  private readonly relayWaiters = new Map<
    string,
    (r: { status: number; body: string; error?: string }) => void
  >();
  /** Pairing-command requests this pod is waiting on, by request id. */
  private readonly pairWaiters = new Map<string, (r: { command: string; expiresAt: number }) => void>();
  /** Send on the CURRENT control socket, or null if the gateway is not connected. */
  private controlSend: ((msg: unknown) => void) | null = null;
  /** The egress tunnel: each SOCKS CONNECT on the local relay proxy becomes a stream
   * over the control link to the owner's relay. Long-lived (the control link comes and
   * goes); a link drop resets it, ending every app connection rather than stranding it. */
  private readonly tunnelMux = new TunnelMux((msg) => this.controlSend?.(msg));
  private relayProxy: RelayProxy | null = null;
  private relaySeq = 0;

  /**
   * Ask the owner's relay (via the gateway) to fetch a URL. Resolves with the result
   * or rejects — never hangs: a relay that dies mid-fetch would otherwise leak a waiter
   * and block the agent's /fetch forever.
   */
  // 30s, not 90s: a real residential page load is a few seconds; a browser that hasn't
  // answered in 30s is hung (e.g. a site stalling a headless fetch), and the relay rung
  // is now always retried (fetch-ladder never memory-skips it), so a fast-fail is cheap.
  submitRelayFetch(url: string, timeoutMs = 30_000): Promise<{ status: number; body: string; finalUrl?: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const send = this.controlSend;
      if (!send) return reject(new Error("no relay connected"));
      const id = `pr-${++this.relaySeq}-${Date.now()}`;
      const timer = setTimeout(() => {
        this.relayWaiters.delete(id);
        reject(new Error("relay timed out"));
      }, timeoutMs);
      this.relayWaiters.set(id, (r) => {
        clearTimeout(timer);
        this.relayWaiters.delete(id);
        if (r.error) reject(new Error(r.error));
        else resolve(r);
      });
      send({ type: "relay-fetch", id, url });
    });
  }

  /**
   * Ask the gateway to mint a pairing command the owner can run to bring up a relay.
   * Used when a fetch is refused everywhere and no relay is connected — the pod hands
   * the owner a ready-to-run line instead of a dead end. Never hangs.
   */
  submitRelayPairRequest(timeoutMs = 15_000): Promise<{ command: string; expiresAt: number }> {
    return new Promise((resolve, reject) => {
      const send = this.controlSend;
      if (!send) return reject(new Error("gateway not connected"));
      const id = `pair-${++this.relaySeq}-${Date.now()}`;
      const timer = setTimeout(() => {
        this.pairWaiters.delete(id);
        reject(new Error("pairing request timed out"));
      }, timeoutMs);
      this.pairWaiters.set(id, (r) => {
        clearTimeout(timer);
        this.pairWaiters.delete(id);
        resolve(r);
      });
      send({ type: "relay-pair-request", id });
    });
  }

  /** Whether the owner's relay is connected right now, per the last relay-state frame
   * the gateway pushed. Absent/unreadable/false all mean "no relay". */
  private relayConnected(): boolean {
    try {
      const statePath = process.env.PODBAY_RELAY_STATE ?? "/etc/podbay/relay-state.json";
      const s = JSON.parse(readFileSync(statePath, "utf8")) as { connected?: boolean };
      return Boolean(s.connected);
    } catch {
      return false;
    }
  }

  /**
   * If a fetch was refused by the network (not merely empty) and no relay is up, ask
   * the gateway for a pairing command the owner can run. Returns undefined when a relay
   * would not help, one is already connected, or the gateway is unreachable — in all
   * of which the plain result already carries the right advice.
   */
  private async maybeRelaySetup(
    out: { ok: boolean; reports: { outcome: string }[] },
  ): Promise<{ command: string; expiresAt: number } | undefined> {
    if (out.ok || !this.controlSend || this.relayConnected()) return undefined;
    // A relay changes network origin and identity — it helps a block/challenge/login,
    // not an empty client-rendered shell (that is the browser rung's job).
    const networkRefused = out.reports.some((r) =>
      r.outcome === "blocked" || r.outcome === "challenged" || r.outcome === "login",
    );
    if (!networkRefused) return undefined;
    return this.submitRelayPairRequest().catch(() => undefined);
  }
  private readonly opts: Required<Pick<AgentServerOptions, "host" | "port" | "idleThresholdMs" | "tickMs">>;
  private tick?: NodeJS.Timeout;
  // A lighter, faster poll JUST for the tmux window list, so a tab the user closes (its shell exits
  // — no web action we can hook) disappears from the tab strip within ~1s instead of waiting up to a
  // full tickMs (3s) for the next onTick. refreshWindows broadcasts only on change, so this is cheap.
  private windowTick?: NodeJS.Timeout;
  private refreshingWindows = false;
  private lastLinks: string[] = [];
  private lastWindows: WindowInfo[] = [];
  /** Cached index of the agent's tmux window (see agentTarget()). */
  private agentWindowIndex: number | null = null;
  /** The remote-control session URL, once seen in the terminal. Sticky (RC prints
   * it once, then it scrolls away) and reported on /healthz so the control plane
   * can persist the "Open in Claude app" link WITHOUT a client having been
   * connected to observe the frame — the boot greeter enables RC with no watcher. */
  private lastSessionUrl?: string;
  /** Last recorded pane hash — the terminal recorder only writes on change. */
  private lastPaneHash?: string;
  /** Whether the Codex remote-control daemon is up, refreshed on each tick. This is
   * an HONEST signal — "this pod is registered and available in your Codex app" —
   * NOT "an app is paired": pairing lives server-side and nothing local reveals it
   * (see codex-pair-panel.tsx). */
  private codexRcActive = false;
  /** agent id → its captured sign-in value (Claude: OAuth URL, Codex: device code).
   * Sticky: the value scrolls out of the pane seconds after it prints. */
  private readonly agentAuthValues = new Map<string, string>();
  /** Added agents whose login menu we've already driven (once each). */
  private readonly loginDriven = new Set<string>();
  /** agent id → its OWN remote-control session URL (sticky). An added Claude's RC
   * link prints in ITS window; the pod-level capture only ever watched the
   * primary's, so the added agent looked permanently unconnected. */
  private readonly agentSessionUrls = new Map<string, string>();
  /** Added agents we've already run the RC greeter for (once each per process). */
  private readonly rcEnabled = new Set<string>();
  /** Repair attempts per target ("session", or an agent id) — the watchdog's memory.
   * Bounded by pruneHistory; drives the cap that stops an infinite respawn loop. */
  private readonly repairs = new Map<string, RepairAttempt[]>();
  /** Per supervised target: consecutive respawns that came up but never SERVED on the probe
   * port. Drives the corrupted-`.next` recovery (wipe the cache after a failed-to-serve
   * respawn) and the outcome-based cap (a respawn that serves clears the slate). */
  private readonly failedServes = new Map<string, number>();
  /** Targets with a post-respawn serve-check already scheduled, so ticks don't stack them. */
  private readonly serveCheckPending = new Set<string>();
  /** Recent repairs, newest last, bounded — reported on /healthz so the control
   * plane can turn them into pod EVENTS. A journal line only an operator with SSH
   * can read is not an audit trail for the owner. */
  private readonly recentRepairs: { target: string; reason: string; at: string; cause?: string }[] = [];
  /** Watches for OOM kills — reported as incidents, and used to attribute an agent
   * respawn to out-of-memory. Detection is the cgroup v2 `oom_kill` counter, NOT dmesg:
   * a container can't read the host kernel ring buffer (`Operation not permitted`), so
   * the old dmesg watcher was silently blind on the whole Incus fleet (see oom-cgroup.ts).
   * The cursor lives on tmpfs: it resets on a container recreate (correct — the cgroup
   * counters reset too) but survives a pod-agent process restart. */
  private readonly oomWatcher = new OomWatcher({
    readOomCounts: () => readCgroupOomCounts(),
    // null when never written yet → scan() baselines instead of replaying historical counts.
    readCursor: () => {
      try {
        return JSON.parse(
          readFileSync(process.env.PODBAY_OOM_CURSOR ?? "/run/podbay-oom-cursor", "utf8"),
        ) as Record<string, number>;
      } catch {
        return null;
      }
    },
    writeCursor: (c) => {
      try {
        writeFileSync(process.env.PODBAY_OOM_CURSOR ?? "/run/podbay-oom-cursor", JSON.stringify(c));
      } catch {
        /* best-effort */
      }
    },
    now: Date.now,
  });
  /** Targets that burned their attempts; reported so the cockpit can say so
   * instead of showing a state that looks transient forever. */
  private readonly cappedTargets = new Set<string>();
  /** Added agents whose window we've already respawned after their login (once each).
   * Mirrors the PRIMARY agent's maybeRespawnAuthed: the `claude /login` process must
   * be killed and the CLI restarted, or the pane sits forever on "Login successful.
   * Press Enter to continue…" — the exact state the primary path was built to avoid. */
  private readonly loginRespawned = new Set<string>();
  private readonly log: Logger;
  /** tmux queries must run as the uid that owns the session's tmux server. */
  private readonly tmuxUid?: number;
  private readonly tmuxGid?: number;
  private readonly authedRespawn?: { credsPath: string; command: string };
  private readonly credential?: { agent: string; path: string };
  private readonly agentCommandFor?: (agent: string) => string;
  private readonly declaredAgents: string[];
  private readonly displayName?: string;
  private readonly greeter?: Pick<GreeterOptions, "rcTitle" | "agentAuth" | "kickoffTrigger" | "resumeTrigger" | "greetedMarkerPath">;
  private bootedUnauthed = false;
  private respawned = false;
  private greeterStarted = false;
  private loginAssistantStarted = false;
  private stopResumeWatch?: () => void;
  private readonly metrics: MetricsSampler;
  private readonly previewShotter: PreviewShotter;
  /** Slugs with a startup stop/start/restart in flight — a second command for the same slug is refused
   * rather than allowed to spawn a competing process (overlapping restarts spawned ~6 procs all
   * crash-looping on the port; afisha-crawler, 2026-08-26). */
  private readonly startupInFlight = new Set<string>();

  constructor(options: AgentServerOptions & { logger?: Logger }) {
    this.log = options.logger ?? createLogger("pod-agent");
    this.tmuxUid = options.uid;
    this.tmuxGid = options.gid;
    this.authedRespawn = options.authedRespawn;
    this.credential = options.credential;
    this.agentCommandFor = options.agentCommandFor;
    this.declaredAgents = options.declaredAgents ?? [];
    this.displayName = options.displayName;
    this.greeter = options.greeter;
    // "Booted unauthed" = the CLI came up with no credentials, so login is still pending.
    // Track it even when there's NO kickoff to respawn into (an OSS/bare pod) so RC still
    // gets enabled after login — both sources point at the same creds file.
    const bootCredsPath = this.authedRespawn?.credsPath ?? this.credential?.path;
    if (bootCredsPath) this.bootedUnauthed = !existsSync(bootCredsPath);
    this.opts = {
      host: options.host ?? "::",
      port: options.port ?? 8080,
      idleThresholdMs: options.idleThresholdMs ?? 15 * 60 * 1000,
      tickMs: options.tickMs ?? 3000,
    };
    this.session = new PtySession(options);

    // Resource sampler for the Stats tab (docs/plans/stats-redesign-plan.md).
    this.metrics = new MetricsSampler(
      realSamplerDeps({
        homePath: "/home/dev",
        agentStatus: () => sessionStateFromDisk().status ?? null,
      }),
      { appPort: options.appPort ?? 3000 },
    );
    // Self-screenshot of the preview app for the cockpit's lightweight thumbnail (vs. a live iframe).
    this.previewShotter = new PreviewShotter({ port: options.appPort ?? 3000 });

    this.session.onData((data) => this.broadcast({ type: "output", data }));
    this.session.onExit((code) => {
      this.log.warn("pty_exit", { code, session: this.session.sessionName });
      this.broadcast({ type: "exit", code });
    });

    this.http = http.createServer((req, res) => {
      if (req.url === "/relay") {
        // Live relay-egress capacity, so `podbay relay check` can report "N of M streams in use"
        // and a workload can size its own concurrency to the cap instead of failing closed on it.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            streamsInUse: this.tunnelMux.openCount,
            streamsMax: RELAY_LIMITS.maxPerPod,
            maxPerOwner: RELAY_LIMITS.maxPerOwner,
            ratePerDomainPerMin: RELAY_LIMITS.ratePerDomainPerMin,
          }),
        );
        return;
      }
      if (req.url === "/healthz") {
        const ok = this.session.isAlive;
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
        // idleMs = time since the last terminal output. This ticks during
        // remote-control / background work (which bypasses the gateway), so the
        // control-plane idle policy can avoid suspending a pod mid-work.
        // agentStatus is Claude's OWN state (busy|shell|idle|waiting) — the honest
        // "is it working?" signal for the idle sweep. idleMs (terminal output) is
        // kept for older CLIs / fallback, but it lies: see sessionStateFromDisk.
        const sess = sessionStateFromDisk();
        res.end(
          JSON.stringify({
            ready: ok,
            sessionName: this.session.sessionName,
            idleMs: this.session.idleMs(),
            // The HONEST "last active" signal: ms since the agent's newest transcript entry (message,
            // tool call, or tool result), the same source the Claude app shows. Unlike idleMs (which
            // is terminal-OUTPUT time and ticks on spinners), this reflects real turns/tool work.
            lastActivityMs: lastAgentActivityMs(),
            sessionUrl: this.lastSessionUrl ?? null,
            agentStatus: sess.status ?? null,
            // Codex has no live state file; this is derived from how recently it wrote to
            // its rollout log — `busy` (working) vs `idle` (quiet) vs null (no session yet).
            codexStatus: codexActivityFromDisk(),
            // The CLI's own "what am I blocked on" detail (e.g. "dialog open") —
            // lets the dashboard tell "needs an answer" apart from plain waiting.
            agentWaitingFor: sess.waitingFor ?? null,
            // Is anything serving the preview port right now? The dashboard gates
            // its Preview button on this instead of offering a dead link.
            appListening: this.metrics.appListening().listening,
            codexRcActive: this.codexRcActive,
            deviceName: this.displayName || hostname(),
            agents: this.agentStates(),
            // Targets the watchdog gave up on — a pod that is broken in a way it
            // cannot fix itself must SAY so, not sit in a state that reads as
            // "still starting" forever.
            repairGaveUp: [...this.cappedTargets],
            startupMissingDir: this.startupMissingDirs(),
            repairs: [...this.recentRepairs],
            // OOM kills the pod-agent has observed — recorded as incidents by the plane.
            ooms: this.oomWatcher.list(),
            // What is WRONG with this pod, in the owner's terms. Empty when healthy.
            issues: this.issues(),
          }),
        );
        return;
      }
      if (req.url?.startsWith("/metrics")) {
        // ?windowMs= serves that window at ITS resolution (see rollup.ts tiers), so
        // a 30-day view costs hourly points rather than a month of minutes.
        const q = req.url.includes("?") ? new URLSearchParams(req.url.split("?")[1]) : null;
        const w = Number(q?.get("windowMs"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.metrics.snapshot(Number.isFinite(w) && w > 0 ? w : undefined)));
        return;
      }
      if (req.url?.startsWith("/preview-shot")) {
        // A PNG thumbnail of the pod's own preview app (localhost:3000), captured with the prebaked
        // headless Chromium. 204 when nothing is serving the port, so the cockpit shows its status
        // line instead of a stale/blank image. Cache-Control none — the freshness is managed by the
        // shotter's own cache + the cockpit's poll cadence.
        if (!this.metrics.appListening().listening) {
          res.writeHead(204);
          res.end();
          return;
        }
        this.previewShotter
          .get()
          .then((buf) => {
            if (!buf) {
              res.writeHead(204);
              res.end();
              return;
            }
            res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
            res.end(buf);
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }
      // Codex remote-control pairing: mint a short-lived code the cockpit shows so
      // the user can connect their Codex app to this pod. POST (it generates state).
      if (req.method === "POST" && req.url === "/codex/pair") {
        this.codexPairingCode()
          .then((r) => {
            res.writeHead("error" in r ? 503 : 200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(r));
          })
          .catch((e: unknown) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "pair failed" }));
          });
        return;
      }
      // Run the doctor. Transport ONLY — the checks and fixes live in the CLI, so
      // the pod's own agent, an operator in the terminal, and the cockpit all run
      // exactly the same thing rather than three drifting implementations.
      // Fetch-memory exchange, both directions, on the poll the control plane already
      // makes. GET drains what this pod learned; POST installs the fleet's plan.
      // Deliberately the same shape as every other pod fact: the control plane comes
      // to us, so there is no per-pod credential to mint or leak.
      if (req.url === "/fetch-memory") {
        void (async () => {
          try {
            const { readFileSync, writeFileSync, truncateSync } = await import("node:fs");
            const reports =
              process.env.PODBAY_FETCH_REPORTS ?? "/home/dev/.podbay-fetch-reports.jsonl";
            const plan = process.env.PODBAY_FETCH_PLAN ?? "/etc/podbay/fetch-memory.json";

            if (req.method === "GET") {
              let lines: string[] = [];
              try {
                lines = readFileSync(reports, "utf8").split("\n").filter(Boolean);
              } catch {
                /* nothing buffered yet is the normal case */
              }
              // Truncate only AFTER a successful read+parse: losing a pod's reports
              // because the drain half-failed is worse than sending one twice.
              const parsed = lines.flatMap((l) => {
                try {
                  return [JSON.parse(l)];
                } catch {
                  return [];
                }
              });
              try {
                if (parsed.length) truncateSync(reports, 0);
              } catch {
                /* best-effort */
              }
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ reports: parsed }));
              return;
            }

            if (req.method === "POST") {
              const body = await readBounded(req);
              writeFileSync(plan, body || "{}");
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
              return;
            }
          } catch (e) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        })();
        return;
      }

      // Run the fetch ladder for one URL: consult the fleet's memory, climb, verify
      // each result, record what happened. Lives here rather than in the CLI because
      // the verifier is already bundled with this process — and because a route can
      // enforce the ladder, where instructions in a skill can only advise it.
      if (req.method === "POST" && req.url === "/fetch") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const { url, wanted } = JSON.parse(body || "{}") as { url?: string; wanted?: string[] };
            if (!url) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "url required" }));
              return;
            }
            const { runFetch } = await import("./fetch-runner.js");
            const out = await runFetch(url, wanted, {
              relayFetch: this.controlSend ? (u) => this.submitRelayFetch(u) : undefined,
            });
            // When the source refused this network and the owner has no relay up, hand
            // back a ready-to-run command instead of a dead end — the pod recognises it
            // cannot reach the site and offers the one fix that would.
            const relaySetup = await this.maybeRelaySetup(out);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(relaySetup ? { ...out, relaySetup } : out));
          } catch (e) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        })();
        return;
      }

      // Bounded diagnostics for support. A separate route from /doctor because it
      // is a different KIND of thing: doctor answers "what is wrong", this answers
      // "what does this machine look like" — and the second one is what an
      // operator would otherwise open a shell to find out.
      if (req.method === "POST" && req.url === "/report") {
        execFile(
          "/usr/local/bin/podbay-doctor",
          ["--report"],
          {
            uid: this.tmuxUid,
            gid: this.tmuxGid,
            timeout: 60_000,
            maxBuffer: 2_000_000,
            env: { ...process.env, HOME: "/home/dev" },
          },
          (err, stdout) => {
            if (err && !stdout) {
              res.writeHead(500, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: String(err) }));
              return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(stdout || '{"sections":[]}');
          },
        );
        return;
      }

      if (req.method === "POST" && req.url === "/doctor") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const mode = String(JSON.parse(body || "{}").mode ?? "check");
            const args = [
              "--json",
              ...(mode === "safe" ? ["--fix"] : mode === "invasive" ? ["--fix-invasive"] : []),
            ];
            execFile(
              "/usr/local/bin/podbay-doctor",
              args,
              { uid: this.tmuxUid, gid: this.tmuxGid, timeout: 120_000, env: { ...process.env, HOME: "/home/dev" } },
              (err, stdout) => {
                if (err && !stdout) {
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: String(err) }));
                  return;
                }
                this.log.info("doctor_run", { mode });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(String(stdout || '{"checked":0,"issues":[]}'));
              },
            );
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "doctor failed" }));
          }
        })();
        return;
      }
      // Codex remote-control on/off (the cockpit's toggle). OFF kills the daemon
      // and drops a sentinel on the home volume so boot/wake/login hooks don't
      // silently re-enable it; ON removes the sentinel and starts the daemon.
      if (req.method === "POST" && req.url === "/codex/rc") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const on = Boolean(JSON.parse(body || "{}").on);
            if (!this.codexOnPod()) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Codex isn't on this pod" }));
              return;
            }
            if (on) {
              // A pre-multi-agent image never seeded the codex STANDALONE build (the daemon
              // hard-fails without it), so turning RC on would SILENTLY no-op. Fail loudly and tell
              // the owner to update, instead of leaving the toggle looking broken (velsa, 2026-08-14).
              if (!existsSync(CODEX_STANDALONE)) {
                res.writeHead(409, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "This pod's image is too old for Codex remote control — update the pod (Settings → Update), then turn it on." }));
                return;
              }
              rmSync(CODEX_RC_OFF, { force: true });
              this.ensureCodexDaemon("toggle-on");
            } else {
              mkdirSync("/home/dev/.podbay", { recursive: true });
              writeFileSync(CODEX_RC_OFF, `${new Date().toISOString()}\n`);
              await new Promise<void>((resolve) =>
                execFile("pkill", ["-f", "app-server --remote-control"], () => resolve()),
              );
              this.codexRcActive = false;
            }
            this.log.info("codex_rc_toggle", { on });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, on }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "toggle failed" }));
          }
        })();
        return;
      }
      // Yield / resume ALL agent remote-control to an external harness (T3 Code).
      // `{ yield: true }` stops Podbay driving BOTH Claude and Codex (writes the
      // two RC-off sentinels + kills the live Codex daemon) so the harness owns the
      // agents without a fight. `{ yield: false }` hands control back (clears the
      // sentinels + restarts Podbay's own RC). Credentials are NEVER touched, so the
      // agents stay signed in across the hand-off in both directions.
      if (req.method === "POST" && req.url === "/agent/rc-yield") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const doYield = Boolean(JSON.parse(body || "{}").yield);
            if (doYield) await this.yieldAgentControl();
            else this.resumeAgentControl();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, yielded: doYield }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "rc-yield failed" }));
          }
        })();
        return;
      }
      // Send the sign-in code the user pasted in the cockpit to a SPECIFIC agent's
      // window. The cockpit previously typed it over the terminal WebSocket, which
      // follows the ACTIVE window — fine for a single-agent pod, wrong the moment a
      // pod has two. Targeted by window, so the code always lands on the right CLI.
      if (req.method === "POST" && req.url === "/agent/input") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const { agent, text } = JSON.parse(body || "{}") as { agent?: string; text?: string };
            const w = agent ? this.windowForAgent(agent) : null;
            if (!agent || w == null || typeof text !== "string" || !text) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "unknown agent or empty input" }));
              return;
            }
            const target = `${this.session.sessionName}:${w}`;
            const send = (args: string[]) =>
              new Promise<void>((resolve) =>
                execFile("tmux", args, { uid: this.tmuxUid, gid: this.tmuxGid }, () => resolve()),
              );
            await send(["send-keys", "-t", target, "-l", text]);
            await new Promise((r) => setTimeout(r, 500)); // let the TUI register the paste
            await send(["send-keys", "-t", target, "Enter"]);
            this.log.info("agent_input_sent", { agent, window: w, chars: text.length });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "send failed" }));
          }
        })();
        return;
      }
      // Add a second agent to a LIVE pod (multi-agent slice 3). Spawns it in its
      // own tmux window so the already-running agent's session is untouched — the
      // whole point of adding rather than recreating.
      if (req.method === "POST" && req.url === "/agent/add") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const agent = String(JSON.parse(body || "{}").agent ?? "");
            if (agent !== "claude-code" && agent !== "codex") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "unknown agent" }));
              return;
            }
            // The added agent joins a worked-in pod, so it must NOT re-run the
            // env's first-run kickoff (which would re-greet and re-ask). The boot
            // command's --continue/resume path is the right entry.
            if (!this.agentCommandFor) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "adding an agent is not supported on this pod" }));
              return;
            }
            const cmd = this.agentCommandFor(agent);
            const index = await spawnAgentWindow(this.session.sessionName, agent, cmd, {
              uid: this.tmuxUid,
              gid: this.tmuxGid,
            });
            if (index == null) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "could not create window" }));
              return;
            }
            this.log.info("agent_added", { agent, window: index });
            await this.refreshWindows().catch(() => undefined);
            if (agent === "codex") this.ensureCodexDaemon("agent_added");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, agent, window: index }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "add failed" }));
          }
        })();
        return;
      }
      // Relaunch a DEAD agent in its EXISTING window — the recovery path the PODBAY-AGENT-EXITED
      // message points at (`podbay-agent-restart`), and the repair `podbay doctor` applies for a
      // window whose agent process has exited to a bare shell. `respawn-pane -k` replaces the dead
      // pane with a fresh supervised launch; the boot command's --continue path resumes the
      // conversation (and now self-heals to fresh if the transcript won't resume). Optional `agent`
      // in the body; defaults to the pod's primary agent.
      if (req.method === "POST" && req.url === "/agent/restart") {
        void (async () => {
          try {
            const body = await readBounded(req);
            const requested = String(JSON.parse(body || "{}").agent ?? "");
            const agent = requested || this.declaredAgents[0] || "claude-code";
            const w = this.windowForAgent(agent);
            if (w == null || !this.agentCommandFor) {
              res.writeHead(w == null ? 404 : 503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: w == null ? `no window for agent '${agent}'` : "restart not supported on this pod" }));
              return;
            }
            const target = `${this.session.sessionName}:${w}`;
            await new Promise<void>((resolve) =>
              execFile(
                "tmux",
                ["respawn-pane", "-k", "-t", target, this.agentCommandFor!(agent)],
                { uid: this.tmuxUid, gid: this.tmuxGid },
                () => resolve(),
              ),
            );
            if (agent === "codex") {
              this.ensureCodexDaemon("agent_restart");
            } else if (!existsSync(credentialsPathForAgent(agent))) {
              // Reconnect wiped the dead credential, so this respawn took the `claude /login` branch
              // and is now sitting at the "Select login method" menu. DRIVE it (pick the subscription
              // method) so the sign-in URL actually prints and the cockpit captures it — otherwise
              // Reconnect hangs forever on "Getting Claude's sign-in link…" with the terminal stuck on
              // the menu (velsa, 2026-08-22). Clear the per-window guard so a repeat reconnect re-drives.
              // The wipe also killed the OLD remote-control session, so its URL is dead: clear it (so
              // rcActive stops falsely reading "on") and — for the PRIMARY claude — mark that we OWE an
              // RC restore once the re-login completes. The failStateWatchdog only sets pendingRcRestore
              // on a pane-detected auth failure, so a MANUAL reconnect would otherwise never restore RC
              // (owner: makore.app dev lost RC after re-login, 2026-08-26).
              this.lastSessionUrl = undefined;
              this.agentSessionUrls.delete(agent);
              if (agent === this.credential?.agent) {
                this.pendingRcRestore = true;
                this.rcRestore = { attempts: 0, lastAt: 0, surfaced: false };
              }
              this.loginDriven.delete(agent);
              this.loginAssistantStarted = false;
              void driveLoginMenu({
                sessionName: `${this.session.sessionName}:${w}`,
                uid: this.tmuxUid,
                gid: this.tmuxGid,
                logger: this.log,
              }).catch((e) => this.log.warn("reconnect_login_menu_failed", { agent, err: String(e) }));
            }
            this.log.info("agent_restarted", { agent, window: w });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, agent, window: w }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "restart failed" }));
          }
        })();
        return;
      }

      // Doctor's lost-RC repair: the primary Claude is signed in but its remote-control session is dead
      // (e.g. a manual reconnect that never restored it). Re-establish RC. reenableRemoteControl self-
      // guards (no-ops when yielded to T3 or logged out); reset the auto-restore budget so a prior
      // give-up doesn't block this manual fix.
      if (req.method === "POST" && req.url === "/agent/rc-restore") {
        // Check the CURRENT classification before touching any restore state: a login-required pod
        // can never be fixed by this call (only the owner's own /login clears it), so the caller
        // (doctor, or a future cockpit action) needs to be able to tell "this can't be fixed by
        // restoring" apart from "an attempt was made" rather than both reading as ok:true.
        const state = this.primaryRcState();
        if (!shouldAttemptRcRestore(state)) {
          this.log.info("rc_restore_skipped_login_required", { auto: false });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "login-required" }));
          return;
        }
        this.pendingRcRestore = true;
        this.rcRestore = { attempts: 0, lastAt: 0, surfaced: false };
        this.reenableRemoteControl(0);
        this.log.info("rc_restore_requested", {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, rcState: this.primaryRcState() }));
        return;
      }
      // The sanctioned dev-server lifecycle (`podbay dev restart|stop|start`) — restart without
      // fighting the watchdog, and reload secrets in one command (a fresh login shell re-sources
      // them). The answer to the first10 supervisor fight.
      if (req.method === "POST" && req.url === "/dev") {
        void (async () => {
          try {
            const body = await readBounded(req, 8192);
            const action = String((JSON.parse(body || "{}") as { action?: string }).action ?? "");
            const result = await this.devControl(action);
            res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "dev control failed" }));
          }
        })();
        return;
      }
      // Restart/stop/start one `podbay startup` process by slug — the race-free reload the CLI
      // lacked (afisha-ops couldn't reload without a whole-pod restart). Same handler shape as /dev.
      if (req.method === "POST" && req.url === "/startup") {
        void (async () => {
          try {
            const body = await readBounded(req, 8192);
            const parsed = JSON.parse(body || "{}") as { action?: string; slug?: string };
            const result = await this.startupControl(String(parsed.slug ?? ""), String(parsed.action ?? ""));
            res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "startup control failed" }));
          }
        })();
        return;
      }
      // Live supervised-dev-server state, so `podbay dev`/`podbay startup list` can SHOW that the
      // dev server is managed + its restart policy — the visibility first10 never had.
      if (req.method === "GET" && req.url === "/dev") {
        void (async () => {
          const state = await this.devState();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(state));
        })();
        return;
      }
      // Secrets the agent has asked the owner for (names + reason only, never values),
      // so the pod dashboard can render them as inputs to fill.
      if (req.method === "GET" && req.url === "/secret-requests") {
        const path = process.env.PODBAY_SECRET_REQUESTS ?? "/etc/podbay/secret-requests.json";
        const secretsEnv = process.env.PODBAY_SECRETS_ENV ?? "/etc/podbay/secrets.env";
        // Hide a request the instant its secret is set, so filling it in the dashboard
        // makes the ask disappear with no explicit dismiss step.
        const satisfied = setKeysIn(secretsEnv);
        const requests = readRequests(path).filter((r) => !satisfied.has(r.key));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requests }));
        return;
      }
      if (req.method === "POST" && req.url === "/secret-request") {
        void (async () => {
          const path = process.env.PODBAY_SECRET_REQUESTS ?? "/etc/podbay/secret-requests.json";
          try {
            const body = await readBounded(req, 8192);
            const { key, description } = JSON.parse(body || "{}") as { key?: unknown; description?: unknown };
            if (typeof key !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ ok: false, error: "key required" }));
            }
            const requests = addRequest(path, key, typeof description === "string" ? description : "", new Date().toISOString());
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, requests }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "bad request" }));
          }
        })();
        return;
      }
      // Once a request is satisfied (or withdrawn), the web app drops it.
      if (req.method === "DELETE" && (req.url ?? "").startsWith("/secret-request/")) {
        const path = process.env.PODBAY_SECRET_REQUESTS ?? "/etc/podbay/secret-requests.json";
        const key = decodeURIComponent((req.url ?? "").slice("/secret-request/".length));
        try {
          removeRequest(path, key);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true })); // idempotent
        }
        return;
      }
      // GitHub connection for private-repo clones (gh-auth.ts). The web app runs
      // the OAuth device flow and POSTs only the final token here.
      if (req.url === "/gh/status") {
        githubStatus()
          .then((s) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(s));
          })
          .catch(() => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ connected: false, login: null }));
          });
        return;
      }
      if (req.method === "DELETE" && req.url === "/gh/token") {
        clearGithubToken()
          .then(() => {
            this.log.info("gh_disconnected");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((e: unknown) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "gh logout failed" }),
            );
          });
        return;
      }
      if (req.method === "POST" && req.url === "/gh/token") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 8192) req.destroy(); // a token is small; cap the read
        });
        req.on("end", () => {
          let token: unknown;
          try {
            token = JSON.parse(body || "{}").token;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "invalid body" }));
          }
          if (typeof token !== "string" || !token) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "missing token" }));
          }
          setGithubToken(token)
            .then(({ login }) => {
              this.log.info("gh_connected", { login });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, login }));
            })
            .catch((e: unknown) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "gh login failed" }),
              );
            });
        });
        return;
      }
      // The authed user's repos, listed with the pod's OWN gh credentials — the token
      // never leaves the pod. Used by the cockpit's "add GitHub → choose repo" flow.
      if (req.url === "/gh/repos") {
        listRepos()
          .then((repos) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, repos }));
          })
          .catch((e: unknown) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "gh repo list failed" }),
            );
          });
        return;
      }
      // Clone a chosen repo into ~/work — only when empty (one pod = one repo).
      if (req.method === "POST" && req.url === "/gh/clone") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 8192) req.destroy();
        });
        req.on("end", () => {
          let repo: unknown;
          let force = false;
          try {
            const parsed = JSON.parse(body || "{}");
            repo = parsed.repo;
            force = parsed.force === true; // opt-in overwrite of a non-empty ~/work
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "invalid body" }));
          }
          if (typeof repo !== "string" || !repo) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "missing repo" }));
          }
          cloneRepo(repo, { force })
            .then((r) => {
              if (r.ok) {
                this.log.info("gh_repo_cloned", { repo, dest: r.dest });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, dest: r.dest }));
              } else {
                // 409 for a non-empty workspace: not an error, a refusal the UI explains.
                res.writeHead(r.reason === "not-empty" ? 409 : 400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, reason: r.reason }));
              }
            })
            .catch((e: unknown) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "clone failed" }),
              );
            });
        });
        return;
      }
      // In-pod GitHub device login (self-host): the pod itself runs the OAuth device flow with
      // gh's own client, so no podbay OAuth app is needed. start → returns the one-time code the
      // owner enters at github.com/login/device; poll → installs the token once authorized.
      if (req.method === "POST" && req.url === "/gh/login/start") {
        ghDeviceStart()
          .then((d) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...d }));
          })
          .catch((e: unknown) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "device start failed" }));
          });
        return;
      }
      if (req.method === "POST" && req.url === "/gh/login/poll") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 8192) req.destroy();
        });
        req.on("end", () => {
          let deviceCode: unknown;
          try {
            deviceCode = JSON.parse(body || "{}").deviceCode;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "invalid body" }));
          }
          if (typeof deviceCode !== "string" || !deviceCode) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "missing deviceCode" }));
          }
          ghDevicePoll(deviceCode)
            .then((r) => {
              if (r.status === "connected") this.log.info("gh_connected", { login: r.login });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, ...r }));
            })
            .catch((e: unknown) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "device poll failed" }));
            });
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    // Cap inbound frames so a giant input.data can't exhaust memory / the PTY.
    this.wss = new WebSocketServer({ server: this.http, maxPayload: 1024 * 1024 });
    // Routed by path: /control is the GATEWAY's link (fetch memory, relay), anything
    // else is a terminal client. Same server, different conversations — and the
    // terminal path is untouched by this.
    this.wss.on("connection", (ws, req) => {
      if ((req.url ?? "").startsWith("/control")) this.onControlLink(ws);
      else this.onConnection(ws);
    });
  }

  /**
   * The gateway's control link. It dials US — the pod never initiates, so there is no
   * pod credential anywhere in this path. If a future change adds a token here, the
   * direction has been reversed by mistake.
   *
   * Buffered fetch outcomes are pushed on a short timer rather than on write, because
   * the CLI appends to a file directly and the server would otherwise have to watch
   * it. Cleared only after a successful send.
   */
  private onControlLink(ws: WebSocket): void {
    const planPath = process.env.PODBAY_FETCH_PLAN ?? "/etc/podbay/fetch-memory.json";
    const statePath = process.env.PODBAY_RELAY_STATE ?? "/etc/podbay/relay-state.json";
    const reportsPath =
      process.env.PODBAY_FETCH_REPORTS ?? "/home/dev/.podbay-fetch-reports.jsonl";

    const deps: ControlDeps = {
      writePlan: (json) => writeFileSync(planPath, json),
      writeRelayState: (json) => writeFileSync(statePath, json),
      deliverRelayResult: (id, payload) => {
        const waiter = this.relayWaiters.get(id);
        if (!waiter) return false;
        this.relayWaiters.delete(id);
        waiter(payload);
        return true;
      },
      deliverPairCode: (id, payload) => {
        const waiter = this.pairWaiters.get(id);
        if (!waiter) return false;
        this.pairWaiters.delete(id);
        waiter(payload);
        return true;
      },
      deliverTunnelEvent: (id, event) => this.tunnelMux.handleEvent(id, event),
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      log: (event, detail) => this.log.info(event, detail ?? {}),
    };
    // Expose this link's send for the relay rung; clear it when the socket goes.
    this.controlSend = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    // Announce this is a real control socket, FIRST thing. The gateway keeps the
    // connection only if it sees this — so a gateway that dials /control on an OLDER
    // pod-agent (which has no /control route and lands on the terminal handler) gets
    // no hello, backs off, and never mistakes a terminal for a control link.
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "control-hello" }));

    ws.on("message", (data) => handleControlMessage(String(data), deps));

    const flush = () => {
      if (ws.readyState !== ws.OPEN) return;
      const reports = takeOutcomes(
        () => readFileSync(reportsPath, "utf8"),
        () => writeFileSync(reportsPath, ""),
      );
      if (reports.length > 0) ws.send(JSON.stringify({ type: "fetch-outcomes", reports }));
    };
    const timer = setInterval(flush, 5_000);
    flush();

    const onGone = () => {
      clearInterval(timer);
      if (this.controlSend) this.controlSend = null;
      // No control link → no tunnel. End every app connection now (fail closed) rather
      // than leaving sockets open against a relay that can no longer be reached.
      this.tunnelMux.reset();
    };
    ws.on("close", onGone);
    ws.on("error", onGone);
    this.log.info("control_link_open");
  }

  /** Current tmux windows as WindowInfo (docs/plans/multi-agent-plan.md, cheap-tabs).
   * The agent runs in the lowest-index window (the one the launcher created); tag it
   * with the agent id. Higher-index windows are user-opened shells (untagged). When we
   * add real per-agent slots, this becomes a window→agent registry lookup. */
  private async computeWindows(): Promise<WindowInfo[]> {
    const raw = await listWindows(this.session.sessionName, { uid: this.tmuxUid, gid: this.tmuxGid });
    if (raw.length === 0) return [];
    const agentIdx = raw[0].index; // lowest index = the PRIMARY agent's window
    this.agentWindowIndex = agentIdx; // cache for agentTarget()
    // Tag agent windows: the primary by position, ADDED agents by window NAME
    // (spawnAgentWindow names them after the agent id). Without the name check an
    // added agent's tab showed the raw id ("claude-code"), not its label.
    const isAgentName = (n: string): n is (typeof AGENT_IDS)[number] =>
      (AGENT_IDS as readonly string[]).includes(n);
    return raw.map((w) => ({
      index: w.index,
      name: w.name,
      active: w.active,
      ...(w.index === agentIdx && this.credential
        ? { agent: this.credential.agent }
        : isAgentName(w.name)
          ? { agent: w.name }
          : {}),
    }));
  }

  /** Every agent this pod SHOULD host: the spec's declaration, the primary, and
   * anything currently running. Spec-first on purpose — a declared agent whose
   * window has died must still appear here, or the watchdog can't see it missing
   * and the cockpit can't say "not running". */
  private agentsOnPod(): string[] {
    const ids = new Set<string>(this.declaredAgents);
    if (this.credential) ids.add(this.credential.agent);
    for (const w of this.lastWindows) if (w.agent) ids.add(w.agent);
    return [...ids];
  }

  private codexOnPod(): boolean {
    return this.agentsOnPod().includes("codex");
  }

  /**
   * The watchdog: compare what the pod IS running against what its spec says it
   * should, and repair the difference — capped, backed off, and always logged.
   *
   * Ordered deliberately. The session is checked first because every other repair
   * is meaningless without it, and an agent window can't be assessed while the
   * server that hosts it is gone.
   */
  private async watchdog(): Promise<void> {
    // 1. The session. Verified on a live pod (2026-07-29): when the tmux server
    //    dies the PTY child dies with it, the pod-agent PROCESS survives, so
    //    systemd's restart policy never fires and /healthz reports ready:false
    //    forever. Recovery is to re-run the BOOT path, which is the sequence
    //    measured to restore a pod completely (session + every agent from
    //    spec.agents) — so we exit and let the service manager do exactly that,
    //    rather than maintain a second, unproven in-process rebuild.
    if (!this.session.isAlive) {
      if (this.tryRepair("session", "session_dead")) {
        this.log.error("watchdog_session_restart", { session: this.session.sessionName });
        // Give the log a beat to flush, then let the supervisor restart us.
        setTimeout(() => process.exit(1), 250);
      }
      return; // nothing else is assessable without a session
    }

    // 2. One window per declared agent. A missing window is the failure that
    //    started this work: an update dropped an added agent and nothing noticed.
    for (const id of this.agentsOnPod()) {
      if (this.windowForAgent(id) != null) continue;
      if (!this.agentCommandFor) continue;
      // Attribute the respawn to out-of-memory if a kill was seen just before the agent
      // vanished — the reliable OOM signal, vs matching the kill's pid.
      const cause = this.oomWatcher.sawOomSince(90_000) ? "oom" : undefined;
      if (!this.tryRepair(id, "window_missing", cause)) continue;
      this.log.warn("watchdog_respawn_window", { agent: id, cause });
      void spawnAgentWindow(this.session.sessionName, id, this.agentCommandFor(id), {
        uid: this.tmuxUid,
        gid: this.tmuxGid,
      })
        .then((w) => this.log.info("watchdog_respawned", { agent: id, window: w }))
        .catch((e) => this.log.warn("watchdog_respawn_failed", { agent: id, err: String(e) }));
    }

    // 3. The pod's long-running non-agent processes (dev server + `podbay startup`
    //    commands). init.sh nohup-launches them at boot only, so an OOM kill mid-run
    //    left them dead until the next reboot — the "detected but not recovered" gap.
    //    Same repair policy, same OOM attribution; the repair reaches the owner as a
    //    pod_repaired event with target `startup:<slug>`.
    await this.superviseStartupProcesses();
  }

  /** Watchdog step 3: restart what DIED among the declared long-running processes.
   * Never starts what never ran (boot owns first launch — pidfile absent = not ours),
   * never resurrects removed/disabled entries (the declaration is re-read each pass). */
  private async superviseStartupProcesses(): Promise<void> {
    const home = "/home/dev";
    const work = "/home/dev/work";
    const procs = [devServerProcess(home, work), ...declaredStartupProcesses(home, work)].filter(
      (p): p is StartupProcess => p != null,
    );
    const now = Date.now();
    for (const p of procs) {
      if (pidfileState(p.pidfile) !== "dead") {
        // It's running again — if it had been marked capped/gave-up, it RECOVERED (via a spaced
        // recovery respawn, a `podbay startup restart`, or coming back on its own). Clear the flags
        // so healthz/doctor stop reporting a dead proc that is actually alive. A portless proc has
        // no serve-check to do this otherwise, which is how a recovered afisha-ops would still show
        // as [critical] "gave up" forever.
        const alive = `startup:${p.slug}`;
        if (this.cappedTargets.delete(alive)) {
          this.repairs.delete(alive);
          this.failedServes.delete(alive);
          this.appendStartupLog(p, `[podbay] ${p.slug} is running again ✓`);
        }
        continue;
      }
      // TRUCE: an intentional restart/stop (`podbay dev …`) holds a pause sentinel — never race
      // to respawn what the agent deliberately killed. This is the fix for the supervisor↔agent
      // fight that drove first10 into hard-kills that corrupted `.next` (2026-08-11).
      if (isSupervisionPaused(pausePath(p.slug), now)) continue;
      // The dev server may be running by hand (a tmux `pnpm dev`) without our pidfile —
      // binding :3000 twice would break the working copy, so probe before respawning.
      if (p.probePort && (await this.portAnswers(p.probePort))) continue;

      const target = `startup:${p.slug}`;
      const history = pruneHistory(this.repairs.get(target) ?? [], now);
      const cause = this.oomWatcher.sawOomSince(90_000) ? "oom" : undefined;

      // Capped: back off the tight loop, but NEVER give up permanently — EVERY supervised target
      // (not just the dev server) gets a spaced-out recovery attempt so an unattended pod heals
      // itself instead of staying dead until a reboot. (Before: recovery was gated to `dev-server`,
      // so a crash-looped `startup` proc like afisha-ops was marked "gave up" forever — the pod
      // couldn't revive itself and `doctor --fix` could only say "restart the pod".)
      let recovery = false;
      if (isCapped(history, now)) {
        if (recoveryDue(history, now)) {
          recovery = true;
          history.push({ at: now, ok: false }); // advance the cooldown so we retry ~every 10m, not every tick
          this.repairs.set(target, history);
        } else {
          // Surface the backing-off state ONCE (it's still capped this cooldown window), but it is
          // NOT terminal — a recovery attempt fires once recoveryDue() passes.
          if (!this.cappedTargets.has(target)) {
            this.cappedTargets.add(target);
            this.log.error("watchdog_gave_up", { target, reason: "process_dead" });
            this.appendStartupLog(p, `[podbay] ${p.slug} kept failing — backing off; podbay retries it automatically. Force it now with 'podbay startup restart ${p.slug}'.`);
          }
          continue;
        }
      } else if (!this.tryRepair(target, "process_dead", cause)) {
        continue; // backing off
      }

      // On a recovery attempt the tight crash-loop is often EADDRINUSE from an incompletely-killed
      // survivor still holding the port. Free it BEFORE respawning so the fresh instance can bind —
      // otherwise the recovery just re-crashes and re-caps (the afisha-ops failure mode).
      if (recovery) this.killCommandOrphans(p);

      // Corrupted-.next recovery: a Next dev server that came up but never served is almost always
      // a poisoned build cache (a hard kill mid-build). Wipe it before respawning. Recovery
      // attempts always clean, since by then the cache is the prime suspect.
      const failed = this.failedServes.get(target) ?? 0;
      if (recovery || shouldCleanNextCache(p, failed)) this.cleanNextCache(p);

      // A line the AGENT can actually see (first10 saw ZERO signal a supervisor existed).
      this.appendStartupLog(
        p,
        `[podbay] ${p.slug} not running — restarting${recovery ? " (recovery)" : ""}${cause ? ` [${cause}]` : ""}${failed ? ` (${failed} prior failed-to-serve)` : ""}`,
      );
      this.log.warn("watchdog_respawn_startup", { slug: p.slug, cause, recovery });
      try {
        const pid = respawnStartupProcess(p, { uid: this.tmuxUid, gid: this.tmuxGid, home });
        this.log.info("watchdog_respawned_startup", { slug: p.slug, pid, recovery });
        // Outcome-based cap: verify it actually SERVES. A serve clears the slate; a came-up-but-
        // -dead respawn counts as a failed serve (feeding .next recovery + the cap).
        if (p.probePort) this.scheduleServeCheck(target, p);
      } catch (e) {
        this.log.warn("watchdog_respawn_startup_failed", { slug: p.slug, err: String(e) });
      }
    }
  }

  /** After a respawn, confirm the process actually answers on its probe port. Serving clears the
   * repair slate (a healthy restart never accrues toward the cap); not serving counts as a failed
   * serve, which drives `.next` recovery and, once the cap is hit, self-heal. */
  private scheduleServeCheck(target: string, p: StartupProcess): void {
    if (!p.probePort || this.serveCheckPending.has(target)) return;
    this.serveCheckPending.add(target);
    const timer = setTimeout(() => {
      void (async () => {
        this.serveCheckPending.delete(target);
        const serving = await this.portAnswers(p.probePort!);
        if (serving) {
          this.repairs.delete(target);
          this.cappedTargets.delete(target);
          this.failedServes.delete(target);
          this.appendStartupLog(p, `[podbay] ${p.slug} is serving again ✓`);
        } else {
          const n = (this.failedServes.get(target) ?? 0) + 1;
          this.failedServes.set(target, n);
          this.appendStartupLog(p, `[podbay] ${p.slug} came up but isn't serving yet (${n})`);
        }
      })();
    }, 12_000);
    if (typeof timer.unref === "function") timer.unref();
  }

  /** Wipe a Next.js build cache that a hard kill mid-build likely corrupted. Best-effort and
   * dev-server-scoped; never touches anything outside the workspace's `.next`. */
  private cleanNextCache(p: StartupProcess): void {
    const dir = nextCacheDir(p.cwd);
    try {
      rmSync(dir, { recursive: true, force: true });
      this.appendStartupLog(p, `[podbay] wiped ${dir} (recovering a corrupted build cache)`);
      this.log.info("watchdog_next_cache_wiped", { slug: p.slug });
    } catch (e) {
      this.log.warn("watchdog_next_cache_wipe_failed", { slug: p.slug, err: String(e) });
    }
  }

  /** Append one human-readable line to a supervised process's own logfile, so the agent tailing
   * it sees what the supervisor did — the visibility first10 was missing. Best-effort. */
  private appendStartupLog(p: StartupProcess, line: string): void {
    try {
      appendFileSync(p.logfile, `${line}\n`);
    } catch {
      /* logfile not writable yet — non-fatal */
    }
  }

  /** Hold a target paused so the watchdog won't respawn it during an intentional op. TTL-bounded
   * so a crash mid-op can never disable recovery forever (see isSupervisionPaused). */
  private pauseSupervision(pausefile: string, ttlMs: number): void {
    try {
      mkdirSync(SUPERVISE_PAUSE_DIR, { recursive: true });
      writeFileSync(pausefile, String(Date.now() + ttlMs));
    } catch {
      /* best-effort — a missed pause just means the loop's own guards apply */
    }
  }

  private resumeSupervision(pausefile: string): void {
    try {
      rmSync(pausefile, { force: true });
    } catch {
      /* it'll expire on its own */
    }
  }

  /** Kill ORPHAN survivors of a supervised process before a (re)spawn — the fix for the EADDRINUSE
   * crash-loop. When a prior generation was killed incompletely (a missed pid) or the pod-agent
   * lost the pidfile, an old instance can keep holding the port; every respawn then dies EADDRINUSE
   * and eventually trips the cap. We find any process still running THIS proc's exact command
   * (`pgrep -f <command>`) and SIGKILL its group so the fresh spawn can bind. Scoped to the proc's
   * specific command string and called only on an intentional restart or a recovery respawn, so a
   * healthy unrelated process is never touched. Best-effort. */
  private killCommandOrphans(p: StartupProcess): number {
    let killed = 0;
    try {
      const out = execFileSync("pgrep", ["-f", "--", p.command], {
        encoding: "utf8",
        timeout: 4000,
      }).trim();
      const self = process.pid;
      for (const line of out.split("\n")) {
        const pid = Number.parseInt(line.trim(), 10);
        if (!Number.isFinite(pid) || pid <= 1 || pid === self) continue;
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        killed++;
      }
      if (killed)
        this.appendStartupLog(p, `[podbay] cleared ${killed} stale '${p.slug}' process(es) holding the port before restart`);
    } catch {
      /* pgrep exit 1 (no match) or unavailable — nothing to clear */
    }
    // Port-anchored mop-up: pgrep matches the COMMAND string, but the real server is often a
    // grandchild whose cmdline (`node …`) doesn't contain it. If a port is declared, SIGKILL whatever
    // still listens on it so the fresh spawn can bind. Best-effort/immediate here; stopProcess owns
    // the graceful TERM-then-wait path for a restart.
    if (p.probePort) {
      for (const pid of this.listeningPids(p.probePort)) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        killed++;
      }
    }
    return killed;
  }

  /** Stop a supervised process gracefully (dev server OR a `podbay startup` proc — same pidfile
   * contract). respawnStartupProcess launches DETACHED (a new process-group leader), so signalling
   * the GROUP (`-pid`) takes down the command AND its children together; fall back to the bare pid
   * for a process not started as a leader. SIGTERM, then SIGKILL if it won't go within ~5s. */
  /** Every descendant pid of `root` (children, grandchildren, …), by walking `pgrep -P`. Captured so a
   * stop can reap a whole process TREE — the port-binding leaf is often a grandchild that escaped the
   * tracked pid's process group, which a group-kill alone would miss. */
  private descendantPids(root: number): number[] {
    return collectDescendants(root, (pid) => {
      try {
        const out = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8", timeout: 4000 }).trim();
        if (!out) return [];
        return out
          .split("\n")
          .map((l) => Number.parseInt(l.trim(), 10))
          .filter((n) => Number.isFinite(n) && n !== process.pid);
      } catch {
        return []; // pgrep exit 1 = no children of this pid
      }
    });
  }

  private async stopProcess(p: StartupProcess): Promise<void> {
    let pid = 0;
    try {
      pid = Number.parseInt(readFileSync(p.pidfile, "utf8").trim(), 10);
    } catch {
      pid = 0;
    }
    if (Number.isFinite(pid) && pid > 1) {
      // Capture the descendant TREE while the parent is still alive — once it dies its children
      // reparent to init and the parent→child link is lost. The process that actually binds the port
      // is often a grandchild that ESCAPED the tracked pid's process group (a wrapper or `next start`
      // that starts its own session), so a group-kill alone misses it and leaves an EADDRINUSE orphan
      // (afisha-crawler restart racing on :3000, 2026-08-26). Reaping the whole tree frees the port
      // even with no `--port` declared. SIGTERM the lot, wait ~5s, SIGKILL survivors.
      const all = [pid, ...this.descendantPids(pid)];
      const alive1 = (x: number): boolean => {
        try {
          process.kill(x, 0);
          return true;
        } catch {
          return false;
        }
      };
      const anyAlive = (): boolean => all.some(alive1);
      const sig = (x: number, s: NodeJS.Signals): void => {
        // Signal the group (reaps same-group children) AND the bare pid (reaps an escaped leaf).
        try {
          process.kill(-x, s);
        } catch {
          /* not a group leader */
        }
        try {
          process.kill(x, s);
        } catch {
          /* already gone */
        }
      };
      for (const x of all) sig(x, "SIGTERM");
      for (let i = 0; i < 25 && anyAlive(); i++) await new Promise((r) => setTimeout(r, 200));
      if (anyAlive()) for (const x of all) sig(x, "SIGKILL");
    }
    // Belt-and-suspenders when the port is declared: kill whatever STILL holds it and WAIT for it to
    // free (a holder the tree walk couldn't reach — e.g. a fully daemonized double-fork).
    if (p.probePort) await this.killPortHolders(p.probePort);
  }

  /** Pids currently LISTENING on a local TCP port (via `ss`), excluding ourselves. Empty when `ss`
   * is unavailable or nothing is bound. */
  private listeningPids(port: number): number[] {
    try {
      const out = execFileSync("ss", ["-H", "-ltnp", `sport = :${port}`], {
        encoding: "utf8",
        timeout: 3000,
      });
      return parseListeningPids(out).filter((pid) => pid !== process.pid);
    } catch {
      return [];
    }
  }

  /** Free a TCP port: SIGTERM whoever listens on it (group + bare), wait ~5s, then SIGKILL any
   * survivor, and wait briefly for the socket to release. Returns how many holders we signalled.
   * Anchored to the PORT, not a pid — so it reaches an orphan the pidfile/command tracking lost. */
  private async killPortHolders(port: number): Promise<number> {
    const holders = this.listeningPids(port);
    if (holders.length === 0) return 0;
    const signalAll = (pids: number[], sig: NodeJS.Signals): void => {
      for (const pid of pids) {
        try {
          process.kill(-pid, sig);
        } catch {
          try {
            process.kill(pid, sig);
          } catch {
            /* already gone */
          }
        }
      }
    };
    signalAll(holders, "SIGTERM");
    for (let i = 0; i < 25 && this.listeningPids(port).length > 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const survivors = this.listeningPids(port);
    if (survivors.length > 0) {
      signalAll(survivors, "SIGKILL");
      for (let i = 0; i < 10 && this.listeningPids(port).length > 0; i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return holders.length;
  }

  /**
   * Agent-facing dev-server lifecycle — the sanctioned alternative to hand-killing. `restart`
   * stops cleanly and relaunches through a fresh login shell, which RE-SOURCES the pod's secrets:
   * the one-command fix for "the gate is open because a secret was added after the server booted".
   * Every action pauses supervision for the swap, so the watchdog never races the restart, and
   * resets the repair cap so a healthy restart starts clean.
   */
  async devControl(action: string): Promise<{ ok: boolean; action: string; message: string }> {
    const home = "/home/dev";
    const work = "/home/dev/work";
    const p = devServerProcess(home, work);
    if (!p) return { ok: false, action, message: "this workspace has no `dev` script — nothing to manage" };
    const target = `startup:${p.slug}`;
    const pause = pausePath(p.slug);
    const clearState = (): void => {
      this.repairs.delete(target);
      this.cappedTargets.delete(target);
      this.failedServes.delete(target);
    };
    // Spawn AFTER clearing any survivor of this command — the fix for "my kill missed a pid, the
    // old instance still holds the port, the new one crashes EADDRINUSE". The group-stop takes the
    // tracked pid; killCommandOrphans mops up any earlier generation that leaked.
    const spawn = (): number => {
      this.killCommandOrphans(p);
      return respawnStartupProcess(p, { uid: this.tmuxUid, gid: this.tmuxGid, home });
    };
    switch (action) {
      case "stop": {
        this.pauseSupervision(pause, 60_000);
        await this.stopProcess(p);
        try {
          rmSync(p.pidfile, { force: true }); // removed pidfile = intentionally stopped; the watchdog won't restart it
        } catch {
          /* nothing to remove */
        }
        clearState();
        this.resumeSupervision(pause);
        this.appendStartupLog(p, "[podbay] dev server stopped by 'podbay dev stop'");
        return { ok: true, action, message: "dev server stopped — it won't be restarted until you run `podbay dev start`" };
      }
      case "start": {
        if (await this.portAnswers(p.probePort ?? 3000)) {
          return { ok: true, action, message: "already serving on :3000 (nothing to do)" };
        }
        this.pauseSupervision(pause, 60_000);
        const pid = spawn();
        clearState();
        this.resumeSupervision(pause);
        this.scheduleServeCheck(target, p);
        this.appendStartupLog(p, `[podbay] dev server started by 'podbay dev start' (pid ${pid})`);
        return { ok: true, action, message: `dev server starting (pid ${pid}) — it re-sources secrets on launch. Tail ~/.podbay-dev.log.` };
      }
      case "restart": {
        this.pauseSupervision(pause, 60_000);
        await this.stopProcess(p);
        const pid = spawn();
        clearState();
        this.resumeSupervision(pause);
        this.scheduleServeCheck(target, p);
        this.appendStartupLog(p, `[podbay] dev server restarted by 'podbay dev restart' (pid ${pid})`);
        return { ok: true, action, message: `dev server restarting (pid ${pid}) — secrets reloaded from the pod env. Tail ~/.podbay-dev.log.` };
      }
      default:
        return { ok: false, action, message: "unknown action — use restart | stop | start" };
    }
  }

  /**
   * Agent-facing lifecycle for a `podbay startup` process (afisha-ops, a worker, …) — the sanctioned
   * alternative to hand-killing one, which races the watchdog. Same pause→swap→resume contract as
   * devControl: `restart` stops it cleanly and relaunches via a fresh login shell (respawnStartupProcess
   * → `bash -lc`), so it picks up NEW CODE and re-sourced secrets. `stop` is session-only (the entry
   * stays registered; the next boot relaunches it — use `podbay startup remove` to unregister). `start`
   * launches a registered proc that isn't running yet (e.g. right after `startup add`).
   */
  /**
   * Forget give-up state for startup commands that are no longer DECLARED.
   *
   * `podbay startup remove <slug>` edits `startup.json` directly and never tells this process, so a
   * slug the watchdog had capped stayed in `cappedTargets` forever — and the cockpit kept showing
   * "'<slug>' keeps failing to start" for a command that no longer exists, with fix advice
   * (`startup restart`, `doctor --fix`) that cannot work because there is nothing left to restart.
   * Observed on podbay `dev` 2026-08-29: `dashboard-concepts` removed, error still displayed.
   *
   * Same shape as the orphaned RC-off marker: durable state outliving the thing it describes, with
   * nothing reconciling the two. Reconcile from the declaration, which is the source of truth.
   */
  /** `startup:<slug>` → the absolute directory its command `cd`s into that no longer exists. Lets
   * health say "its folder is gone" (with a fix that works) instead of "it keeps failing" (with two
   * that cannot). Only reports a directory it is SURE about — see `leadingCdPath`. */
  private startupMissingDirs(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of declaredStartupProcesses("/home/dev", "/home/dev/work")) {
      const dir = leadingCdPath(p.command);
      if (dir && !existsSync(dir)) out[`startup:${p.slug}`] = dir;
    }
    return out;
  }

  private pruneUndeclaredStartupTargets(): void {
    const declared = new Set(
      declaredStartupProcesses("/home/dev", "/home/dev/work").map((p) => `startup:${p.slug}`),
    );
    for (const target of [...this.cappedTargets]) {
      // dev-server is supervised WITHOUT a startup.json entry — it is never "undeclared".
      if (!target.startsWith("startup:") || target === "startup:dev-server") continue;
      if (declared.has(target)) continue;
      this.cappedTargets.delete(target);
      this.repairs.delete(target);
      this.failedServes.delete(target);
      this.log.info("startup_target_undeclared_cleared", { target });
    }
  }

  async startupControl(
    slug: string,
    action: string,
  ): Promise<{ ok: boolean; action: string; slug: string; message: string }> {
    // Serialize commands per slug: an overlapping stop/start/restart is what let ~6 competing procs
    // spawn and crash-loop on the port (afisha-crawler, 2026-08-26). Refuse the second rather than race.
    if (this.startupInFlight.has(slug))
      return { ok: false, action, slug, message: `another '${slug}' startup command is still running — wait for it, then retry` };
    this.startupInFlight.add(slug);
    try {
    const home = "/home/dev";
    const work = "/home/dev/work";
    const procs = declaredStartupProcesses(home, work);
    const p = procs.find((x) => x.slug === slug);
    if (!p)
      return { ok: false, action, slug, message: `no startup command '${slug}' (see: podbay startup list)` };
    const target = `startup:${p.slug}`;
    const pause = pausePath(p.slug);
    const logHint = `Tail ~/.podbay/startup/${slug}.log`;
    const clearState = (): void => {
      this.repairs.delete(target);
      this.cappedTargets.delete(target);
      this.failedServes.delete(target);
    };
    // Spawn AFTER clearing any survivor of this command — the fix for "my kill missed a pid, the
    // old instance still holds the port, the new one crashes EADDRINUSE". The group-stop takes the
    // tracked pid; killCommandOrphans mops up any earlier generation that leaked.
    const spawn = (): number => {
      this.killCommandOrphans(p);
      return respawnStartupProcess(p, { uid: this.tmuxUid, gid: this.tmuxGid, home });
    };
    switch (action) {
      case "stop": {
        this.pauseSupervision(pause, 60_000);
        await this.stopProcess(p);
        try {
          rmSync(p.pidfile, { force: true }); // removed pidfile = intentionally stopped; the watchdog won't respawn it
        } catch {
          /* nothing to remove */
        }
        clearState();
        this.resumeSupervision(pause);
        this.appendStartupLog(p, `[podbay] '${slug}' stopped by 'podbay startup stop'`);
        return {
          ok: true,
          action,
          slug,
          message: `stopped '${slug}' — it stays registered (the next boot relaunches it; 'podbay startup start ${slug}' to run it now, 'podbay startup remove ${slug}' to unregister)`,
        };
      }
      case "start": {
        if (pidfileState(p.pidfile) === "alive")
          return { ok: true, action, slug, message: `'${slug}' is already running (nothing to do)` };
        this.pauseSupervision(pause, 60_000);
        // A dead pidfile can still leave an orphan holding the declared port — free it (with the
        // graceful wait) before spawning so the new instance can bind.
        if (p.probePort) await this.killPortHolders(p.probePort);
        const pid = spawn();
        clearState();
        this.resumeSupervision(pause);
        this.appendStartupLog(p, `[podbay] '${slug}' started by 'podbay startup start' (pid ${pid})`);
        return { ok: true, action, slug, message: `'${slug}' starting (pid ${pid}) — fresh code + re-sourced secrets. ${logHint}` };
      }
      case "restart": {
        this.pauseSupervision(pause, 60_000);
        await this.stopProcess(p); // stops the tracked pid AND frees the declared port (waits for it)
        const pid = spawn();
        clearState();
        this.resumeSupervision(pause);
        this.appendStartupLog(p, `[podbay] '${slug}' restarted by 'podbay startup restart' (pid ${pid})`);
        return { ok: true, action, slug, message: `'${slug}' restarting (pid ${pid}) — fresh code + re-sourced secrets. ${logHint}` };
      }
      default:
        return { ok: false, action, slug, message: "unknown action — use restart | stop | start" };
    }
    } finally {
      this.startupInFlight.delete(slug);
    }
  }

  /** Live supervised-dev-server state for `podbay dev` / `podbay startup list`. */
  async devState(): Promise<{
    present: boolean;
    serving: boolean;
    pid: number | null;
    capped: boolean;
    paused: boolean;
    failedServes: number;
    attempts: number;
  }> {
    const home = "/home/dev";
    const work = "/home/dev/work";
    const p = devServerProcess(home, work);
    if (!p) return { present: false, serving: false, pid: null, capped: false, paused: false, failedServes: 0, attempts: 0 };
    const now = Date.now();
    const target = `startup:${p.slug}`;
    const history = pruneHistory(this.repairs.get(target) ?? [], now);
    let pid: number | null = null;
    try {
      const n = Number.parseInt(readFileSync(p.pidfile, "utf8").trim(), 10);
      if (Number.isFinite(n) && n > 1) pid = n;
    } catch {
      /* no pidfile */
    }
    return {
      present: true,
      serving: await this.portAnswers(p.probePort ?? 3000),
      pid,
      capped: isCapped(history, now),
      paused: isSupervisionPaused(pausePath(p.slug), now),
      failedServes: this.failedServes.get(target) ?? 0,
      attempts: history.length,
    };
  }

  private async portAnswers(port: number): Promise<boolean> {
    try {
      const ctl = AbortSignal.timeout(1_000);
      await fetch(`http://127.0.0.1:${port}/`, { signal: ctl });
      return true; // any HTTP answer (even 500) means something is bound
    } catch {
      return false;
    }
  }

  /**
   * Record an attempt and say whether it may proceed. Returns false when the
   * target is backing off (temporary) or capped (final, and reported once).
   */
  private tryRepair(target: string, reason: string, cause?: string): boolean {
    const now = Date.now();
    const history = pruneHistory(this.repairs.get(target) ?? [], now);
    const decision = shouldRepair(history, now);
    if (!decision.allow) {
      if (decision.reason === "capped" && !this.cappedTargets.has(target)) {
        this.cappedTargets.add(target);
        this.log.error("watchdog_gave_up", { target, reason });
      }
      this.repairs.set(target, history);
      return false;
    }
    history.push({ at: now, ok: true });
    this.repairs.set(target, history);
    this.cappedTargets.delete(target);
    this.recentRepairs.push({ target, reason, at: new Date(now).toISOString(), ...(cause ? { cause } : {}) });
    if (this.recentRepairs.length > 20) this.recentRepairs.shift();
    this.log.info("watchdog_repair", { target, reason, remaining: decision.remaining - 1 });
    return true;
  }

  /** Classify the CURRENT `rcState` for the primary Claude agent — the SAME input assembly
   * `agentStates()` builds for its `isPrimaryClaude` branch (live gate/auth-failure/recovery-budget
   * signals cached from `failStateWatchdog`'s last tick), extracted so `reenableRemoteControl` and the
   * `/agent/rc-restore` handler can gate on the identical classification `/healthz` reports, rather
   * than a second hand-assembled opinion drifting from it. Returns `"unknown"` when there is no
   * primary credential or the primary is codex (codex's RC never goes through this pane-based
   * classifier — see agentStates()'s own comment on that split) since those callers only ever care
   * about the greeter-driven Claude RC path this classification exists for. */
  private primaryRcState(): RcState {
    if (!this.credential || this.credential.agent === "codex") return "unknown";
    const id = this.credential.agent;
    const cred = credentialState(id, credentialsPathForAgent(id));
    const hasSessionUrl = Boolean(this.agentSessionUrls.get(id) ?? this.lastSessionUrl);
    return classifyRcState({
      authed: cred.authed,
      loginExpired: cred.expired,
      liveAuthFailure: this.primaryNeedsReauth,
      gate: this.primaryGate,
      hasSessionUrl,
      recovering: this.pendingRcRestore && !this.rcRestore.surfaced && this.rcRestore.attempts < 3,
      recoveryGaveUp: this.rcRestore.surfaced,
      rcYielded: existsSync(CLAUDE_RC_OFF),
    });
  }

  /** Per-agent truth for /healthz — what the cockpit's agent cards render from.
   * authed = that CLI's credentials file exists; rcActive = codex daemon up /
   * Claude session URL captured. No guessing from pod-level singletons. */
  private agentStates(): {
    id: string;
    window: number | null;
    authed: boolean;
    loginExpired: boolean;
    needsReauth: boolean;
    expiresAt: number | null;
    rcState: RcState;
    rcActive: boolean;
    authUrl: string | null;
    sessionUrl: string | null;
  }[] {
    return this.agentsOnPod().map((id) => {
      // authed is now TOKEN-AWARE (false when the login has hard-expired), not mere file-presence —
      // the blind spot that hid a dead claude login for weeks (2026-08-22). loginExpired distinguishes
      // "was signed in, token died → reconnect" from "never signed in → first-time login".
      const cred = credentialState(id, credentialsPathForAgent(id));
      // Live auth-failure/gate/bounded-restore tracking (failStateWatchdog) is PRIMARY-CLAUDE ONLY —
      // sessionStateFromDisk/the bridge signal is per-pid and codex has its own daemon self-heal (see
      // failStateWatchdog's own doc comment). An added (non-primary) Claude degrades to the file-only
      // signals below, same limitation `needsReauth` already had before this change.
      const isPrimaryClaude = id === this.credential?.agent && id !== "codex";
      const hasSessionUrl = Boolean(this.agentSessionUrls.get(id) ?? this.lastSessionUrl);
      // Codex has no TUI to pane-classify — its RC is a headless daemon (refreshCodexRc's own
      // comment) — so it does NOT go through the pane-based classifyRcState below. A pgrep-confirmed
      // "the daemon isn't running" is a CONFIRMED-NEGATIVE signal, not merely absent evidence, so a
      // non-active authed Codex reads as `down` directly — classifyRcState's generic `unknown`
      // fallback models "we genuinely can't tell" (Claude's captured-URL-or-not ambiguity), which
      // isn't Codex's situation. This is the documented, task-brief-flagged deviation for the one
      // agent that lacks pane-classification signals.
      // The primary Claude's classification is delegated to primaryRcState() — the SAME assembly
      // this branch used to inline, now shared with reenableRemoteControl/rc-restore's gating (task
      // 3.3) so there is exactly one place that wires the live signals together. A non-primary
      // (added) Claude agent has no live signals of its own (failStateWatchdog is primary-only) and
      // keeps the prior degraded inline assembly unchanged.
      const rcState: RcState =
        id === "codex"
          ? !cred.authed || cred.expired
            ? "login-required"
            : this.codexRcActive
              ? "active"
              : "down"
          : isPrimaryClaude
            ? this.primaryRcState()
            : classifyRcState({
                authed: cred.authed,
                loginExpired: cred.expired,
                liveAuthFailure: false,
                gate: null,
                hasSessionUrl,
                recovering: false,
                recoveryGaveUp: false,
                // CLAUDE_RC_OFF is not agent-scoped, but only Claude RC is ever yielded to T3 (Codex
                // has its own pairing/daemon model) — applying it pod-wide to every non-codex agent is
                // the conservative, no-worse-than-before choice.
                rcYielded: existsSync(CLAUDE_RC_OFF),
              });
      return {
      // Live auth-failure (the primary claude): a mid-session logout the FILE misses. Only the primary
      // has the live signal (failStateWatchdog); others fall back to the file-expiry via loginExpired.
      needsReauth: isPrimaryClaude ? this.primaryNeedsReauth : false,
      id,
      window: this.windowForAgent(id),
      authed: cred.authed,
      loginExpired: cred.expired,
      expiresAt: cred.expiresAt,
      rcState,
      // rcActive is the backward-compatible projection of rcState: true if and only if active.
      // `recovering`/`down`/`login-required`/`unknown` must never be promoted to true. This REPLACES
      // the prior ad-hoc boolean expression (Boolean(url) && !primaryNeedsReauth for Claude,
      // codexRcActive alone for Codex) — see the task's commit message for the one behavior change
      // this introduces (an unauthenticated Codex now reads inactive even if a stale codexRcActive
      // flag were still true, which the pgrep tick keeps in sync in practice anyway).
      rcActive: rcState === "active",
      sessionUrl: this.agentSessionUrls.get(id) ?? this.lastSessionUrl ?? null,
      // Claude: its sign-in URL. Codex: its one-time device CODE. Both scraped
      // from THAT agent's own window, so an added agent gets the cockpit's
      // link-and-paste sign-in instead of being sent to the terminal.
      authUrl: this.agentAuthValues.get(id) ?? null,
      };
    });
  }

  /** tmux window index hosting an agent (primary by position, added by name). */
  private windowForAgent(id: string): number | null {
    if (id === this.credential?.agent) return this.agentWindowIndex;
    return this.lastWindows.find((w) => w.agent === id)?.index ?? null;
  }

  /** Per-agent sign-in value, sticky once captured (it scrolls away). Claude → the
   * OAuth URL; Codex → the device code. Scraped per WINDOW because the pod-level
   * capture only ever watched the primary agent's. */
  private async refreshAgentAuthValues(): Promise<void> {
    const exec = { uid: this.tmuxUid, gid: this.tmuxGid };
    for (const id of this.agentsOnPod()) {
      const w = this.windowForAgent(id);
      if (w == null) continue;
      const target = `${this.session.sessionName}:${w}`;
      // Signed in → the sign-in value is spent. Drop it so a stale OAuth link can
      // never be shown as if the agent still needed it.
      if (existsSync(credentialsPathForAgent(id))) this.agentAuthValues.delete(id);
      // AUTHED claude: capture its own RC session URL (the hand-off link).
      if (id !== "codex" && existsSync(credentialsPathForAgent(id))) {
        if (!this.agentSessionUrls.has(id)) {
          try {
            const urls = await extractLinks(target, exec);
            const rc = urls.find((u) => SESSION_URL_RE.test(u));
            if (rc) this.agentSessionUrls.set(id, rc);
          } catch {
            // best-effort
          }
        }
        continue;
      }
      if (this.agentAuthValues.has(id)) continue; // sticky
      if (existsSync(credentialsPathForAgent(id))) continue; // already signed in
      try {
        if (id === "codex") {
          const pane = stripAnsiText(await capturePane(target, exec));
          if (pane.includes("codex/device")) {
            const m = pane.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/);
            if (m) this.agentAuthValues.set(id, m[0]);
          }
        } else {
          const urls = await extractLinks(target, exec);
          const url = urls.find(
            (u) => AUTH_URL_RE.test(u) && !SESSION_URL_RE.test(u) && isCompleteAuthUrl(u),
          );
          if (url) this.agentAuthValues.set(id, url);
        }
      } catch {
        // best-effort; a capture hiccup must not break the tick
      }
    }
  }

  /** Current problems, computed from the signals we already collect. */
  private issues() {
    const m = this.metrics.snapshot();
    // Read memory fresh (the snapshot samples it, but issues() runs on /healthz and a
    // current read is cheap). Absent/unreadable → no memory issue.
    let memory: { availableMb: number; totalMb: number } | undefined;
    try {
      const mem = parseMem(readFileSync("/proc/meminfo", "utf8"));
      if (mem.totalMb > 0) memory = { availableMb: Math.max(0, mem.totalMb - mem.usedMb), totalMb: mem.totalMb };
    } catch {
      /* no memory issue when we can't read it */
    }
    return computeIssues({
      sessionAlive: this.session.isAlive,
      agents: this.agentStates().map((a) => ({ id: a.id, window: a.window, authed: a.authed, loginExpired: a.loginExpired, needsReauth: a.needsReauth, expiresAt: a.expiresAt, stuckGate: this.menuStuck.get(a.id) })),
      repairGaveUp: [...this.cappedTargets],
      startupMissingDir: this.startupMissingDirs(),
      disk: { usedMb: m.disk.usedMb, totalMb: m.disk.totalMb },
      memory,
      app: m.app.port != null ? { port: m.app.port, listening: m.app.listening } : null,
      codexRuntimeMissing:
        this.codexOnPod() &&
        existsSync(credentialsPathForAgent("codex")) &&
        !existsSync(CODEX_STANDALONE),
    });
  }

  /** tmux target for the AGENT's window — what greeter/RC/kickoff-respawn/paneChars
   * must use so they reach the agent, not whatever window the user switched to
   * (the Exp-1 finding: `-t main` follows the ACTIVE window). Until the first window
   * scan caches the index, falls back to the bare session (correct with one window). */
  private agentTarget(): string {
    return this.agentWindowIndex == null
      ? this.session.sessionName
      : `${this.session.sessionName}:${this.agentWindowIndex}`;
  }

  private onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.log.info("client_attached", { clients: this.clients.size });
    // Immediately report status so a fresh client can render chips/idle.
    this.sendStatus(ws);
    if (this.lastLinks.length) this.send(ws, { type: "links", urls: this.lastLinks });
    if (this.lastWindows.length) this.send(ws, { type: "windows", windows: this.lastWindows });

    ws.on("message", (raw) => {
      const msg = parseClientMessage(raw.toString());
      if (!msg) return;
      if (msg.type === "input") this.session.write(msg.data);
      else if (msg.type === "resize") this.session.resize(msg.cols, msg.rows);
      else if (msg.type === "ping") this.send(ws, { type: "pong" });
      else if (msg.type === "select-window") {
        // Switch the active window, then push the refreshed tab state immediately
        // (don't wait for the next tick) so the click feels responsive.
        void selectWindow(this.session.sessionName, msg.index, {
          uid: this.tmuxUid,
          gid: this.tmuxGid,
        }).then(() => this.refreshWindows());
      } else if (msg.type === "new-window") {
        // The tab strip's "+" — open a shell window and push the new tab set.
        void newWindow(this.session.sessionName, {
          uid: this.tmuxUid,
          gid: this.tmuxGid,
        }).then(() => this.refreshWindows());
      }
    });
    const detach = (why: string) => () => {
      if (this.clients.delete(ws)) this.log.info("client_detached", { clients: this.clients.size, why });
    };
    ws.on("close", detach("close"));
    ws.on("error", detach("error"));
  }

  private broadcast(msg: AgentMessage): void {
    const frame = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  private send(ws: WebSocket, msg: AgentMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private cred() {
    return this.credential
      ? credentialState(this.credential.agent, this.credential.path)
      : undefined;
  }

  private sendStatus(ws: WebSocket): void {
    const s = idleStatus(this.session.idleMs(), this.opts.idleThresholdMs, this.session.isAlive);
    const cred = this.cred();
    void paneCharCount(this.agentTarget(), { uid: this.tmuxUid, gid: this.tmuxGid }).then(
      (paneChars) => this.send(ws, { type: "status", ...s, paneChars, cred }),
    );
  }

  /** Recompute the window list and broadcast only when it changed (same discipline
   * as links). Cheap enough to run every tick and after a select. */
  private async refreshWindows(): Promise<void> {
    if (this.refreshingWindows) return; // called from onTick, select/create, AND the 1s poll — don't race
    this.refreshingWindows = true;
    try {
      const windows = await this.computeWindows();
      const key = (ws: WindowInfo[]) => JSON.stringify(ws);
      if (key(windows) !== key(this.lastWindows)) {
        this.lastWindows = windows;
        this.broadcast({ type: "windows", windows });
      }
    } finally {
      this.refreshingWindows = false;
    }
  }

  private async onTick(): Promise<void> {
    const exec = { uid: this.tmuxUid, gid: this.tmuxGid };
    this.oomWatcher.scan(); // cheap: reads dmesg, records any new OOM kills
    this.pruneUndeclaredStartupTargets(); // a removed startup command must stop being reported
    this.maybeRespawnAuthed();
    if (this.codexOnPod()) this.refreshCodexRc(); // primary OR added codex
    await this.refreshWindows(); // caches agentWindowIndex before agentTarget() below
    this.driveAddedAgentLogins();
    this.advanceAddedAgents();
    await this.refreshAgentAuthValues();
    // Refresh links (the RC session URL lives in the AGENT's window); broadcast on change.
    const urls = await extractLinks(this.agentTarget(), exec);
    if (urls.join("\n") !== this.lastLinks.join("\n")) {
      this.lastLinks = urls;
      this.broadcast({ type: "links", urls });
    }
    // Remember the RC session URL the first time it's available (sticky), so
    // /healthz can report it. PRIMARY source: Claude Code writes the bridge
    // session id to ~/.claude/sessions/<pid>.json — reliable, unlike scraping the
    // terminal where the URL wraps across Claude's TUI box padding and the regex
    // misses it (a live false-negative: RC active, but "hand-off unavailable").
    // Fallback: the pane links, for older CLIs that don't write the session file.
    if (!this.lastSessionUrl) {
      this.lastSessionUrl =
        sessionStateFromDisk().url ?? urls.find((u) => SESSION_URL_RE.test(u)) ?? undefined;
    }
    const s = idleStatus(this.session.idleMs(), this.opts.idleThresholdMs, this.session.isAlive);
    const pane = await capturePane(this.session.sessionName, exec);
    this.recordPane(pane);
    const paneChars = (pane.match(/\S/g) ?? []).length;
    this.broadcast({ type: "status", ...s, paneChars, cred: this.cred() });

    // Watchdog LAST: it must judge the pod's shape after refreshWindows and
    // advanceAddedAgents have run this tick, or it would "repair" a window that
    // is mid-spawn and fight its own boot sequence.
    await this.watchdog();
    // Menu watchdog: catch an agent window wedged at a known menu that no one-shot
    // driver is clearing (any respawn site — reconnect, resume, update, window-repair)
    // and drive/surface it. Same "after advanceAddedAgents" rationale.
    await this.menuWatchdog();
    // Fail-state watchdog: detect a live auth failure (that the credential FILE misses) and
    // auto-restore remote control once the login recovers — the two gaps behind the 2026-08-23
    // mid-session-logout incident.
    await this.failStateWatchdog();
  }

  /** Primary-agent fail-state tracking. `authFailTicks` debounces the live auth-failure signal;
   * `needsReauth` is the surfaced state; `pendingRcRestore` remembers that we owe an RC restore once
   * the login recovers; `rcRestore` bounds the restore attempts with backoff. Primary claude only —
   * `sessionStateFromDisk`/the bridge signal is per-pid, and codex has its own daemon self-heal. */
  private primaryAuthFailTicks = 0;
  private primaryNeedsReauth = false;
  private pendingRcRestore = false;
  private rcRestore = { attempts: 0, lastAt: 0, surfaced: false };
  /** Last-classified gate for the primary agent's pane, cached from failStateWatchdog's async tick
   * so the synchronous agentStates()/rcState computation can read it without its own pane capture
   * (agentStates() is called from /healthz and must stay sync — see its own doc comment). Same
   * pattern as primaryNeedsReauth: an async watchdog tick feeds a field a sync reader consumes. */
  private primaryGate: GateKind | null = null;

  /**
   * Detect a LIVE agent auth failure and auto-restore remote control after the login recovers.
   *
   * The credential FILE only flips `expired` at hard-expiry; a mid-session refresh FAILURE (the CLI
   * prints "Login expired · Please run /login") happens while the file's expiry is still in the
   * future — so file-based health reports the pod fine while the owner is locked out (velsa,
   * 2026-08-23). We read the live pane instead. And because the remote-control worker dies with that
   * login but the pod can't see the server-side bridge state directly, we key the auto-restore on the
   * reliable observable TRANSITION: auth-failure seen → login valid again → RC is stale → re-run it.
   * Bounded (cap + backoff), and surfaced if it can't recover — never silent, never infinite.
   */
  private async failStateWatchdog(): Promise<void> {
    if (!this.credential || this.credential.agent === "codex") return;
    const w = this.windowForAgent(this.credential.agent);
    if (w == null) return;
    const target = `${this.session.sessionName}:${w}`;
    const pane = await capturePane(target, { uid: this.tmuxUid, gid: this.tmuxGid }).catch(() => "");
    if (!pane) return;
    // At a menu the menu-watchdog is in charge — never touch auth/RC mid-menu (e.g. the /login menu
    // after a reconnect is progress, not a failure). "oauth-retry" is the one gate that IS a failure
    // (a rejected sign-in code, not progress toward one) — it must still reach the check below so
    // needsReauth gets set instead of silently waiting on the menu-watchdog, which only surfaces a
    // human-readable label and never flips the cockpit's Reconnect state (test:1, 2026-08-26/27).
    const gate = classifyGate(pane);
    this.primaryGate = gate; // cache for agentStates()'s sync rcState computation, see the field's doc
    if (gate != null && gate !== "oauth-retry") return;

    // 1. Live auth-failure, debounced so a 1-tick transient isn't flagged.
    const authBad = authFailureInPane(pane);
    this.primaryAuthFailTicks = authBad ? this.primaryAuthFailTicks + 1 : 0;
    const needs = this.primaryAuthFailTicks >= 2;
    if (needs && !this.primaryNeedsReauth) this.log.warn("agent_auth_failure_detected", { agent: this.credential.agent });
    if (needs) this.pendingRcRestore = true; // we now owe an RC restore once the login recovers
    this.primaryNeedsReauth = needs;
    if (needs) return; // logged out — nothing to restore until the owner re-logs-in (surfaced on healthz)

    // 2. Recovery transition: we saw an auth failure, and the login is valid again → the RC bridge is
    // stale, re-establish it (this is the manual `/remote-control` velsa had to run).
    if (!this.pendingRcRestore) return;
    if (existsSync(CLAUDE_RC_OFF)) return; // yielded to T3 — its job, not ours
    if (!credentialState(this.credential.agent, this.credential.path).authed) return; // not recovered yet
    // The only remaining way to reach here still login-blocked: gate === "oauth-retry" is the one
    // gate the early check above (line ~2245) lets fall through (every other blocking gate already
    // returned before pendingRcRestore is even checked, and a live auth-failure already returned at
    // "if (needs) return"). Check BEFORE the attempts counter below so a live blocking OAuth-retry
    // dialog never burns a slot from the bounded restore budget — the exact gap this task closes.
    if (!shouldAttemptRcRestore(this.primaryRcState())) {
      this.log.info("rc_restore_skipped_login_required", { auto: true });
      return;
    }
    if (sessionStateFromDisk().url) {
      // RC is back (a fresh bridge session id appeared) → done, reset the budget.
      this.log.info("rc_autorestore_ok", { attempts: this.rcRestore.attempts });
      this.pendingRcRestore = false;
      this.rcRestore = { attempts: 0, lastAt: 0, surfaced: false };
      return;
    }
    if (this.rcRestore.attempts >= 3) {
      if (!this.rcRestore.surfaced) {
        this.log.warn("rc_autorestore_gave_up", { agent: this.credential.agent });
        this.rcRestore.surfaced = true; // surfaced on healthz (rcActive stays false)
      }
      return;
    }
    if (Date.now() - this.rcRestore.lastAt < 30_000) return; // backoff — a greeter run takes time
    this.rcRestore.attempts += 1;
    this.rcRestore.lastAt = Date.now();
    this.log.warn("rc_autorestore", { agent: this.credential.agent, attempt: this.rcRestore.attempts });
    this.reenableRemoteControl(0); // RC-only greeter; its own guards skip a logged-out/yielded agent
  }

  /** Per-window state for the menu watchdog: the last pane hash, how many ticks it has
   * been static, how many times we've driven this gate, and whether we've surfaced it. */
  private readonly menuGateState = new Map<
    string,
    { hash: string; staticTicks: number; drives: number; surfaced: boolean }
  >();
  /** 3b: an agent stuck at a gate the watchdog can't safely auto-answer (the owner-decision "proceed",
   * or a gate that survived the drive cap) → surfaced to the cockpit as a health issue, cleared when
   * the gate clears. 3c: a static selection-menu the classifier doesn't recognize → the early-warning
   * (logged once per pane) that the CLI changed its menu wording, the way tonight's reconnect hang
   * rode a version bump. Both read from the pane already captured in menuWatchdog. */
  private readonly menuStuck = new Map<string, string>();
  private readonly menuUnknown = new Map<string, { hash: string; ticks: number; warned: boolean }>();

  /**
   * Self-healing backstop for stuck menus. Every tick, for each Claude window, if it shows a KNOWN
   * blocking gate that has been byte-static for a couple ticks (a one-shot driver actively clearing it
   * would change the pane, so static ⇒ genuinely wedged with no driver acting), drive the safe answer
   * or surface the owner-decision ones. Bounded per gate; past the cap it becomes a "needs you" state
   * rather than looping. Codex is excluded — its TUI can't be reliably pane-scraped (signals.ts).
   */
  private async menuWatchdog(): Promise<void> {
    const STATIC_TICKS = 2; // ~6s at the default 3s tick — long enough that a live driver has moved on
    const MAX_DRIVES = 3;
    for (const id of this.agentsOnPod()) {
      if (id === "codex") continue;
      const w = this.windowForAgent(id);
      if (w == null) continue;
      const target = `${this.session.sessionName}:${w}`;
      const pane = await capturePane(target, { uid: this.tmuxUid, gid: this.tmuxGid }).catch(() => "");
      const gate = pane ? classifyGate(pane) : null;
      const prev = this.menuGateState.get(id) ?? { hash: "", staticTicks: 0, drives: 0, surfaced: false };
      if (!gate) {
        this.menuStuck.delete(id); // no known gate up → not stuck on our account
        // 3c tripwire: a numbered selection menu (❯ 1.) the classifier does NOT recognize, sitting
        // static → warn once. This is the "the CLI changed its menu and we didn't notice" alarm.
        const looksMenu = pane ? /❯\s*\d/.test(pane) && !agentGone(pane) : false;
        if (looksMenu) {
          const uh = paneHash(pane);
          const u = this.menuUnknown.get(id);
          const uticks = u && u.hash === uh ? u.ticks + 1 : 0;
          const warned = u?.warned === true && u.hash === uh;
          if (uticks >= 5 && !warned) {
            this.log.warn("menu_watchdog_unknown_gate", { agent: id, window: w, sample: pane.slice(-160) });
            this.menuUnknown.set(id, { hash: uh, ticks: uticks, warned: true });
            this.menuStuck.set(id, "an unrecognized prompt"); // surface — better than a silent hang
          } else {
            this.menuUnknown.set(id, { hash: uh, ticks: uticks, warned });
          }
        } else {
          this.menuUnknown.delete(id);
        }
        // Cleared — reset so a future gate starts fresh.
        if (prev.hash || prev.drives || prev.surfaced) this.menuGateState.set(id, { hash: "", staticTicks: 0, drives: 0, surfaced: false });
        continue;
      }
      this.menuUnknown.delete(id); // a known gate → not "unknown"
      const h = paneHash(pane);
      const staticTicks = h === prev.hash ? prev.staticTicks + 1 : 0;
      const drives = h === prev.hash ? prev.drives : 0; // a changed pane = progress; reset the drive count
      const st = { hash: h, staticTicks, drives, surfaced: prev.surfaced && h === prev.hash };
      if (staticTicks < STATIC_TICKS) {
        this.menuGateState.set(id, st);
        continue;
      }
      // "Do you want to proceed" is an owner decision we must NOT answer — surface it straight away
      // instead of burning the drive budget on a no-op. A rejected OAuth code is the same shape: Enter
      // RESUBMITS the dead code (making it worse, not progress), so it gets the same immediate
      // surface rather than cycling through the drive-then-give-up path (test:1, 2026-08-26/27).
      if (gate === "proceed" || gate === "oauth-retry") {
        if (!st.surfaced) this.log.warn("menu_watchdog_needs_owner", { agent: id, gate, window: w });
        this.menuStuck.set(id, gateLabel(gate));
        this.menuGateState.set(id, { ...st, surfaced: true });
        continue;
      }
      if (st.drives >= MAX_DRIVES) {
        // Gave up driving — surface it as a "needs you" (health issue) rather than looping forever.
        if (!st.surfaced) {
          this.log.warn("menu_watchdog_gave_up", { agent: id, gate, window: w });
          st.surfaced = true;
        }
        this.menuStuck.set(id, gateLabel(gate));
        this.menuGateState.set(id, st);
        continue;
      }
      this.menuStuck.delete(id); // we're actively driving it — not stuck
      st.drives += 1;
      this.menuGateState.set(id, st);
      this.log.warn("menu_watchdog_drove", { agent: id, gate, drive: st.drives, window: w });
      void this.driveGate(gate, target, id);
    }
  }

  /** Drive one classified gate in a specific window. Reuses the proven login-menu driver; sends the
   * exact keystrokes the greeter uses for the others; deliberately does NOT auto-answer `proceed`
   * (owner decision — the surfaced "needs you" via menuWatchdog is the handling). */
  private async driveGate(gate: GateKind, target: string, agentId: string): Promise<void> {
    const send = (args: string[]) =>
      new Promise<void>((resolve) =>
        execFile("tmux", args, { uid: this.tmuxUid, gid: this.tmuxGid }, () => resolve()),
      );
    try {
      if (gate === "login-menu" || gate === "api-key") {
        // driveLoginMenu handles BOTH: it dismisses the api-key prompt then accepts the subscription
        // method. Re-arm the one-shot guards so a re-spawned primary is drivable again.
        this.loginDriven.delete(agentId);
        if (agentId === this.credential?.agent) this.loginAssistantStarted = false;
        await driveLoginMenu({ sessionName: target, uid: this.tmuxUid, gid: this.tmuxGid, logger: this.log });
      } else if (gate === "bypass") {
        // The bypass-permissions gate: answer "2" (Yes, accept) then Enter — same as the greeter.
        await send(["send-keys", "-t", target, "-l", "2"]);
        await send(["send-keys", "-t", target, "Enter"]);
      } else if (gate === "trust") {
        // Folder-trust prompt for the owner's own ~/work — accept (Enter takes the default).
        await send(["send-keys", "-t", target, "Enter"]);
      } else if (gate === "login-continue") {
        // "Login successful. Press Enter to continue…" — a dismiss-with-Enter confirmation, so the agent
        // reaches its prompt instead of sitting at a dialog the card reads as "Needs you".
        await send(["send-keys", "-t", target, "Enter"]);
      }
      // gate === "proceed": intentionally not answered — surfaced as "needs you" instead.
    } catch (e) {
      this.log.warn("menu_watchdog_drive_failed", { agent: agentId, gate, err: String(e) });
    }
  }

  /** Append a timestamped snapshot whenever the terminal screen changes, capped so
   * it can't grow unbounded. Best-effort — recording must never break the tick. */
  private recordPane(pane: string): void {
    const hash = paneHash(pane);
    if (hash === this.lastPaneHash) return;
    this.lastPaneHash = hash;
    try {
      appendFileSync(TERMINAL_LOG, `\n=== ${new Date().toISOString()} ===\n${pane}\n`);
      if (statSync(TERMINAL_LOG).size > TERMINAL_LOG_CAP) {
        const buf = readFileSync(TERMINAL_LOG);
        writeFileSync(TERMINAL_LOG, buf.subarray(buf.length - Math.floor(TERMINAL_LOG_CAP / 2)));
      }
    } catch {
      // best-effort; disk hiccup or race must not break the status tick
    }
  }

  /** Login→kickoff handoff: respawn the window once credentials appear, then
   * greet the fresh authed session. */
  private maybeRespawnAuthed(): void {
    if (!this.bootedUnauthed || this.respawned) return;
    const r = this.authedRespawn;
    const credsPath = r?.credsPath ?? this.credential?.path;
    if (!credsPath || !existsSync(credsPath)) return; // creds haven't landed yet
    this.respawned = true;
    // No kickoff to respawn into (OSS/bare pod): the CLI is already running in the now-authed
    // window, so DON'T respawn it — just greet it to enable remote control (RC = claude↔claude.ai,
    // not gateway-dependent, so it works for a local pod too). Without this a signed-in
    // kickoff-less pod sat forever at "Enabling remote control…".
    if (!r) {
      this.log.info("post_login_greet", { session: this.session.sessionName, kickoff: false });
      this.startGreeter(); // no-ops for codex
      this.ensureCodexDaemon("post-login");
      return;
    }
    this.log.info("kickoff_respawn", { session: this.session.sessionName });
    execFile(
      "tmux",
      ["respawn-window", "-k", "-t", this.agentTarget(), r.command],
      { uid: this.tmuxUid, gid: this.tmuxGid },
      (err) => {
        if (err) this.log.error("kickoff_respawn_failed", { err });
        else {
          this.startGreeter(); // no-ops for codex
          this.ensureCodexDaemon("post-login"); // auth.json just appeared → start the daemon
        }
      },
    );
  }

  /** Drive the `claude /login` method menu once (unauthed boot) so the sign-in
   * URL prints — for the web terminal AND the launch wizard. Fire-and-forget. */
  private startLoginAssistant(): void {
    if (this.loginAssistantStarted) return;
    this.loginAssistantStarted = true;
    void driveLoginMenu({
      sessionName: this.agentTarget(),
      uid: this.tmuxUid,
      gid: this.tmuxGid,
      logger: this.log,
    }).catch((e) => this.log.error("login_assistant_failed", { err: e }));
  }

  /** Drive the `claude /login` method menu in an ADDED agent's own window, so its
   * sign-in URL actually prints — the pod-level login assistant only ever ran
   * against the primary. Without this the cockpit had nothing to link to and the
   * user was pushed into the terminal (regression caught 2026-07-29). Once per
   * agent per process; no-ops for an already-signed-in agent. */
  private driveAddedAgentLogins(): void {
    for (const id of this.agentsOnPod()) {
      if (id === this.credential?.agent || id === "codex") continue; // primary has its own path; codex self-prints
      if (this.loginDriven.has(id)) continue;
      if (existsSync(credentialsPathForAgent(id))) continue;
      const w = this.windowForAgent(id);
      if (w == null) continue;
      this.loginDriven.add(id);
      this.log.info("added_agent_login_menu", { agent: id, window: w });
      void driveLoginMenu({
        sessionName: `${this.session.sessionName}:${w}`,
        uid: this.tmuxUid,
        gid: this.tmuxGid,
        logger: this.log,
      }).catch((e) => this.log.warn("added_agent_login_menu_failed", { agent: id, err: String(e) }));
    }
  }

  /**
   * Bring an ADDED Claude all the way from "signed in" to "remote control on",
   * using the SAME machinery the primary agent has had since the login flow was
   * hardened — not a thinner parallel copy (which is exactly how a fixed bug came
   * back: the added agent sat at "Login successful. Press Enter to continue…"
   * because nothing respawned its login process; found live 2026-07-29).
   *
   * Three steps, in order, once per agent:
   *  1. respawn its window (kills the `claude /login` process, starts the CLI);
   *  2. run the FULL greeter against that window — same waiting, bypass-gate
   *     answering, dead-agent restart and RC verification the primary gets;
   *  3. its RC session URL is then captured per-agent (refreshAgentAuthValues).
   */
  private advanceAddedAgents(): void {
    if (!this.agentCommandFor) return;
    for (const id of this.agentsOnPod()) {
      if (id === this.credential?.agent || id === "codex") continue;
      if (!existsSync(credentialsPathForAgent(id))) continue; // still signing in
      const w = this.windowForAgent(id);
      if (w == null) continue;
      const target = `${this.session.sessionName}:${w}`;
      const command = this.agentCommandFor(id);

      // 1. Kill the login process and restart the CLI in that window.
      if (!this.loginRespawned.has(id)) {
        this.loginRespawned.add(id);
        this.log.info("added_agent_login_respawn", { agent: id, window: w });
        execFile(
          "tmux",
          ["respawn-window", "-k", "-t", target, command],
          { uid: this.tmuxUid, gid: this.tmuxGid },
          (err) => {
            if (err) {
              this.log.error("added_agent_login_respawn_failed", { agent: id, err: String(err) });
              this.loginRespawned.delete(id); // let the next tick retry
              return;
            }
            this.startAddedAgentGreeter(id, target, command);
          },
        );
        continue;
      }
      // Boot-time case: already authed, window already running the CLI — greet it.
      this.startAddedAgentGreeter(id, target, command);
    }
  }

  /** Step 2: the full greeter (RC + verification + safety), once per agent. */
  private startAddedAgentGreeter(id: string, target: string, respawnCommand: string): void {
    if (this.rcEnabled.has(id)) return;
    this.rcEnabled.add(id);
    this.log.info("added_agent_rc_enable", { agent: id, target });
    void runGreeter({
      rcTitle: sanitizeSessionName(this.displayName),
      // An added agent in api-key mode also boots on the key → same accept-the-prompt.
      agentAuth: this.greeter?.agentAuth,
      sessionName: target,
      uid: this.tmuxUid,
      gid: this.tmuxGid,
      logger: this.log,
      traceFile: "/home/dev/.podbay-greeter.log",
      // No kickoff/resume trigger: an added agent joins a worked-in pod — RC only.
      // respawnCommand lets the greeter restart a DEAD agent instead of typing at
      // the bash prompt its corpse left behind (same protection as the primary).
      respawnCommand,
      greetedMarkerPath: `/home/dev/.podbay-greeted-${id}`,
      // Per-agent RC-session-identity state: an added agent runs on its own tmux window
      // with its own RC session, so it must not share the primary's hash file (that would
      // make each agent's rename decision leak into the other's).
      rcSessionHashPath: `/home/dev/.podbay-rc-session-hash-${id}`,
    }).catch((e) => {
      this.rcEnabled.delete(id); // allow a retry on a later tick
      this.log.warn("added_agent_rc_failed", { agent: id, err: String(e) });
    });
  }

  /** Run the greeter once per process against an authed session (fire-and-forget;
   * it does its own waiting, verification, and give-up logging). */
  /** The primary agent's login has hit its HARD expiry (refresh token dead). Driving `/remote-control`
   * into a logged-out agent can never succeed — it's refused — so the greeter would burn its bounded
   * 3×/30s retry budget and re-arm on every resume (the afisha loop). Skip it; the cockpit's
   * loginExpired detection + Reconnect own recovery. Fail OPEN (unreadable creds → not expired) so a
   * transient read error never silently disables RC for a healthy login. */
  private primaryLoginExpired(): boolean {
    if (!this.credential) return false;
    try {
      return credentialState(this.credential.agent, this.credential.path).expired;
    } catch {
      return false;
    }
  }

  /** Is the `t3-code` startup command registered? That declaration is what makes a T3 handover
   * durable across restarts, so it — not a live process — is the honest witness for "an external
   * harness owns Claude here". Unreadable/malformed file ⇒ treat as NOT registered only when the
   * file is genuinely absent; a read error means we cannot prove the orphan, so we assume it IS
   * registered and leave the marker alone (never clear on ambiguity). */
  private t3StartupRegistered(): boolean {
    try {
      const raw = readFileSync(PODBAY_STARTUP_JSON, "utf8");
      return /"slug"\s*:\s*"t3-code"/.test(raw);
    } catch (e) {
      // ENOENT is a real answer: `startup add` creates the file, so no file ⇒ nothing registered.
      return (e as NodeJS.ErrnoException)?.code !== "ENOENT";
    }
  }

  /** Clear an RC-off sentinel that no external harness justifies (see `isOrphanedRcYield`). Runs at
   * boot, BEFORE the greeter reads the marker, so a pod stranded by a failed T3 enable heals itself
   * on its next restart instead of silently never greeting again. */
  private healOrphanedRcYield(): void {
    if (!isOrphanedRcYield({
      markerExists: existsSync(CLAUDE_RC_OFF),
      t3StartupRegistered: this.t3StartupRegistered(),
    })) return;
    try {
      rmSync(CLAUDE_RC_OFF, { force: true });
      this.log.info("rc_yield_orphan_cleared", { marker: CLAUDE_RC_OFF });
    } catch (e) {
      this.log.error("rc_yield_orphan_clear_failed", { err: e });
    }
  }

  private startGreeter(): void {
    if (!this.greeter || this.greeterStarted) return;
    if (existsSync(CLAUDE_RC_OFF)) return; // control yielded to an external harness — don't drive Claude RC
    if (this.primaryLoginExpired()) {
      this.log.info("greeter_skip_login_expired", {});
      return; // logged-out agent — don't loop /remote-control into a refusal
    }
    this.greeterStarted = true;
    void runGreeter({
      ...this.greeter,
      sessionName: this.agentTarget(),
      uid: this.tmuxUid,
      gid: this.tmuxGid,
      logger: this.log,
      traceFile: "/home/dev/.podbay-greeter.log",
      // Lets the greeter restart a DEAD agent instead of typing into the bash
      // prompt its corpse left behind (see AGENT_EXITED_MARKER in boot.ts).
      respawnCommand: this.authedRespawn?.command,
      // No coldStart flag: whether /rename runs is now decided by RC session identity
      // (rc-session-identity.ts), not by "did the pod-agent process restart" — see runGreeter's
      // rename block. A genuinely fresh/replacement RC session (first boot, image update, crash)
      // still gets renamed; a pod-agent-only restart whose RC session survived does not.
    }).catch((e) => this.log.error("greeter_failed", { err: e }));
  }

  /** Re-enable remote control after a suspend/resume: the process survives the
   * suspend, but RC's upstream connection dies, so the Claude app can't
   * reconnect until `/remote-control` runs again. RC only — never the kickoff. */
  private reenableRemoteControl(gapMs: number): void {
    if (!this.greeter || !this.credential || !existsSync(this.credential.path)) return;
    if (existsSync(CLAUDE_RC_OFF)) return; // control yielded to an external harness — don't re-drive Claude RC
    if (this.primaryLoginExpired()) {
      this.log.info("rc_reenable_skip_login_expired", { gapMs });
      return; // logged-out agent — don't re-arm the RC loop on every resume
    }
    // Broader than the file-based hard-expiry check above: also catches a LIVE blocking gate
    // (login-menu/oauth-retry) or a live auth failure the credential file hasn't caught up to yet —
    // the exact gap this task closes (a manual /agent/rc-restore or an automatic retry landing while
    // the pane shows a blocking OAuth-retry dialog). The greeter's own pane-safety checks would likely
    // no-op safely anyway, but skipping here means the call is diagnosable as "this is a login
    // problem, not RC-down" instead of a silently-wasted attempt (and every caller of
    // reenableRemoteControl gets this for free through the one choke point).
    if (!shouldAttemptRcRestore(this.primaryRcState())) {
      this.log.info("rc_restore_skipped_login_required", { gapMs });
      return;
    }
    this.log.info("resume_detected_reenabling_rc", { gapMs });
    void runGreeter({
      ...this.greeter,
      // RC only. This fires from startResumeWatch's wall-clock-jump detector, which only
      // observes a gap on a provider whose "suspend" genuinely freezes THIS process in place
      // (Fly's Machines suspend) — the conversation is still on screen and the agent is
      // exactly where it was, so neither the kickoff nor the resume nudge belongs here (that's
      // for a COLD restart, where claude relaunched into a fresh/--continue'd session). Incus's
      // "suspend" is a plain VM stop/start (see incus/provider.ts sleep()) — a full cold boot
      // where this process doesn't survive, so the wall-clock detector never fires there; an
      // Incus wake instead goes through the normal boot()/startGreeter() path like any other
      // cold restart, and the RC-session-identity comparison (rc-session-identity.ts) decides
      // /rename correctly either way from what it actually observes, not from an assumption
      // about which provider preserves the process.
      kickoffTrigger: undefined,
      resumeTrigger: undefined,
      // No explicit rcSessionHashPath: this targets the SAME agentTarget() (and therefore
      // the same RC session) as startGreeter, so it must compare against the SAME identity
      // state — both fall through to the shared DEFAULT_RC_SESSION_HASH_PATH. Suspend/resume
      // thaws the same session, so this naturally reads as "same id" and skips /rename —
      // one mechanism (rc-session-identity.ts) now covers this call site too, rather than a
      // separate coldStart:false special case.
      sessionName: this.agentTarget(),
      uid: this.tmuxUid,
      gid: this.tmuxGid,
      logger: this.log,
      traceFile: "/home/dev/.podbay-greeter.log",
      // Lets the greeter restart a DEAD agent instead of typing into the bash
      // prompt its corpse left behind (see AGENT_EXITED_MARKER in boot.ts).
      respawnCommand: this.authedRespawn?.command,
    }).catch((e) => this.log.error("rc_reenable_failed", { err: e }));
  }

  /** Yield BOTH agents' remote-control to an external harness (T3 Code): drop the
   * two RC-off sentinels so boot/resume hooks stop re-driving Claude + Codex, and
   * kill the live Codex daemon. Credentials are untouched — the agents stay signed
   * in and the harness drives them with the same on-disk logins. Durable across
   * restart/resume (the sentinels live on the home volume). */
  private async yieldAgentControl(): Promise<void> {
    mkdirSync("/home/dev/.podbay", { recursive: true });
    const stamp = `${new Date().toISOString()}\n`;
    writeFileSync(CLAUDE_RC_OFF, stamp);
    writeFileSync(CODEX_RC_OFF, stamp);
    // Codex RC is a detached daemon — stop it so it isn't fighting the harness.
    // Claude RC is a slash-command state inside the TUI (no separate process to
    // kill); the sentinel stops us RE-establishing it on the next boot/resume.
    await new Promise<void>((resolve) =>
      execFile("pkill", ["-f", "app-server --remote-control"], () => resolve()),
    );
    this.codexRcActive = false;
    this.log.info("agent_rc_yielded", {});
  }

  /** Hand control back from the external harness: clear the sentinels and restart
   * Podbay's own remote-control for both agents. Idempotent — safe if control was
   * never yielded. */
  private resumeAgentControl(): void {
    rmSync(CLAUDE_RC_OFF, { force: true });
    rmSync(CODEX_RC_OFF, { force: true });
    // Re-drive Claude RC (the greeter's one-shot may have already run this process,
    // so use the resume path, which re-runs RC-only) and restart the Codex daemon.
    this.reenableRemoteControl(0);
    this.ensureCodexDaemon("rc-resume");
    this.log.info("agent_rc_resumed", {});
  }

  /** Codex's remote-control analog of the greeter: start the app-server DAEMON so
   * the pod is pairable from the Codex app. Unlike Claude's RC (a slash-command
   * typed into the TUI), this is a detached process — no tmux. Requirements: a
   * Codex pod, logged in, and the STANDALONE build present (the npm codex can't
   * daemonize). We start ONLY when it isn't already running: `remote-control start`
   * invalidates outstanding pairing codes, so re-running it while the daemon is up
   * would break a code the user is mid-entry on. After a suspend/resume wake the
   * process is gone (the socket file may linger, stale), so we check the PROCESS,
   * not the socket. Fire-and-forget + idempotent, safe to call on boot, post-login,
   * and every wake. */
  private ensureCodexDaemon(reason: string): void {
    // Codex may be the primary OR an added agent — key off presence + its own
    // creds, not `credential.agent` (which is the primary only; that guard left
    // codex-added-to-a-Claude-pod with no RC daemon, ever).
    if (!this.codexOnPod() || !existsSync(credentialsPathForAgent("codex"))) return;
    if (existsSync(CODEX_RC_OFF)) return; // the owner switched RC off — stay off
    // Codex login hit its hard expiry — the daemon would spawn into a logged-out account and fail on
    // every boot/resume/toggle. Skip; loginExpired detection + Reconnect own recovery. Fail open on an
    // unreadable/absent expiry field (credentialExpired only flags a KNOWN expiry in the past).
    try {
      if (credentialState("codex", credentialsPathForAgent("codex")).expired) {
        this.log.info("codex_rc_skip_login_expired", { reason });
        return;
      }
    } catch {
      /* unreadable → treat as not-expired (fail open) */
    }
    if (!existsSync(CODEX_STANDALONE)) {
      this.log.warn("codex_rc_no_standalone", { path: CODEX_STANDALONE });
      return;
    }
    execFile("pgrep", ["-f", "app-server --remote-control"], (running) => {
      if (!running) return; // exit 0 → a daemon process already exists; leave it (+ its codes)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: "/home/dev",
        CODEX_HOME: "/home/dev/.codex",
        PATH: `/home/dev/.local/bin:${process.env.PATH ?? ""}`,
      };
      // Strip the app's OpenAI key so the daemon uses the user's ChatGPT login
      // (auth.json), not usage-based billing — same rationale as boot.ts's CODEX.
      delete env.OPENAI_API_KEY;
      delete env.OPENAI_BASE_URL;
      this.log.info("codex_rc_start", { reason });
      execFile(
        CODEX_STANDALONE,
        ["remote-control", "start"],
        { env, uid: this.tmuxUid, gid: this.tmuxGid },
        (err, stdout) => {
          if (err) this.log.warn("codex_rc_start_failed", { err: String(err) });
          else this.log.info("codex_rc_started", { out: String(stdout).trim().slice(0, 200) });
        },
      );
    });
  }

  /** Mint a fresh Codex pairing code the cockpit can show. Ensures the daemon is up
   * (pairing hits its control socket), then runs `remote-control pair --json`. Codes
   * are short-lived (~10 min); the daemon may still be starting, so one retry. The
   * device appears in the Codex app named by hostname (= the pod slug). */
  async codexPairingCode(): Promise<
    | { manualPairingCode: string; pairingCode: string; expiresAt: number; deviceName: string }
    | { error: string }
  > {
    if (!this.codexOnPod() || !existsSync(credentialsPathForAgent("codex")))
      return { error: "Codex isn't signed in on this pod" };
    if (!existsSync(CODEX_STANDALONE)) return { error: "codex standalone build missing" };
    this.ensureCodexDaemon("pair-request"); // no-op if already running
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: "/home/dev",
      CODEX_HOME: "/home/dev/.codex",
      PATH: `/home/dev/.local/bin:${process.env.PATH ?? ""}`,
    };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
    const run = (): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile(
          CODEX_STANDALONE,
          ["remote-control", "pair", "--json"],
          { env, uid: this.tmuxUid, gid: this.tmuxGid, timeout: 20_000 },
          (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
        );
      });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = JSON.parse((await run()).trim());
        if (typeof j.manualPairingCode === "string")
          return {
            manualPairingCode: j.manualPairingCode,
            // The long code the QR wraps: the Codex app scans a URL of the form
            // https://chatgpt.com/codex/pair?pairing_code=<pairingCode> (confirmed
            // by decoding a real desktop-app pairing QR).
            pairingCode: String(j.pairingCode ?? ""),
            expiresAt: Number(j.expiresAt) || 0,
            deviceName: this.displayName || hostname(),
          };
        throw new Error("no manualPairingCode in output");
      } catch (e) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2500)); // daemon may still be coming up
          continue;
        }
        this.log.warn("codex_pair_failed", { err: String(e) });
        return { error: e instanceof Error ? e.message : "pair failed" };
      }
    }
    return { error: "pair failed" };
  }

  /** Is the Codex RC daemon up? pgrep is the honest, version-independent check —
   * the daemon's own state DB does NOT record pairings (see codex-pair-panel.tsx),
   * so this deliberately reports availability, not "an app is paired". */
  private refreshCodexRc(): void {
    execFile("pgrep", ["-f", "app-server --remote-control"], (err) => {
      this.codexRcActive = !err;
      // Auto-heal when down-but-should-be-up: covers an ADDED codex whose
      // device-code login completed later (the login→respawn hook is
      // primary-agent-only). ensureCodexDaemon's guards (creds present, owner
      // hasn't switched RC off) make this a no-op otherwise, and it never
      // touches a RUNNING daemon — so no pairing-code invalidation.
      if (err) this.ensureCodexDaemon("tick-revive");
    });
  }

  /**
   * Bring up the pod-local SOCKS5 relay proxy that apps point `PODBAY_RELAY_PROXY` at.
   *
   * The port is FIXED (not OS-assigned) so the env var can be exported statically at
   * boot, before the agent starts — an app must never have to discover a moving port.
   * Binding is 127.0.0.1 only: this is a pod-local endpoint, never reachable off-pod.
   * With no relay connected every CONNECT is refused cleanly (fail closed), so starting
   * it unconditionally is safe and the variable is simply inert until an owner runs
   * `relay start`.
   */
  private async startRelayProxy(): Promise<void> {
    const port = Number(process.env.PODBAY_RELAY_PROXY_PORT ?? 1080);
    if (!Number.isFinite(port) || port <= 0) return;
    const proxy = new RelayProxy({
      port,
      dial: (host, p) => this.tunnelMux.dial(host, p),
      log: (event, detail) => this.log.info(event, detail ?? {}),
    });
    try {
      await proxy.listen();
      this.relayProxy = proxy;
      this.log.info("relay_proxy_listening", { port });
    } catch (e) {
      // A busy port must not take the pod-agent down — the tunnel is optional.
      this.log.warn("relay_proxy_start_failed", { port, err: String(e) });
    }
  }

  async listen(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve) => this.http.listen(this.opts.port, this.opts.host, resolve));
    this.metrics.start();
    await this.startRelayProxy();
    this.tick = setInterval(() => void this.onTick(), this.opts.tickMs);
    this.windowTick = setInterval(() => void this.refreshWindows(), 1_000); // fast tab-close reflection
    // Cache the agent's window index before the first greet, so agentTarget()
    // resolves to the agent window (not the bare session) from the very start.
    await this.refreshWindows();
    // Before ANY RC path reads the marker: drop it if no harness justifies it. A failed T3 enable
    // can strand it on disk, and every RC path (greeter included) then returns early forever.
    this.healOrphanedRcYield();
    // Already authed at boot (login lives on the pod's volume) → the session
    // starts straight into the agent; greet it. Otherwise the boot ran
    // `claude /login`: drive the method menu so the sign-in URL actually prints
    // (the greeter runs later, after the login→kickoff respawn).
    if (this.credential && existsSync(this.credential.path)) this.startGreeter();
    else if (this.greeter && this.credential) this.startLoginAssistant();
    // Codex has no greeter/tmux RC — start its app-server daemon so the pod is
    // pairable from the Codex app. No-ops unless codex + authed + standalone present;
    // when unauthed at boot it starts after login (maybeRespawnAfterLogin).
    this.ensureCodexDaemon("boot");
    // Watch for suspend/resume so remote control comes back on every wake — for
    // Claude re-run the greeter's /remote-control, for Codex restart the daemon.
    if (this.greeter || this.credential?.agent === "codex") {
      this.stopResumeWatch = startResumeWatch((gap) => {
        this.reenableRemoteControl(gap); // no-ops without a greeter
        this.ensureCodexDaemon(`resume gap=${gap}ms`); // no-ops unless codex
      });
    }
    const addr = this.http.address();
    const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
    return { host: this.opts.host, port };
  }

  /** Current idle in ms (for the control plane / tests). */
  idleMs(): number {
    return this.session.idleMs();
  }

  async close(): Promise<void> {
    if (this.tick) clearInterval(this.tick);
    if (this.windowTick) clearInterval(this.windowTick);
    this.metrics.stop();
    this.stopResumeWatch?.();
    this.tunnelMux.reset();
    await this.relayProxy?.close();
    this.relayProxy = null;
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
    await this.session.killSession();
  }
}
