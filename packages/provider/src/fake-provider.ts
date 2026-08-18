import { readFileSync, writeFileSync, openSync, closeSync, rmSync } from "node:fs";
import type { MetricSample, MetricsSnapshot, BoxStats, PodAgentState, PodIssue } from "@podbay/shared";
import type {
  SandboxProvider,
  CodexPairing,
  DoctorReport,
  DoctorMode,
  PodHealth,
  DiagnosticReport,
  FetchReport,
  GithubRepo,
  CloneResult,
} from "./provider.js";
import {
  ProviderError,
  type CreatePodInput,
  type ExecResult,
  type PodInfo,
  type UpdateStage,
} from "./types.js";

/**
 * In-memory SandboxProvider for e2e / local hermetic mode (`PODBAY_FAKE_PROVIDER=1`).
 * No Fly, no network — pods are objects. `endpoint()` returns a configurable
 * local pod-agent address so the terminal path can point at a real local agent.
 */
export class FakeProvider implements SandboxProvider {
  private podsMem = new Map<string, PodInfo>();
  /** e2e runs TWO processes against one database — the Next server and the test
   * stack (gateway) — and BOTH run the provisioning sweep. With per-process
   * in-memory state, whichever process built a pod was the only one that could
   * see it; the other reported it "gone" and wrote that to the shared row. That
   * raced non-deterministically (a pod read as Running or Gone depending on who
   * won). PODBAY_FAKE_STATE_FILE makes the double's state shared, which is what
   * "one fake provider" was always supposed to mean. */
  private get stateFile(): string | null {
    return process.env.PODBAY_FAKE_STATE_FILE ?? null;
  }
  private get pods(): Map<string, PodInfo> {
    const f = this.stateFile;
    if (!f) return this.podsMem;
    try {
      return new Map(Object.entries(JSON.parse(readFileSync(f, "utf8")) as Record<string, PodInfo>));
    } catch {
      return new Map();
    }
  }
  /**
   * Apply ONE pod's change under a lock, re-reading first.
   *
   * Writing the whole map wholesale loses updates: Playwright runs specs in
   * parallel, so several processes read the file, each adds its own pod, and the
   * last writer wipes the others' — pods vanished mid-test and 13 specs failed
   * with pods that "didn't exist". Read-modify-write must be atomic, so take an
   * exclusive lock file (O_EXCL), re-read, apply just this delta, write, release.
   */
  private applyDelta(id: string, info: PodInfo | null): void {
    const f = this.stateFile;
    if (!f) {
      if (info) this.podsMem.set(id, info);
      else this.podsMem.delete(id);
      return;
    }
    const lock = `${f}.lock`;
    let fd: number | undefined;
    for (let i = 0; i < 200 && fd === undefined; i++) {
      try {
        fd = openSync(lock, "wx");
      } catch {
        // 5ms busy-wait; contention here is a handful of processes, not a fleet
        const until = Date.now() + 5;
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
    try {
      const m = this.pods; // fresh read INSIDE the lock
      if (info) m.set(id, info);
      else m.delete(id);
      writeFileSync(f, JSON.stringify(Object.fromEntries(m)));
    } catch {
      /* best-effort: a test double must never take the run down */
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        rmSync(lock, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  /** Agents per pod (primary first) — lets the agent-card cockpit and the add-agent
   * flow run hermetically in dev/e2e. */
  private agents = new Map<string, string[]>();
  constructor(
    private readonly opts: { region?: string; agentEndpoint?: string; previewEndpoint?: string } = {},
  ) {}

  async createPod(input: CreatePodInput): Promise<PodInfo> {
    const existing = this.pods.get(input.id);
    if (existing) return existing;
    this.agents.set(input.id, [...(input.agents ?? ["claude-code"])]);
    const info: PodInfo = {
      id: input.id,
      status: "running",
      region: input.region ?? this.opts.region ?? "fra",
      endpoint: this.opts.agentEndpoint ?? null,
      keepAwake: false,
    };
    // e2e: a pod NAMED with the NO-SESSION sentinel never gets a session URL, so it
    // stays in the onboarding "login" phase (deriveSetupStep) instead of jumping to
    // ready — the only way to exercise the sign-in hero, which PODBAY_FAKE_SESSION_URL
    // otherwise skips. The flag rides the persisted PodInfo so both processes see it.
    if (input.name?.includes("NO-SESSION")) (info as { noSession?: boolean }).noSession = true;
    this.applyDelta(input.id, info);
    return info;
  }
  async getPod(id: string): Promise<PodInfo> {
    return (
      this.pods.get(id) ?? {
        id,
        status: "gone",
        region: this.opts.region ?? "fra",
        endpoint: null,
        keepAwake: false,
      }
    );
  }
  async listPods(filter?: { owner?: string }): Promise<PodInfo[]> {
    void filter;
    return [...this.pods.values()];
  }
  /** Records every exec script (the last argv element), so a test can assert what ran. */
  execScripts: string[] = [];
  /** Scriptable exec: a test sets this to drive stdout by matching on the command
   * (e.g. the agent-messaging outbox drain / tmux injection). Default = empty stdout,
   * the prior behavior. Return a string for stdout, or a full ExecResult. */
  execHandler?: (script: string, cmd: string[], id: string) => string | ExecResult;
  async exec(id: string, cmd: string[] = []): Promise<ExecResult> {
    const script = cmd[cmd.length - 1] ?? "";
    this.execScripts.push(script);
    const r = this.execHandler?.(script, cmd, id);
    if (typeof r === "string") return { exitCode: 0, stdout: r, stderr: "" };
    return r ?? { exitCode: 0, stdout: "", stderr: "" };
  }
  async sleep(id: string): Promise<PodInfo> {
    return this.mut(id, "suspended");
  }
  async wake(id: string): Promise<PodInfo> {
    return this.mut(id, "running");
  }
  async setKeepAwake(id: string, keepAwake: boolean): Promise<PodInfo> {
    const p = this.pods.get(id);
    if (!p) throw new ProviderError(`pod ${id} not found`, "not_found");
    const next = { ...p, keepAwake };
    this.applyDelta(id, next);
    return next;
  }
  async resize(id: string): Promise<PodInfo> {
    // The fake box has infinite headroom — sizing is a no-op, just prove the call
    // reaches the provider and the pod stays live.
    //
    // A real resize stops and restarts the pod over minutes, and the UI it drives
    // (one transient state, progress, read-only settings) is only observable WHILE
    // that is happening. Returning instantly made that window unobservable, so the
    // regression it guards against couldn't be tested. `resizeDelayMs` reintroduces
    // the duration without the machine.
    if (this.resizeDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.resizeDelayMs));
    }
    return this.require(id);
  }

  /** Test knob: how long a resize should appear to take. */
  resizeDelayMs = Number(process.env.PODBAY_FAKE_RESIZE_MS ?? 0);
  async snapshot(): Promise<{ snapshotId: string }> {
    return { snapshotId: "fake-snap" };
  }
  async destroy(id: string): Promise<void> {
    this.applyDelta(id, null);
    this.agents.delete(id);
  }

  /** Fake add: record it so agentStates reflects the new agent (window = position). */
  async addAgent(id: string, agent: string): Promise<{ window: number }> {
    this.require(id);
    const list = this.agents.get(id) ?? ["claude-code"];
    if (!list.includes(agent)) list.push(agent);
    this.agents.set(id, list);
    return { window: list.indexOf(agent) };
  }
  /** Fake spec patch: accumulate the merged fields so a test can assert what was pushed. */
  readonly specPatches = new Map<string, Record<string, unknown>>();
  async patchPodSpec(id: string, patch: Record<string, unknown>): Promise<void> {
    this.require(id);
    this.specPatches.set(id, { ...(this.specPatches.get(id) ?? {}), ...patch });
  }
  /** Live config-refresh calls recorded for e2e/tests. */
  readonly refreshConfigCalls: { id: string; files: number }[] = [];
  async refreshConfig(
    id: string,
    opts: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<{ refreshed: boolean; note?: string }> {
    this.require(id);
    this.refreshConfigCalls.push({ id, files: opts.claudeFiles?.length ?? 0 });
    return { refreshed: true };
  }
  async endpoint(id: string): Promise<string> {
    const p = this.require(id);
    if (!p.endpoint) throw new ProviderError(`pod ${id} has no endpoint`, "invalid");
    return p.endpoint;
  }
  async podAddress(id: string, port: number): Promise<string> {
    this.require(id);
    // e2e points this at a local test app; default keeps the port meaningful.
    return this.opts.previewEndpoint ?? `http://127.0.0.1:${port}`;
  }
  async agentReady(id: string): Promise<boolean> {
    return this.require(id).status === "running";
  }
  /** No in-pod agent to probe in the fake — no activity signal (allows sleep). */
  async agentIdleMs(): Promise<number | null> {
    return null;
  }
  /** Overridable in tests; no real agent to read a session URL from. PODBAY_FAKE_SESSION_URL
   * lets e2e hand the pod a remote-control link so the launch wizard reaches READY
   * immediately. Without it a fake pod is stuck on "Starting your agent" for
   * RC_WAIT_MS (90s) — longer than any sane test timeout, which is why every
   * cockpit-ready assertion failed while the product was fine. */
  sessionUrl: string | null = process.env.PODBAY_FAKE_SESSION_URL ?? null;
  async agentSessionUrl(id?: string): Promise<string | null> {
    // A NO-SESSION pod stays in onboarding — never hand it a ready session link.
    if (id && (this.pods.get(id) as { noSession?: boolean } | undefined)?.noSession) return null;
    return this.sessionUrl;
  }
  /** Fake pairing code so the Codex pairing wizard can be exercised in dev/e2e
   * (10-min countdown, device named by pod id). */
  async codexRcActive(): Promise<boolean> {
    return process.env.PODBAY_FAKE_CODEX_RC === "1";
  }

  /** Fake per-agent states so the agent-card cockpit can be exercised in dev/e2e.
   * Agents are whatever addAgent recorded (or claude-code); all authed, RC mirrors
   * the pod-level fakes. */
  /** Records cockpit-sent sign-in codes so e2e can assert the flow without a pod. */
  sentAgentInput: { id: string; agent: string; text: string }[] = [];
  async sendAgentInput(id: string, agent: string, text: string): Promise<void> {
    this.sentAgentInput.push({ id, agent, text });
  }

  /**
   * Scriptable per-POD health, read from a sidecar of the shared state file.
   *
   * Per-pod rather than a field or an env var: e2e runs specs in PARALLEL against
   * ONE server, so a process-wide "this pod is unhealthy" would leak into every
   * other spec's pod and make the suite non-deterministic. Keyed by pod id, a test
   * can make ITS pod sick and nobody else's.
   *
   * A test writes `<state-file>.health.json`:
   *   { "<pod-id>": { "issues": [...], "doctor": { checked, issues } } }
   */
  private scripted(id: string): {
    issues?: PodIssue[];
    doctor?: DoctorReport;
    gh?: boolean;
    workEmpty?: boolean;
    secretRequests?: { key: string; description: string; at: string }[];
    agentStatus?: string;
    codexStatus?: string;
    agentWaitingFor?: string;
    appListening?: boolean;
  } {
    const f = this.stateFile;
    if (!f) return {};
    try {
      const all = JSON.parse(readFileSync(`${f}.health.json`, "utf8")) as Record<
        string,
        {
          issues?: PodIssue[];
          doctor?: DoctorReport;
          gh?: boolean;
          workEmpty?: boolean;
          secretRequests?: { key: string; description: string; at: string }[];
          agentStatus?: string;
          codexStatus?: string;
          agentWaitingFor?: string;
          appListening?: boolean;
        }
      >;
      return all[id] ?? {};
    } catch {
      return {};
    }
  }

  /** One read of the fake pod's health — agents from what addAgent recorded, the
   * rest scripted per pod (see scripted()). */
  async podHealth(id: string): Promise<PodHealth> {
    const agents = this.agents.get(id) ?? ["claude-code"];
    const scripted = this.scripted(id);
    // A NO-SESSION pod is mid-onboarding: its agent isn't signed in yet, so the sign-in
    // hero (and the AgentCards needs-signin state) render instead of jumping past them.
    const authed = !(this.pods.get(id) as { noSession?: boolean } | undefined)?.noSession;
    return {
      agents: agents.map((a, i) => ({
        id: a,
        window: i,
        authed,
        rcActive: a === "codex" ? process.env.PODBAY_FAKE_CODEX_RC === "1" : this.sessionUrl != null,
      })),
      issues: scripted.issues ?? this.fakeIssues,
      repairs: this.fakeRepairs,
      repairGaveUp: [],
      // Live signals for the dashboard cards — scriptable per pod in e2e; default
      // to a plausible "waiting at the prompt" with the preview up.
      agentStatus: scripted.agentStatus ?? "waiting",
      codexStatus: scripted.codexStatus ?? null,
      agentWaitingFor: scripted.agentWaitingFor ?? null,
      appListening: scripted.appListening ?? true,
    };
  }

  /** Scriptable doctor result for e2e/dev; healthy unless a test says otherwise. */
  fakeDoctor: DoctorReport = { checked: 0, issues: [] };
  async runDoctor(id: string, mode: DoctorMode): Promise<DoctorReport> {
    const scripted = this.scripted(id).doctor;
    if (!scripted) return this.fakeDoctor;
    // Honour the mode the way the real doctor does: "check" changes nothing; a fix
    // marks the fixable findings fixed, and only an INVASIVE run touches invasive
    // ones — so a test can assert the difference rather than trusting the label.
    if (mode === "check") return scripted;
    return {
      checked: scripted.checked,
      issues: scripted.issues.map((i) =>
        i.fixed || (i.invasive && mode !== "invasive") ? i : { ...i, fixed: true },
      ),
    };
  }
  async podReport(id: string): Promise<DiagnosticReport> {
    void id;
    return {
      collectedAt: "2026-01-01T00:00:00.000Z",
      sections: [{ name: "disk-free", text: "20G total, 15G free" }],
    };
  }
  fetchReports: FetchReport[] = [];
  pushedPlan: unknown = null;
  async drainFetchReports(): Promise<FetchReport[]> {
    const out = this.fetchReports;
    this.fetchReports = [];
    return out;
  }
  async pushFetchPlan(_id: string, plan: unknown): Promise<void> {
    this.pushedPlan = plan;
  }



  /** Scriptable in tests; a fake pod is healthy unless a test says otherwise. */
  fakeIssues: PodIssue[] = [];
  /** Scriptable in tests; a fake pod repairs nothing on its own. */
  fakeRepairs: { target: string; reason: string; at: string }[] = [];
  fakeCodexRcOff = false;
  async setCodexRc(_id: string, on: boolean): Promise<void> {
    this.fakeCodexRcOff = !on;
  }

  async codexPair(id: string): Promise<CodexPairing> {
    return {
      manualPairingCode: "FAKE-CODE",
      pairingCode: "00000000000000000000fake",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      deviceName: id,
    };
  }
  /** Fake paired status — flip PODBAY_FAKE_CODEX_PAIRED=1 to exercise the "Connected"
   * state of the wizard in dev. */
  /** Overridable in tests; no real agent to ask (null → idle policy falls back). */
  agentState: string | null = null;
  /** Fake: swap the recorded image; the volume/data concept doesn't exist here. */
  /** Walks the same stages a real update reports, with a short pause between
   * them, so the cockpit's progress UI can be exercised in dev/e2e without the
   * box. `fakeUpdateStageMs` = 0 makes it instant for tests that don't care. */
  fakeUpdateStageMs = 1500;
  async updateImage(id: string, image: string, onStage?: UpdateStage): Promise<PodInfo> {
    const p = this.require(id);
    for (const s of ["stopping", "recreating", "starting", "booting", "waiting for agent"]) {
      onStage?.(s);
      if (this.fakeUpdateStageMs > 0)
        await new Promise((r) => setTimeout(r, this.fakeUpdateStageMs));
    }
    const next = { ...p, imageDigest: image.split("@")[1] ?? image };
    this.applyDelta(id, next);
    return next;
  }
  async agentStatus(): Promise<string | null> {
    return this.agentState;
  }
  /** Synthetic box stats so /admin/boxes renders in fake/local mode. Pods come
   * from this provider's in-memory map; RAM usage is a deterministic fraction of
   * each pod's tier so the fit-viz shows real-looking density. */
  async boxStats(): Promise<BoxStats> {
    // A synthetic spread (independent of the in-memory pods) so /admin/boxes shows
    // realistic density in fake/local mode.
    const spec: [string, "s" | "m" | "l"][] = [
      ["doc-qa-demo", "m"],
      ["saas-app-1", "l"],
      ["bot-2", "s"],
      ["landing-3", "s"],
      ["repo-onboard-4", "m"],
      ["game-jam-5", "s"],
    ];
    const memGb = (sz: string) => (sz === "l" ? 16 : sz === "m" ? 8 : 4);
    const pods = spec.map(([id, size]) => ({
      id,
      name: null,
      size,
      slots: memGb(size) / 4,
      status: "running",
      ramUsedMb: Math.round(memGb(size) * 1024 * 0.55), // ~55% of the ceiling, actual
    }));
    const usedMb = pods.reduce((n, p) => n + (p.ramUsedMb ?? 0), 0) + 6144; // + host overhead
    return {
      name: "hetzner-fsn1",
      region: "hetzner-fsn1",
      reachable: true,
      cpuCores: 24,
      ramUsedMb: usedMb,
      ramTotalMb: 128 * 1024,
      diskUsedMb: 40 * 1024,
      diskTotalMb: 1700 * 1024,
      pods,
    };
  }
  /** Synthetic metrics so the Stats tab renders in fake/local mode. Deterministic
   * (index-based, no RNG) so snapshots are stable across renders. */
  async fetchMetrics(id: string): Promise<MetricsSnapshot | null> {
    if (this.require(id).status !== "running") return null;
    const n = 60;
    const now = 1_700_000_000_000;
    const states = ["idle", "waiting", "busy", "shell"];
    const series: MetricSample[] = Array.from({ length: n }, (_, i) => {
      const wave = (Math.sin(i / 6) + 1) / 2; // 0..1, smooth
      return {
        t: now + i * 60_000,
        cpuPct: Math.round(8 + wave * 55),
        memUsedMb: Math.round(1400 + wave * 1800),
        memTotalMb: 4096,
        diskUsedMb: 4200 + i * 8, // slowly filling
        diskTotalMb: 10240,
        netRxKbps: Math.round(wave * 900),
        netTxKbps: Math.round(wave * 180),
        agentStatus: states[i % 4],
      };
    });
    const last = series[series.length - 1];
    return {
      series,
      disk: {
        path: "/home/dev",
        usedMb: last.diskUsedMb,
        totalMb: last.diskTotalMb,
        breakdown: [
          { label: "node_modules", mb: 2600 },
          { label: "Repo", mb: 1400 },
          { label: "Claude", mb: 480 },
        ],
      },
      app: { port: 3000, listening: true },
      sampleIntervalMs: 60_000,
    };
  }
  /** Fake GitHub connection state — flips on setGithubToken so the cockpit chip
   * can be driven end-to-end in dev/e2e without a real device flow. */
  private ghConnected = false;
  async githubStatus(id?: string): Promise<{ connected: boolean; login: string | null }> {
    // e2e can script a pod as already-connected (the real device flow can't run headless).
    const connected = (id ? this.scripted(id).gh : undefined) ?? this.ghConnected;
    return { connected, login: connected ? "octocat" : null };
  }
  async setGithubToken(): Promise<{ login: string }> {
    this.ghConnected = true;
    return { login: "octocat" };
  }
  async clearGithubToken(): Promise<void> {
    this.ghConnected = false;
  }
  /** Fake repo list + workspace emptiness so the "add GitHub → choose repo → clone"
   * flow is drivable in e2e. `fakeWorkEmpty` toggles the one-pod-one-repo refusal. */
  fakeRepos: GithubRepo[] = [
    { fullName: "octocat/hello-world", private: false, updatedAt: "2026-08-01T00:00:00Z" },
    { fullName: "octocat/secret-lab", private: true, updatedAt: "2026-07-30T00:00:00Z" },
  ];
  fakeWorkEmpty = true;
  clonedRepo?: string;
  async listRepos(): Promise<GithubRepo[]> {
    return this.fakeRepos;
  }
  async cloneRepo(id: string, repo: string, force = false): Promise<CloneResult> {
    this.require(id);
    // e2e can script a non-empty workspace per pod (to exercise the overwrite path).
    const workEmpty = this.scripted(id).workEmpty ?? this.fakeWorkEmpty;
    if (!workEmpty && !force) return { ok: false, reason: "not-empty" };
    this.clonedRepo = repo; // a forced clone replaces whatever was there
    this.fakeWorkEmpty = false;
    return { ok: true, dest: "/home/dev/work" };
  }

  /** Secret requests the agent has declared; settable in tests. Per-pod scripting (via
   * the sidecar) takes precedence so e2e can make ONE pod show an agent request without
   * leaking into other specs. */
  secretRequestList: { key: string; description: string; at: string }[] = [];
  async secretRequests(id?: string): Promise<{ key: string; description: string; at: string }[]> {
    return (id ? this.scripted(id).secretRequests : undefined) ?? this.secretRequestList;
  }

  /** Records the last-injected secrets so e2e can assert the injection path ran. */
  lastSecrets?: Record<string, string>;
  async injectSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    this.require(id);
    this.lastSecrets = secrets;
  }

  private require(id: string): PodInfo {
    const p = this.pods.get(id);
    if (!p) throw new ProviderError(`pod ${id} not found`, "not_found");
    return p;
  }
  private mut(id: string, status: PodInfo["status"]): PodInfo {
    const p = this.pods.get(id);
    if (!p) throw new ProviderError(`pod ${id} not found`, "not_found");
    const next = { ...p, status };
    this.applyDelta(id, next); // mutating the returned object isn't enough when shared
    return next;
  }
}
