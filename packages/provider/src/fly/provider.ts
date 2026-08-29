import net from "node:net";
import type { MetricsSnapshot , PodAgentState , PodIssue } from "@podbay/shared";
import type { SandboxProvider, CodexPairing, DoctorReport, DoctorMode, PodHealth,
  DiagnosticReport, GithubRepo, CloneResult,
} from "../provider.js"
import { narrowSnapshot } from "../provider.js";;
import { ProviderError, type CreatePodInput, type ExecResult, type PodInfo, type PodStatus } from "../types.js";
import type { FlyConfig } from "../config.js";
import type { FlyApi, FlyMachine } from "./api.js";
import { buildInitFiles, toEnvFile } from "./init.js";
import { createLogger } from "@podbay/shared/log";

const log = createLogger("provider");

const POD_ID = "podbay_pod_id";
const OWNER = "podbay_owner";
const VOLUME_ID = "podbay_volume_id";
const KEEP_AWAKE = "podbay_keep_awake";

/** Fly Machines implementation of SandboxProvider. One machine + one volume per pod. */
export class FlyProvider implements SandboxProvider {
  constructor(
    private readonly fly: FlyApi,
    private readonly config: FlyConfig,
  ) {}

  async createPod(input: CreatePodInput): Promise<PodInfo> {
    // AUTHORITATIVE guard first: if the caller already knows this pod's machine,
    // read it BY ID — a consistent lookup. listMachines is eventually consistent,
    // so relying on it to answer "does a machine exist yet?" is what let a retry
    // build a second machine (one pod → 3 machines + 3 volumes, all billing,
    // 2026-07-17). By-id beats search; search is only the fallback below.
    if (input.knownMachineId) {
      const known = await this.fly.getMachine(input.knownMachineId).catch(() => null);
      if (known && known.state !== "destroyed" && known.state !== "destroying") {
        return this.toPodInfo(known);
      }
      // Recorded but genuinely gone (destroyed out-of-band) → fall through and rebuild.
    }
    const existing = await this.findMachine(input.id);
    if (existing) return this.toPodInfo(await this.dedupeMachines(input.id)); // idempotent + self-heal

    const region = input.region ?? this.config.region;
    const volume = await this.fly.createVolume({
      name: volumeName(input.id),
      region,
      size_gb: this.config.volumeSizeGb,
    });

    const files = await buildInitFiles({
      id: input.id,
      resolved: input.resolved,
      envDir: input.envDir,
      name: input.name,
      secrets: input.secrets,
      githubRepo: input.githubRepo,
      agents: input.agents,
      agentAuth: input.agentAuth,
    });

    const env = sanitizeEnv(input.resolved.env);

    const machine = await this.fly.createMachine({
      region,
      config: {
        image: baseImageFor(input, this.config),
        guest: { cpu_kind: this.config.guest.cpuKind, cpus: this.config.guest.cpus, memory_mb: this.config.guest.memoryMb },
        env,
        mounts: [{ volume: volume.id, path: "/home/dev" }],
        metadata: {
          [POD_ID]: input.id,
          [OWNER]: input.owner,
          [VOLUME_ID]: volume.id,
          [KEEP_AWAKE]: "false",
        },
        files,
        auto_destroy: false,
        restart: { policy: "on-failure" },
      },
    });

    // Tell the caller the machine id NOW — before we wait ~60s for it to boot — so
    // the pod→machine link is durable within milliseconds of the machine existing.
    // Persisting it only after createPod returns would leave a ~minute-wide window
    // where a crash/retry can't know the machine exists and builds another.
    await input.onMachineCreated?.(machine.id).catch(() => undefined);

    // Wait for the machine to boot so it's usable (exec / terminal) on return.
    try {
      await this.fly.waitForState(machine.id, "started", 60);
    } catch {
      // fall through — return what we have even if it didn't reach "started" in time
    }
    // Self-heal a duplicate: a provision RETRY can race Fly's eventually-consistent
    // listMachines (the findMachine guard above misses a machine created moments
    // earlier) and build a SECOND machine+volume for one pod (seen live). Collapse
    // to exactly one before returning.
    return this.toPodInfo(await this.dedupeMachines(input.id));
  }

  /** Keep exactly one machine per pod, destroying any duplicates (and their
   * volumes). Deterministic — keeps the smallest machine id, so even a
   * hypothetical concurrent create agrees on the survivor rather than the two
   * destroying each other. Best-effort on the destroys. */
  private async dedupeMachines(podId: string): Promise<FlyMachine> {
    const alive = (await this.fly.listMachines()).filter(
      (m) =>
        m.config.metadata?.[POD_ID] === podId && m.state !== "destroyed" && m.state !== "destroying",
    );
    if (alive.length === 0) throw new ProviderError(`pod ${podId} machine vanished`, "transient");
    const keep = alive.reduce((a, b) => (a.id < b.id ? a : b));
    for (const extra of alive) {
      if (extra.id === keep.id) continue;
      log.warn("duplicate_machine_destroyed", { podId, kept: keep.id, destroyed: extra.id });
      await this.fly.destroyMachine(extra.id).catch(() => undefined);
      const vol = extra.config.metadata?.[VOLUME_ID];
      if (vol && vol !== keep.config.metadata?.[VOLUME_ID]) {
        await this.fly.destroyVolume(vol).catch(() => undefined);
      }
    }
    return keep;
  }

  async getPod(id: string): Promise<PodInfo> {
    const m = await this.findMachine(id);
    if (!m) {
      return { id, status: "gone", region: this.config.region, endpoint: null, keepAwake: false };
    }
    return this.toPodInfo(m);
  }

  async listPods(filter?: { owner?: string }): Promise<PodInfo[]> {
    const machines = await this.fly.listMachines();
    return machines
      .filter((m) => m.config.metadata?.[POD_ID])
      .filter((m) => !filter?.owner || m.config.metadata?.[OWNER] === filter.owner)
      .map((m) => this.toPodInfo(m));
  }

  async exec(id: string, command: string[]): Promise<ExecResult> {
    const m = await this.requireMachine(id);
    const r = await this.fly.execMachine(m.id, command);
    return { exitCode: r.exit_code, stdout: r.stdout, stderr: r.stderr };
  }

  async sleep(id: string): Promise<PodInfo> {
    const m = await this.requireMachine(id);
    if (m.config.metadata?.[KEEP_AWAKE] === "true") {
      throw new ProviderError(`pod ${id} has keepAwake set; refusing to sleep`, "conflict");
    }
    try {
      await this.fly.suspendMachine(m.id);
    } catch (e) {
      if (e instanceof ProviderError && e.code === "unsupported") {
        await this.fly.stopMachine(m.id); // fallback where suspend is unavailable
      } else {
        throw e;
      }
    }
    return this.getPod(id);
  }

  async wake(id: string): Promise<PodInfo> {
    const m = await this.requireMachine(id);
    await this.fly.startMachine(m.id);
    return this.getPod(id);
  }

  async setKeepAwake(id: string, keepAwake: boolean): Promise<PodInfo> {
    const m = await this.requireMachine(id);
    await this.fly.updateMachineMetadata(m.id, KEEP_AWAKE, keepAwake ? "true" : "false");
    return this.getPod(id);
  }

  /** Resizing isn't offered on the legacy Fly path — every go-forward pod is on
   * Incus, where resize is a stop→reconfigure→start. Surfaced as a clean
   * "unsupported" so the control plane can guard the UI on provider. */
  async resize(id: string): Promise<PodInfo> {
    throw new ProviderError(`resize not supported on the Fly provider (pod ${id})`, "unsupported");
  }

  async snapshot(id: string): Promise<{ snapshotId: string }> {
    const m = await this.requireMachine(id);
    const volId = m.config.metadata?.[VOLUME_ID];
    if (!volId) throw new ProviderError(`pod ${id} has no volume to snapshot`, "invalid");
    const snap = await this.fly.snapshotVolume(volId);
    return { snapshotId: snap.id };
  }

  async destroy(id: string): Promise<void> {
    const m = await this.findMachine(id);
    if (!m) return; // idempotent
    const volId = m.config.metadata?.[VOLUME_ID];
    await this.fly.destroyMachine(m.id);
    // The volume can briefly read as "attached" after a force machine destroy;
    // retry, and treat a persistent failure as best-effort cleanup rather than
    // failing the whole delete (the machine — the thing that matters — is gone).
    if (volId) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await this.fly.destroyVolume(volId);
          break;
        } catch (e) {
          const retryable = e instanceof ProviderError && (e.code === "conflict" || e.code === "invalid");
          if (retryable && attempt < 4) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          if (attempt >= 4) break; // give up quietly; a sweep can reclaim it
          throw e;
        }
      }
    }
  }

  async endpoint(id: string): Promise<string> {
    const info = await this.getPod(id);
    if (info.status !== "running" || !info.endpoint) {
      throw new ProviderError(`pod ${id} is not running (${info.status})`, "invalid");
    }
    return info.endpoint;
  }

  /** True once the pod-agent accepts a TCP connection on its port — i.e. the pod
   * is actually connectable, not merely "the Fly machine reports started". Used
   * to hold a pod in `waking` until the agent is reachable. */
  async agentReady(id: string): Promise<boolean> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return false;
    return await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: m.private_ip!, port: this.config.agentPort, family: 6 });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1500);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  }

  /** The agent's real in-pod idle time, read from its /healthz. `null` when the
   * machine isn't running or the agent can't be reached (no signal). */
  /** GET the pod-agent's /healthz once. `null` when the machine isn't running or
   * the agent can't be reached (no signal). Shared by agentIdleMs/agentSessionUrl. */
  private async fetchHealth(
    id: string,
  ): Promise<{ idleMs?: unknown; sessionUrl?: unknown; agentStatus?: unknown } | null> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return null;
    const url = `http://[${m.private_ip}]:${this.config.agentPort}/healthz`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (!res.ok) return null;
      return (await res.json()) as { idleMs?: unknown; sessionUrl?: unknown; agentStatus?: unknown };
    } catch {
      return null;
    }
  }

  async updateImage(id: string, image: string): Promise<PodInfo> {
    const m = await this.requireMachine(id);
    const wasSuspended = m.state === "suspended" || m.state === "stopped";
    // Fly's update replaces the whole config, so hand back a copy with only the
    // image changed — the volume mount rides along, which is why ~/work, the
    // agent's plan and the Claude login survive an in-place swap.
    const updated = await this.fly.updateMachine(m.id, { ...m.config, image });
    log.info("pod_image_updated", { podId: id, machineId: m.id, wasSuspended });
    if (!wasSuspended) {
      // It was running: it cold-restarts onto the new image.
      await this.fly.waitForState(m.id, "started", 60).catch(() => undefined);
    }
    // A suspended machine is deliberately LEFT stopped: Fly won't start it, and we
    // never wake a suspended pod just to update it — it applies on the next wake.
    return this.toPodInfo((await this.fly.getMachine(m.id)) ?? updated);
  }

  async agentStatus(id: string): Promise<string | null> {
    const body = await this.fetchHealth(id);
    return body && typeof body.agentStatus === "string" ? body.agentStatus : null;
  }

  async agentIdleMs(id: string): Promise<number | null> {
    const body = await this.fetchHealth(id);
    return body && typeof body.idleMs === "number" ? body.idleMs : null;
  }

  async agentSessionUrl(id: string): Promise<string | null> {
    const body = await this.fetchHealth(id);
    return body && typeof body.sessionUrl === "string" ? body.sessionUrl : null;
  }

  async codexRcActive(id: string): Promise<boolean> {
    const h = await this.fetchHealth(id).catch(() => null);
    return (h as { codexRcActive?: boolean } | null)?.codexRcActive === true;
  }

  async sendAgentInput(id: string, agent: string, text: string): Promise<void> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/agent/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404)
      throw new ProviderError(
        "This pod needs updating before the cockpit can sign this agent in — click Update in Settings.",
        "invalid",
      );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ProviderError(body?.error || "couldn't send the code to the agent", "transient");
    }
  }

  async podHealth(id: string): Promise<PodHealth> {
    const h = (await this.fetchHealth(id).catch(() => null)) as Partial<PodHealth> | null;
    return {
      agents: Array.isArray(h?.agents) ? h.agents : [],
      issues: Array.isArray(h?.issues) ? h.issues : [],
      repairs: Array.isArray(h?.repairs) ? h.repairs : [],
      repairGaveUp: Array.isArray(h?.repairGaveUp) ? h.repairGaveUp : [],
      ooms: Array.isArray(h?.ooms) ? h.ooms : [],
      agentStatus: typeof h?.agentStatus === "string" ? h.agentStatus : null,
      codexStatus: typeof h?.codexStatus === "string" ? h.codexStatus : null,
      agentWaitingFor: typeof h?.agentWaitingFor === "string" ? h.agentWaitingFor : null,
      ...(typeof h?.appListening === "boolean" ? { appListening: h.appListening } : {}),
    };
  }

  async runDoctor(id: string, mode: DoctorMode): Promise<DoctorReport> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/doctor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(150_000),
    });
    if (res.status === 404)
      throw new ProviderError("This pod needs updating before doctor can run here.", "invalid");
    const body = (await res.json().catch(() => null)) as (DoctorReport & { error?: string }) | null;
    if (!res.ok || !body || !Array.isArray(body.issues))
      throw new ProviderError(body?.error || "doctor didn't complete", "transient");
    return { checked: body.checked ?? body.issues.length, issues: body.issues };
  }
  async podReport(id: string): Promise<DiagnosticReport> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/report`, {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
    });
    const body = (await res.json().catch(() => null)) as (DiagnosticReport & { error?: string }) | null;
    if (!res.ok || !body || !Array.isArray(body.sections))
      throw new ProviderError(body?.error || "diagnostics didn't complete", "transient");
    return { collectedAt: body.collectedAt ?? new Date().toISOString(), sections: body.sections };
  }


  async setCodexRc(id: string, on: boolean): Promise<void> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/codex/rc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404)
      throw new ProviderError(
        "This pod needs updating before remote control can be switched here — click Update in Settings.",
        "invalid",
      );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ProviderError(body?.error || "couldn't switch remote control", "transient");
    }
  }

  async codexPair(id: string): Promise<CodexPairing> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/codex/pair`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before it can pair with the Codex app — click Update in Settings, then try again.",
        "invalid",
      );
    }
    const body = (await res.json().catch(() => null)) as (CodexPairing & { error?: string }) | null;
    if (!res.ok || !body || !body.manualPairingCode) {
      throw new ProviderError(body?.error || "Codex pairing isn't ready yet on this pod", "transient");
    }
    return {
      manualPairingCode: body.manualPairingCode,
      pairingCode: body.pairingCode || "",
      expiresAt: Number(body.expiresAt) || 0,
      deviceName: body.deviceName || id,
    };
  }


  async fetchMetrics(id: string, windowMs?: number): Promise<MetricsSnapshot | null> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return null;
    const get = async (url: string): Promise<Response | null> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        return await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      } catch {
        return null;
      }
    };
    // Same forward-compat fallback as the incus provider: an older pod-agent matches
    // the path exactly and 404s the ?windowMs= form, which showed up as "metrics
    // aren't available yet" on pods that simply hadn't updated.
    const base = `http://[${m.private_ip}]:${this.config.agentPort}/metrics`;
    let res = await get(windowMs ? `${base}?windowMs=${windowMs}` : base);
    let narrow = false;
    if (windowMs && res && !res.ok) {
      res = await get(base);
      narrow = true;
    }
    if (!res?.ok) return null;
    const snap = (await res.json().catch(() => null)) as MetricsSnapshot | null;
    if (!snap) return null;
    return narrow && windowMs ? narrowSnapshot(snap, windowMs) : snap;
  }

  async previewShot(id: string): Promise<Buffer | null> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000); // a capture is slower than a JSON probe
    try {
      const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/preview-shot`, {
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }


  /** Write /etc/podbay/secrets.env on a running pod (0600, dev-owned) from the
   * given key→value map, replacing prior contents. Content travels base64 via
   * argv (never the plaintext), decoded in-pod — mirrors init.sh's file layout. */
  async injectSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    const payload = Buffer.from(toEnvFile(secrets)).toString("base64");
    const script =
      "mkdir -p /etc/podbay && " +
      `printf %s '${payload}' | base64 -d > /etc/podbay/secrets.env && ` +
      "chmod 600 /etc/podbay/secrets.env && chown dev:dev /etc/podbay/secrets.env";
    const r = await this.exec(id, ["bash", "-c", script]);
    if (r.exitCode !== 0) {
      throw new ProviderError(`failed to inject secrets into ${id}: ${r.stderr}`, "transient");
    }
  }

  async githubStatus(id: string): Promise<{ connected: boolean; login: string | null }> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return { connected: false, login: null };
    try {
      const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/gh/status`, {
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? ((await res.json()) as { connected: boolean; login: string | null })
        : { connected: false, login: null };
    } catch {
      return { connected: false, login: null };
    }
  }

  async secretRequests(id: string): Promise<{ key: string; description: string; at: string }[]> {
    const m = await this.findMachine(id);
    if (!m || mapStatus(m.state) !== "running" || !m.private_ip) return [];
    try {
      const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/secret-requests`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { requests?: { key: string; description: string; at: string }[] };
      return Array.isArray(body.requests) ? body.requests : [];
    } catch {
      return [];
    }
  }

  async clearGithubToken(id: string): Promise<void> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/gh/token`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before it can disconnect from GitHub — click Update in Settings, then try again.",
        "invalid",
      );
    }
    if (!res.ok) throw new ProviderError("GitHub disconnect failed on the pod", "invalid");
  }

  async setGithubToken(id: string, token: string): Promise<{ login: string }> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/gh/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before it can connect to GitHub — click Update in Settings, then try again.",
        "invalid",
      );
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; login?: string; error?: string };
    if (!res.ok || !data.ok || !data.login) {
      throw new ProviderError(data.error || "GitHub login failed on the pod", "invalid");
    }
    return { login: data.login };
  }

  async listRepos(id: string): Promise<GithubRepo[]> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/gh/repos`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError("This pod needs updating before it can list your repos.", "invalid");
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; repos?: GithubRepo[]; error?: string };
    if (!res.ok || !data.ok || !Array.isArray(data.repos)) {
      throw new ProviderError(data.error || "Couldn't list repos on the pod", "invalid");
    }
    return data.repos;
  }

  async cloneRepo(id: string, repo: string, force = false): Promise<CloneResult> {
    const m = await this.requireMachine(id);
    if (!m.private_ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://[${m.private_ip}]:${this.config.agentPort}/gh/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, force }),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 404) {
      throw new ProviderError("This pod needs updating before it can clone a repo.", "invalid");
    }
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      dest?: string;
      reason?: "not-empty" | "invalid";
      error?: string;
    };
    if (res.ok && data.ok && data.dest) return { ok: true, dest: data.dest };
    if (res.status === 409 && data.reason) return { ok: false, reason: data.reason };
    if (res.status === 400 && data.reason) return { ok: false, reason: data.reason };
    throw new ProviderError(data.error || "Clone failed on the pod", "invalid");
  }

  /** `http://[ip]:<port>` for a running pod — generalizes `endpoint` (the agent
   * port) so the gateway can proxy the preview to an app port (e.g. 3000). */
  async podAddress(id: string, port: number): Promise<string> {
    const m = await this.requireMachine(id);
    if (mapStatus(m.state) !== "running" || !m.private_ip) {
      throw new ProviderError(`pod ${id} is not running (${m.state})`, "invalid");
    }
    return `http://[${m.private_ip}]:${port}`;
  }

  // --- internals ---

  private async findMachine(podId: string): Promise<FlyMachine | null> {
    const machines = await this.fly.listMachines();
    return machines.find((m) => m.config.metadata?.[POD_ID] === podId) ?? null;
  }

  private async requireMachine(podId: string): Promise<FlyMachine> {
    const m = await this.findMachine(podId);
    if (!m) throw new ProviderError(`pod ${podId} not found`, "not_found");
    return m;
  }

  private toPodInfo(m: FlyMachine): PodInfo {
    const status = mapStatus(m.state);
    const endpoint =
      status === "running" && m.private_ip
        ? `http://[${m.private_ip}]:${this.config.agentPort}`
        : null;
    return {
      id: m.config.metadata?.[POD_ID] ?? m.id,
      status,
      region: m.region,
      endpoint,
      keepAwake: m.config.metadata?.[KEEP_AWAKE] === "true",
      machineId: m.id,
      // "image@sha256:…" → the digest alone; a tag-only image has no digest.
      imageDigest: m.config.image?.split("@")[1],
    };
  }
}

function mapStatus(state: string): PodStatus {
  switch (state) {
    case "started":
      return "running";
    case "created":
      return "provisioning";
    case "starting":
      return "waking";
    case "stopping":
    case "stopped":
    case "suspended":
    case "suspending":
      return "suspended";
    case "destroying":
    case "destroyed":
      return "gone";
    default:
      return "error";
  }
}

/** Fly volume names: start with a letter, [a-z0-9_], <= 30 chars. */
function volumeName(podId: string): string {
  const slug = podId.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `pb_${slug}`.slice(0, 30);
}

function baseImageFor(input: CreatePodInput, config: FlyConfig): string {
  // v0: if the environment pins a concrete image, use it; otherwise the podbay
  // base image. Building from dockerfile/devcontainer is a later change.
  const base = input.resolved.base;
  return "image" in base && base.image ? base.image : config.baseImage;
}

/** Non-secret env only. The @podbay/shared validator already rejects secret-bearing keys. */
function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  return { ...env };
}
