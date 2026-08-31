import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MetricsSnapshot, PodResources } from "@podbay/shared";
import type {
  SandboxProvider,
  CodexPairing,
  DoctorReport,
  DoctorMode,
  PodHealth,
  DiagnosticReport,
  GithubRepo,
  CloneResult,
  GhDeviceStart,
  GhDevicePoll,
} from "../provider.js";
import {
  ProviderError,
  type CreatePodInput,
  type ExecResult,
  type PodInfo,
  type PodStatus,
  type UpdateStage,
} from "../types.js";
import { buildInitFiles } from "../fly/init.js";
import { narrowSnapshot } from "../provider.js";
import { refreshSpecPermissions } from "../incus/provider.js";

const run = promisify(execFile);

/**
 * A SandboxProvider that runs each pod as a local DOCKER container — the OSS / self-host
 * provider (see docs/strategy/oss-strategy.md). It implements the same interface the
 * cloud FlyProvider / IncusProvider do; the control plane is unchanged. Register it under a
 * provider name (e.g. "local") and set PODBAY_DEFAULT_PROVIDER=local.
 *
 * CORE lifecycle (createPod/exec/getPod/destroy/ports/secrets/sleep/wake) is real Docker.
 * Observability (health/metrics/status/input) is proxied to the in-pod pod-agent over its
 * published :8080. Cloud-only features (image pipeline, GitHub OAuth, Codex pairing, resize,
 * snapshot) throw `unsupported` — a self-hoster doesn't have the managed machinery behind them.
 *
 * NOTE: the Docker orchestration is type-complete and validated at compile time; a live boot
 * needs a Docker host (this build machine may have none). Run recipe in the strategy doc.
 */
export interface LocalProviderOptions {
  /** The pod-base OCI image to boot. Default env PODBAY_LOCAL_IMAGE or "podbay/pod-base:local". */
  image?: string;
  /** Extra `docker run` args (e.g. resource caps). */
  runArgs?: string[];
  region?: string;
  /**
   * ANY-VM MODE. A remote Docker endpoint — `ssh://user@host` (Docker's native SSH transport)
   * or `tcp://host:2376`. Unset ⇒ the local daemon. Setting this turns this exact provider into
   * the multi-cloud connector: the same docker commands run on the remote VM (AWS/GCP/Hetzner/a
   * box), reachable because the pod-agent dials the gateway OUTBOUND — no inbound ports needed for
   * control. Default env PODBAY_DOCKER_HOST. The VM must already exist with Docker installed;
   * provisioning the VM itself is a separate concern (a cloud SDK layer above this).
   */
  dockerHost?: string;
  /**
   * COMPOSE / CONTAINERIZED-CONTROL-PLANE MODE. A Docker network name to attach pods to
   * (default env PODBAY_LOCAL_NETWORK). When the control plane itself runs in a container
   * (the self-host compose install), `127.0.0.1:<published-port>` is the CONTAINER's loopback,
   * not the host's — so internal dialing (gateway terminal proxy, health/metrics probes) must
   * go container→container instead. With a network set, pods join it and `podAddress` returns
   * `http://podbay-<id>:<port>` (Docker DNS). Host-published ports remain for the BROWSER
   * (previews) via `publishedAddress`, which always returns the host mapping.
   */
  network?: string;
  /**
   * DEPLOYMENT MODE for reachability (self-host-public-previews). `local` (default) publishes the
   * pod's dev-server on a loopback host port — reachable only from the Docker host. `ip`/`domain`
   * serve previews THROUGH the Caddy front door at a per-pod subdomain (`<id>.<publicBase>`), so
   * they are reachable from any browser over one 80/443 pair with automatic HTTPS. Default env
   * PODBAY_DEPLOY_MODE.
   */
  deployMode?: "local" | "ip" | "domain" | "proxy";
  /**
   * The public base host that pod preview subdomains live under, in `ip`/`domain` mode — e.g.
   * `1.2.3.4.sslip.io` (no domain) or `pods.example.com` (owner domain). A pod's preview is then
   * `https://<id>.<publicBase>`. Default env PODBAY_PUBLIC_BASE.
   */
  publicBase?: string;
}

const LABEL = "podbay.managed";

/** `docker run` CPU/memory flags for a chosen size — empty (unlimited) when unset or non-positive. */
export function cpuMemArgs(r?: { cpus?: number; memoryGb?: number }): string[] {
  const args: string[] = [];
  if (r?.cpus && r.cpus > 0) args.push("--cpus", String(r.cpus));
  if (r?.memoryGb && r.memoryGb > 0) args.push("--memory", `${Math.round(r.memoryGb * 1024)}m`);
  return args;
}

/** The Docker host's compute + what podbay pods have reserved on it, for the self-host size picker. */
export interface HostCapacity {
  cpus: number;
  memoryGb: number;
  allocatedCpus: number; // sum of running podbay pods' --cpus limits (unlimited pods count 0)
  allocatedMemoryGb: number;
}

/**
 * Pure capacity math (self-host-pod-sizing), split out so it's testable without a real Docker.
 * `infoLine` is `docker info --format '{{.NCPU}} {{.MemTotal}}'`; `inspectStdout` is one line per
 * running podbay pod from `docker inspect --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'`.
 * Docker reports 0 NanoCpus / 0 Memory for an unlimited container, so unlimited pods naturally
 * contribute 0 to the allocated sums.
 */
export function parseHostCapacity(infoLine: string, inspectStdout: string): HostCapacity {
  const [ncpu, memBytes] = infoLine.trim().split(/\s+/);
  const cpus = Number.parseInt(ncpu ?? "0", 10) || 0;
  const memoryGb = (Number.parseInt(memBytes ?? "0", 10) || 0) / 1024 ** 3;
  let allocatedNano = 0;
  let allocatedBytes = 0;
  for (const row of inspectStdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const [nano, bytes] = row.split(/\s+/);
    allocatedNano += Number.parseInt(nano ?? "0", 10) || 0;
    allocatedBytes += Number.parseInt(bytes ?? "0", 10) || 0;
  }
  return {
    cpus,
    memoryGb,
    allocatedCpus: allocatedNano / 1e9, // docker stores --cpus as nanoCPUs
    allocatedMemoryGb: allocatedBytes / 1024 ** 3,
  };
}

export class LocalProvider implements SandboxProvider {
  private readonly image: string;
  private readonly region: string;
  private readonly runArgs: string[];
  private readonly dockerHost?: string;
  private readonly network?: string;
  private readonly deployMode: "local" | "ip" | "domain" | "proxy";
  private readonly publicBase?: string;

  constructor(opts: LocalProviderOptions = {}) {
    this.image = opts.image ?? process.env.PODBAY_LOCAL_IMAGE ?? "podbay/pod-base:local";
    this.dockerHost = opts.dockerHost ?? process.env.PODBAY_DOCKER_HOST ?? undefined;
    this.network = opts.network ?? process.env.PODBAY_LOCAL_NETWORK ?? undefined;
    const mode = opts.deployMode ?? process.env.PODBAY_DEPLOY_MODE ?? "local";
    this.deployMode = mode === "ip" || mode === "domain" || mode === "proxy" ? mode : "local";
    this.publicBase = (opts.publicBase ?? process.env.PODBAY_PUBLIC_BASE ?? "").trim() || undefined;
    this.region = opts.region ?? (this.dockerHost ? this.hostOf(this.dockerHost) : "local");
    this.runArgs = opts.runArgs ?? [];
  }

  /** In a public deployment mode (with a base host configured) the pod preview is served through the
   * Caddy front door at `https://<id>.<publicBase>`, not a loopback host port. */
  private previewMode(): boolean {
    return this.deployMode !== "local" && !!this.publicBase;
  }

  private name(id: string): string {
    return `podbay-${id}`;
  }

  /** The pod's persistent /home/dev volume name — deterministic so a recreate reuses it. */
  private homeVolume(id: string): string {
    return `podbay-${id}-home`;
  }

  /** Extract the bare host from a docker endpoint (ssh://user@HOST[:port] | tcp://HOST:port). */
  private hostOf(endpoint: string): string {
    return endpoint.replace(/^\w+:\/\//, "").split("@").pop()!.split(":")[0]!;
  }

  /** Thin `docker` wrapper. Runs against the local daemon, or a remote one when dockerHost is set
   * (DOCKER_HOST makes the CLI drive the remote over SSH — same commands, different machine).
   * Never throws on a non-zero exit for reads — returns the ExecResult so callers decide; throws
   * (transient) only when docker itself can't be invoked. */
  private async docker(args: string[]): Promise<ExecResult> {
    const env = this.dockerHost ? { ...process.env, DOCKER_HOST: this.dockerHost } : process.env;
    try {
      const { stdout, stderr } = await run("docker", args, { env, maxBuffer: 16 * 1024 * 1024 });
      return { exitCode: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof err.code === "number") return { exitCode: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      throw new ProviderError(`docker not available: ${err.message ?? "spawn failed"}`, "transient", e);
    }
  }

  private mapStatus(dockerState: string): PodStatus {
    switch (dockerState) {
      case "running":
        return "running";
      case "created":
      case "paused":
      case "exited":
      case "dead":
        return "suspended";
      case "removing":
        return "destroying";
      default:
        return "gone";
    }
  }

  /** The `docker run` args for a pod — shared by createPod and updateImage (recreate) so a pod
   * comes back with the SAME name/labels/caps/network/home-volume/sizing on the new image. The CMD
   * waits for /etc/podbay/pod-spec.json (written a beat after start) before exec'ing the agent. */
  private dockerRunArgs(o: {
    id: string;
    owner: string;
    resources?: { cpus?: number; memoryGb?: number };
    image: string;
  }): string[] {
    return [
      "run", "-d",
      "--name", this.name(o.id),
      "--hostname", o.id,
      "--label", `${LABEL}=1`,
      "--label", `podbay.id=${o.id}`,
      "--label", `podbay.owner=${o.owner}`,
      // Local mode publishes the dev server on a loopback host port (the preview link). Public modes
      // serve previews THROUGH Caddy (podbay-<id>:3000 over the pod network), so no per-pod host port.
      ...(this.previewMode() ? [] : ["-p", "3000"]),
      "-p", "8080",
      // init.sh bind-mounts node_modules from the image — needs CAP_SYS_ADMIN + apparmor=unconfined
      // in plain Docker (found dogfooding 2026-08-13).
      "--cap-add", "SYS_ADMIN",
      "--security-opt", "apparmor=unconfined",
      ...(this.network ? ["--network", this.network] : []),
      // Persistent /home/dev (self-host-persistent-volume): survives recreate; a recreate reuses it
      // by name so image UPDATES and resize keep the pod's work + login + gh token.
      "-v", `${this.homeVolume(o.id)}:/home/dev`,
      ...cpuMemArgs(o.resources),
      ...this.runArgs,
      o.image,
      "sh", "-c",
      "mkdir -p /etc/podbay; for i in $(seq 1 100); do [ -f /etc/podbay/pod-spec.json ] && break; sleep 0.2; done; exec node /opt/pod-agent/main.js",
    ];
  }

  async createPod(input: CreatePodInput): Promise<PodInfo> {
    const existing = await this.getPod(input.id);
    if (existing.status !== "gone") return existing;

    const args = this.dockerRunArgs({
      id: input.id,
      owner: input.owner,
      resources: input.resources,
      image: this.image,
    });
    const res = await this.docker(args);
    if (res.exitCode !== 0) {
      throw new ProviderError(`docker run failed: ${res.stderr.trim() || res.stdout.trim()}`, "transient");
    }

    // Inject the pod-spec + .claude env layer + secrets EXACTLY as the managed providers do,
    // via the shared buildInitFiles — so a local pod gets the env's kickoff, permissions, and
    // skills/rules layer, not a hand-rolled subset. A minimal spec dropped `kickoff`, which is
    // what wires up the post-login greeter that enables remote control: without it a signed-in
    // local pod sat forever at "Enabling remote control…" (found dogfooding, 2026-08-12).
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
    // pod-spec.json is the trigger the CMD-wrapper waits on before exec'ing the agent, so write
    // it LAST — everything else (the .claude layer, secrets.env) must be present when init reads it.
    const spec = files.find((f) => f.guest_path === "/etc/podbay/pod-spec.json");
    for (const f of files) {
      if (f === spec) continue;
      const isSecrets = f.guest_path === "/etc/podbay/secrets.env";
      await this.writeFileB64(input.id, f.guest_path, f.raw_value, isSecrets ? { mode: "0600", chown: "dev:dev" } : {});
    }
    if (spec) await this.writeFileB64(input.id, spec.guest_path, spec.raw_value);

    return this.getPod(input.id);
  }

  /** The registry digest ("sha256:…") of the image an EXISTING container is running — the pod's
   * actual version, not the currently-tagged one (they differ once pod-base:latest moves on, which
   * is exactly the update signal). undefined for a locally-built image with no RepoDigest. */
  private async imageDigestOf(imageId: string): Promise<string | undefined> {
    if (!imageId) return undefined;
    const r = await this.docker(["inspect", "-f", "{{index .RepoDigests 0}}", imageId]).catch(() => null);
    // e.g. "ghcr.io/podbay-cloud/pod-base@sha256:abc…" → "sha256:abc…"
    return r?.exitCode === 0 ? r.stdout.trim().split("@")[1] || undefined : undefined;
  }

  /** The digest of the pod-base tag currently pulled on the host — the target a self-host update
   * would recreate onto. A pod whose imageDigest differs from this has an update available (the
   * owner refreshes it with `docker compose pull`). Cheap local inspect, no registry round-trip. */
  async latestImageDigest(): Promise<string | undefined> {
    return this.imageDigestOf(this.image);
  }

  async getPod(id: string): Promise<PodInfo> {
    // Status + the container's actual image ID in one inspect. imageDigest gives the pod a VERSION
    // (was "unknown") and drives self-host update detection; it also backfills legacy pods via the
    // control-plane reconcile, which reads info.imageDigest.
    const res = await this.docker(["inspect", "-f", "{{.State.Status}} {{.Image}}", this.name(id)]);
    if (res.exitCode !== 0) {
      return { id, status: "gone", region: this.region, endpoint: null, keepAwake: false };
    }
    const [statusRaw, imageId] = res.stdout.trim().split(/\s+/);
    const status = this.mapStatus(statusRaw);
    let endpoint: string | null = null;
    if (status === "running") endpoint = await this.podAddress(id, 8080).catch(() => null);
    const imageDigest = await this.imageDigestOf(imageId ?? "");
    return { id, status, region: this.region, endpoint, keepAwake: false, imageDigest };
  }

  async listPods(filter?: { owner?: string }): Promise<PodInfo[]> {
    const args = ["ps", "-a", "--filter", `label=${LABEL}=1`, "--format", "{{.Label \"podbay.id\"}}"];
    if (filter?.owner) args.splice(3, 0, "--filter", `label=podbay.owner=${filter.owner}`);
    const res = await this.docker(args);
    const ids = res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    return Promise.all(ids.map((id) => this.getPod(id)));
  }

  async exec(id: string, command: string[]): Promise<ExecResult> {
    return this.docker(["exec", this.name(id), ...command]);
  }

  /** Merge `patch` into the pod's /etc/podbay/pod-spec.json so in-pod readers (the `podbay`
   * CLI, doctor) reflect a post-launch change. Best-effort: a stopped/unreachable container
   * just leaves the DB authoritative for the next attempt. */
  async patchPodSpec(id: string, patch: Record<string, unknown>): Promise<void> {
    try {
      const cur = await this.exec(id, ["cat", "/etc/podbay/pod-spec.json"]);
      if (cur.exitCode !== 0 || !cur.stdout) return;
      const spec = JSON.parse(cur.stdout) as Record<string, unknown>;
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(spec[k]) !== JSON.stringify(v)) {
          spec[k] = v;
          changed = true;
        }
      }
      if (!changed) return;
      await this.writeFile(id, "/etc/podbay/pod-spec.json", JSON.stringify(spec, null, 2));
    } catch {
      // Best-effort; the DB remains the source of truth.
    }
  }

  /** Live config-refresh (self-host): deliver the current `.claude` layer + refreshed permissions and
   * re-apply via `/opt/podbay/podbay-refresh` — no container recreate, no agent restart. Mirrors the
   * incus implementation via docker exec / file writes. Degrades gracefully on an image without the
   * refresh script. Never throws. */
  async refreshConfig(
    id: string,
    opts: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<{ refreshed: boolean; note?: string }> {
    try {
      const cur = await this.exec(id, ["cat", "/etc/podbay/pod-spec.json"]);
      if (cur.exitCode === 0 && cur.stdout) {
        const specToPush = refreshSpecPermissions(cur.stdout, opts.permissions);
        if (specToPush !== cur.stdout)
          await this.writeFile(id, "/etc/podbay/pod-spec.json", specToPush);
      }
      for (const f of opts.claudeFiles ?? []) await this.writeFileB64(id, f.guest_path, f.raw_value);
      const r = await this.exec(id, ["podbay-refresh"]);
      if (r.exitCode !== 0)
        return {
          refreshed: false,
          note: "delivered; this pod's image predates in-place refresh — update it to apply",
        };
      return { refreshed: true };
    } catch (e) {
      return { refreshed: false, note: `refresh failed: ${String(e).slice(0, 120)}` };
    }
  }

  async destroy(id: string): Promise<void> {
    await this.docker(["rm", "-f", this.name(id)]);
    // Remove the pod's persistent home volume too — delete means "gone for good" (the cockpit says
    // so), and orphaned volumes would otherwise pile up on the host. Best-effort: a container mid-
    // teardown can briefly hold it, and a missing volume is not an error.
    await this.docker(["volume", "rm", this.homeVolume(id)]).catch(() => undefined);
  }

  async sleep(id: string): Promise<PodInfo> {
    await this.docker(["stop", this.name(id)]);
    return this.getPod(id);
  }

  async wake(id: string): Promise<PodInfo> {
    await this.docker(["start", this.name(id)]);
    return this.getPod(id);
  }

  async setKeepAwake(id: string): Promise<PodInfo> {
    return this.getPod(id); // a local container is always "keep awake"; nothing to schedule
  }

  /** The pod's address for INTERNAL callers (gateway terminal proxy, health/metrics probes).
   * Network mode (compose): container-DNS — `http://podbay-<id>:<port>` — because the control
   * plane runs in a container where 127.0.0.1 is its own loopback. Otherwise the host mapping. */
  async podAddress(id: string, port: number): Promise<string> {
    if (this.network) return `http://${this.name(id)}:${port}`;
    return this.publishedAddress(id, port);
  }

  /** The URL a BROWSER uses to reach the pod's preview.
   * - Public modes (`ip`/`domain`): the front-door subdomain `https://<id>.<publicBase>` — Caddy
   *   routes it to the pod's dev server over the pod network, so it works from any machine with one
   *   80/443 pair and automatic HTTPS. No host port is published for the app in these modes.
   * - Local mode: the published host port (loopback, or the remote host in any-VM mode). */
  async publishedAddress(id: string, port: number): Promise<string> {
    if (this.previewMode()) return `https://${id}.${this.publicBase}`;
    const res = await this.docker(["port", this.name(id), String(port)]);
    const line = res.stdout.split("\n").map((s) => s.trim()).find(Boolean);
    const hostPort = line?.split(":").pop();
    if (res.exitCode !== 0 || !hostPort) {
      throw new ProviderError(`no published :${port} for ${id}`, "not_found");
    }
    // Local: loopback. Any-VM: the published port lives on the REMOTE host's interface.
    const host = this.dockerHost ? this.hostOf(this.dockerHost) : "127.0.0.1";
    return `http://${host}:${hostPort}`;
  }

  /** The Docker host's total CPU/RAM and what podbay pods have reserved, for the self-host size
   * picker. `allocated*` sums the RUNNING managed pods' explicit limits — a pod launched unlimited
   * contributes 0 (it isn't reserved), which the UI notes. Runs against DOCKER_HOST, so it reports
   * the remote host in any-VM mode. Best-effort: throws only if docker itself can't be invoked. */
  async hostCapacity(): Promise<HostCapacity> {
    const info = await this.docker(["info", "--format", "{{.NCPU}} {{.MemTotal}}"]);
    const ps = await this.docker([
      "ps", "--filter", `label=${LABEL}=1`, "--filter", "status=running", "--format", "{{.ID}}",
    ]);
    const ids = ps.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const inspOut = ids.length
      ? (await this.docker(["inspect", "--format", "{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}", ...ids])).stdout
      : "";
    return parseHostCapacity(info.stdout, inspOut);
  }

  async endpoint(id: string): Promise<string> {
    return this.podAddress(id, 8080);
  }

  async agentReady(id: string): Promise<boolean> {
    const health = await this.agentGet(id, "/healthz");
    return health !== null;
  }

  /** Replace /etc/podbay/secrets.env atomically (0600, dev-owned) — same contract as Fly/Incus. */
  async injectSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    const body = Object.entries(secrets)
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await this.writeFile(id, "/etc/podbay/secrets.env", `${body}\n`, { mode: "0600", chown: "dev:dev" });
  }

  /** Write a file inside the container via a base64 round-trip (no stdin plumbing needed). */
  private async writeFile(
    id: string,
    path: string,
    content: string,
    opts: { mode?: string; chown?: string } = {},
  ): Promise<void> {
    return this.writeFileB64(id, path, Buffer.from(content, "utf8").toString("base64"), opts);
  }

  /** Write ALREADY-base64 content (e.g. buildInitFiles' raw_value) — avoids a re-encode. */
  private async writeFileB64(
    id: string,
    path: string,
    b64: string,
    opts: { mode?: string; chown?: string } = {},
  ): Promise<void> {
    const cmds = [
      "mkdir -p \"$(dirname '" + path + "')\"",
      `printf %s '${b64}' | base64 -d > '${path}'`,
      opts.mode ? `chmod ${opts.mode} '${path}'` : "",
      opts.chown ? `chown ${opts.chown} '${path}' 2>/dev/null || true` : "",
    ].filter(Boolean).join(" && ");
    const res = await this.exec(id, ["sh", "-c", cmds]);
    if (res.exitCode !== 0) throw new ProviderError(`write ${path} failed: ${res.stderr.trim()}`, "transient");
  }

  // ── pod-agent HTTP proxy (published :8080) ─────────────────────────────────────────────

  private async agentGet(id: string, path: string): Promise<unknown | null> {
    try {
      const base = await this.podAddress(id, 8080);
      const ctl = AbortSignal.timeout(3000);
      const r = await fetch(`${base}${path}`, { signal: ctl });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  private async agentPost(id: string, path: string, body: unknown): Promise<boolean> {
    try {
      const base = await this.podAddress(id, 8080);
      const r = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** POST/DELETE to the pod-agent and RETURN the parsed body (unlike agentPost's boolean) — the
   * GitHub endpoints answer with { login } / { repos } / device codes we need. Throws on an
   * unreachable pod or a non-2xx with a JSON error, so callers surface a real message. */
  private async agentJson(id: string, path: string, method: "POST" | "DELETE", body?: unknown): Promise<Record<string, unknown>> {
    const base = await this.podAddress(id, 8080);
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { __status: r.status, ...j };
  }

  async podHealth(id: string): Promise<PodHealth> {
    const h = (await this.agentGet(id, "/healthz")) as Partial<PodHealth> | null;
    return {
      agents: h?.agents ?? [],
      issues: h?.issues ?? [],
      repairs: h?.repairs ?? [],
      repairGaveUp: h?.repairGaveUp ?? [],
      ...(h?.ooms ? { ooms: h.ooms } : {}),
      agentStatus: h?.agentStatus ?? null,
      codexStatus: h?.codexStatus ?? null,
      agentWaitingFor: h?.agentWaitingFor ?? null,
      idleMs: h?.idleMs ?? null,
      lastActivityMs: h?.lastActivityMs ?? null,
      ...(typeof h?.appListening === "boolean" ? { appListening: h.appListening } : {}),
    };
  }

  async fetchMetrics(id: string, windowMs?: number): Promise<MetricsSnapshot | null> {
    // Narrow client-side: the stats window buttons (1h/24h/7d/30d) pass windowMs, but this used to
    // ignore it and always return the full ring — so switching windows changed nothing (velsa).
    const snap = (await this.agentGet(id, "/metrics")) as MetricsSnapshot | null;
    return snap && windowMs ? narrowSnapshot(snap, windowMs) : snap;
  }

  async previewShot(id: string): Promise<Buffer | null> {
    // Raw bytes, not JSON — so this can't reuse agentGet. Same base URL, longer budget (a capture
    // takes ~1-3s), 204/error → null.
    try {
      const base = await this.podAddress(id, 8080);
      const r = await fetch(`${base}/preview-shot`, { signal: AbortSignal.timeout(12_000) });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  async agentIdleMs(id: string): Promise<number | null> {
    const h = (await this.agentGet(id, "/healthz")) as { idleMs?: number } | null;
    return typeof h?.idleMs === "number" ? h.idleMs : null;
  }

  async agentSessionUrl(id: string): Promise<string | null> {
    const h = (await this.agentGet(id, "/healthz")) as { sessionUrl?: string } | null;
    return h?.sessionUrl ?? null;
  }

  async agentStatus(id: string): Promise<string | null> {
    // Was reading `agentState` — a field /healthz never served (it's `agentStatus`),
    // so self-host's idle sweep saw null forever. Fixed 2026-08-16.
    const h = (await this.agentGet(id, "/healthz")) as { agentStatus?: string } | null;
    return h?.agentStatus ?? null;
  }

  async secretRequests(id: string): Promise<{ key: string; description: string; at: string }[]> {
    const r = (await this.agentGet(id, "/secret-requests")) as { key: string; description: string; at: string }[] | null;
    return r ?? [];
  }

  async sendAgentInput(id: string, agent: string, text: string): Promise<void> {
    const ok = await this.agentPost(id, "/agent/input", { agent, text });
    if (!ok) throw new ProviderError("agent input failed (pod unreachable?)", "transient");
  }

  async runDoctor(id: string, mode: DoctorMode): Promise<DoctorReport> {
    const r = (await this.agentGet(id, `/doctor?mode=${mode}`)) as DoctorReport | null;
    return r ?? { checked: 0, issues: [] };
  }

  async podReport(id: string): Promise<DiagnosticReport> {
    const r = (await this.agentGet(id, "/doctor?report=1")) as DiagnosticReport | null;
    return r ?? { collectedAt: new Date(0).toISOString(), sections: [] };
  }

  // ── cloud-only features: honestly unsupported in the self-host provider ───────────────

  private unsupported(feature: string): never {
    throw new ProviderError(`${feature} is a cloud feature — not available in the local provider`, "unsupported");
  }

  async resize(id: string, resources: PodResources): Promise<PodInfo> {
    // Self-host live resize: change the running container's CPU/memory caps in place with
    // `docker update` — no restart, no data loss. Only positive limits: dropping a limit back to
    // "unlimited" would need a container recreate, which destroys a volume-less pod (0audit), so
    // refuse it rather than silently lose the owner's work.
    const args = cpuMemArgs(resources);
    if (!args.length) {
      throw new ProviderError(
        "can't resize a self-host pod to unlimited (that needs a recreate, which would wipe the pod) — set a positive CPU/memory instead",
        "unsupported",
      );
    }
    const res = await this.docker(["update", ...args, this.name(id)]);
    if (res.exitCode !== 0) {
      throw new ProviderError(
        `docker update failed: ${res.stderr.trim() || res.stdout.trim()}`,
        "transient",
      );
    }
    return this.getPod(id);
  }
  async snapshot(_id: string): Promise<{ snapshotId: string }> {
    return this.unsupported("snapshot");
  }
  async updateImage(
    id: string,
    image: string,
    onStage?: UpdateStage,
    opts?: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<PodInfo> {
    // Self-host image update = recreate on the new pod-base, REUSING the /home/dev volume so the
    // pod's work, agent login, secrets vault decryption, and gh token all survive. The container
    // rootfs (incl. /etc/podbay) is wiped, so preserve the spec + secrets from the live container
    // and re-push them after the recreate (the .claude layer is refreshed from opts, delivering
    // current skills). Mirrors the Incus recreate-keeping-volume path.
    const stage = (s: string) => {
      try {
        onStage?.(s as never);
      } catch {
        /* progress is best-effort */
      }
    };
    const cname = this.name(id);
    const insp = await this.docker([
      "inspect",
      "-f",
      '{{.State.Status}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{index .Config.Labels "podbay.owner"}}',
      cname,
    ]);
    if (insp.exitCode !== 0) throw new ProviderError(`pod ${id} not found`, "not_found");
    const [statusRaw, nanoRaw, memRaw, owner = ""] = insp.stdout.trim().split(/\s+/);
    const wasRunning = statusRaw === "running";
    const nano = Number(nanoRaw) || 0;
    const mem = Number(memRaw) || 0;
    const resources = {
      cpus: nano > 0 ? nano / 1e9 : undefined,
      memoryGb: mem > 0 ? mem / 1024 ** 3 : undefined,
    };

    // GUARD: a pod created before persistent volumes has NO named /home/dev volume — its work lives
    // in the container's writable layer. Recreating it (rm + run) would seed a FRESH empty volume
    // and destroy ~/work irrecoverably. Refuse; the owner recreates the pod deliberately instead.
    // (Same reasoning as resize's unlimited-refusal above.)
    const mounts = await this.docker(["inspect", "-f", "{{range .Mounts}}{{.Name}} {{end}}", cname]);
    if (!mounts.stdout.includes(this.homeVolume(id))) {
      throw new ProviderError(
        "This pod predates persistent volumes, so updating it would erase everything in ~/work (the update recreates the pod). Launch a fresh pod — new pods keep their work across updates — and move your changes there instead.",
        "unsupported",
      );
    }

    const catFile = async (p: string): Promise<string> => {
      if (!wasRunning) return "";
      const r = await this.docker(["exec", cname, "sh", "-c", `cat ${p} 2>/dev/null`]).catch(() => null);
      return r?.exitCode === 0 ? r.stdout : "";
    };
    const preservedSpec = await catFile("/etc/podbay/pod-spec.json");
    const preservedSecrets = await catFile("/etc/podbay/secrets.env");

    // The web action's `image` is a cloud digest, meaningless to Docker — self-host updates to the
    // tag it runs (this.image, e.g. ghcr.io/podbay-cloud/pod-base:latest). Pull the newest of that tag.
    void image;
    stage("pulling");
    await this.docker(["pull", this.image]).catch(() => undefined);

    stage("stopping");
    await this.docker(["rm", "-f", cname]); // the named /home/dev volume PERSISTS

    stage("recreating");
    const res = await this.docker(this.dockerRunArgs({ id, owner, resources, image: this.image }));
    if (res.exitCode !== 0) {
      throw new ProviderError(
        `docker run (update) failed: ${res.stderr.trim() || res.stdout.trim()}`,
        "transient",
      );
    }

    // Re-push in the same order createPod uses: everything else first, pod-spec.json LAST — it's the
    // trigger the CMD-wrapper waits on before exec'ing the agent.
    stage("booting");
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
    if (preservedSecrets) {
      await this.writeFileB64(id, "/etc/podbay/secrets.env", b64(preservedSecrets), { mode: "0600", chown: "dev:dev" });
    }
    for (const f of opts?.claudeFiles ?? []) await this.writeFileB64(id, f.guest_path, f.raw_value);
    if (preservedSpec) {
      await this.writeFileB64(id, "/etc/podbay/pod-spec.json", b64(refreshSpecPermissions(preservedSpec, opts?.permissions)));
    }
    return this.getPod(id);
  }
  // GitHub connect for self-host: proxy to the pod-agent's /gh/* endpoints (the token lives in the
  // pod, never reaches the web app). Same wire as FlyProvider, via the local agentGet/agentJson.
  async githubStatus(id: string): Promise<{ connected: boolean; login: string | null; workRepo?: string | null }> {
    const s = (await this.agentGet(id, "/gh/status")) as { connected?: boolean; login?: string | null; workRepo?: string | null } | null;
    return { connected: Boolean(s?.connected), login: s?.login ?? null, workRepo: s?.workRepo ?? null };
  }
  async setGithubToken(id: string, token: string): Promise<{ login: string }> {
    const r = await this.agentJson(id, "/gh/token", "POST", { token });
    if (r.__status !== 200 || !r.ok) throw new ProviderError(String(r.error ?? "gh login failed"), "transient");
    return { login: String(r.login ?? "") };
  }
  async listRepos(id: string): Promise<GithubRepo[]> {
    const r = (await this.agentGet(id, "/gh/repos")) as { ok?: boolean; repos?: GithubRepo[] } | null;
    return r?.ok && Array.isArray(r.repos) ? r.repos : [];
  }
  async cloneRepo(id: string, repo: string, force?: boolean): Promise<CloneResult> {
    const r = await this.agentJson(id, "/gh/clone", "POST", { repo, force: force === true });
    if (r.ok) return { ok: true, dest: String(r.dest ?? "") };
    if (r.reason === "not-empty" || r.reason === "invalid") return { ok: false, reason: r.reason };
    throw new ProviderError(String(r.error ?? "clone failed"), "transient");
  }
  async clearGithubToken(id: string): Promise<void> {
    await this.agentJson(id, "/gh/token", "DELETE").catch(() => undefined);
  }
  async startGhLogin(id: string): Promise<GhDeviceStart> {
    const r = await this.agentJson(id, "/gh/login/start", "POST");
    if (r.__status !== 200 || !r.ok) throw new ProviderError(String(r.error ?? "device start failed"), "transient");
    return {
      userCode: String(r.userCode),
      verificationUri: String(r.verificationUri),
      deviceCode: String(r.deviceCode),
      interval: Number(r.interval ?? 5),
      expiresIn: Number(r.expiresIn ?? 900),
    };
  }
  async pollGhLogin(id: string, deviceCode: string): Promise<GhDevicePoll> {
    const r = await this.agentJson(id, "/gh/login/poll", "POST", { deviceCode });
    if (r.__status !== 200 || !r.ok) throw new ProviderError(String(r.error ?? "device poll failed"), "transient");
    if (r.status === "connected") return { status: "connected", login: String(r.login ?? "") };
    if (r.status === "pending" || r.status === "slow_down" || r.status === "expired") return { status: r.status };
    return { status: "error", error: String(r.error ?? "device flow failed") };
  }
  async codexPair(_id: string): Promise<CodexPairing> {
    return this.unsupported("Codex pairing");
  }
  async codexRcActive(_id: string): Promise<boolean> {
    return false;
  }
  async setCodexRc(_id: string, _on: boolean): Promise<void> {
    /* no managed RC in self-host */
  }
}
