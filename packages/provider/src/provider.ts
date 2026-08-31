import type { PodResources, MetricsSnapshot, BoxStats, PodAgentState, PodIssue } from "@podbay/shared";
import type { BaseImage, CreatePodInput, ExecResult, PodInfo, UpdateStage } from "./types.js";

/**
 * Provider-agnostic pod lifecycle. Implementations (FlyProvider, later others)
 * hide all infrastructure specifics behind these Podbay-domain methods.
 */
export interface SandboxProvider {
  createPod(input: CreatePodInput): Promise<PodInfo>;
  getPod(id: string): Promise<PodInfo>;
  listPods(filter?: { owner?: string }): Promise<PodInfo[]>;
  exec(id: string, command: string[]): Promise<ExecResult>;
  sleep(id: string): Promise<PodInfo>;
  wake(id: string): Promise<PodInfo>;
  setKeepAwake(id: string, keepAwake: boolean): Promise<PodInfo>;
  /**
   * Change a pod's reserved CPU/RAM and (grow-only) disk. Applied with a brief
   * suspend — stop → reconfigure → start — so a running pod cold-restarts (the
   * agent resumes via `claude --continue`). Disk can only grow; callers pass the
   * high-water-mark diskGb. Providers that can't resize throw ProviderError
   * "unsupported".
   */
  resize(id: string, resources: PodResources): Promise<PodInfo>;
  snapshot(id: string): Promise<{ snapshotId: string }>;
  destroy(id: string): Promise<void>;
  endpoint(id: string): Promise<string>;
  /** `http://[ip]:<port>` for a running pod — the preview proxy target. */
  podAddress(id: string, port: number): Promise<string>;
  /** True once the pod-agent is actually connectable (not just Fly "started"). */
  agentReady(id: string): Promise<boolean>;
  /** The pod-agent's resource-metrics snapshot (Stats tab), or null if the agent
   * is unreachable / too old to serve /metrics. */
  fetchMetrics(id: string, windowMs?: number): Promise<MetricsSnapshot | null>;
  /** A PNG thumbnail of the pod's own preview app (localhost:3000), captured by the pod-agent with the
   * image's prebaked headless Chromium — so the cockpit shows a lightweight image instead of framing
   * the whole live site. Null when nothing is serving the port, the agent is unreachable, or the image
   * is too old to serve it. */
  previewShot(id: string): Promise<Buffer | null>;
  /** Host-level stats for the self-hosted box this provider runs (backoffice).
   * Optional — providers without a "box" concept (Fly) omit it. */
  boxStats?(): Promise<BoxStats>;
  /** List published base images in the provider's image store (image-manifest
   * prune). Optional — providers without an image store (Fly) omit it. */
  listBaseImages?(): Promise<BaseImage[]>;
  /** Delete a base image by fingerprint (prune). Optional. */
  deleteBaseImage?(fingerprint: string): Promise<void>;
  /** Milliseconds since the pod's terminal last produced output — the agent's
   * REAL in-pod idle time (ticks during remote-control / background work, which
   * bypass our gateway), so the idle policy won't suspend a pod mid-work. `null`
   * when the agent can't be reached (no signal). */
  agentIdleMs(id: string): Promise<number | null>;
  /** The remote-control session URL the pod-agent has observed, or `null` if none
   * yet / unreachable. Read from /healthz so the control plane can persist the
   * "Open in Claude app" link even when no client was connected to see the frame
   * (the boot greeter enables RC with no watcher). */
  agentSessionUrl(id: string): Promise<string | null>;
  /** The agent's OWN reported state — `busy` | `shell` | `idle` | `waiting` — or
   * `null` when unreachable / the CLI doesn't report it. This is the truthful
   * "is it working?" signal for the idle policy; terminal output is not (a session
   * parked at `waiting` repaints every ~15–32s, so output-based idle never
   * expires and the pod never sleeps). See docs/plans/pre-alpha-plan.md P0.1. */
  agentStatus(id: string): Promise<string | null>;
  /**
   * Swap the pod's machine to a new image IN PLACE, keeping its volume — so
   * `~/work`, the agent's plan/data and the Claude login all survive (verified
   * live 2026-07-17). NOT destroy+recreate, which would lose all of it.
   *
   * A running machine cold-restarts (the live conversation ends; the agent resumes
   * via `claude --continue` + the greeter's resume nudge). A SUSPENDED machine is
   * left stopped — Fly won't start it, which is exactly the "apply on next wake"
   * behaviour we want: never wake a suspended pod just to update it.
   */
  updateImage(
    id: string,
    image: string,
    onStage?: UpdateStage,
    opts?: {
      /** Freshly-resolved env `.claude` layer (guest_path → base64), pushed after the
       * recreate so an UPDATE delivers current skills/rules to an existing pod — not
       * just a new image. Without this, the recreate wiped /etc/podbay/claude and the
       * volume's seed marker skipped any re-seed: a skill shipped after a pod's
       * creation NEVER reached it (found live 2026-07-28, everyday-harrier-ae1b). */
      claudeFiles?: { guest_path: string; raw_value: string }[];
      /** Freshly-resolved env permissions, merged into the preserved pod-spec so an
       * UPDATE refreshes a pod's permission preset from current code instead of keeping
       * the frozen one it was created with — the path a preset fix / new deny reaches an
       * existing pod (the 2026-08-01 git-push removal otherwise never propagated). */
      permissions?: unknown;
      /** The pod's CURRENT display name (DB `pods.name`, null ⇒ fall back to slug), merged into the
       * preserved pod-spec so an UPDATE refreshes `podName` from the dashboard instead of keeping the
       * verbatim on-pod value — otherwise a dashboard rename was FROZEN and the greeter re-applied the
       * stale name as the Claude-app session title on every fresh session (owner report 2026-08-30). */
      name?: string | null;
    },
  ): Promise<PodInfo>;
  /** Write the pod's app secrets to /etc/podbay/secrets.env (0600, dev-owned) on
   * a running pod, replacing any prior contents. The DB is the source of truth;
   * the control plane calls this on wake and on set/clear. Requires the pod up. */
  injectSecrets(id: string, secrets: Record<string, string>): Promise<void>;
  /** Whether the pod has a working GitHub login (for private-repo clones), and as
   * whom. The web app runs the OAuth device flow; these two just proxy the pod
   * agent. Non-throwing status; setGithubToken throws if the pod is unreachable. */
  githubStatus(id: string): Promise<{ connected: boolean; login: string | null; workRepo?: string | null }>;
  /** Secrets the agent asked the owner for, from inside the pod (names + reason only,
   * never values) — so the dashboard can render them as inputs. Non-throwing: a pod
   * that is down or has none returns an empty list. */
  secretRequests(id: string): Promise<{ key: string; description: string; at: string }[]>;
  setGithubToken(id: string, token: string): Promise<{ login: string }>;
  /** The connected user's repositories, listed with the pod's OWN gh credentials
   * (no token reaches the web). For the cockpit's "add GitHub → choose repo" flow. */
  listRepos(id: string): Promise<GithubRepo[]>;
  /** Clone a repo into the pod's ~/work. By default ONLY when empty (one pod = one
   * repo) — a non-empty workspace is refused, never overwritten. With `force` the
   * existing contents are REPLACED with the repo (the confirmed "override" path).
   * Requires the pod authed + up. */
  cloneRepo(id: string, repo: string, force?: boolean): Promise<CloneResult>;
  /** Forget the pod's GitHub login (the cockpit's confirmed "Disconnect").
   * Already-cloned repos stay; only future authenticated git operations stop. */
  clearGithubToken(id: string): Promise<void>;
  /** In-pod GitHub DEVICE login (self-host): the POD itself runs the OAuth device flow with gh's
   * own client, so there's no podbay OAuth app to configure. `start` returns the one-time code the
   * owner types at github.com/login/device; `poll` installs the token once GitHub authorizes.
   * Optional — only the local (self-host) provider implements these. */
  startGhLogin?(id: string): Promise<GhDeviceStart>;
  pollGhLogin?(id: string, deviceCode: string): Promise<GhDevicePoll>;
  /** Add an agent to a LIVE pod, starting it in its own window (multi-agent slice 3).
   * Additive by design: never recreates the instance, so the already-running agent's
   * session survives. Idempotent — adding an agent the pod already runs is a no-op. */
  addAgent?(id: string, agent: string): Promise<{ window: number }>;
  /** Merge a partial update into the running pod's `/etc/podbay/pod-spec.json` so in-pod
   * readers (the `podbay` CLI, `podbay-doctor`) reflect a post-launch change instead of the
   * launch-time value. The spec is written ONCE at boot and preserved verbatim across
   * recreates (bar `permissions`), so a field the owner later changes — preview visibility,
   * display name, lifecycle — otherwise reads stale in-pod forever. Best-effort by contract:
   * callers MUST NOT let a failure (pod suspended/unreachable) fail the mutation; the DB stays
   * the source of truth and a later change re-attempts. No-op if the provider can't reach the
   * pod's filesystem. */
  patchPodSpec?(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Live config-refresh (docs/plans/live-config-refresh.md): push the CURRENT pod-base content —
   * the env `.claude` layer + skills, plus freshly-resolved `permissions` — into a RUNNING pod and
   * re-apply it WITHOUT recreating the instance or restarting the agent process. So a build that only
   * carries hot-pushable content (skills, settings/hooks, rules) reaches existing 24/7 pods with no
   * reboot: settings/hooks/permissions and skills reach the live session at once (Claude's file
   * watcher / next skill invocation); `CLAUDE.md` prose lands at the agent's next compaction. Returns
   * whether the in-pod refresh actually ran — an older image without the refresh script reports
   * `refreshed:false` + a `note`. Best-effort delivery: MUST NOT throw for a suspended/unreachable
   * pod. Optional + edition-symmetric (incus file-push + exec; local docker exec). */
  refreshConfig?(
    id: string,
    opts: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<{ refreshed: boolean; note?: string }>;
  /** Mint a short-lived Codex pairing code (the codex analog of the Claude session
   * URL): the user enters it in their Codex app to connect to this pod. Generated on
   * demand against the pod's RC daemon; the pod shows in the app as `deviceName`.
   * Throws (transient) if the pod is unreachable / its daemon isn't ready. */
  codexPair(id: string): Promise<CodexPairing>;
  /** Whether the pod's Codex remote-control daemon is up, i.e. the pod is registered
   * and available in the user's Codex app. Deliberately NOT "an app is paired" —
   * that lives server-side and is not observable on the pod. Non-throwing. */
  codexRcActive(id: string): Promise<boolean>;
  /**
   * ONE read of the pod's /healthz, returning everything it reports about itself.
   *
   * Was three methods (agentStates / podIssues / podRepairs) that each fetched the
   * SAME endpoint — three round-trips per cockpit render, and three chances for the
   * surfaces to disagree about a pod at one moment in time. A fleet view would have
   * multiplied that by the number of pods. Non-throwing: an unreachable pod, or one
   * on an image that predates a field, yields empty parts rather than an error.
   */
  podHealth(id: string): Promise<PodHealth>;
  /** Run the pod's doctor. "check" changes nothing; "safe" applies the safe repairs;
   * "invasive" also applies repairs that REPLACE files (backing them up first), and
   * exists as its own mode so a safe fix can never quietly become a destructive one. */
  runDoctor(id: string, mode: DoctorMode): Promise<DoctorReport>;
  /** Bounded diagnostics — see the REPORT BOUNDARY in pod-base/podbay-doctor.
   * Exists so support can diagnose novel breakage WITHOUT a shell on a user's pod:
   * facts about the machine, never the user's content. */
  podReport(id: string): Promise<DiagnosticReport>;
  /** Drain what this pod learned about fetching, and install the fleet's current
   * plan. Both on the poll the control plane already makes — the pod never calls out,
   * so there is no per-pod credential. */
  drainFetchReports?(id: string): Promise<FetchReport[]>;
  pushFetchPlan?(id: string, plan: unknown): Promise<void>;
  /** Switch the pod's Codex remote-control daemon on/off. OFF persists on the pod
   * (survives restarts/wakes) until switched back on. */
  setCodexRc(id: string, on: boolean): Promise<void>;
  /** Type text (the sign-in code the owner pasted in the cockpit) into a SPECIFIC
   * agent's window, followed by Enter. Window-targeted: the terminal WebSocket
   * follows the ACTIVE window, which is the wrong destination on a 2-agent pod. */
  sendAgentInput(id: string, agent: string, text: string): Promise<void>;
}

/** Everything a pod reports about itself in one read. */
export interface PodHealth {
  agents: PodAgentState[];
  issues: PodIssue[];
  /** `cause` attributes a repair (e.g. an agent respawn) to why it happened — `oom` when
   * an out-of-memory kill was seen around the death. */
  repairs: { target: string; reason: string; at: string; cause?: string }[];
  /** Targets the watchdog gave up repairing. */
  repairGaveUp: string[];
  /** Out-of-memory kills the pod-agent read from the kernel log. */
  ooms?: { victim: string; rssMb: number; victimIsAgent: boolean; ktime: number; at: string }[];
  /** The agent CLI's OWN activity state — `busy` | `shell` | `idle` | `waiting`.
   * Null/absent on images that predate the field or when no session reports one. */
  agentStatus?: string | null;
  /** Codex activity, derived from its rollout-log mtime — `busy` | `idle` | null (no
   * session yet / older image). Codex exposes no live state file like Claude does. */
  codexStatus?: string | null;
  /** What the CLI says it's blocked on (e.g. "dialog open") — distinguishes
   * "needs an answer from you" from plain waiting. Absent on older images. */
  agentWaitingFor?: string | null;
  /** DEPRECATED for activity — time since the last terminal OUTPUT (spinners/redraws tick it), so it
   * "lies" about real work. Kept for older callers; use `lastActivityMs` instead. */
  idleMs?: number | null;
  /** Milliseconds since the agent's newest TRANSCRIPT entry — a message, tool CALL, or tool RESULT
   * (the same source the Claude app shows). The HONEST "last active" signal: it reflects real turns
   * and tool work, unlike `idleMs` (terminal output) or `lastActiveAt` (terminal traffic only, blind
   * to app/remote-control and autonomous work). Null on an image that doesn't report it. */
  lastActivityMs?: number | null;
  /** Whether anything is serving the preview port (:3000) right now. Absent
   * (undefined) on older images — callers must treat that as unknown, not false. */
  appListening?: boolean;
}

export type DoctorMode = "check" | "safe" | "invasive";

/** One named, printed section of a diagnostic bundle. Named so a reader can see
 * exactly what was collected — an unlabelled dump is indistinguishable from a
 * shell, which is the thing this replaces. */
/** One outcome a pod recorded while climbing the ladder. */
export interface FetchReport {
  domain: string;
  rung: string;
  outcome: string;
  at?: string;
}

export interface DiagnosticReport {
  collectedAt: string;
  sections: { name: string; text: string }[];
}

/** What `podbay doctor` found (and fixed, when asked). `invasive` marks a finding
 * whose repair replaces files, so a surface can ask for consent separately. */
export interface DoctorReport {
  checked: number;
  issues: {
    id: string;
    severity: string;
    title: string;
    detail: string;
    fixed: boolean;
    invasive?: boolean;
  }[];
}

/** A repository the connected GitHub user can clone (owner + collaborator + org). */
export interface GithubRepo {
  fullName: string;
  private: boolean;
  updatedAt: string;
}

/** Outcome of cloning a repo into a pod's ~/work. `not-empty` is a refusal (one pod =
 * one repo), not an error — the workspace already has code and is left untouched. */
export type CloneResult = { ok: true; dest: string } | { ok: false; reason: "not-empty" | "invalid" };

export interface GhDeviceStart {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}
export type GhDevicePoll =
  | { status: "connected"; login: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "error"; error: string };

/** A short-lived Codex pairing code + the device name the pod registers under.
 * `manualPairingCode` is the short XXXX-XXXX the user types; `pairingCode` is the long
 * value the QR wraps (`https://chatgpt.com/codex/pair?pairing_code=…`). `expiresAt` is
 * unix seconds (~10 min out). */
export interface CodexPairing {
  manualPairingCode: string;
  pairingCode: string;
  expiresAt: number;
  deviceName: string;
}

/**
 * Trim a snapshot to a window, client-side.
 *
 * Needed when a pod runs an older agent that cannot narrow it itself: the caller
 * asked for an hour and must not be handed a day, or the "covering X" line beside
 * the charts becomes a lie.
 */
export function narrowSnapshot(snap: MetricsSnapshot, windowMs: number): MetricsSnapshot {
  if (!Array.isArray(snap.series) || snap.series.length === 0) return snap;
  const newest = snap.series[snap.series.length - 1]!.t;
  // Anchored on the newest SAMPLE, not on now(): a suspended pod's history ends
  // when it stopped recording, and anchoring on now would show an empty window.
  const from = newest - windowMs;
  return { ...snap, series: snap.series.filter((s) => s.t >= from) };
}
