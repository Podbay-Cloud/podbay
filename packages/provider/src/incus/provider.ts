import { createLogger } from "@podbay/shared/log";
import type { PodResources, MetricsSnapshot, BoxStats, BoxPod, PodAgentState , PodIssue } from "@podbay/shared";
import type {
  BaseImage,
  CreatePodInput,
  ExecResult,
  PodInfo,
  PodStatus,
  UpdateStage,
} from "../types.js";
import { ProviderError } from "../types.js";
import type { SandboxProvider, CodexPairing, DoctorReport, DoctorMode, PodHealth,
  DiagnosticReport, GithubRepo, CloneResult,
} from "../provider.js"
import { narrowSnapshot } from "../provider.js";
import type { FetchReport } from "../provider.js";;
import { buildInitFiles, toEnvFile } from "../fly/init.js";
import { IncusApi, type IncusInstance } from "./http-client.js";

const log = createLogger("provider-incus");

/**
 * IncusProvider — pods as Incus KVM virtual machines on our own box
 * (docs/strategy/infra-strategy.md, decided 2026-07-20). M1 PREP: written ahead of the
 * box; compiles and is unit-testable with an injected IncusApi, but NOT wired
 * into any config until every flow passes the M0 verification checklist
 * (scripts/incus/README.md).
 *
 * Shape mirrors FlyProvider so the control plane can't tell them apart:
 * - instance name == pod id (the idempotency key; no eventually-consistent
 *   list-hunting — Incus names are unique, so the dedupe class of bugs is out).
 * - /home/dev lives on a SEPARATE custom volume (`<id>-home`) attached to the
 *   instance — exactly what the Fly volume holds — so updateImage can recreate
 *   the instance from a new image and reattach it (upgrade flow parity).
 * - sleep/wake map to STATEFUL stop/start (suspend-to-disk). In the 24/7 model
 *   these only serve the explicit user "suspend" verb, never an idle sweep.
 * - agent probes (/healthz) are identical to Fly's — same pod-agent, reached at
 *   the instance's bridge IP over WireGuard.
 */

export interface IncusConfig {
  /** Storage pool holding root disks + home volumes (ZFS on the box's NVMe). */
  pool: string;
  /** Image alias produced by scripts/incus/build-image.sh (e.g. "pod-base"). */
  imageAlias: string;
  /** Image identifier recorded on PodInfo for drift/update detection. Set to the
   * alias@fingerprint at image publish time (the box script prints it). */
  imageDigest: string;
  /** Label reported as the pod's region (e.g. "hetzner-fsn1"). */
  region: string;
  /** Port the pod-agent listens on inside the VM (same as Fly: 8080). */
  agentPort: number;
  /** Per-pod defaults until per-pod sizing ships (pricing-model.md). */
  cpus: number;
  memoryGb: number;
  homeVolumeGb: number;
}

/** Incus status → our PodStatus. Frozen/Stopped both read as "suspended" because
 * a stateful-stopped VM resumes with RAM intact — the user-facing suspend. */
function mapStatus(incusStatus: string): PodStatus {
  switch (incusStatus) {
    case "Running":
      return "running";
    case "Stopped":
    case "Frozen":
      return "suspended";
    case "Error":
      return "error";
    default:
      return "provisioning"; // Starting/Stopping and friends are transitional
  }
}

/**
 * Replace ONLY the `permissions` block of a preserved pod-spec with a freshly-resolved
 * one, keeping every other field (node_modules paths, kickoff, agents, …). updateImage
 * preserves the spec verbatim across a recreate, which froze the permission preset a pod
 * was created with — so a preset change (a fix, or a new security deny) never reached an
 * existing pod on update. Pure + total: a nullish `permissions` or an unparseable spec is
 * returned unchanged, because an image update must never fail over this.
 */
export function refreshSpecPermissions(specJson: string, permissions: unknown): string {
  if (permissions == null) return specJson;
  try {
    const spec = JSON.parse(specJson) as unknown;
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      (spec as Record<string, unknown>).permissions = permissions;
      return JSON.stringify(spec);
    }
  } catch {
    /* unparseable spec — push it unchanged rather than break the update */
  }
  return specJson;
}

/**
 * Sanitize a pod's self-reported `/healthz` at the trust boundary (pre-Alpha security M2).
 * The pod runs untrusted code and fully controls this response, and the raw strings/numbers
 * flow into persisted events, the owner+admin dashboards, the critical-alert pager, and the
 * OOM dedup key (`ktime`). Left raw, a hostile pod could inject control chars, bloat storage
 * with unbounded strings/arrays, or poison `ktime`/`rssMb`. Cap array sizes, cap+strip string
 * fields, coerce numerics into a sane finite range, and normalize timestamps. Never throws.
 */
const MAX_HEALTH_ITEMS = 50;
const MAX_HEALTH_STR = 300;
function cleanStr(s: unknown): string {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_HEALTH_STR) : "";
}
function cleanNum(n: unknown, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v < 0 ? 0 : v > max ? max : v;
}
function cleanAt(s: unknown): string {
  const d = new Date(typeof s === "string" ? s.slice(0, 40) : "");
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
export function sanitizePodHealth(h: PodHealth): PodHealth {
  const arr = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.slice(0, MAX_HEALTH_ITEMS) : []);
  return {
    agents: arr(h.agents),
    issues: arr(h.issues),
    repairGaveUp: arr(h.repairGaveUp).map(cleanStr),
    repairs: arr(h.repairs).map((r) => ({
      target: cleanStr(r?.target),
      reason: cleanStr(r?.reason),
      at: cleanAt(r?.at),
      ...(r?.cause != null ? { cause: cleanStr(r.cause) } : {}),
    })),
    ooms: arr(h.ooms).map((o) => ({
      victim: cleanStr(o?.victim),
      rssMb: cleanNum(o?.rssMb, 1_000_000),
      victimIsAgent: o?.victimIsAgent === true,
      ktime: cleanNum(o?.ktime, Number.MAX_SAFE_INTEGER),
      at: cleanAt(o?.at),
    })),
    // Live-signal fields (dashboard cards). Pod-controlled — allowlist the status,
    // bound the free string, and keep tri-state semantics: undefined = the image
    // doesn't report it (unknown), never coerced to false.
    agentStatus: ["busy", "shell", "idle", "waiting"].includes(h.agentStatus as string)
      ? (h.agentStatus as string)
      : null,
    codexStatus: ["busy", "idle"].includes(h.codexStatus as string) ? (h.codexStatus as string) : null,
    agentWaitingFor: typeof h.agentWaitingFor === "string" ? cleanStr(h.agentWaitingFor) : null,
    ...(typeof h.appListening === "boolean" ? { appListening: h.appListening } : {}),
  };
}

export class IncusProvider implements SandboxProvider {
  constructor(
    private readonly incus: IncusApi,
    private readonly config: IncusConfig,
  ) {}

  private homeVolume(id: string): string {
    return `${id}-home`;
  }

  /** The `home` disk device for an instance. New volumes are BLOCK (native ext4,
   * mounted by podbay-home-mount) and take NO path — Incus forbids a path on a
   * block custom volume. LEGACY pods created before the 9p→block switch have a
   * `filesystem` volume, which REQUIRES a path (the 9p share mountpoint); detect
   * that so recreating an old pod (updateImage) still works. */
  private async homeDevice(id: string): Promise<Record<string, string>> {
    const vol = await this.incus.getVolume(this.config.pool, this.homeVolume(id));
    const base = { type: "disk", pool: this.config.pool, source: this.homeVolume(id) };
    return vol?.content_type === "filesystem" ? { ...base, path: "/home/dev" } : base;
  }

  async createPod(input: CreatePodInput): Promise<PodInfo> {
    // Per-pod tier (falls back to the box defaults for the legacy path).
    const cpus = input.resources?.cpus ?? this.config.cpus;
    const memoryGb = input.resources?.memoryGb ?? this.config.memoryGb;
    const diskGb = input.resources?.diskGb ?? this.config.homeVolumeGb;

    // Idempotency: instance name == pod id. A retry ADOPTS the existing instance
    // (Incus names are unique) rather than building a second — then falls through
    // to the start + configure steps, which are guarded so a retry that adopts a
    // started-but-unconfigured instance still finishes the job.
    let inst = await this.incus.getInstance(input.id);
    if (!inst) {
      // Home volume first (survives instance recreation — the upgrade flow).
      if (!(await this.incus.getVolume(this.config.pool, this.homeVolume(input.id)))) {
        await this.incus.createVolume(this.config.pool, this.homeVolume(input.id), diskGb);
      }
      await this.incus.createInstance({
        name: input.id,
        imageAlias: this.config.imageAlias,
        config: {
          "limits.cpu": String(cpus),
          "limits.memory": `${memoryGb}GiB`,
          // user.* keys are free-form metadata (keepAwake + our configure marker).
          "user.podbay.owner": input.owner,
          "user.podbay.keep_awake": "false",
        },
        devices: {
          // Block volume — NO `path` (Incus forbids a path on a block custom
          // volume). It attaches as a raw device; podbay-home-mount.service in the
          // guest formats ext4 (first boot) + mounts it at /home/dev before the
          // agent. This replaces the old 9p filesystem share (broken POSIX).
          home: await this.homeDevice(input.id),
        },
      });
      await input.onMachineCreated?.(input.id); // machineId == instance name on Incus
      inst = await this.incus.getInstance(input.id);
      if (!inst) throw new ProviderError(`instance ${input.id} vanished after create`, "transient");
    }

    // The VM MUST be running before we inject init files. Incus's file API is
    // served by the in-guest agent, which only runs once the VM is started —
    // pushing to a STOPPED VM silently drops the files (verified on the box
    // 2026-07-21: the pod-spec never landed, so init.sh skipped the kickoff, so
    // the login→REPL respawn was disabled and the session wedged at "Press
    // Enter"). So: start → wait for the guest → push → reload the agent.
    if (inst.status !== "Running") await this.incus.setState(input.id, "start");

    // Configure once, idempotently (the marker survives a provision retry that
    // adopts a started-but-unconfigured instance).
    if (inst.config["user.podbay.configured"] !== "true") {
      await this.waitGuestReady(input.id);
      // Init files (pod-spec, kickoff, .claude layer, secrets.env) — same builder
      // as Fly, pushed to the RUNNING guest.
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
      // Incus's files API does NOT create parent dirs — a push to a missing dir
      // 404s (e.g. /etc/podbay/claude/). Create the unique parents first.
      const dirs = [
        ...new Set(files.map((f) => f.guest_path.replace(/\/[^/]*$/, "")).filter(Boolean)),
      ];
      for (const d of dirs) await this.incus.exec(input.id, ["mkdir", "-p", d]);
      for (const f of files) {
        await this.incus.pushFile(input.id, f.guest_path, Buffer.from(f.raw_value, "base64"));
      }
      // Drop a seed marker written BEFORE this push. init.sh runs once at boot,
      // when the files above don't exist yet; older images then marked the pod
      // "seeded" on that empty pass, so the restart below skipped the .claude layer
      // and the env's skills/rules were silently dead in the pod (found via the
      // byo-project dogfood 2026-07-23 — /codebase-onboarding "not registered").
      // init.sh no longer writes the marker without a spec; this clears it for pods
      // still running the older base image.
      await this.incus
        .exec(input.id, ["rm", "-f", "/home/dev/.podbay-seeded"])
        .catch(() => {});
      // Reload the agent so it processes the now-present spec: init.sh writes
      // ~/.podbay-kickoff and main.ts re-reads the spec, which is what switches
      // on authedRespawn + the greeter (the login→REPL handoff).
      await this.incus.exec(input.id, ["systemctl", "restart", "podbay-agent"]);
      await this.incus.patchInstance(input.id, {
        config: { "user.podbay.configured": "true" },
      });
      // Wait for the RESTARTED agent to serve /healthz again before returning.
      // Otherwise the pod is "running" (VM up) but its agent is briefly
      // unreachable, so liveStatus demotes it to "waking" — and the later
      // "running" (from: waking) is billed as a wake-from-sleep, so the whole
      // onboarding window shows as SUSPENDED time (seen live 2026-07-21).
      await this.waitAgentReady(input.id);
    }

    log.info("pod_created", { podId: input.id, pool: this.config.pool });
    return this.toPodInfo((await this.incus.getInstance(input.id)) ?? inst);
  }

  /** Poll the pod-agent's /healthz until it serves again (after a restart), so
   * the pod isn't reported "running" with an unreachable agent. Best-effort:
   * returns after the timeout rather than failing the whole provision. */
  private async waitAgentReady(id: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.agentReady(id).catch(() => false)) return;
      await new Promise((res) => setTimeout(res, 1500));
    }
    log.warn("pod_agent_not_ready_after_restart", { podId: id });
  }

  /** Poll the in-guest Incus agent until it accepts an exec (⇒ the files API is
   * also ready). Pushing before this lands nothing on a VM. */
  private async waitGuestReady(id: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const r = await this.incus.exec(id, ["true"]);
        if (r.exitCode === 0) return;
      } catch (e) {
        lastErr = e; // "Instance agent not usable yet" until the guest agent is up
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    throw new ProviderError(`pod ${id} guest agent not ready after start`, "transient", lastErr);
  }

  async getPod(id: string): Promise<PodInfo> {
    const inst = await this.incus.getInstance(id);
    if (!inst) {
      return { id, status: "gone", region: this.config.region, endpoint: null, keepAwake: false };
    }
    return this.toPodInfo(inst);
  }

  async listPods(): Promise<PodInfo[]> {
    return (await this.incus.listInstances()).map((i) => this.toPodInfo(i));
  }

  async exec(id: string, command: string[]): Promise<ExecResult> {
    return this.incus.exec(id, command);
  }

  /** The EXPLICIT user "suspend" verb (never an idle sweep). A PLAIN stop, not
   * stateful: it frees the box's RAM+CPU (so the user can reallocate), the data
   * persists on the separate /home/dev volume, and restore is a cold boot where
   * the agent resumes via `claude --continue` + the greeter nudge. Stateful stop
   * is deliberately NOT used — Incus forbids it alongside a shared-filesystem
   * volume (verified on the box), and network sessions (RC/webhooks) don't
   * survive suspend on any platform anyway, so RAM-freezing buys nothing here. */
  async sleep(id: string): Promise<PodInfo> {
    await this.incus.setState(id, "stop");
    return this.getPod(id);
  }

  async wake(id: string): Promise<PodInfo> {
    await this.incus.setState(id, "start");
    return this.getPod(id);
  }

  async setKeepAwake(id: string, keepAwake: boolean): Promise<PodInfo> {
    await this.incus.patchInstance(id, {
      config: { "user.podbay.keep_awake": keepAwake ? "true" : "false" },
    });
    return this.getPod(id);
  }

  /**
   * Change reserved CPU/RAM and (grow-only) disk with a brief suspend. Incus
   * won't change `limits.*` on a running VM, so: stop → patch limits + grow the
   * home volume → start (if it was running). The disk grow is online on ZFS;
   * callers pass the high-water-mark diskGb (control-plane never shrinks).
   */
  /**
   * Stop a RUNNING pod for maintenance without destroying recent work.
   *
   * `force: true` on an Incus VM is a power cut. The guest never flushes, and ext4
   * delayed allocation then loses the DATA of anything written in the last commit
   * window while keeping its metadata — files come back the right name, the right
   * date, and ZERO BYTES.
   *
   * That is not theoretical: an owner's pod came back from an update with 20 of 23
   * `node_modules/.bin` shims zeroed, timestamped minutes before the update
   * (2026-07-29). A `pnpm install` had just written them. We tell people their
   * files survive an update, so this is the one promise we cannot break.
   *
   * So: sync inside the guest, ask it to shut down properly, and force only if it
   * will not go. A pod that refuses to stop still has to stop — but by then the
   * sync has already made the damage window small.
   */
  private async stopForMaintenance(id: string, why: string): Promise<void> {
    // Best-effort: a wedged guest may not run this, which is exactly why the
    // graceful stop below matters too.
    await this.incus.exec(id, ["sync"]).catch(() => {});
    try {
      await this.incus.setState(id, "stop");
      return;
    } catch (err) {
      log.warn("pod_graceful_stop_failed", { podId: id, why, err: String(err) });
    }
    await this.incus.setState(id, "stop", { force: true });
  }

  async resize(id: string, resources: PodResources): Promise<PodInfo> {
    const inst = await this.incus.getInstance(id);
    if (!inst) throw new ProviderError(`pod ${id} not found`, "not_found");
    const wasRunning = inst.status === "Running";

    if (wasRunning) await this.stopForMaintenance(id, "resize");
    await this.incus.patchInstance(id, {
      config: {
        "limits.cpu": String(resources.cpus),
        "limits.memory": `${resources.memoryGb}GiB`,
      },
    });
    await this.incus.resizeVolume(this.config.pool, this.homeVolume(id), resources.diskGb);
    if (wasRunning) await this.incus.setState(id, "start");
    log.info("pod_resized", { podId: id, ...resources, wasRunning });
    return this.getPod(id);
  }

  /** Volume snapshot — the archive/backup primitive rides on this. */
  async snapshot(id: string): Promise<{ snapshotId: string }> {
    const snapshotId = `snap-${Date.now()}`;
    await this.incus.snapshotVolume(this.config.pool, this.homeVolume(id), snapshotId);
    return { snapshotId };
  }

  async destroy(id: string): Promise<void> {
    const inst = await this.incus.getInstance(id);
    if (inst) {
      // Force is right HERE and nowhere else: the volume is deleted below, so there
      // is no data left to flush and a graceful stop would only make delete slower.
      if (inst.status === "Running") await this.incus.setState(id, "stop", { force: true });
      await this.incus.deleteInstance(id);
    }
    // Volume last — it holds the user's work.
    if (await this.incus.getVolume(this.config.pool, this.homeVolume(id))) {
      await this.incus.deleteVolume(this.config.pool, this.homeVolume(id));
    }
  }

  /** Published base images in the incus store (image-manifest prune). */
  async listBaseImages(): Promise<BaseImage[]> {
    return (await this.incus.listImages()).map((i) => ({
      fingerprint: i.fingerprint,
      aliases: (i.aliases ?? []).map((a) => a.name),
      sizeBytes: i.size,
      createdAt: i.created_at,
    }));
  }

  async deleteBaseImage(fingerprint: string): Promise<void> {
    await this.incus.deleteImage(fingerprint);
  }

  /**
   * Upgrade = recreate-keeping-volume (Incus has no in-place image swap like
   * `fly machine update --image`): stop → delete instance (home volume is a
   * separate custom volume, untouched) → create from the new image alias →
   * reattach → start. Same outcome as Fly's flow: ~/work + the Claude login
   * survive; the live conversation ends; `claude --continue` resumes.
   */
  async updateImage(
    id: string,
    image: string,
    onStage?: UpdateStage,
    opts?: {
      claudeFiles?: { guest_path: string; raw_value: string }[];
      permissions?: unknown;
    },
  ): Promise<PodInfo> {
    const stage = (s: string) => { try { onStage?.(s); } catch { /* progress is best-effort */ } };
    const inst = await this.incus.getInstance(id);
    if (!inst) throw new ProviderError(`pod ${id} not found`, "not_found");
    const wasRunning = inst.status === "Running";
    const keepAwake = inst.config["user.podbay.keep_awake"] === "true";
    const owner = inst.config["user.podbay.owner"] ?? "";
    // Preserve the pod's CURRENT sizing across the recreate — a resized pod must
    // not silently snap back to the box defaults on an image update.
    const cpu = inst.config["limits.cpu"] ?? String(this.config.cpus);
    const memory = inst.config["limits.memory"] ?? `${this.config.memoryGb}GiB`;

    // The `image` param is provider-agnostic and, from the web action, is Fly's
    // PODBAY_BASE_IMAGE (a docker digest) — meaningless to Incus, which caused
    // "Image not provided for instance creation". Incus's image identity is its
    // OWN published alias (config.imageAlias, e.g. "pod-base"), which the box's
    // build-image.sh re-points to the newest build — so recreating from it is
    // exactly "update to latest". Use the caller's value only if it looks like an
    // Incus alias (no docker "/" or ":"), else fall back to our alias.
    const looksLikeIncusAlias = image && !image.includes("/") && !image.includes(":");
    const sourceAlias = looksLikeIncusAlias ? image : this.config.imageAlias;

    // Preserve the pod-spec across the recreate. The fresh root fs wipes
    // /etc/podbay/pod-spec.json, and WITHOUT it the new boot's init.sh skips the
    // node_modules bind-mount (the app reinstalls from scratch — slow) AND the
    // permission preset (the agent then asks to run every command). Read it now,
    // while the pod is still up, and re-push it after the recreate. (secrets are
    // re-injected by the control plane; kickoff + ~/.claude live on the volume.)
    const preservedSpec = wasRunning
      ? await this.incus
          .exec(id, ["cat", "/etc/podbay/pod-spec.json"])
          .then((r) => (r.exitCode === 0 && r.stdout ? r.stdout : null))
          .catch(() => null)
      : null;

    stage("stopping");
    if (wasRunning) await this.stopForMaintenance(id, "update");
    await this.incus.deleteInstance(id);
    stage("recreating");
    await this.incus.createInstance({
      name: id,
      imageAlias: sourceAlias,
      config: {
        "limits.cpu": cpu,
        "limits.memory": memory,
        "user.podbay.owner": owner,
        "user.podbay.keep_awake": keepAwake ? "true" : "false",
      },
      devices: {
        // Same home volume, re-attached. homeDevice() picks block (no path) vs a
        // legacy filesystem volume (path) so recreating an OLD pod still works.
        home: await this.homeDevice(id),
      },
    });
    // Suspended pods stay stopped — "applies on next start", same as Fly.
    if (wasRunning) {
      stage("starting");
      await this.incus.setState(id, "start");
      // Re-push the pod-spec and RELOAD the agent so init.sh re-runs with the
      // env config present (mirrors createPod). Without this, the update strips
      // node_modules + permissions. First boot ran init.sh without the spec; the
      // agent restart re-runs it correctly.
      if (preservedSpec) {
        stage("booting");
        await this.waitGuestReady(id);
        await this.incus.exec(id, ["mkdir", "-p", "/etc/podbay"]);
        // Refresh the permission preset from the freshly-resolved env before re-pushing:
        // the spec is otherwise preserved verbatim, which FROZE the preset a pod was
        // created with — a preset fix (or a new security deny) never reached it on update
        // (git-push prompt lingered on pre-2026-08-01 pods). Everything else in the spec
        // is preserved. See refreshSpecPermissions.
        const specToPush = refreshSpecPermissions(preservedSpec, opts?.permissions);
        await this.incus.pushFile(id, "/etc/podbay/pod-spec.json", Buffer.from(specToPush, "utf8"));
        // Deliver the CURRENT env .claude layer with the update. The recreate wiped
        // /etc/podbay/claude (ephemeral rootfs) and the home volume still carries
        // ~/.podbay-seeded, so without this an update NEVER refreshed skills/rules —
        // a skill shipped after pod-creation was unreachable by update (live find,
        // 2026-07-28). Push the fresh layer, clear the marker, and the agent restart
        // below re-runs init.sh, which re-seeds (same mechanism as createPod).
        // Best-effort: a failed layer push must not fail the whole update.
        const claudeFiles = opts?.claudeFiles ?? [];
        if (claudeFiles.length > 0) {
          try {
            const dirs = [
              ...new Set(
                claudeFiles.map((f) => f.guest_path.replace(/\/[^/]*$/, "")).filter(Boolean),
              ),
            ];
            for (const d of dirs) await this.incus.exec(id, ["mkdir", "-p", d]);
            for (const f of claudeFiles) {
              await this.incus.pushFile(id, f.guest_path, Buffer.from(f.raw_value, "base64"));
            }
            await this.incus.exec(id, ["rm", "-f", "/home/dev/.podbay-seeded"]);
            log.info("pod_update_claude_layer_pushed", { podId: id, files: claudeFiles.length });
          } catch (e) {
            log.warn("pod_update_claude_layer_failed", { podId: id, err: e });
          }
        }
        stage("restarting agent");
        await this.incus.exec(id, ["systemctl", "restart", "podbay-agent"]);
      }
      // The control plane re-injects secrets after this returns; kickoff + ~/.claude
      // survive on the /home/dev volume, so login/RC still work.
      stage("waiting for agent");
      await this.waitAgentReady(id);
    }
    stage("finishing");
    log.info("pod_image_updated", { podId: id, image, sourceAlias, wasRunning });
    return this.getPod(id);
  }

  /** Add an agent to a live pod — POSTs to the pod-agent, which spawns it in a new
   * tmux window. No recreate: the running agent keeps its session. */
  async addAgent(id: string, agent: string): Promise<{ window: number }> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/agent/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before a second agent can be added — click Update in Settings, then try again.",
        "invalid",
      );
    }
    const body = (await res.json().catch(() => null)) as { window?: number; error?: string } | null;
    if (!res.ok || typeof body?.window !== "number") {
      throw new ProviderError(body?.error ?? "could not add the agent", "transient");
    }
    log.info("pod_agent_added", { podId: id, agent, window: body.window });
    // Persist the add into the POD's spec, not just the DB. The spec is what a
    // recreate preserves and what boot rebuilds windows from — leaving it stale
    // meant an image update silently dropped the added agent (live find, pod
    // "ttt", 2026-07-29: spec said ['codex'], Claude's window vanished on update).
    // Best-effort: the add already succeeded; a spec-patch failure must not fail it.
    try {
      const cur = await this.incus.exec(id, ["cat", "/etc/podbay/pod-spec.json"]);
      if (cur.exitCode === 0 && cur.stdout) {
        const spec = JSON.parse(cur.stdout) as { agents?: string[] };
        const agents = Array.isArray(spec.agents) ? spec.agents : [];
        if (!agents.includes(agent)) {
          spec.agents = [...agents, agent];
          await this.incus.pushFile(
            id,
            "/etc/podbay/pod-spec.json",
            Buffer.from(JSON.stringify(spec, null, 2), "utf8"),
          );
        }
      }
    } catch (e) {
      log.warn("pod_spec_agent_patch_failed", { podId: id, agent, err: String(e) });
    }
    return { window: body.window };
  }

  /** Merge `patch` into the pod's /etc/podbay/pod-spec.json (same cat→splice→push the
   * agent add uses). Best-effort: a suspended/unreachable pod just leaves the DB as the
   * source of truth for the next attempt. */
  async patchPodSpec(id: string, patch: Record<string, unknown>): Promise<void> {
    try {
      const cur = await this.incus.exec(id, ["cat", "/etc/podbay/pod-spec.json"]);
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
      await this.incus.pushFile(
        id,
        "/etc/podbay/pod-spec.json",
        Buffer.from(JSON.stringify(spec, null, 2), "utf8"),
      );
      log.info("pod_spec_patched", { podId: id, keys: Object.keys(patch) });
    } catch (e) {
      log.warn("pod_spec_patch_failed", { podId: id, keys: Object.keys(patch), err: String(e) });
    }
  }

  /** Live config-refresh: deliver the CURRENT env `.claude` layer + refreshed spec permissions into
   * the running instance and re-apply them via `/opt/podbay/podbay-refresh` — WITHOUT recreating the
   * instance or restarting the agent (contrast updateImage, which recreates + `systemctl restart
   * podbay-agent`). settings/hooks/permissions + skills reach the live agent via Claude's file watcher
   * / next skill use; CLAUDE.md prose lands at the next compaction. An image that predates the refresh
   * script returns `refreshed:false` + a note (the layer was still delivered). Best-effort: never
   * throws. */
  async refreshConfig(
    id: string,
    opts: { claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown },
  ): Promise<{ refreshed: boolean; note?: string }> {
    try {
      // Refresh the permission preset in the live spec (same freshening as updateImage).
      const cur = await this.incus.exec(id, ["cat", "/etc/podbay/pod-spec.json"]);
      if (cur.exitCode === 0 && cur.stdout) {
        const specToPush = refreshSpecPermissions(cur.stdout, opts.permissions);
        if (specToPush !== cur.stdout)
          await this.incus.pushFile(id, "/etc/podbay/pod-spec.json", Buffer.from(specToPush, "utf8"));
      }
      // Deliver the current .claude layer (skills/rules/settings source) into /etc/podbay/claude.
      const claudeFiles = opts.claudeFiles ?? [];
      if (claudeFiles.length > 0) {
        const dirs = [
          ...new Set(claudeFiles.map((f) => f.guest_path.replace(/\/[^/]*$/, "")).filter(Boolean)),
        ];
        for (const d of dirs) await this.incus.exec(id, ["mkdir", "-p", d]);
        for (const f of claudeFiles)
          await this.incus.pushFile(id, f.guest_path, Buffer.from(f.raw_value, "base64"));
      }
      // Re-apply IN PLACE — re-runs the idempotent refresh blocks, NO agent restart. A pod on an
      // image without the script degrades gracefully: the layer is delivered, apply awaits an update.
      const r = await this.incus.exec(id, ["podbay-refresh"]);
      if (r.exitCode !== 0)
        return {
          refreshed: false,
          note: "delivered; this pod's image predates in-place refresh — update it to apply",
        };
      log.info("pod_config_refreshed", { podId: id, files: claudeFiles.length });
      return { refreshed: true };
    } catch (e) {
      log.warn("pod_config_refresh_failed", { podId: id, err: String(e) });
      return { refreshed: false, note: `refresh failed: ${String(e).slice(0, 120)}` };
    }
  }

  async endpoint(id: string): Promise<string> {
    return this.podAddress(id, this.config.agentPort);
  }

  async podAddress(id: string, port: number): Promise<string> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    return `http://${ip}:${port}`;
  }

  async agentReady(id: string): Promise<boolean> {
    return (await this.fetchHealth(id)) !== null;
  }

  async agentIdleMs(id: string): Promise<number | null> {
    const h = await this.fetchHealth(id);
    return typeof h?.idleMs === "number" ? h.idleMs : null;
  }

  async agentSessionUrl(id: string): Promise<string | null> {
    const h = await this.fetchHealth(id);
    return typeof h?.sessionUrl === "string" ? h.sessionUrl : null;
  }

  async codexRcActive(id: string): Promise<boolean> {
    const h = await this.fetchHealth(id).catch(() => null);
    return (h as { codexRcActive?: boolean } | null)?.codexRcActive === true;
  }

  async sendAgentInput(id: string, agent: string, text: string): Promise<void> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/agent/input`, {
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
    // The pod controls this response and it feeds events, dashboards, the alert pager, and
    // the OOM dedup key — sanitize at the boundary (M2). sanitizePodHealth also array-checks.
    return sanitizePodHealth({
      agents: (h?.agents as PodHealth["agents"]) ?? [],
      issues: (h?.issues as PodHealth["issues"]) ?? [],
      repairs: (h?.repairs as PodHealth["repairs"]) ?? [],
      repairGaveUp: (h?.repairGaveUp as string[]) ?? [],
      ooms: (h?.ooms as PodHealth["ooms"]) ?? [],
      agentStatus: h?.agentStatus ?? null,
      codexStatus: h?.codexStatus ?? null,
      agentWaitingFor: h?.agentWaitingFor ?? null,
      appListening: h?.appListening,
    });
  }

  async runDoctor(id: string, mode: DoctorMode): Promise<DoctorReport> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/doctor`, {
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
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/report`, {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 404)
      throw new ProviderError("This pod needs updating before diagnostics can run here.", "invalid");
    const body = (await res.json().catch(() => null)) as (DiagnosticReport & { error?: string }) | null;
    if (!res.ok || !body || !Array.isArray(body.sections))
      throw new ProviderError(body?.error || "diagnostics didn't complete", "transient");
    return { collectedAt: body.collectedAt ?? new Date().toISOString(), sections: body.sections };
  }
  async drainFetchReports(id: string): Promise<FetchReport[]> {
    const ip = await this.instanceIp(id);
    if (!ip) return [];
    const res = await fetch(`http://${ip}:${this.config.agentPort}/fetch-memory`, {
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res?.ok) return [];
    const body = (await res.json().catch(() => null)) as { reports?: FetchReport[] } | null;
    return Array.isArray(body?.reports) ? body.reports : [];
  }

  async pushFetchPlan(id: string, plan: unknown): Promise<void> {
    const ip = await this.instanceIp(id);
    if (!ip) return;
    await fetch(`http://${ip}:${this.config.agentPort}/fetch-memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan),
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }



  async setCodexRc(id: string, on: boolean): Promise<void> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/codex/rc`, {
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
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/codex/pair`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before it can pair with the Codex app — click Update in Settings, then try again.",
        "invalid",
      );
    }
    const body = (await res.json().catch(() => null)) as
      | (CodexPairing & { error?: string })
      | null;
    // 503 = daemon still coming up (or standalone missing) — transient, let the UI retry.
    if (!res.ok || !body || !body.manualPairingCode) {
      throw new ProviderError(
        body?.error || "Codex pairing isn't ready yet on this pod",
        "transient",
      );
    }
    return {
      manualPairingCode: body.manualPairingCode,
      pairingCode: body.pairingCode || "",
      expiresAt: Number(body.expiresAt) || 0,
      deviceName: body.deviceName || id,
    };
  }


  /**
   * Read the pod's metrics, optionally narrowed to a window.
   *
   * The window is sent as a query param, which pods running an OLDER pod-agent
   * cannot route — they match the path EXACTLY and answer 404. That regressed the
   * Stats tab to "metrics aren't available yet" on every pod that hadn't been
   * updated yet: the data was there, the request just didn't parse. So a 404 with a
   * window falls back to the plain endpoint and narrows the series here. A client
   * must not require the fleet to update before it works again.
   */
  async fetchMetrics(id: string, windowMs?: number): Promise<MetricsSnapshot | null> {
    const ip = await this.instanceIp(id);
    if (!ip) return null;
    const get = async (url: string): Promise<Response | null> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        return await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      } catch {
        return null;
      }
    };
    const base = `http://${ip}:${this.config.agentPort}/metrics`;
    let res = await get(windowMs ? `${base}?windowMs=${windowMs}` : base);
    let narrow = false;
    if (windowMs && res && !res.ok) {
      res = await get(base);
      narrow = true; // the old agent gave us everything it has
    }
    if (!res?.ok) return null;
    const snap = (await res.json().catch(() => null)) as MetricsSnapshot | null;
    if (!snap) return null;
    return narrow && windowMs ? narrowSnapshot(snap, windowMs) : snap;
  }


  /** Host-level box stats for the backoffice (docs/plans/box-observability-plan.md):
   * CPU/RAM/disk from the Incus API + each instance's live RAM usage. Pod display
   * names are filled by the control plane (this knows only instance ids). */
  async boxStats(): Promise<BoxStats> {
    const MB = 1024 * 1024;
    const unreachable: BoxStats = {
      name: this.config.region,
      region: this.config.region,
      reachable: false,
      cpuCores: 0,
      ramUsedMb: 0,
      ramTotalMb: 0,
      diskUsedMb: 0,
      diskTotalMb: 0,
      pods: [],
    };
    try {
      const [res, pool, instances] = await Promise.all([
        this.incus.hostResources(),
        this.incus.poolResources(this.config.pool),
        this.incus.listInstances(),
      ]);
      const pods: BoxPod[] = await Promise.all(
        instances.map(async (inst) => {
          const memGb = Number((inst.config["limits.memory"] ?? "").replace(/GiB?$/i, "")) || 4;
          const st = await this.incus.instanceState(inst.name).catch(() => null);
          return {
            id: inst.name,
            name: null,
            size: memGb >= 16 ? "l" : memGb >= 8 ? "m" : "s",
            slots: Math.max(1, Math.round(memGb / 4)),
            status: mapStatus(inst.status),
            ramUsedMb: st?.memory?.usage != null ? Math.round(st.memory.usage / MB) : null,
          };
        }),
      );
      return {
        name: this.config.region,
        region: this.config.region,
        reachable: true,
        cpuCores: res.cpu?.total ?? 0,
        ramUsedMb: Math.round((res.memory?.used ?? 0) / MB),
        ramTotalMb: Math.round((res.memory?.total ?? 0) / MB),
        diskUsedMb: Math.round((pool.space?.used ?? 0) / MB),
        diskTotalMb: Math.round((pool.space?.total ?? 0) / MB),
        pods,
      };
    } catch {
      return unreachable;
    }
  }

  async agentStatus(id: string): Promise<string | null> {
    const h = await this.fetchHealth(id);
    return typeof h?.agentStatus === "string" ? h.agentStatus : null;
  }

  async githubStatus(id: string): Promise<{ connected: boolean; login: string | null }> {
    const ip = await this.instanceIp(id);
    if (!ip) return { connected: false, login: null };
    try {
      const res = await fetch(`http://${ip}:${this.config.agentPort}/gh/status`, {
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
    const ip = await this.instanceIp(id);
    if (!ip) return [];
    try {
      const res = await fetch(`http://${ip}:${this.config.agentPort}/secret-requests`, {
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
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/gh/token`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    // 404 = pod-agent predates the route; the pod keeps its login until updated.
    if (res.status === 404) {
      throw new ProviderError(
        "This pod needs updating before it can disconnect from GitHub — click Update in Settings, then try again.",
        "invalid",
      );
    }
    if (!res.ok) throw new ProviderError("GitHub disconnect failed on the pod", "invalid");
  }

  async setGithubToken(id: string, token: string): Promise<{ login: string }> {
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/gh/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(30_000),
    });
    // 404 = the pod-agent predates the /gh/token route: the OAuth flow worked,
    // the pod just can't accept the token yet. Tell the user how to fix it.
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
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/gh/repos`, {
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
    const ip = await this.instanceIp(id);
    if (!ip) throw new ProviderError(`pod ${id} has no address (not running?)`, "transient");
    const res = await fetch(`http://${ip}:${this.config.agentPort}/gh/clone`, {
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
    if ((res.status === 409 || res.status === 400) && data.reason) return { ok: false, reason: data.reason };
    throw new ProviderError(data.error || "Clone failed on the pod", "invalid");
  }

  async injectSecrets(id: string, secrets: Record<string, string>): Promise<void> {
    // Same contract as Fly: replace /etc/podbay/secrets.env on the running pod.
    await this.incus.pushFile(
      id,
      "/etc/podbay/secrets.env",
      Buffer.from(toEnvFile(secrets), "utf8"),
      "0600",
      1000,
      1000,
    );
  }

  // --- internals ---

  private toPodInfo(inst: IncusInstance): PodInfo {
    return {
      id: inst.name,
      status: mapStatus(inst.status),
      region: this.config.region,
      endpoint: null, // resolved lazily via endpoint(); needs the state call
      keepAwake: inst.config["user.podbay.keep_awake"] === "true",
      machineId: inst.name, // one instance per pod, named by pod id
      imageDigest: this.config.imageDigest,
    };
  }

  /** The VM's bridge IPv4 (reachable from the gateway over WireGuard). */
  private async instanceIp(id: string): Promise<string | null> {
    const state = await this.incus.instanceState(id);
    if (!state?.network) return null;
    for (const [ifname, net] of Object.entries(state.network)) {
      if (ifname === "lo") continue;
      const v4 = net.addresses.find((a) => a.family === "inet" && a.scope === "global");
      if (v4) return v4.address;
    }
    return null;
  }

  private async fetchHealth(id: string): Promise<{
    idleMs?: number;
    sessionUrl?: string;
    agentStatus?: string;
    codexStatus?: string;
  } | null> {
    const ip = await this.instanceIp(id);
    if (!ip) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`http://${ip}:${this.config.agentPort}/healthz`, {
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!res.ok) return null;
      return (await res.json()) as { idleMs?: number; sessionUrl?: string; agentStatus?: string };
    } catch {
      return null;
    }
  }
}
