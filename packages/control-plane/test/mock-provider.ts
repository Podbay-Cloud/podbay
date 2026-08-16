import type {
  CreatePodInput,
  ExecResult,
  PodInfo,
  PodStatus,
  SandboxProvider,
} from "@podbay/provider";

/** In-memory SandboxProvider for control-plane tests. */
export class MockProvider implements SandboxProvider {
  pods = new Map<string, PodInfo>();
  destroyed: string[] = [];
  /** Force createPod to still succeed but let tests flip status afterwards. */
  region = "fra";
  /** App secrets injected into the most recent createPod (launch-config tests). */
  lastSecrets?: Record<string, string>;
  /** Stdout returned by exec (cred-read tests). */
  execStdout = "";
  /** Secrets pushed by the most recent injectSecrets call (secret tests). */
  injectedSecrets?: Record<string, string>;
  injectCalls = 0;

  /** Every machine this provider has ever built, in order — so a test can assert
   * a retry ADOPTED the existing machine instead of building a second one. */
  machinesBuilt: string[] = [];
  private machineSeq = 0;
  /** createPod inputs (id + resolved tier) for sizing assertions. */
  created: { id: string; resources?: CreatePodInput["resources"] }[] = [];

  /** When set, createPod throws — to test provisioning-failure handling. */
  failCreate?: string;

  async createPod(input: CreatePodInput): Promise<PodInfo> {
    this.lastSecrets = input.secrets;
    this.created.push({ id: input.id, resources: input.resources });
    if (this.failCreate) throw new Error(this.failCreate);
    // Adopt a machine the caller already knows about (the real provider does a
    // consistent by-id read here) — must NOT build another.
    if (input.knownMachineId) {
      const existing = this.pods.get(input.id);
      if (existing) return existing;
    }
    const machineId = `machine-${++this.machineSeq}`;
    this.machinesBuilt.push(machineId);
    await input.onMachineCreated?.(machineId);
    const info: PodInfo = {
      id: input.id,
      status: "running",
      region: input.region ?? this.region,
      endpoint: `http://[fdaa::1]:8080`,
      keepAwake: false,
      machineId,
      imageDigest: "sha256:test",
    };
    this.pods.set(input.id, info);
    return info;
  }
  async getPod(id: string): Promise<PodInfo> {
    return this.pods.get(id) ?? { id, status: "gone", region: this.region, endpoint: null, keepAwake: false };
  }
  async listPods(): Promise<PodInfo[]> {
    return [...this.pods.values()];
  }
  execCalls: string[][] = [];
  async exec(_id: string, cmd: string[]): Promise<ExecResult> {
    this.execCalls.push(cmd);
    return { exitCode: 0, stdout: this.execStdout, stderr: "" };
  }
  async sleep(id: string): Promise<PodInfo> {
    return this.set(id, "suspended");
  }
  async wake(id: string): Promise<PodInfo> {
    return this.set(id, "running");
  }
  async setKeepAwake(id: string, keepAwake: boolean): Promise<PodInfo> {
    const p = this.pods.get(id)!;
    p.keepAwake = keepAwake;
    return p;
  }
  resized: { id: string; cpus: number; memoryGb: number; diskGb: number }[] = [];
  async resize(id: string, r: { cpus: number; memoryGb: number; diskGb: number }): Promise<PodInfo> {
    this.resized.push({ id, ...r });
    return this.pods.get(id)!; // stays running; a real provider would blip it
  }
  async snapshot(): Promise<{ snapshotId: string }> {
    return { snapshotId: "snap" };
  }
  async destroy(id: string): Promise<void> {
    this.destroyed.push(id);
    this.pods.delete(id);
  }
  async endpoint(id: string): Promise<string> {
    return this.pods.get(id)?.endpoint ?? "";
  }
  async podAddress(id: string, port: number): Promise<string> {
    return `http://[fdaa::1]:${port}`;
  }
  async agentReady(id: string): Promise<boolean> {
    return this.pods.get(id)?.status === "running";
  }
  /** Agent idle time per pod (tests set this to simulate a busy pod). */
  agentIdle = new Map<string, number | null>();
  async agentIdleMs(id: string): Promise<number | null> {
    return this.agentIdle.has(id) ? (this.agentIdle.get(id) ?? null) : null;
  }
  /** Metrics app.listening per pod — the fallback the live-signals sweep uses when an
   * older image doesn't report appListening on /healthz. Unset → no metrics available. */
  metricsAppListening = new Map<string, boolean>();
  async fetchMetrics(id: string): Promise<import("@podbay/shared").MetricsSnapshot | null> {
    if (!this.metricsAppListening.has(id)) return null;
    return {
      series: [],
      disk: { path: "/home/dev", usedMb: 0, totalMb: 0, breakdown: [] },
      app: { port: 3000, listening: this.metricsAppListening.get(id)! },
      sampleIntervalMs: 1000,
    };
  }
  /** RC session URL per pod (tests set this to simulate the greeter observing it). */
  agentSession = new Map<string, string | null>();
  async agentSessionUrl(id: string): Promise<string | null> {
    return this.agentSession.get(id) ?? null;
  }
  /** Claude's own state per pod: busy|shell|idle|waiting (null = CLI didn't report). */
  agentState = new Map<string, string | null>();
  /** Records image updates so tests can assert the in-place swap happened. */
  updatedImages: { id: string; image: string }[] = [];
  /** Records the claude layer delivered with each update (seed-on-update fix). */
  updateClaudeFiles: { id: string; paths: string[] }[] = [];
  /** When set, updateImage awaits it — lets a test observe the row DURING the
   * update (the durable "updating" flag). */
  updateImageGate?: Promise<void>;
  /** Records add-agent calls (slice 3). Returns a window index like the real one. */
  addedAgents: { id: string; agent: string }[] = [];
  /** Scripted per-agent states (agent-card cockpit tests). */
  agentStatesResult: import("@podbay/shared").PodAgentState[] = [];
  /** One health read; the individual scriptable fields feed it. */
  /** Scriptable live signals (dashboard cards). */
  agentStatusResult: string | null = null;
  codexStatusResult: string | null = null;
  appListeningResult: boolean | undefined = undefined;
  async podHealth(): Promise<import("@podbay/provider").PodHealth> {
    return {
      agents: this.agentStatesResult,
      issues: this.issuesResult,
      repairs: this.repairsResult,
      repairGaveUp: [],
      agentStatus: this.agentStatusResult,
      codexStatus: this.codexStatusResult,
      agentWaitingFor: null,
      ...(this.appListeningResult !== undefined ? { appListening: this.appListeningResult } : {}),
    };
  }

  /** Scriptable doctor report. */
  doctorResult: {
    checked: number;
    issues: { id: string; severity: string; title: string; detail: string; fixed: boolean; invasive?: boolean }[];
  } = { checked: 0, issues: [] };
  doctorCalls: { id: string; mode: string }[] = [];
  async runDoctor(id: string, mode: import("@podbay/provider").DoctorMode) {
    this.doctorCalls.push({ id, mode });
    return this.doctorResult;
  }

  /** Scriptable pod issues (health strip tests). */
  issuesResult: import("@podbay/shared").PodIssue[] = [];
  /** Scriptable watchdog repairs, for the event-ingestion tests. */
  repairsResult: { target: string; reason: string; at: string }[] = [];
  /** Records cockpit-sent sign-in codes (per-agent login flow). */
  sentAgentInput: { id: string; agent: string; text: string }[] = [];
  async sendAgentInput(id: string, agent: string, text: string): Promise<void> {
    this.sentAgentInput.push({ id, agent, text });
  }

  /** Records RC toggles so tests can assert the passthrough + persistence intent. */
  codexRcToggles: { id: string; on: boolean }[] = [];
  async setCodexRc(id: string, on: boolean): Promise<void> {
    this.codexRcToggles.push({ id, on });
  }

  async addAgent(id: string, agent: string): Promise<{ window: number }> {
    this.addedAgents.push({ id, agent });
    return { window: this.addedAgents.length };
  }
  /** Accumulated spec patches per pod — asserts the push-on-mutation freshness path. */
  specPatches = new Map<string, Record<string, unknown>>();
  async patchPodSpec(id: string, patch: Record<string, unknown>): Promise<void> {
    this.specPatches.set(id, { ...(this.specPatches.get(id) ?? {}), ...patch });
  }
  /** Permissions passed to the most recent updateImage — asserts the refresh-preset path. */
  updatePermissions: unknown[] = [];
  async updateImage(
    id: string,
    image: string,
    onStage?: (s: string) => void,
    opts?: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<PodInfo> {
    this.updatedImages.push({ id, image });
    this.updateClaudeFiles.push({ id, paths: (opts?.claudeFiles ?? []).map((f) => f.guest_path) });
    this.updatePermissions.push(opts?.permissions);
    onStage?.("recreating");
    if (this.updateImageGate) await this.updateImageGate;
    const p = this.pods.get(id);
    if (!p) throw new Error(`no pod ${id}`);
    const next = { ...p, imageDigest: image.split("@")[1] ?? image };
    this.pods.set(id, next);
    return next;
  }
  async agentStatus(id: string): Promise<string | null> {
    return this.agentState.get(id) ?? null;
  }
  async injectSecrets(_id: string, secrets: Record<string, string>): Promise<void> {
    this.injectedSecrets = secrets;
    this.injectCalls++;
  }
  async githubStatus(): Promise<{ connected: boolean; login: string | null }> {
    return { connected: false, login: null };
  }
  async setGithubToken(): Promise<{ login: string }> {
    return { login: "octocat" };
  }

  /** Test helper: force a status (simulate out-of-band change). */
  forceStatus(id: string, status: PodStatus): void {
    const p = this.pods.get(id);
    if (p) p.status = status;
  }
  private set(id: string, status: PodStatus): PodInfo {
    const p = this.pods.get(id)!;
    p.status = status;
    return p;
  }
}
