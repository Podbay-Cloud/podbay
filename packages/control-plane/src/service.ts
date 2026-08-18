import path from "node:path";
import { access } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import {
  resolveWithConfig,
  POD_TIERS,
  DEFAULT_POD_SIZE,
  isPodSize,
  resolveResources,
  slotsForSize,
  ACCOUNT_SLOT_CAP,
  type PodSize,
  type AgentCli,
  type AgentAuth,
  type MetricsSnapshot,
  type BoxStats,
} from "@podbay/shared";
import type { FetchMemory } from "./fetch-memory.js";
import {
  AgentMessages,
  resolvePodRef,
  SYSTEM_SENDER,
  MSG_PAIR_CAP,
  MSG_RATE_WINDOW_MS,
  type PodRef,
} from "./agent-messages.js";
import { drainOutbox, confirmDrain, deliverMessages, pushFleetRoster, type OutboxLine } from "./agent-messaging.js";
import { classifyEvent } from "./incidents.js";
import {
  pickClaudeSettings,
  validateClaudeSettings,
  CLAUDE_SETTINGS_MERGE_PY,
  type ClaudeSettings,
} from "./claude-settings.js";
import { formatWarnDigest } from "./warn-digest.js";
import { createLogger, type Logger } from "@podbay/shared/log";
import type { PodAgentState, PodIssue } from "@podbay/shared";
import type {
  PodInfo,
  SandboxProvider,
  CodexPairing,
  DoctorReport,
  DiagnosticReport,
  DoctorMode,
  PodHealth,
  GithubRepo,
  CloneResult,
  GhDeviceStart,
  GhDevicePoll,
} from "@podbay/provider";
import { buildInitFiles } from "@podbay/provider";
import { requestHandoff, writeResizeNote } from "./handoff.js";
import type { PodStore } from "./store.js";
import type { SecretVault } from "./secret-vault.js";
import {
  ControlError,
  LIFECYCLE_POLICIES,
  type LifecyclePolicy,
  type PodEvent,
  type PodEventType,
  type PodRecord,
  type PodStatus,
  type FleetHealthRow,
  type PodLiveSignals,
} from "./types.js";
import { generateSlug } from "./slug.js";
import { usageForPod, type PodUsage } from "./metrics.js";

/** Min gap between config-drift auto-refresh ATTEMPTS on one pod, so a persistently-failing refresh
 * doesn't exec on every reconcile sweep. A successful refresh updates config_hash and stops retrying
 * outright; this only bounds the failure case. */
const CONFIG_DRIFT_BACKOFF_MS = 10 * 60_000;

/** Stable hash of the config layer we deliver to a pod — the `/etc/podbay/claude/*` files (sorted by
 * path so order can't perturb it) plus the permissions slice. Drift-detection compares this: it
 * changes iff the delivered bytes change. Returns null when there's nothing to deliver. */
function configLayerHash(
  claudeFiles: { guest_path: string; raw_value: string }[] | undefined,
  permissions: unknown,
): string | null {
  if (!claudeFiles && permissions === undefined) return null;
  const files = [...(claudeFiles ?? [])].sort((a, b) => a.guest_path.localeCompare(b.guest_path));
  const canonical = JSON.stringify({ files, permissions: permissions ?? null });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface PodServiceConfig {
  /** Directory holding first-party environments (each a subdir with podbay.yaml). */
  environmentsRoot: string;
  /** Optional region override passed to the provider. */
  region?: string;
  /** Optional per-pod app-secret vault (BotFather token, API keys). When present,
   * set secrets are injected into the pod as env vars on wake and on set/clear. */
  secretVault?: SecretVault;
  logger?: Logger;
  /** Additional named providers ('incus', …) beside the constructor's default.
   * A pod's record.provider picks which one hosts it (infra-strategy.md M1). */
  providers?: Record<string, SandboxProvider>;
  /** Name recorded on pods hosted by the constructor's default provider. */
  defaultProviderName?: string;
  /** Shared fetch memory. Optional: without it the fleet does not learn and every pod
   * climbs the ladder alone — degraded, never broken. */
  fetchMemory?: FetchMemory;
  /** Owner-scoped message routing between a user's own pods (agent-messaging). Optional:
   * without it `podbay msg` sends simply sit undrained — degraded, never broken. */
  agentMessages?: AgentMessages;
  /** Called when a CRITICAL unplanned incident is recorded — for admin alerting (the
   * gateway wires this to Telegram). Deduped per pod+type inside the service, so an OOM
   * loop is one alert, not fifty. Absent → no alerts. */
  onIncident?: (info: { podId: string; ownerId: string; title: string }) => void;
}

/** A declared secret plus whether the owner has set a value (never the value). */
export interface SecretStatus {
  key: string;
  description: string | null;
  required: boolean;
  set: boolean;
  /** Optional https link to where to obtain the value (provider's keys page). */
  url: string | null;
  /** True for a key the ENVIRONMENT declares; false for an arbitrary one the owner
   * added. Drives the UI verb: a declared key is "Clear"ed (kept, value unset), an
   * arbitrary one is "Delete"d (removed entirely). */
  declared: boolean;
}

/** Launch-time configuration: a display name and values for the env's declared secrets. */
/** Reserved pod-secret key holding the BYO-repo clone token — set at launch,
 * injected by the provisioner for init.sh's first-boot clone, and HIDDEN from the
 * dashboard's secret list (it's not a user-facing app secret). */
export const GH_CLONE_TOKEN_KEY = "PODBAY_GH_CLONE_TOKEN";
/** Reserved secret names carrying the BYO agent API key in api-key mode. Stored in the
 * vault (past the ToS env denylist), injected like any secret, and mapped onto the real
 * key var for the agent process by boot.ts. Hidden from the user's secret list. Must
 * match RESERVED_ANTHROPIC_KEY / RESERVED_OPENAI_KEY in packages/pod-agent/src/boot.ts. */
export const AGENT_API_KEY_SECRET: Record<string, string> = {
  "claude-code": "PODBAY_AGENT_ANTHROPIC_KEY",
  codex: "PODBAY_AGENT_OPENAI_KEY",
};
const RESERVED_SECRET_KEYS = new Set([
  GH_CLONE_TOKEN_KEY,
  ...Object.values(AGENT_API_KEY_SECRET),
]);

export interface LaunchOptions {
  /** Display name (trimmed, ≤60 chars; empty ⇒ falls back to the slug). */
  name?: string;
  /** Values for the env's declared secrets (UPPER_SNAKE key → plaintext). */
  secrets?: Record<string, string>;
  /** Chosen lifecycle policy; ignored/rejected when the env locks its lifecycle. */
  lifecycle?: LifecyclePolicy;
  /** Chosen compute tier (@podbay/shared POD_TIERS); defaults to Small. */
  size?: PodSize;
  /** Self-host explicit sizing (self-host-pod-sizing): a `local` pod's CPU cores + memory (MB).
   * Omitted ⇒ unlimited (the OSS default). Ignored for cloud pods (they use `size`). */
  cpus?: number;
  memoryMb?: number;
  /** Agent(s) the user picked at launch (multi-agent-plan.md slice 3). Empty/absent
   * ⇒ the environment's declared agents. Must be a subset of what the env allows. */
  agents?: AgentCli[];
  /** BYO-repo: a "owner/name" GitHub repo to clone into ~/work at first boot
   * (docs/plans/byo-repo-plan.md). The token is resolved from the user's encrypted
   * connection and passed to the provider separately — never stored on the pod row. */
  githubRepo?: string;
  /** The GitHub access token for cloning githubRepo, resolved from the user's
   * connection by the caller (web action). Injected into the pod, never persisted
   * on the pod row. */
  githubToken?: string;
  /** Auth mode for this pod (api-key-pod-mode.md). Absent ⇒ the environment's default. */
  agentAuth?: AgentAuth;
  /** The BYO API key for api-key mode, resolved by the caller. Stored as the reserved
   * PODBAY_AGENT_* secret (past the ToS denylist), injected, never on the pod row. */
  agentApiKey?: string;
  /** Per-account slot budget to enforce (default ACCOUNT_SLOT_CAP). The caller
   * (web) passes Infinity to exempt admins. See accountSlotUsage. */
  slotCap?: number;
}

/**
 * Orchestrates the SandboxProvider against a PodStore: launch, ownership-scoped
 * lifecycle, idle policy, and status reconciliation. Never handles credentials.
 */
export class PodService {
  private readonly log: Logger;
  /** Optional: without it the fleet simply does not learn, and every pod climbs the
   * ladder alone — degraded, never broken. */
  private readonly fetchMemory?: FetchMemory;
  private readonly agentMessages?: AgentMessages;
  /** Per-(pod:type) last-alerted time, so a repeating critical incident pages once per
   * window rather than on every reconcile. In-memory (a gateway restart resets it). */
  private readonly incidentAlertedAt = new Map<string, number>();
  /** Per-pod last config-drift auto-refresh ATTEMPT time, so a pod whose refresh keeps failing is
   * backed off instead of exec'd on every reconcile sweep. In-memory (a gateway restart resets it,
   * which just means one immediate retry — harmless because the delivery is idempotent). */
  private readonly configDriftAttempt = new Map<string, number>();

  constructor(
    private readonly provider: SandboxProvider,
    private readonly store: PodStore,
    private readonly config: PodServiceConfig,
  ) {
    this.log = config.logger ?? createLogger("control-plane");
    this.fetchMemory = config.fetchMemory;
    this.agentMessages = config.agentMessages;
  }

  private defaultName(): string {
    return this.config.defaultProviderName ?? "fly";
  }

  /** Resolve the SandboxProvider hosting a pod by its recorded provider name.
   * Unknown names FALL BACK to the default with a warning — a config gap must
   * degrade to "acts like before", never brick a pod operation. */
  private providerFor(name: string | null | undefined): SandboxProvider {
    const n = name ?? this.defaultName();
    if (n === this.defaultName()) return this.provider;
    const p = this.config.providers?.[n];
    if (p) return p;
    this.log.warn("unknown_provider_fallback", { provider: n });
    return this.provider;
  }

  /** providerFor by pod id (one store read) — for id-only internal paths. */
  private async providerOf(id: string): Promise<SandboxProvider> {
    return this.providerFor((await this.store.get(id))?.provider);
  }

  /** PUBLIC routing hook for callers that talk to the provider directly (the
   * gateway's terminal/preview proxy resolves pod addresses through this so a
   * pod on any provider is reachable). Unknown/missing → the default provider. */
  async providerForPod(id: string): Promise<SandboxProvider> {
    return this.providerOf(id);
  }

  /**
   * Append a lifecycle event. Best-effort: observability must never break a pod
   * operation — a failed insert loses a data point, a thrown one loses the pod.
   * Emitted from BOTH explicit actions and reconcile-detected out-of-band changes
   * (Fly restarting a machine, a crash, someone running `fly` by hand) — without
   * the latter the timeline silently lies. See docs/plans/observability-plan.md.
   */
  private async emit(
    rec: Pick<PodRecord, "id" | "ownerId">,
    type: PodEventType,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.store.appendEvent({
        id: randomUUID(),
        podId: rec.id,
        ownerId: rec.ownerId,
        type,
        at: new Date().toISOString(),
        meta: meta ?? null,
      });
    } catch (e) {
      this.log.warn("pod_event_append_failed", { id: rec.id, type, err: e });
    }
  }

  async launchPod(
    ownerId: string,
    environmentName: string,
    opts: LaunchOptions = {},
  ): Promise<PodRecord> {
    if (!isSafeName(environmentName)) {
      throw new ControlError(`invalid environment name: ${environmentName}`, "invalid");
    }
    const envDir = path.join(this.config.environmentsRoot, environmentName);

    // Resolve BEFORE provisioning — unknown/invalid env must have no side effects.
    let resolved;
    try {
      resolved = await resolveWithConfig(envDir);
    } catch (e) {
      throw new ControlError(
        `environment "${environmentName}" did not resolve: ${(e as Error).message}`,
        "invalid",
      );
    }

    // Validate launch-time secrets against what the env declares, BEFORE any
    // provisioning: only declared keys accepted; required ones must be non-blank.
    const secrets = this.validateLaunchSecrets(resolved.secrets, opts.secrets);

    const id = await this.uniqueSlug();
    const name = opts.name?.trim().slice(0, 60) || null;

    // Effective lifecycle up front so a locked-env override is rejected BEFORE we
    // write anything. always-on pods never idle-sleep (keepAwake derived true).
    const lifecycle = this.effectiveLifecycle(resolved.lifecycle, opts.lifecycle);
    const alwaysOn = lifecycle === "always-on";

    // Compute tier (defaults to Small). diskGb starts at the tier's disk; it's
    // the grow-only high-water mark from here on.
    const size: PodSize = isPodSize(opts.size) ? opts.size : DEFAULT_POD_SIZE;

    // Slot budget: this pod's slots must fit in the account's remaining allowance.
    // Checked BEFORE any write, so an over-budget launch has no side effects. Admins pass
    // slotCap: Infinity (never trips). Suspend a pod to free slots (see accountSlotUsage).
    await this.assertSlotsFit(ownerId, slotsForSize(size), opts.slotCap ?? ACCOUNT_SLOT_CAP);

    // Agent(s) the user picked (multi-agent-plan.md slice 3). Constrain to what the
    // env declares (never trust the client to widen the roster); empty ⇒ null, which
    // falls back to the env's declared agents at spec-build time.
    const chosenAgents = (opts.agents ?? []).filter((a) => resolved.agents.includes(a));

    // Auth mode: the launch pick, else the env default. Persisted so wake/recreate keep it.
    const agentAuth: AgentAuth = opts.agentAuth ?? resolved.agentAuth;

    // Create the DB row FIRST — before the secrets it owns (pod_secrets FKs
    // pods.id) and before the machine — so the pod is durable and
    // URL-addressable the instant launch returns. It starts "provisioning";
    // background machine creation flips it to running (or error). No credential
    // injection — each pod does its own /login (opsx per-pod-login).
    const now = new Date().toISOString();
    const record: PodRecord = {
      id,
      ownerId,
      environmentName,
      name,
      codexDevices: null,
      status: "provisioning",
      region: this.config.region ?? "",
      keepAwake: alwaysOn,
      lifecycle,
      autoUpdate: "inherit",
      // Env-declared default (docs: first-10-customers wants a shareable landing
      // from launch; private surfaces gate themselves in-app). Owner can flip it.
      previewPublic: resolved.preview === "public",
      // BYO-repo (docs/plans/byo-repo-plan.md): the repo to clone into ~/work. The token
      // rides as a reserved encrypted pod-secret below, never on this row.
      githubRepo: opts.githubRepo?.trim() || null,
      agents: chosenAgents.length ? chosenAgents : null,
      agentAuth,
      authedAt: null,
      sessionUrl: null,
      authUrl: null,
      machineId: null,
      imageDigest: null,
      // Baselined by the first reconcile (no delivery — the pod boots with the current layer).
      configHash: null,
      updatingSince: null,
      updateStage: null,
      maintenanceKind: null,
      provider: this.defaultName(),
      size,
      diskGb: POD_TIERS[size].diskGb,
      // Self-host explicit sizing: carried on the row so provisionPending can apply it (and it
      // survives a provision retry). Omitted ⇒ null ⇒ unlimited.
      cpus: opts.cpus ?? null,
      memoryMb: opts.memoryMb ?? null,
      provisionAttempts: 0,
      provisionLeaseUntil: null,
      provisionError: null,
      walkthroughSeenAt: null,
      position: null,
      createdAt: now,
      lastActiveAt: now,
    };
    const created = await this.store.create(record);
    await this.emit(created, "created", { environmentName, lifecycle });

    // Persist launch secrets now that the FK target exists — they survive wake
    // re-injection (DB = source of truth) and the provisioner re-reads them for
    // first-boot injection into /etc/podbay/secrets.env.
    if (secrets && this.config.secretVault) {
      for (const [k, v] of Object.entries(secrets)) await this.config.secretVault.set(id, k, v);
    }
    // BYO-repo clone token: stored as a RESERVED encrypted pod-secret (same vault
    // as app secrets), so the async provisioner re-reads + injects it for init.sh's
    // first-boot clone — without the token ever touching the pod row or a log. The
    // reserved key is hidden from the dashboard's secret list.
    if (opts.githubRepo?.trim() && opts.githubToken && this.config.secretVault) {
      await this.config.secretVault.set(id, GH_CLONE_TOKEN_KEY, opts.githubToken);
    }

    // api-key mode: store the BYO key as the reserved PODBAY_AGENT_* secret (per the
    // primary agent), so it's injected into secrets.env and boot.ts maps it onto the
    // real key var. Kept off the pod row and out of the user's secret list.
    if (agentAuth === "api-key" && opts.agentApiKey && this.config.secretVault) {
      const primary = (chosenAgents[0] ?? resolved.agents[0]) as string;
      const reserved = AGENT_API_KEY_SECRET[primary];
      if (reserved) await this.config.secretVault.set(id, reserved, opts.agentApiKey);
    }

    // That's it — the row IS the job. A background worker (the gateway's
    // provisioner, or provisionPending in tests) claims it and builds the
    // machine. Durable and retryable: nothing is lost if this process restarts.
    return created;
  }

  /**
   * The provisioner worker tick (docs/runbooks/durable-provisioning-plan.md). Claims up to
   * `limit` pods stuck in "provisioning" (via a race-safe lease so multiple
   * gateway instances never double-build) and builds each. Returns the ids it
   * built (or attempted). Call it on a timer; it's also the test seam that
   * replaces the old in-web build.
   */
  /** Whether an environment still resolves on disk (its podbay.yaml exists). Used
   * to fail a provision fast+clearly when an env was renamed/removed out from
   * under a live pod, instead of looping the retry budget on a raw ENOENT. */
  private async environmentExists(environmentName: string): Promise<boolean> {
    if (!isSafeName(environmentName)) return false;
    const yaml = path.join(this.config.environmentsRoot, environmentName, "podbay.yaml");
    try {
      await access(yaml);
      return true;
    } catch {
      return false;
    }
  }

  async provisionPending(
    now = Date.now(),
    opts: { leaseMs?: number; backoffMs?: number; maxAttempts?: number; limit?: number } = {},
  ): Promise<string[]> {
    const leaseMs = opts.leaseMs ?? 120_000;
    const backoffMs = opts.backoffMs ?? 15_000;
    const maxAttempts = opts.maxAttempts ?? 3;
    const limit = opts.limit ?? 5;
    const claimed = await this.store.claimProvisioning(
      new Date(now).toISOString(),
      new Date(now + leaseMs).toISOString(),
      limit,
    );
    for (const rec of claimed) await this.buildClaimedPod(rec, { now, backoffMs, maxAttempts });
    return claimed.map((r) => r.id);
  }

  /** Build the machine for a pod already claimed by this worker. Reconstructs the
   * createPod inputs from durable state (env + secrets), so it's fully
   * recoverable, and createPod is idempotent by pod id (safe to re-run). */
  private async buildClaimedPod(
    rec: PodRecord,
    opts: { now: number; backoffMs: number; maxAttempts: number },
  ): Promise<void> {
    const prov = this.providerFor(rec.provider);
    // A machine that existed BEFORE this cycle (a re-provision / retry of a pod
    // that already booted) carries the user's data. Provisioning failure must
    // NEVER destroy it — the give-up cleanup below only ever removes a machine
    // THIS cycle created. (2026-07-24: a retry whose env had been renamed away
    // burned its attempts on ENOENT, hit give-up, and prov.destroy() wiped a live
    // week-old pod + its volume. Never again.)
    const hadPriorMachine = Boolean(rec.machineId);
    try {
      const envDir = path.join(this.config.environmentsRoot, rec.environmentName);
      // A MISSING environment (renamed/removed out from under a live pod) is a
      // PERMANENT failure — retrying can't conjure the directory back. Fail fast
      // with a clear, actionable message instead of looping through the retry
      // budget and then destroying the machine.
      if (!(await this.environmentExists(rec.environmentName))) {
        this.log.error("pod_provision_env_missing", { id: rec.id, env: rec.environmentName });
        await this.store
          .update(rec.id, {
            status: "error",
            provisionError: envMissingMessage(rec.environmentName),
            provisionLeaseUntil: null,
          })
          .catch(() => undefined);
        return; // no retry, no destroy — the machine (if any) is left intact
      }
      const resolved = await resolveWithConfig(envDir);
      const secrets = this.config.secretVault
        ? await this.config.secretVault.retrieveAll(rec.id).catch(() => undefined)
        : undefined;
      const alwaysOn = rec.lifecycle === "always-on";
      const info = await prov.createPod({
        id: rec.id,
        owner: rec.ownerId,
        resolved,
        envDir,
        region: this.config.region,
        // The display name rides the pod-spec so in-pod surfaces (remote-control
        // session title) match what the user named the pod in the dashboard.
        name: rec.name ?? undefined,
        // BYO-repo: the repo to clone (from the durable row). The clone token is
        // already in `secrets` (reserved key), re-read + injected like any secret.
        githubRepo: rec.githubRepo ?? undefined,
        // The pod's chosen agent(s) (multi-agent-plan.md slice 3); undefined ⇒ the
        // provider falls back to the env's declared agents at spec build.
        agents: rec.agents ?? undefined,
        agentAuth: rec.agentAuth ?? undefined,
        secrets: secrets && Object.keys(secrets).length ? secrets : undefined,
        // Sizing. Cloud builds at the pod's tier (CPU/RAM from `size`, disk = high-water mark).
        // Self-host (`local`) uses the owner's explicit `cpus`/`memoryMb` when set — else omits
        // them so the container is unlimited (the OSS default; LocalProvider's cpuMemArgs drops
        // absent limits). We never fold the tier into a local pod: an OSS "no limit" pick must
        // NOT inherit Small's 2-CPU cap. (self-host-pod-sizing)
        resources:
          rec.provider === "local"
            ? rec.cpus != null || rec.memoryMb != null
              ? {
                  cpus: rec.cpus ?? 0,
                  memoryGb: rec.memoryMb != null ? rec.memoryMb / 1024 : 0,
                  diskGb: rec.diskGb,
                }
              : undefined
            : resolveResources(rec.size, rec.diskGb),
        // If a previous attempt already built the machine, ADOPT it (consistent
        // by-id read) rather than letting the provider search an eventually-
        // consistent list and miss it — which is how a retry built a duplicate.
        knownMachineId: rec.machineId,
        // Persist the link the instant the machine exists, BEFORE the ~60s boot
        // wait, so a crash/retry in between can still find it.
        onMachineCreated: async (machineId) => {
          await this.store.update(rec.id, { machineId }).catch(() => undefined);
        },
      });
      if (alwaysOn) await prov.setKeepAwake(rec.id, true).catch(() => undefined);
      // The row may have been deleted while we built the machine — if so, undo.
      if (!(await this.store.get(rec.id))) {
        await prov.destroy(rec.id).catch(() => undefined);
        return;
      }
      const status = await this.liveStatus(rec.id, info.status, prov);
      await this.store.update(rec.id, {
        status,
        region: info.region,
        keepAwake: alwaysOn || info.keepAwake,
        // Belt-and-braces: onMachineCreated already wrote this for a fresh build,
        // but an ADOPTED machine (retry) never fires that callback.
        machineId: info.machineId ?? rec.machineId,
        imageDigest: info.imageDigest ?? null,
        provisionLeaseUntil: null,
        provisionError: null,
      });
      if (status === "running") await this.emit(rec, "running", { reason: "provisioned" });
      this.log.info("pod_provisioned", {
        id: rec.id,
        status,
        attempt: rec.provisionAttempts,
        machineId: info.machineId,
        adopted: Boolean(rec.machineId),
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (rec.provisionAttempts >= opts.maxAttempts) {
        // Give up. Best-effort cleanup so a half-built machine/volume doesn't
        // leak — but ONLY for a machine THIS cycle was building from scratch. A
        // pod that already had a machine (hadPriorMachine) is a real, booted pod
        // with the user's data on its volume; destroying it on a transient
        // re-provision failure is catastrophic and irreversible.
        this.log.error("pod_provision_failed", {
          id: rec.id,
          err,
          attempts: rec.provisionAttempts,
          hadPriorMachine,
        });
        if (!hadPriorMachine) await prov.destroy(rec.id).catch(() => undefined);
        await this.store
          .update(rec.id, { status: "error", provisionError: err, provisionLeaseUntil: null })
          .catch(() => undefined);
      } else {
        // Retry: shorten the lease to a backoff so the next tick re-claims it.
        this.log.warn("pod_provision_retry", { id: rec.id, err, attempt: rec.provisionAttempts });
        await this.store
          .update(rec.id, {
            provisionError: err,
            provisionLeaseUntil: new Date(opts.now + opts.backoffMs).toISOString(),
          })
          .catch(() => undefined);
      }
    }
  }

  /**
   * ADMIN-SCOPED (backoffice fleet view) — deliberately NOT owner-scoped, unlike
   * every other read here. Callers must gate on requireAdmin(); the naming is the
   * warning. No reconcile: the fleet view must never touch pods just to render.
   */
  private fleetHealthCache: { at: number; rows: FleetHealthRow[] } | null = null;

  async listAllPods(): Promise<PodRecord[]> {
    return this.store.list();
  }

  /**
   * ADMIN-SCOPED: which pods need looking at, worst first.
   *
   * The per-pod drill-in tells you about a pod you ALREADY know is broken; nothing
   * told you WHICH pod to open. Every pod computes its own issues, so this is a
   * sweep of that — the difference between operating a fleet and hearing about
   * problems from users.
   *
   * Cached briefly: it reads every running pod, so an un-cached sweep would hit
   * the whole fleet on every page refresh. Reads are bounded in parallel for the
   * same reason. A pod that fails to answer is reported as unreachable rather than
   * dropped — silence is exactly the state an operator must see.
   */
  async adminFleetHealth(opts: { maxAgeMs?: number } = {}): Promise<FleetHealthRow[]> {
    const maxAge = opts.maxAgeMs ?? 30_000;
    const cached = this.fleetHealthCache;
    if (cached && Date.now() - cached.at < maxAge) return cached.rows;

    const pods = (await this.store.list()).filter((p) => p.status === "running");
    const rows: FleetHealthRow[] = [];
    const CONCURRENCY = 6;
    for (let i = 0; i < pods.length; i += CONCURRENCY) {
      const batch = pods.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          try {
            const h = await this.providerFor(p.provider).podHealth(p.id);
            return { pod: p, health: h, reachable: true as const };
          } catch {
            return { pod: p, health: null, reachable: false as const };
          }
        }),
      );
      for (const r of results) {
        if (!r.reachable) {
          rows.push({
            id: r.pod.id,
            name: r.pod.name,
            ownerId: r.pod.ownerId,
            environmentName: r.pod.environmentName,
            worst: "critical",
            issues: [
              {
                id: "unreachable",
                severity: "critical",
                title: "The pod isn't answering",
                detail: "It reports as running but its agent can't be reached.",
                fixable: false,
              },
            ],
          });
          continue;
        }
        const issues = r.health!.issues.filter((i) => i.severity !== "info");
        if (issues.length === 0) continue;
        rows.push({
          id: r.pod.id,
          name: r.pod.name,
          ownerId: r.pod.ownerId,
          environmentName: r.pod.environmentName,
          worst: issues.some((i) => i.severity === "critical") ? "critical" : "warn",
          issues,
        });
      }
    }
    const order = { critical: 0, warn: 1 } as const;
    rows.sort((a, b) => order[a.worst] - order[b.worst] || a.id.localeCompare(b.id));
    this.fleetHealthCache = { at: Date.now(), rows };
    return rows;
  }

  /**
   * Record that PODBAY, not the owner, did something to this pod.
   *
   * Admin actions delegate to the owner-scoped methods, so their events were
   * indistinguishable from the owner's own — we could suspend, update, roll back
   * or delete someone's pod and they had no way to know it was us. If we are
   * comfortable doing it, we should be comfortable saying it; if we are not
   * comfortable saying it, that is the signal not to do it.
   */
  private async markAdminAction(rec: PodRecord, action: string): Promise<void> {
    await this.emit(rec, "admin_action", { action, at: new Date().toISOString() });
  }

  /** OWNER-SCOPED: what Podbay did to this pod. Deliberately narrow — the owner
   * gets the actions taken ON their pod, not our whole lifecycle log. */
  async podAdminActions(
    ownerId: string,
    id: string,
  ): Promise<{ action: string; at: string }[]> {
    await this.owned(ownerId, id);
    const events = await this.store.listEvents(id).catch(() => []);
    return events
      .filter((e) => e.type === "admin_action")
      .map((e) => ({
        action: typeof e.meta?.action === "string" ? e.meta.action : "changed something",
        at: typeof e.meta?.at === "string" ? e.meta.at : e.at,
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** ADMIN-SCOPED: the whole lifecycle log, folded into usage by the caller. */
  async listAllEvents(): Promise<PodEvent[]> {
    return this.store.listEvents();
  }

  /**
   * ADMIN-SCOPED: machine truth straight from the provider. Returns one entry per
   * MACHINE, so a pod with duplicates appears more than once — that's how the
   * fleet view detects the duplicate-provision bug and orphaned machines.
   */
  async listProviderPods(): Promise<PodInfo[]> {
    const all = await this.provider.listPods();
    for (const [name, p] of Object.entries(this.config.providers ?? {})) {
      if (name === this.defaultName()) continue;
      all.push(...(await p.listPods().catch(() => [] as PodInfo[])));
    }
    return all;
  }

  /** ADMIN-SCOPED: host-level stats for every self-hosted box (Incus). Fly has no
   * box concept and is skipped. Pod display names are enriched from the DB (the
   * provider knows only instance ids). */
  async getBoxStats(): Promise<BoxStats[]> {
    const names = new Map<string, string | null>();
    for (const p of await this.store.list()) names.set(p.id, p.name);
    const providers = new Set<SandboxProvider>([
      this.provider,
      ...Object.values(this.config.providers ?? {}),
    ]);
    const boxes: BoxStats[] = [];
    for (const p of providers) {
      if (typeof p.boxStats !== "function") continue;
      const b = await p.boxStats().catch(() => null);
      if (!b) continue;
      for (const pod of b.pods) pod.name = names.get(pod.id) ?? null;
      boxes.push(b);
    }
    return boxes;
  }

  // --- ADMIN-SCOPED pod control ---
  // These act on ANY pod regardless of owner. The web layer gates them behind
  // requireAdmin(); here we resolve the pod's REAL owner and delegate to the
  // owner-scoped method, so lifecycle events stay attributed to the actual owner
  // (not the admin) and there's one code path per action, not two.

  /** ADMIN-SCOPED: read any pod by id (for the backoffice drill-in view). */
  async adminGetPod(id: string): Promise<PodRecord> {
    return this.ownedByAnyone(id);
  }
  /** ADMIN-SCOPED: one pod's lifecycle events (newest fold uses live status). */
  async adminPodEvents(id: string): Promise<PodEvent[]> {
    return this.store.listEvents(id);
  }
  /** OWNER-SCOPED: the owner's own pod's activity, for the cockpit timeline + banner. */
  async podEvents(ownerId: string, id: string): Promise<PodEvent[]> {
    await this.owned(ownerId, id);
    return this.store.listEvents(id);
  }

  /** Dismiss a pod's incident banner (the OOM/crash notice) durably — server-side, so
   * it stays dismissed across devices and reloads. Owner-scoped, and the event must
   * belong to the named pod. */
  async dismissIncident(ownerId: string, podId: string, eventId: string): Promise<void> {
    await this.owned(ownerId, podId);
    const events = await this.store.listEvents(podId);
    const target = events.find((e) => e.id === eventId);
    if (!target) return;
    // "Dismiss" means "I've seen the trouble on this pod up to now" — clear the WHOLE pile,
    // not one banner at a time. Two things stack it: (1) cgroup v2 propagates one OOM kill up
    // every ancestor cgroup, so a single kill lands as several oom_killed events at the same
    // instant; (2) a pod that keeps OOMing over hours accrues many separate incidents. Before,
    // one dismiss cleared only the ±10s sibling cluster, so a pod that had crashed 3 times made
    // the owner dismiss + reload three times. Now one click dismisses every undismissed
    // banner-worthy incident at or before the target's time. A genuinely NEW incident afterward
    // is newer than this dismiss, so it still surfaces (owner won't miss a recurring problem).
    const cutoff = new Date(target.at).getTime();
    const pile = events.filter((e) => {
      if (e.dismissedAt) return false;
      if (new Date(e.at).getTime() > cutoff) return false; // keep anything newer than what they saw
      const inc = classifyEvent(e.type, e.meta);
      return inc.unplanned && inc.severity !== "info"; // banner-worthy = warn/critical incidents
    });
    for (const e of pile) await this.store.dismissEvent(e.id);
  }
  /** ADMIN-SCOPED: one pod's derived usage, reconciled against its live status. */
  async adminPodUsage(id: string): Promise<PodUsage | null> {
    const rec = await this.ownedByAnyone(id);
    return usageForPod(await this.store.listEvents(id), Date.now(), rec.status);
  }
  /** ADMIN-SCOPED: live resource metrics (CPU/mem/disk/net) for oversight. Null
   * when the pod isn't running or its agent is unreachable. This is RESOURCE data
   * off the pod-agent's /metrics — never the user's terminal/session content. */
  async adminPodMetrics(id: string, windowMs?: number): Promise<MetricsSnapshot | null> {
    const rec = await this.ownedByAnyone(id);
    if (rec.status !== "running") return null;
    return this.providerFor(rec.provider)
      .fetchMetrics(id, windowMs)
      .catch(() => null);
  }
  /** ADMIN-SCOPED: which of the pod's declared secrets are SET (never the values)
   * — a support signal ("did they add their API key?"). */
  async adminListSecrets(id: string): Promise<SecretStatus[]> {
    const rec = await this.ownedByAnyone(id);
    const declared = await this.declaredSecrets(rec.environmentName);
    const setKeys = this.config.secretVault
      ? new Set(await this.config.secretVault.listKeys(id))
      : new Set<string>();
    const out: SecretStatus[] = declared.map((d) => ({
      key: d.key,
      description: d.description,
      required: d.required,
      set: setKeys.has(d.key),
      url: d.url,
      declared: true,
    }));
    const declaredKeys = new Set(declared.map((d) => d.key));
    for (const k of setKeys) {
      if (RESERVED_SECRET_KEYS.has(k)) continue; // reserved plumbing, not a user secret
      if (!declaredKeys.has(k))
        out.push({ key: k, description: null, required: false, set: true, url: null, declared: false });
    }
    return out;
  }
  /** ADMIN-SCOPED: wake any pod. */
  async adminWake(id: string): Promise<PodRecord> {
    const rec = await this.ownedByAnyone(id);
    const out = await this.wake(rec.ownerId, id);
    await this.markAdminAction(rec, "resume");
    return out;
  }
  /** ADMIN-SCOPED: sleep any pod. */
  async adminSleep(id: string): Promise<PodRecord> {
    const rec = await this.ownedByAnyone(id);
    const out = await this.sleep(rec.ownerId, id);
    await this.markAdminAction(rec, "suspend");
    return out;
  }
  /** ADMIN-SCOPED: destroy any pod. */
  async adminDestroy(id: string): Promise<void> {
    const rec = await this.ownedByAnyone(id);
    // Marked BEFORE the delete: afterwards there is no pod to attach it to.
    await this.markAdminAction(rec, "delete");
    return this.destroy(rec.ownerId, id);
  }
  /** ADMIN-SCOPED: apply an image to any pod (update, or roll back to a prior digest).
   * Awaits completion — the backoffice caller wants the resulting record, and it
   * isn't holding a user-facing navigation open the way the cockpit action was. */
  async adminUpdatePodImage(id: string, image: string): Promise<PodRecord> {
    const rec = await this.ownedByAnyone(id);
    await this.emit(rec, "update_started", { to: image });
    // The owner sees "Podbay updated this pod" — including a ROLLBACK, which is
    // the one they are least likely to expect and most likely to notice.
    await this.markAdminAction(
      rec,
      image === rec.imageDigest ? "reinstall the same image" : "change the pod's image",
    );
    return this.runPodImageUpdate(rec, id, image);
  }

  /**
   * ADMIN-SCOPED: resize any pod.
   *
   * "Memory is near the ceiling" is a support ticket, and an operator who can
   * suspend, update, roll back and delete but NOT resize has to hand the one
   * actually-useful remedy back to the user.
   *
   * It changes what the owner is billed, so it is audited like every other admin
   * action — the owner sees "Podbay changed this pod's size to large" in their own
   * activity list. An unexplained bill change is worse than the problem it fixes.
   */
  async adminResize(id: string, size: PodSize): Promise<PodRecord> {
    const rec = await this.ownedByAnyone(id);
    if (rec.size === size) return rec;
    const out = await this.resizePod(rec.ownerId, id, size);
    // The owner's own words, not the tier id: "changed this pod's size to l" is a
    // sentence nobody outside this codebase can read.
    await this.markAdminAction(rec, `change the pod's size to ${POD_TIERS[size].label}`);
    return out;
  }

  /**
   * ADMIN-SCOPED diagnostics — the alternative to giving support a shell.
   *
   * A shell on someone's pod is unbounded: their source, their `gh` token, the
   * secrets in their environment, and their agent's session transcripts, which are
   * the most private thing on the box. Worse, it is unauditable in CONTENT — we can
   * record that an operator opened a terminal, never what they read.
   *
   * This is the bounded trade: named sections describing the MACHINE, collected by
   * a script whose boundary is written down (pod-base/podbay-doctor). It is audited
   * as an admin action, because the owner should know support looked.
   */
  async adminPodReport(id: string): Promise<DiagnosticReport> {
    const rec = await this.ownedByAnyone(id);
    const report = await this.providerFor(rec.provider).podReport(id);
    await this.markAdminAction(rec, "collect diagnostics from this pod");
    return report;
  }

  /** ADMIN-SCOPED doctor: check freely, apply SAFE fixes (audited), never invasive —
   * replacing a user's files is theirs to decide, even with a backup. */
  async adminRunDoctor(id: string, mode: "check" | "safe"): Promise<DoctorReport> {
    const rec = await this.ownedByAnyone(id);
    const report = await this.runDoctor(rec.ownerId, id, mode);
    if (mode === "safe" && report.issues.some((i) => i.fixed)) {
      await this.markAdminAction(rec, "run doctor and apply safe repairs");
    }
    return report;
  }

  /** Resolve a pod by id with NO ownership check (admin path). Throws not_found. */
  private async ownedByAnyone(id: string): Promise<PodRecord> {
    const record = await this.store.get(id);
    if (!record) throw new ControlError(`pod ${id} not found`, "not_found");
    return record;
  }

  /** Stable display order for the pods list. `listByOwner` has no ORDER BY, so the
   * DB returns physical/heap order that reshuffles on every row UPDATE (markActive
   * on terminal use, the idle sweep, status flips) — cards jumped on every refresh.
   * Sort so a card moves only on a real state change:
   *   1. status rank — errors on top (they need you), then active, then suspended,
   *      then teardown; 2. lastActiveAt DESC — most-recently-active first, so the
   *      order MATCHES the "active X ago" the card shows (sorting by an invisible
   *      key, createdAt, read as random); 3. id (stable tiebreak).
   * lastActiveAt only changes on real activity (terminal use or the agent working),
   * so cards stay put otherwise. (Minor: a rare maintenance-wake also bumps it — see
   * 0audit; separating that would also make the "active X ago" label exact.) */
  private static readonly STATUS_RANK: Record<PodStatus, number> = {
    error: 0,
    running: 1,
    provisioning: 1,
    waking: 1,
    suspended: 2,
    destroying: 3,
    gone: 4,
  };
  private sortForDisplay(pods: PodRecord[]): PodRecord[] {
    const rank = (s: PodStatus) => PodService.STATUS_RANK[s] ?? 1;
    // MANUAL order wins: hand-placed pods (position set) keep their exact order.
    // Never-placed pods (position null — e.g. created after the owner last sorted)
    // float ABOVE the placed ones in the default status/recency sort, so a brand-new
    // pod appears at the top where it's easy to find and drag into place.
    return [...pods].sort((a, b) => {
      if (a.position != null && b.position != null)
        return a.position - b.position || a.id.localeCompare(b.id);
      if (a.position != null) return 1;
      if (b.position != null) return -1;
      return (
        rank(a.status) - rank(b.status) ||
        b.lastActiveAt.localeCompare(a.lastActiveAt) || // most-recently-active first (matches the card's "active X ago")
        a.id.localeCompare(b.id)
      );
    });
  }

  /**
   * Persist the owner's hand-ordered dashboard: `orderedIds` is the COMPLETE order
   * as dropped (position = index). Ids not owned by the caller are ignored, and
   * owned pods missing from the list keep their old position — a stale client
   * can't scramble a list it didn't see.
   */
  async setPodOrder(ownerId: string, orderedIds: string[]): Promise<void> {
    const owned = new Set((await this.store.listByOwner(ownerId)).map((p) => p.id));
    let i = 0;
    for (const id of orderedIds) {
      if (!owned.has(id)) continue;
      await this.store.update(id, { position: i++ });
    }
  }

  /**
   * How many of an account's slots are in use, and its cap.
   *
   * A pod occupies slots (by size) UNLESS it is suspended — a suspended pod has freed
   * its compute, so the slots are available for another pod (and resuming it needs them
   * back). error/gone pods hold nothing. This is the single source the guards and the UI
   * both read, so "3 / 4 used" on the dashboard and a launch refusal can never disagree.
   */
  async accountSlotUsage(
    ownerId: string,
    cap = ACCOUNT_SLOT_CAP,
  ): Promise<{ used: number; cap: number; pods: { id: string; size: PodSize; slots: number }[] }> {
    const pods = await this.store.listByOwner(ownerId);
    const active = pods.filter((p) => p.status !== "suspended" && p.status !== "error" && p.status !== "gone");
    const detail = active.map((p) => ({ id: p.id, size: p.size, slots: slotsForSize(p.size) }));
    return { used: detail.reduce((n, p) => n + p.slots, 0), cap, pods: detail };
  }

  /**
   * Throw a `slot_limit` ControlError if the account can't fit `add` more slots.
   * `excludeCost` is the slots the target pod ALREADY contributes to the current tally
   * (0 for a new launch or a suspended pod being resumed; its old cost for a resize), so
   * the check reads used − excludeCost + add. A cap of Infinity (admins) never trips.
   */
  private async assertSlotsFit(
    ownerId: string,
    add: number,
    cap: number,
    excludeCost = 0,
  ): Promise<void> {
    if (!Number.isFinite(cap)) return;
    const { used } = await this.accountSlotUsage(ownerId, cap);
    const total = used - excludeCost + add;
    if (total > cap) {
      throw new ControlError(
        `This would use ${total} of your ${cap} slots. Suspend a pod to free slots, or contact support for more.`,
        "slot_limit",
      );
    }
  }

  async listPods(ownerId: string): Promise<PodRecord[]> {
    const pods = await this.store.listByOwner(ownerId);
    // Reconcile only pods mid-transition (usually 0–1) so the dashboard reflects
    // real agent-reachability without hitting the provider for every pod. A
    // RUNNING pod that's logged in but has no session URL yet is still
    // onboarding: the boot greeter enables remote control with NO client
    // watching, so nothing streamed the URL through the gateway — poll /healthz
    // to capture it and let the wizard reach "Ready" (stops once sessionUrl is set).
    const transient = pods.filter(
      (p) =>
        p.status === "waking" ||
        p.status === "provisioning" ||
        // Onboarding (no session URL yet) — pull auth state. Not gated on authedAt, so a self-host
        // captures the PRE-login sign-in URL too (the gateway would have pushed it in cloud).
        (p.status === "running" && p.sessionUrl === null),
    );
    if (transient.length === 0) return this.sortForDisplay(pods);
    await Promise.all(transient.map((p) => this.reconcile(p.id).catch(() => undefined)));
    return this.sortForDisplay(await this.store.listByOwner(ownerId));
  }

  /** Ids of every running pod, for the gateway's control-socket sweep. Ownership is
   * not relevant here — the gateway maintains a socket to each running pod regardless
   * of who owns it, the same way it proxies any pod's terminal. */
  /** The owner of a pod, for routing a pod-initiated relay request to their relay. */
  async ownerOf(id: string): Promise<string | null> {
    return (await this.store.get(id).catch(() => null))?.ownerId ?? null;
  }

  /** A pod's owner-chosen display name, for gateway-authoritative attribution (relay
   * dashboard, incident alerts). Null when unset — callers fall back to the slug/id. */
  async nameOf(id: string): Promise<string | null> {
    return (await this.store.get(id).catch(() => null))?.name ?? null;
  }

  async listRunningIds(): Promise<string[]> {
    // Filtered in the DB, not in memory: this runs on a timer forever, and
    // store.list() grows with every pod ever created, including destroyed ones.
    return (await this.store.listByStatus(["running"])).map((p) => p.id);
  }

  /**
   * Pods whose status is worth re-checking against the provider.
   *
   * Incus pods are never reconciled on a timer today — `sleepIdlePods` returns early
   * for them, and every other reconcile is triggered by someone looking at a page. So
   * a crashed pod keeps reading "running" and a recovered one keeps reading
   * "suspended", and everything downstream (the control sweep, the idle policy, fleet
   * health) inherits that staleness. This is the input to a periodic sweep that fixes
   * it. Terminal states are excluded — there is nothing to learn about a pod that is
   * gone.
   */
  async listReconcilableIds(): Promise<string[]> {
    return (
      await this.store.listByStatus(["running", "suspended", "waking", "provisioning"])
    ).map((p) => p.id);
  }

  async getPod(ownerId: string, id: string): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    // "waking" only settles to running/suspended via reconcile. listPods does it
    // for the dashboard, but single-pod reads (the cockpit page, the gateway's
    // waitRunning poll) previously showed a stale "waking…" until some OTHER
    // surface reconciled — the live bug where the cockpit sat on waking while
    // the dashboard already said running. Reconcile it here too. Also reconcile a
    // running pod still onboarding (logged in, no session URL yet) so the cockpit
    // page captures the greeter's remote-control URL and advances to "Ready".
    if (
      rec.status === "waking" ||
      // Any running pod still onboarding (no session URL yet) — pull its auth state each poll. Was
      // gated on `authedAt !== null` (post-login only), but a self-host must also pull the PRE-login
      // sign-in URL, which the gateway would otherwise have pushed. Stops once sessionUrl is set.
      (rec.status === "running" && rec.sessionUrl === null)
    ) {
      return this.reconcile(rec.id).catch(() => rec);
    }
    return rec;
  }

  async wake(ownerId: string, id: string, opts: { slotCap?: number } = {}): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    // Resuming a suspended pod reclaims its slots — it must still fit the budget. The pod
    // is suspended (0 in the tally now), so we just add its size back. Admins pass Infinity.
    await this.assertSlotsFit(ownerId, slotsForSize(rec.size), opts.slotCap ?? ACCOUNT_SLOT_CAP);
    await this.providerFor(rec.provider).wake(id);
    // The machine is starting but the pod-agent isn't reachable yet — hold
    // "waking" rather than lying "running". reconcile flips it once it answers.
    return this.store.update(id, {
      status: "waking",
      lastActiveAt: new Date().toISOString(),
    });
  }

  async sleep(ownerId: string, id: string): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    // Suspend kills the running agent, so give it a chance to leave a handoff note
    // first. Best-effort and time-boxed — requestHandoff never throws and never
    // outlives its budget, so the suspend behaves exactly as it did before.
    await requestHandoff({ provider: this.providerFor(rec.provider), podId: id, log: this.log });
    const info = await this.providerFor(rec.provider).sleep(id);
    const updated = await this.store.update(id, { status: info.status });
    await this.emit(rec, "suspended", { reason: "manual" });
    return updated;
  }

  async setKeepAwake(ownerId: string, id: string, keepAwake: boolean): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    await this.providerFor(rec.provider).setKeepAwake(id, keepAwake);
    return this.store.update(id, { keepAwake });
  }

  /**
   * Change a pod's compute tier (owner-scoped). CPU/RAM come from the new size
   * and may move down; disk is grow-only, so the pod keeps `max(current, new)`
   * — a Large→Medium resize retains the 40 GB disk. Applied with a brief suspend
   * (the provider stops → reconfigures → starts), so a running pod cold-restarts
   * and the agent resumes via `claude --continue`. Only from a settled state
   * (running/suspended); throws otherwise so we never resize mid-build.
   */
  /**
   * Start a resize and RETURN, like startPodImageUpdate.
   *
   * resizePod awaited the whole stop→patch→start, which is minutes. The row was
   * marked in-flight correctly the entire time and no surface ever saw it: the
   * server action didn't return, so the page didn't re-render until the resize was
   * already over. The owner watched a pod that said "Running" while it was down,
   * with no progress — reported live 2026-07-29. Progress needs the call to come
   * back first; that is the whole difference between this and the update path.
   */
  async startPodResize(
    ownerId: string,
    id: string,
    size: PodSize,
    opts: { slotCap?: number } = {},
  ): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running" && rec.status !== "suspended") {
      throw new ControlError(`pod ${id} can't be resized while ${rec.status}`, "invalid");
    }
    if (rec.size === size) return; // no-op: never restart a pod for nothing
    // A running pod counts against the budget at its CURRENT size; resizing it swaps that
    // cost for the new size's — so a resize UP must still fit. A suspended pod counts as 0
    // now, so its slots are re-checked when it resumes, not here.
    if (rec.status === "running") {
      await this.assertSlotsFit(
        ownerId,
        slotsForSize(size),
        opts.slotCap ?? ACCOUNT_SLOT_CAP,
        slotsForSize(rec.size),
      );
    }
    await this.store.update(id, {
      updatingSince: new Date().toISOString(),
      updateStage: "stopping",
      maintenanceKind: "resize",
    });
    await this.emit(rec, "resize_started", { size });
    void this.resizePod(ownerId, id, size, { alreadyMarked: true }).catch(async (e) => {
      this.log.error("resize_pod_failed", { podId: id, err: e });
      await this.store
        .update(id, { updatingSince: null, updateStage: null, maintenanceKind: null })
        .catch(() => undefined);
      await this.emit(rec, "resize_failed", { error: (e as Error)?.message ?? String(e) });
    });
  }

  async resizePod(
    ownerId: string,
    id: string,
    size: PodSize,
    opts: { alreadyMarked?: boolean } = {},
  ): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running" && rec.status !== "suspended") {
      throw new ControlError(`pod ${id} can't be resized while ${rec.status}`, "invalid");
    }
    // Disk never shrinks (ZFS/volumes can't, and it's the durable quota).
    const diskGb = Math.max(rec.diskGb, POD_TIERS[size].diskGb);
    const resources = resolveResources(size, diskGb);

    // A resize STOPS AND RESTARTS the pod, so it is a maintenance window like an
    // update. The transient row fields are the same ones the update path uses,
    // because the surfaces already render one state per pod from them; maintenanceKind
    // is what tells them to say "Resizing" rather than "Updating".
    if (!opts.alreadyMarked) {
      await this.store.update(id, {
        updatingSince: new Date().toISOString(),
        updateStage: "stopping",
        maintenanceKind: "resize",
      });
      await this.emit(rec, "resize_started", { size, diskGb });
    }
    // A resize cold-restarts the pod and kills the agent mid-task, exactly like an update
    // — so it gets the same treatment. Only for a RUNNING pod: a suspended one has no live
    // agent to hand off, and no reachable machine to leave a note on (it already handed off
    // when it was suspended). Both are best-effort and time-boxed; neither can fail the
    // resize. The handoff wait is covered by the "Resizing…" progress the cockpit renders.
    if (rec.status === "running") {
      await this.store.update(id, { updateStage: "handoff" }).catch(() => undefined);
      const provider = this.providerFor(rec.provider);
      await requestHandoff({ provider, podId: id, log: this.log });
      // …and leave a note so the resumed agent learns its NEW resources (disk = the pod's
      // real diskGb, since a resize-down keeps the larger disk).
      await writeResizeNote({
        provider,
        podId: id,
        label: POD_TIERS[size].label,
        cpus: resources.cpus,
        memoryGb: resources.memoryGb,
        diskGb: resources.diskGb,
        at: new Date().toISOString(),
        log: this.log,
      });
    }
    try {
      const info = await this.providerFor(rec.provider).resize(id, resources);
      const updated = await this.store.update(id, {
        size,
        diskGb,
        status: info.status,
        updatingSince: null,
        updateStage: null,
        maintenanceKind: null,
      });
      await this.emit(rec, "resized", { size, diskGb });
      return updated;
    } catch (e) {
      // Clear the flag on failure or the pod is stuck reading "Resizing" forever.
      await this.store
        .update(id, { updatingSince: null, updateStage: null, maintenanceKind: null })
        .catch(() => undefined);
      await this.emit(rec, "resize_failed", { error: (e as Error)?.message ?? String(e) });
      throw e;
    }
  }

  /**
   * Self-host LIVE resize: change a running local pod's CPU/memory caps in place via the provider's
   * `docker update` — no cold restart, no agent handoff, no data loss (unlike the tier resize above,
   * which is a maintenance window). Raising/changing a limit applies instantly. REMOVING a limit
   * (back to unlimited) is refused: it needs a container recreate, which would wipe a volume-less
   * self-host pod (0audit). Persists the new `cpus`/`memoryMb` on the row so metrics + the picker
   * reflect it.
   */
  async resizePodLive(
    ownerId: string,
    id: string,
    sizing: { cpus?: number | null; memoryMb?: number | null },
  ): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    if (rec.provider !== "local") {
      throw new ControlError("live resize is only for self-host (local) pods", "invalid");
    }
    if (rec.status !== "running") {
      throw new ControlError(`pod ${id} can't be resized while ${rec.status} — start it first`, "invalid");
    }
    const cpus = sizing.cpus ?? null;
    const memoryMb = sizing.memoryMb ?? null;
    // Refuse dropping an existing limit (limited → unlimited): docker can't unset a running
    // container's memory limit, and a recreate would destroy the pod (no persistent volume).
    if ((rec.cpus != null && cpus == null) || (rec.memoryMb != null && memoryMb == null)) {
      throw new ControlError(
        "removing a CPU or memory limit needs a pod recreate, which would wipe a self-host pod's data — keep a positive value, or recreate the pod to go unlimited",
        "invalid",
      );
    }
    // Both already unlimited and staying unlimited → nothing to apply.
    if (cpus == null && memoryMb == null) return rec;
    const resources = {
      cpus: cpus ?? 0,
      memoryGb: memoryMb != null ? memoryMb / 1024 : 0,
      diskGb: rec.diskGb,
    };
    await this.providerFor(rec.provider).resize(id, resources); // docker update (positive caps only)
    const updated = await this.store.update(id, { cpus, memoryMb });
    await this.emit(rec, "resized", { cpus, memoryMb }).catch(() => undefined);
    return updated;
  }

  /** The effective launch lifecycle: a locked env forces its default (and rejects a
   * differing override); otherwise the caller's choice, else the env default. */
  private effectiveLifecycle(
    env: { default: LifecyclePolicy; locked: boolean },
    requested: LifecyclePolicy | undefined,
  ): LifecyclePolicy {
    if (env.locked) {
      if (requested && requested !== env.default) {
        throw new ControlError(`this environment requires the "${env.default}" lifecycle`, "invalid");
      }
      return env.default;
    }
    if (requested && !LIFECYCLE_POLICIES.includes(requested)) {
      throw new ControlError(`invalid lifecycle: ${requested}`, "invalid");
    }
    return requested ?? env.default;
  }

  /** Change a pod's lifecycle policy (owner-scoped). Rejected when the pod's env
   * locks its lifecycle. `always-on` derives keepAwake true (never idle-sleep,
   * synced to the provider); every other policy derives false. */
  async setLifecycle(ownerId: string, id: string, lifecycle: LifecyclePolicy): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    if (!LIFECYCLE_POLICIES.includes(lifecycle)) {
      throw new ControlError(`invalid lifecycle: ${lifecycle}`, "invalid");
    }
    // Enforce the env's lock (UI can be bypassed).
    const resolved = await resolveWithConfig(
      path.join(this.config.environmentsRoot, rec.environmentName),
    ).catch(() => null);
    if (resolved?.lifecycle.locked && lifecycle !== resolved.lifecycle.default) {
      throw new ControlError(
        `this environment's lifecycle is locked to "${resolved.lifecycle.default}"`,
        "invalid",
      );
    }
    const keepAwake = lifecycle === "always-on";
    const provider = this.providerFor(rec.provider);
    await provider.setKeepAwake(id, keepAwake).catch(() => undefined);
    const updated = await this.store.update(id, { lifecycle, keepAwake });
    // The agent reads lifecycle from the spec to tell the owner what persists/sleeps —
    // push it so that guidance isn't stuck on the launch-time policy. Best-effort.
    await provider.patchPodSpec?.(id, { lifecycle }).catch(() => undefined);
    return updated;
  }

  /** Set a pod's display name (owner-scoped). Empty/whitespace → null (falls back
   * to the slug). Trimmed and length-capped. DB-only. */
  async setName(ownerId: string, id: string, name: string): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    const trimmed = name.trim().slice(0, 60);
    const updated = await this.store.update(id, { name: trimmed || null });
    // podName drives the in-pod remote-control/session title; push it so a rename isn't
    // stuck on the launch-time name until the pod is recreated. Best-effort.
    await this.providerFor(rec.provider)
      .patchPodSpec?.(id, { podName: trimmed || null })
      .catch(() => undefined);
    return updated;
  }

  /**
   * Add a SECOND agent of a different type to a live pod (multi-agent slice 3).
   *
   * Additive on purpose — the provider spawns it in its own window rather than
   * recreating the instance, so the agent already working in this pod keeps its
   * session. Recreating would kill the very session the user is adding a partner to.
   *
   * Constraints, all enforced here rather than in the UI:
   *  - different TYPE only (at most one claude-code + one codex). Two of a type share
   *    that CLI's config AND ~/work, and would race.
   *  - must be declared by the pod's environment.
   *  - idempotent: adding an agent the pod already runs is a no-op, never a 2nd spawn.
   */
  async addAgent(ownerId: string, id: string, agent: string): Promise<PodRecord> {
    if (agent !== "claude-code" && agent !== "codex") {
      throw new ControlError(`unknown agent: ${agent}`, "invalid");
    }
    const rec = await this.owned(ownerId, id);
    // A pod whose row predates per-pod agent recording has agents = null/[] while
    // still RUNNING its environment's primary. Treating that as "no agents" made
    // the add REPLACE the primary rather than join it: the record became ["codex"],
    // the cockpit lost Claude's card entirely and offered to "add" the agent the
    // pod was already running (live find: cheerful-donkey-6bc4, 2026-07-29).
    // So seed from the environment when the record is empty.
    let current = rec.agents ?? [];
    if (current.length === 0) {
      const seedDir = path.join(this.config.environmentsRoot, rec.environmentName);
      const seeded = await resolveWithConfig(seedDir).catch(() => null);
      current = seeded?.agents?.length ? [seeded.agents[0]] : [];
    }
    // Idempotent AND healing: when the DB already lists the agent, still ask the
    // provider — pod-side the spawn is idempotent by window name, so this is a
    // no-op when the window exists and a REPAIR when it was lost (e.g. a pod
    // updated before spec.agents was kept current; live find, pod "ttt"). The
    // early return here left the UI with no way to fix a DB-says-yes /
    // pod-says-no divergence.
    if (current.includes(agent)) {
      if (rec.status === "running") {
        const prov = this.providerFor(rec.provider);
        if (typeof prov.addAgent === "function") await prov.addAgent(id, agent);
      }
      return rec;
    }

    const envDir = path.join(this.config.environmentsRoot, rec.environmentName);
    const resolved = await resolveWithConfig(envDir).catch(() => null);
    if (!resolved) {
      throw new ControlError(`environment "${rec.environmentName}" did not resolve`, "invalid");
    }
    if (!resolved.agents.includes(agent)) {
      throw new ControlError(
        `environment "${rec.environmentName}" does not offer ${agent}`,
        "invalid",
      );
    }
    if (rec.status !== "running") {
      throw new ControlError("the pod must be running to add an agent", "invalid");
    }

    const prov = this.providerFor(rec.provider);
    if (typeof prov.addAgent !== "function") {
      throw new ControlError("this pod's provider cannot add an agent", "invalid");
    }
    await prov.addAgent(id, agent);
    const updated = await this.store.update(id, { agents: [...current, agent] });
    await this.emit(rec, "agent_added", { agent });
    return updated;
  }

  /** Turn the pod's recent watchdog repairs into pod events, once each. */
  /**
   * Drain what a pod learned about fetching, and push back the fleet's plan.
   *
   * Rides the reconcile poll that already runs, for the same reason repairs do: the
   * pod never calls us, so nothing here needs a per-pod credential. Best-effort
   * throughout — a pod that cannot be reached simply keeps its buffer and its
   * last plan, and both are designed to degrade rather than fail.
   */
  private async exchangeFetchMemory(rec: PodRecord, prov: SandboxProvider): Promise<void> {
    if (!this.fetchMemory) return;
    if (typeof prov.drainFetchReports === "function") {
      const reports = await prov.drainFetchReports(rec.id).catch(() => []);
      for (const r of reports) {
        // One bad row must not discard a whole pod's drain.
        await this.fetchMemory
          .record(rec.ownerId, r.domain, r.rung as never, r.outcome as never)
          .catch(() => undefined);
      }
    }
    if (typeof prov.pushFetchPlan === "function") {
      // The whole table, not a delta: it is small (domain, rung, outcome) and a pod
      // that missed a push would otherwise carry a silently partial plan.
      // Single-sourced with the control socket via FetchMemory.fleetPlan.
      const plan = await this.fetchMemory.fleetPlan(rec.ownerId, 500).catch(() => ({ domains: {} }));
      await prov.pushFetchPlan(rec.id, plan).catch(() => undefined);
    }
  }

  /**
   * Drain a pod's message outbox and route each message to a recipient IN THE SAME
   * OWNER'S FLEET, as pending.
   *
   * Rides the reconcile poll for the same reason fetch-memory does: the pod never calls
   * us, so nothing here needs a per-pod credential. The sender is attributed from the
   * drained pod (`rec.id`) — the outbox line's own claim of who it is from is ignored,
   * so a pod cannot forge its identity. A recipient outside the owner's fleet (a foreign
   * pod, or one that does not exist) is dropped: never routed, never leaked. Best-effort
   * throughout — an unreachable pod keeps its outbox for a later poll.
   */
  private async exchangeMessages(rec: PodRecord, prov: SandboxProvider): Promise<void> {
    if (!this.agentMessages) return;
    // Keep the pod's fleet roster fresh so `podbay msg pods` and the CLI's local
    // resolution have something to work from — pushed, because the pod has no outbound
    // credential (same rail as the fetch-plan).
    await this.rosterFor(rec.ownerId)
      .then((fleet) => pushFleetRoster(prov, rec.id, fleet))
      .catch(() => undefined);

    const outbox = await drainOutbox(prov, rec.id).catch(() => [] as OutboxLine[]);
    // Resolve against the owner's OTHER pods (never yourself), the full fleet minus self.
    const fleet = (await this.store.listByOwner(rec.ownerId).catch(() => []))
      .filter((p) => p.id !== rec.id && p.status !== "gone" && p.status !== "destroying")
      .map<PodRef>((p) => ({ id: p.id, name: p.name }));
    // Ack-based drain: only delete the batch once EVERY line is durably handled. A line that
    // throws (transient DB error) leaves the batch in `.draining` so the next reconcile re-emits
    // it — the message-id PK makes the already-recorded ones no-ops. This is what stops a "queued"
    // message being lost when the insert fails after the drain.
    let allHandled = true;
    for (const line of outbox) {
      try {
        const res = resolvePodRef(fleet, line.to);
        if (res.kind !== "ok") {
          // Ambiguous or unknown: tell the sender rather than dropping silently.
          await this.bounce(rec, line, res, fleet);
          continue;
        }
        // Rate guard: throttle a sender→recipient pair that exceeds the cap in the window,
        // so two autonomous agents cannot ping-pong unbounded. Bounce so the sender knows.
        const since = new Date(Date.now() - MSG_RATE_WINDOW_MS);
        const recent = await this.agentMessages.pairCountSince(rec.ownerId, rec.id, res.id, since);
        if (recent >= MSG_PAIR_CAP) {
          await this.bounceRate(rec, line, res.id);
          continue;
        }
        const created = line.at ? new Date(line.at) : undefined;
        await this.agentMessages.route({
          id: line.id,
          ownerId: rec.ownerId,
          fromPod: rec.id,
          toPod: res.id,
          body: line.body,
          createdAt: created && !Number.isNaN(created.getTime()) ? created : undefined,
        });
      } catch (e) {
        // One bad/undeliverable line must not discard the rest of the drain — but a throw here is
        // a TRANSIENT failure (e.g. the DB insert), so withhold the ack and retry the whole batch.
        allHandled = false;
        this.log.warn("msg_route_failed", { podId: rec.id, err: (e as Error).message });
      }
    }
    // Every line landed (routed or bounced) → safe to remove the drained batch. If not, leave it
    // for the next pass (re-emit + PK-dedup). Nothing to ack when there was no batch.
    if (outbox.length && allHandled) await confirmDrain(prov, rec.id).catch(() => undefined);

    // Delivery: this pod is running and being reconciled, so wake it with anything
    // pending FOR it. Gated on the agent being able to take a turn — a busy/shell/dialog
    // pane defers (nothing injected, stays pending) and a suspended recipient never
    // reaches here (reconcile only calls us for a running pod), so it is delivered on
    // its next wake. Mark delivered only for ids actually injected → at-most-once.
    const inbound = await this.agentMessages.pendingFor(rec.ownerId, rec.id).catch(() => []);
    if (inbound.length) {
      const delivered = await deliverMessages(prov, rec.id, inbound).catch(() => [] as string[]);
      for (const id of delivered) {
        await this.agentMessages.markDelivered(id).catch(() => undefined);
      }
      if (delivered.length) this.log.info("msg_delivered", { podId: rec.id, count: delivered.length });
    }
  }

  /** The owner's pods as addressing targets (slug + display name, self marked) — the
   * roster pushed to each pod and the fleet the service resolves refs against. Cross-owner
   * pods are structurally absent, which is what makes cross-owner messaging impossible. */
  private async rosterFor(ownerId: string): Promise<{ id: string; name: string | null }[]> {
    return (await this.store.listByOwner(ownerId).catch(() => []))
      .filter((p) => p.status !== "gone" && p.status !== "destroying")
      .map((p) => ({ id: p.id, name: p.name }));
  }

  /** Route a system notice back to the SENDER when its message could not be delivered
   * (ambiguous or unknown recipient), so a loose reference never fails silently. The
   * bounce id is derived from the original so a re-drained outbox bounces at most once. */
  private async bounce(rec: PodRecord, line: OutboxLine, res: { kind: "ambiguous"; candidates: PodRef[] } | { kind: "none" }, fleet: PodRef[]): Promise<void> {
    if (!this.agentMessages) return;
    const label = (p: PodRef) => (p.name ? `${p.name} (${p.id})` : p.id);
    const body =
      res.kind === "ambiguous"
        ? `Couldn't deliver your message: "${line.to}" matches ${res.candidates.length} of your pods — ` +
          `${res.candidates.map(label).join(", ")}. Resend with a more specific name or the exact slug.`
        : `Couldn't deliver your message: no pod in your fleet matches "${line.to}". ` +
          (fleet.length ? `Your pods: ${fleet.map(label).join(", ")}.` : `You have no other pods to message.`);
    await this.agentMessages
      .route({ id: `bounce_${line.id}`, ownerId: rec.ownerId, fromPod: SYSTEM_SENDER, toPod: rec.id, body })
      .catch(() => undefined);
  }

  /** Bounce when a sender→recipient pair is over the rate cap. */
  private async bounceRate(rec: PodRecord, line: OutboxLine, toId: string): Promise<void> {
    if (!this.agentMessages) return;
    const mins = Math.round(MSG_RATE_WINDOW_MS / 60000);
    await this.agentMessages
      .route({
        id: `bounce_${line.id}`,
        ownerId: rec.ownerId,
        fromPod: SYSTEM_SENDER,
        toPod: rec.id,
        body:
          `Rate limit: too many messages to "${toId}" in the last ${mins} minutes ` +
          `(cap ${MSG_PAIR_CAP}). Your message was not delivered — slow down and try again shortly.`,
      })
      .catch(() => undefined);
  }

  /**
   * Turn what a pod reports about itself — repairs and OOM kills — into persisted events,
   * once each. One health fetch per pass; the reconcile calls this while it already has
   * the provider in hand.
   */
  private async ingestRepairs(rec: PodRecord, prov: SandboxProvider): Promise<void> {
    if (typeof prov.podHealth !== "function") return;
    const health = await prov.podHealth(rec.id).catch(() => null);
    if (!health) return;
    const repairs = health.repairs ?? [];
    const ooms = health.ooms ?? [];
    if (repairs.length === 0 && ooms.length === 0) return;
    const events = await this.store.listEvents(rec.id).catch(() => []);

    // Repairs: compare each repair's OWN timestamp against ones already recorded (meta.at)
    // — NOT the event's recording time, which is always later, and would suppress most.
    if (repairs.length) {
      const lastAt = events
        .filter((e) => e.type === "pod_repaired")
        .reduce<string>((m, e) => {
          const at = typeof e.meta?.at === "string" ? e.meta.at : "";
          return at > m ? at : m;
        }, "");
      for (const r of repairs) {
        if (lastAt && r.at <= lastAt) continue; // already recorded
        const base = { target: r.target, reason: r.reason, at: r.at, ...(r.cause ? { cause: r.cause } : {}) };
        const meta = await this.attachDoctorIfCritical(rec, prov, "pod_repaired", base);
        await this.emit(rec, "pod_repaired", meta);
        this.alertIfCritical(rec, "pod_repaired", meta);
      }
    }

    // OOM kills: deduped by the kernel `ktime` (stable per boot) — the pod reports a
    // bounded rolling history on every fetch, so we skip ones already recorded.
    if (ooms.length) {
      const seen = new Set(
        events
          .filter((e) => e.type === "oom_killed")
          .map((e) => (typeof e.meta?.ktime === "number" ? e.meta.ktime : -1)),
      );
      for (const o of ooms) {
        if (seen.has(o.ktime)) continue;
        const base = { victim: o.victim, rss: o.rssMb, victimIsAgent: o.victimIsAgent, ktime: o.ktime, at: o.at };
        const meta = await this.attachDoctorIfCritical(rec, prov, "oom_killed", base);
        await this.emit(rec, "oom_killed", meta);
        this.alertIfCritical(rec, "oom_killed", meta);
      }
    }
  }

  /**
   * On a CRITICAL incident, capture a read-only (`check`) doctor snapshot and attach a
   * compact form to the event's `meta` (§2) — a diagnostic frozen at the moment of
   * trouble. No migration: `pod_events.meta` is jsonb. Best-effort + time-bounded so it
   * never stalls the reconcile sweep, and only runs for a critical incident being
   * recorded for the FIRST time (the emit is already deduped) — so doctor runs at most
   * once per incident.
   */
  private async attachDoctorIfCritical(
    rec: PodRecord,
    prov: SandboxProvider,
    type: string,
    meta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const inc = classifyEvent(type, meta);
      if (inc.severity !== "critical" || !inc.unplanned) return meta;
      if (typeof prov.runDoctor !== "function") return meta;
      const report = await Promise.race<DoctorReport | null>([
        prov.runDoctor(rec.id, "check"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
      ]).catch(() => null);
      if (!report) return meta;
      return {
        ...meta,
        // Compact: count + each issue's id/severity/title, dropping the verbose detail
        // so the event row stays small.
        doctor: {
          checked: report.checked,
          issues: report.issues.map((i) => ({ id: i.id, severity: i.severity, title: i.title })),
        },
      };
    } catch {
      return meta;
    }
  }

  /** Page the admin for a CRITICAL unplanned incident, deduped per pod+type (1h) so an
   * OOM loop is one alert. Best-effort — a notification must never break the reconcile. */
  private alertIfCritical(rec: PodRecord, type: string, meta: Record<string, unknown>): void {
    try {
      const inc = classifyEvent(type, meta);
      if (inc.severity !== "critical" || !inc.unplanned) return;
      const key = `${rec.id}:${type}`;
      const now = Date.now();
      if (now - (this.incidentAlertedAt.get(key) ?? 0) < 60 * 60_000) return;
      this.incidentAlertedAt.set(key, now);
      this.config.onIncident?.({ podId: rec.id, ownerId: rec.ownerId, title: inc.title });
    } catch {
      /* best-effort */
    }
  }

  /**
   * The daily WARNINGS digest (§7): a single ops summary of every unplanned WARN
   * incident in `[sinceMs, now)` across the fleet — criticals already page immediately,
   * so warnings batch here instead of one message each. Returns null when there were
   * none (the caller sends nothing). Best-effort classification, like the rest.
   */
  async buildWarnDigest(sinceMs: number, now = Date.now()): Promise<string | null> {
    const [events, pods] = await Promise.all([this.listAllEvents(), this.listAllPods()]);
    const nameById = new Map(pods.map((p) => [p.id, p.name] as const));
    const items = events
      .filter((e) => {
        const t = Date.parse(e.at);
        return t >= sinceMs && t < now;
      })
      .map((e) => ({ e, inc: classifyEvent(e.type, e.meta) }))
      .filter(({ inc }) => inc.unplanned && inc.severity === "warn")
      .map(({ e, inc }) => ({ podId: e.podId, podName: nameById.get(e.podId) ?? null, title: inc.title }));
    return formatWarnDigest(items);
  }

  /** Toggle preview URL visibility (owner-only ↔ public). DB-only; the gateway
   * reads the flag to decide whether a preview request needs authentication. */
  async setPreviewPublic(ownerId: string, id: string, previewPublic: boolean): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    const updated = await this.store.update(id, { previewPublic });
    // Keep the in-pod spec fresh so `podbay info`/`podbay visibility` (which read
    // /etc/podbay/pod-spec.json) don't report the launch-time value. Best-effort.
    await this.providerFor(rec.provider)
      .patchPodSpec?.(id, { previewPublic })
      .catch(() => undefined);
    return updated;
  }

  /** Fleet-updates (C): the pod's auto-update opt-out. "off" excludes it from the "update idle pods"
   * bulk action (a pod running a service the owner updates deliberately); "inherit" includes it. */
  async setAutoUpdate(ownerId: string, id: string, autoUpdate: "inherit" | "off"): Promise<PodRecord> {
    await this.owned(ownerId, id);
    return this.store.update(id, { autoUpdate });
  }

  /** Fleet-updates (A): pods eligible for a bulk idle-update — behind the pinned image, running, NOT
   * excluded (autoUpdate="off"), and genuinely IDLE (agent idle now AND no real activity for
   * `dwellMs`, so an agent merely paused between turns isn't interrupted). `pin` is the image-digest
   * pin (the web reads it from env, provider-specific); a null pin makes nothing eligible. */
  async updatableIdlePods(ownerId: string, pin: string | null, dwellMs: number): Promise<string[]> {
    if (!pin) return [];
    const now = Date.now();
    const [pods, live] = await Promise.all([this.listPods(ownerId), this.ownerLiveSignals(ownerId)]);
    const liveBy = new Map(live.map((l) => [l.id, l]));
    return pods
      .filter((p) => {
        // Compare CANONICAL short forms: the pin is a 12-char fingerprint while a pod row may be the
        // full 64-char one (or vice-versa), so a raw === falsely marks a current pod "behind" (same
        // format bug as the update dialog's "nothing changed", 2026-08-18).
        const short = (d: string): string => (d.startsWith("sha256:") ? d.slice(7, 19) : d.slice(0, 12));
        if (!p.imageDigest || short(p.imageDigest) === short(pin)) return false; // not behind
        if (p.status !== "running" || p.updatingSince) return false; // must be up + not already updating
        if (p.autoUpdate === "off") return false; // owner excluded it (C)
        // Idle across ALL the pod's agents — not just Claude. Requiring agentStatus==="idle" skipped
        // codex-only pods (their Claude agentStatus is null). Eligible = at least one agent
        // AFFIRMATIVELY idle AND neither agent busy/working (so a busy codex still blocks an update).
        const l = liveBy.get(p.id);
        const someIdle = l?.agentStatus === "idle" || l?.codexStatus === "idle";
        const anyBusy =
          l?.agentStatus === "busy" ||
          l?.agentStatus === "waiting" ||
          l?.agentStatus === "shell" ||
          l?.codexStatus === "busy";
        if (!someIdle || anyBusy) return false; // not idle right now
        if (now - Date.parse(p.lastActiveAt) < dwellMs) return false; // …and idle for the dwell window
        return true;
      })
      .map((p) => p.id);
  }

  /** Fleet-updates (A): start an image update on every eligible idle pod. Kicks each off sequentially
   * (startPodImageUpdate returns immediately; the recreate runs async) so we don't burst the box, and
   * re-checks eligibility server-side — never trusts a client-supplied list. */
  async updateIdlePods(
    ownerId: string,
    pin: string | null,
    dwellMs: number,
    image: string,
  ): Promise<{ started: string[] }> {
    const slugs = await this.updatableIdlePods(ownerId, pin, dwellMs);
    const started: string[] = [];
    for (const id of slugs) {
      try {
        await this.startPodImageUpdate(ownerId, id, image);
        started.push(id);
      } catch (e) {
        this.log.warn("bulk_update_pod_failed", { id, err: String(e) });
      }
    }
    return { started };
  }

  /** Record that the owner has seen the post-create connect walkthrough, so it never
   * re-runs. Idempotent — the first timestamp stands. */
  async markWalkthroughSeen(ownerId: string, id: string): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    if (rec.walkthroughSeenAt) return rec;
    return this.store.update(id, { walkthroughSeenAt: new Date().toISOString() });
  }

  /** Whether the owner's pod has a working GitHub login (private-repo clones). */
  async githubStatus(ownerId: string, id: string): Promise<{ connected: boolean; login: string | null }> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).githubStatus(id);
  }

  /** Secrets the agent asked the owner for, from inside their pod (names + reason
   * only). Owner-scoped, so one owner cannot read another's requests. */
  async secretRequests(ownerId: string, id: string): Promise<{ key: string; description: string; at: string }[]> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).secretRequests(id);
  }

  /** Install a GitHub token (from the web device flow) into the owner's pod. */
  async setGithubToken(ownerId: string, id: string, token: string): Promise<{ login: string }> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).setGithubToken(id, token);
  }

  /** The owner's GitHub repos, listed with the pod's own credentials (add-repo flow). */
  async listPodRepos(ownerId: string, id: string): Promise<GithubRepo[]> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).listRepos(id);
  }

  /** Clone a repo into the owner's pod ~/work — only when empty (one pod = one repo). */
  async cloneRepoIntoPod(
    ownerId: string,
    id: string,
    repo: string,
    force = false,
  ): Promise<CloneResult> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).cloneRepo(id, repo, force);
  }

  /** Forget the owner's pod GitHub login (cockpit "Disconnect", confirmed). */
  async clearGithubToken(ownerId: string, id: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    await this.providerFor(rec.provider).clearGithubToken(id);
  }

  /** Begin an IN-POD GitHub device login (self-host): the pod runs the OAuth device flow itself. */
  async startGhLogin(ownerId: string, id: string): Promise<GhDeviceStart> {
    const rec = await this.owned(ownerId, id);
    const p = this.providerFor(rec.provider);
    if (!p.startGhLogin) throw new ControlError("in-pod GitHub login isn't available for this pod", "invalid");
    return p.startGhLogin(id);
  }

  /** Poll the in-pod GitHub device login; installs the token in the pod once GitHub authorizes. */
  async pollGhLogin(ownerId: string, id: string, deviceCode: string): Promise<GhDevicePoll> {
    const rec = await this.owned(ownerId, id);
    const p = this.providerFor(rec.provider);
    if (!p.pollGhLogin) throw new ControlError("in-pod GitHub login isn't available for this pod", "invalid");
    return p.pollGhLogin(id, deviceCode);
  }

  /** Mint a short-lived Codex pairing code for the owner's pod (cockpit hand-off).
   * On demand — the code is spent quickly and a daemon restart invalidates it, so it
   * is never persisted. */
  async codexPair(ownerId: string, id: string): Promise<CodexPairing> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).codexPair(id);
  }

  /** Record that the owner confirmed pairing a device (self-reported — see
   * PodRecord.codexDevices). Appends, so several devices can be listed; the name is
   * whatever the owner calls it. Trimmed + capped, and deduped by name so repeated
   * confirmations don't pile up. */
  async confirmCodexDevice(ownerId: string, id: string, name: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    const clean = (name || "").trim().slice(0, 40) || "A device";
    const existing = (rec.codexDevices ?? []).filter((d) => d.name !== clean);
    const next = [...existing, { name: clean, at: new Date().toISOString() }].slice(-5);
    await this.store.update(id, { codexDevices: next });
  }

  /** Forget a confirmed device (the owner unpaired it, or mislabelled it). */
  async forgetCodexDevice(ownerId: string, id: string, name: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    const next = (rec.codexDevices ?? []).filter((d) => d.name !== name);
    await this.store.update(id, { codexDevices: next });
  }

  /** Is the owner's Codex pod registered for remote control (daemon up)? */
  /** Per-agent truth from the pod (multi-agent cockpit cards). Empty array when
   * the pod is unreachable or predates per-agent reporting — the UI degrades to
   * the legacy pod-level signals rather than guessing. */
  /** ONE read of what the pod says about itself. Surfaces derive from this rather
   * than each fetching /healthz separately — three reads of one endpoint could
   * disagree about a pod at a single moment, and a fleet view would multiply it. */
  async podHealth(ownerId: string, id: string): Promise<PodHealth> {
    const rec = await this.owned(ownerId, id);
    return this.readHealth(rec);
  }

  private async readHealth(rec: PodRecord): Promise<PodHealth> {
    const empty: PodHealth = { agents: [], issues: [], repairs: [], repairGaveUp: [] };
    if (rec.status !== "running") return empty;
    return this.providerFor(rec.provider)
      .podHealth(rec.id)
      .catch(() => empty);
  }

  async agentStates(ownerId: string, id: string): Promise<PodAgentState[]> {
    return (await this.podHealth(ownerId, id)).agents;
  }

  /** Send the sign-in code the owner pasted in the cockpit to a specific agent's
   * window. Window-targeted rather than "type into the terminal", so it lands on
   * the right CLI on a two-agent pod. */
  async sendAgentInput(ownerId: string, id: string, agent: string, text: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running") {
      throw new ControlError("the pod must be running to sign an agent in", "invalid");
    }
    if (!(rec.agents ?? []).some((a) => a === agent)) {
      throw new ControlError(`this pod does not run ${agent}`, "invalid");
    }
    await this.providerFor(rec.provider).sendAgentInput(id, agent, text);
  }

  /** Run the pod's doctor, owner-scoped. `fix` applies the SAFE repairs only —
   * anything invasive stays behind its own confirmation in the UI. */
  async runDoctor(ownerId: string, id: string, mode: DoctorMode): Promise<DoctorReport> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running") {
      throw new ControlError("the pod must be running for doctor to check it", "invalid");
    }
    const report = await this.providerFor(rec.provider).runDoctor(id, mode);
    if (mode !== "check" && report.issues.some((i) => i.fixed)) {
      await this.emit(rec, "pod_repaired", {
        by: "doctor",
        mode,
        fixed: report.issues.filter((i) => i.fixed).map((i) => i.id),
        at: new Date().toISOString(),
      });
    }
    return report;
  }

  /** What the pod says is wrong with it. Owner-scoped; empty when healthy, asleep,
   * unreachable, or running an image too old to report. */
  async podIssues(ownerId: string, id: string): Promise<PodIssue[]> {
    return (await this.podHealth(ownerId, id)).issues;
  }

  private liveSignalsCache = new Map<string, { at: number; rows: PodLiveSignals[] }>();

  /**
   * Live signals for the OWNER's dashboard cards — ONE row per pod. Every row carries
   * the pod's current LIFECYCLE status (so the card reflects a server-side transition
   * like an update starting on the next poll, not only on a full reload); RUNNING pods
   * additionally get one /healthz read (agent activity, :3000 liveness, live-critical
   * trouble), bounded in parallel. Cached briefly per owner (the client polls this).
   *
   * Failure shows as `unreachable`, and every live signal degrades to null/unknown —
   * a card must render from lifecycle status alone when the pod can't answer, never
   * claim "no app on :3000" or "idle" it didn't hear from the pod.
   */
  async ownerLiveSignals(ownerId: string, opts: { maxAgeMs?: number } = {}): Promise<PodLiveSignals[]> {
    const maxAge = opts.maxAgeMs ?? 10_000;
    const cached = this.liveSignalsCache.get(ownerId);
    if (cached && Date.now() - cached.at < maxAge) return cached.rows;

    const owned = (await this.store.list()).filter((p) => p.ownerId === ownerId);
    const base = (p: (typeof owned)[number]) => ({
      id: p.id,
      status: p.status,
      updating: Boolean(p.updatingSince),
    });
    const rows: PodLiveSignals[] = [];
    const CONCURRENCY = 6;
    for (let i = 0; i < owned.length; i += CONCURRENCY) {
      const batch = owned.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          // Only RUNNING pods get a health probe; others carry lifecycle only.
          if (p.status !== "running") {
            return {
              ...base(p),
              agentStatus: null,
              codexStatus: null,
              agentWaitingFor: null,
              agents: [],
              appListening: null,
              criticalIssue: null,
              unreachable: false,
            } satisfies PodLiveSignals;
          }
          try {
            const prov = this.providerFor(p.provider);
            const h = await prov.podHealth(p.id);
            const critical = h.issues.find((x) => x.severity === "critical" && !x.agent) ?? null;
            // Preview truth: healthz.appListening is the cheap path (new images). On an
            // image that predates it, fall back to the METRICS app.listening probe — the
            // SAME source the cockpit's preview card uses (getPodAppListening → podMetrics),
            // so the card and the cockpit never disagree, even on un-updated pods.
            let appListening = typeof h.appListening === "boolean" ? h.appListening : null;
            if (appListening === null) {
              const m = await prov.fetchMetrics(p.id).catch(() => null);
              if (m?.app && typeof m.app.listening === "boolean") appListening = m.app.listening;
            }
            return {
              ...base(p),
              agentStatus: h.agentStatus ?? null,
              codexStatus: h.codexStatus ?? null,
              agentWaitingFor: h.agentWaitingFor ?? null,
              agents: h.agents.map((a) => ({ id: a.id, authed: a.authed })),
              appListening,
              criticalIssue: critical ? { title: critical.title, detail: critical.detail } : null,
              unreachable: false,
            } satisfies PodLiveSignals;
          } catch {
            return {
              ...base(p),
              agentStatus: null,
              codexStatus: null,
              agentWaitingFor: null,
              agents: [],
              appListening: null,
              criticalIssue: null,
              unreachable: true,
            } satisfies PodLiveSignals;
          }
        }),
      );
      rows.push(...results);
    }
    this.liveSignalsCache.set(ownerId, { at: Date.now(), rows });
    return rows;
  }

  /** The cockpit's Codex remote-control switch. OFF persists on the pod until
   * switched back on (boot/wake hooks honor it). */
  async setCodexRc(ownerId: string, id: string, on: boolean): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running") {
      throw new ControlError("the pod must be running to switch remote control", "invalid");
    }
    await this.providerFor(rec.provider).setCodexRc(id, on);
    await this.emit(rec, "codex_rc_toggled", { on });
  }

  async codexRcActive(ownerId: string, id: string): Promise<boolean> {
    const rec = await this.owned(ownerId, id);
    return this.providerFor(rec.provider).codexRcActive(id);
  }

  /** Read the cockpit-editable slice of the pod's ~/.claude/settings.json. Best-effort: a pod with
   * no file (or a garbled one) yields {} so the UI falls back to Claude's defaults. */
  async getClaudeSettings(ownerId: string, id: string): Promise<ClaudeSettings> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running")
      throw new ControlError("the pod must be running to read Claude settings", "invalid");
    const r = await this.providerFor(rec.provider).exec(id, [
      "cat",
      "/home/dev/.claude/settings.json",
    ]);
    if (r.exitCode !== 0 || !r.stdout.trim()) return {};
    try {
      return pickClaudeSettings(JSON.parse(r.stdout));
    } catch {
      return {};
    }
  }

  /** Merge a validated patch into ~/.claude/settings.json IN the pod, preserving every podbay-managed
   * key (permissions, hooks, …). `null` for a key resets it to Claude's default. Returns the fresh
   * settings so the cockpit re-renders from the file that was actually written. */
  async saveClaudeSettings(
    ownerId: string,
    id: string,
    patch: ClaudeSettings,
  ): Promise<ClaudeSettings> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running")
      throw new ControlError("the pod must be running to change Claude settings", "invalid");
    const clean = validateClaudeSettings(patch); // throws ControlError on bad input
    const b64 = Buffer.from(JSON.stringify(clean), "utf8").toString("base64");
    const r = await this.providerFor(rec.provider).exec(id, [
      "python3",
      "-c",
      CLAUDE_SETTINGS_MERGE_PY,
      b64,
    ]);
    if (r.exitCode !== 0 || !r.stdout.includes("OK"))
      throw new Error(
        `couldn't save Claude settings: ${(r.stderr || r.stdout || "no output").trim().slice(0, 200)}`,
      );
    await this.emit(rec, "claude_settings_changed", { keys: Object.keys(clean) });
    return this.getClaudeSettings(ownerId, id);
  }


  /** Live config-refresh (docs/plans/live-config-refresh.md): push the CURRENT env `.claude` layer +
   * skills + freshly-resolved permissions into a RUNNING pod and re-apply them WITHOUT a recreate or
   * an agent restart. The same fresh resolve as an image update (`buildInitFiles` + `resolveWithConfig`),
   * but delivered via `provider.refreshConfig` instead of `updateImage`. Cloud-shaped (incus) and
   * self-host (local) both implement it; a provider without the capability, or a pod on an image that
   * predates the in-pod refresh script, reports `refreshed:false` with a note (delivery still happened).
   * Emits `config_refreshed`. Gated on a running pod. */
  async refreshPodConfig(ownerId: string, id: string): Promise<{ refreshed: boolean; note?: string }> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running")
      throw new ControlError("the pod must be running to refresh its config", "invalid");
    const provider = this.providerFor(rec.provider);
    if (!provider.refreshConfig)
      throw new ControlError("this pod's provider can't refresh config in place", "invalid");
    const payload = await this.resolveConfigPayload(rec);
    const result = await provider.refreshConfig(id, {
      claudeFiles: payload.claudeFiles,
      permissions: payload.permissions,
    });
    // Record the delivered hash so the drift sweep treats the pod as in-sync (skip on a resolve
    // failure — we didn't actually deliver the current layer, so don't claim we did).
    if (payload.hash) await this.store.update(id, { configHash: payload.hash }).catch(() => undefined);
    await this.emit(rec, "config_refreshed", {
      refreshed: result.refreshed,
      files: payload.claudeFiles?.length ?? 0,
      ...(result.note ? { note: result.note } : {}),
    });
    return result;
  }

  /**
   * Resolve a pod's CURRENT `.claude`/skills/permissions layer FRESH (the same resolve an image
   * update does) + a stable hash of it. The hash is what drift-detection compares: it changes iff
   * the delivered bytes change. Best-effort — an env renamed out from under a live pod yields an
   * undefined payload + null hash (deliver nothing, claim nothing) rather than throwing.
   */
  private async resolveConfigPayload(
    rec: PodRecord,
  ): Promise<{ claudeFiles?: { guest_path: string; raw_value: string }[]; permissions?: unknown; hash: string | null }> {
    try {
      const envDir = path.join(this.config.environmentsRoot, rec.environmentName);
      const resolved = await resolveWithConfig(envDir);
      const permissions = resolved.permissions;
      const files = await buildInitFiles({
        id: rec.id,
        resolved,
        envDir,
        name: rec.name ?? undefined,
        githubRepo: rec.githubRepo ?? undefined,
        agents: (rec.agents as never) ?? undefined,
      });
      const claudeFiles = files.filter((f) => f.guest_path.startsWith("/etc/podbay/claude/"));
      return { claudeFiles, permissions, hash: configLayerHash(claudeFiles, permissions) };
    } catch (e) {
      this.log.warn("refresh_claude_layer_resolve_failed", { podId: rec.id, err: e });
      return { hash: null };
    }
  }

  /**
   * Auto-sync a RUNNING pod's config when it has drifted from the env's current layer — the reconcile
   * hook that replaces the manual "Sync config" button. Rides the reconcile sweep (already rotating
   * over running pods, thundering-herd-safe), so an env/image change reaches every running pod within
   * one rotation, no button press. Semantics:
   *   - config_hash NULL (fresh pod, or a legacy row from before this feature): BASELINE to the
   *     current hash WITHOUT delivering — the pod already booted with its layer, so a no-op delivery
   *     would just add noise. (Trade-off: a pod whose env changed between its last delivery and this
   *     baseline is not re-synced until the NEXT change — a one-time rollout gap, not ongoing.)
   *   - hash present AND different → DELIVER the current layer in place + record the new hash + emit.
   *   - equal → nothing.
   * Best-effort and gated on a provider that can refresh; a persistently-failing pod is backed off
   * in-memory so it doesn't exec every sweep.
   */
  private async reconcileConfigDrift(rec: PodRecord, prov: SandboxProvider): Promise<void> {
    if (typeof prov.refreshConfig !== "function") return;
    const payload = await this.resolveConfigPayload(rec);
    if (!payload.hash) return; // env didn't resolve — nothing trustworthy to compare
    if (payload.hash === rec.configHash) return; // in sync
    if (rec.configHash === null) {
      // Baseline silently — the pod already has this layer from boot/last delivery.
      await this.store.update(rec.id, { configHash: payload.hash }).catch(() => undefined);
      return;
    }
    // Real drift. Back off a pod that keeps failing so we don't exec it every sweep.
    const now = Date.now();
    const last = this.configDriftAttempt.get(rec.id) ?? 0;
    if (last && now - last < CONFIG_DRIFT_BACKOFF_MS) return;
    this.configDriftAttempt.set(rec.id, now);
    const result = await prov.refreshConfig(rec.id, {
      claudeFiles: payload.claudeFiles,
      permissions: payload.permissions,
    });
    // Only record the new hash once the layer was actually delivered; a false record would suppress
    // future retries. `refreshed:false` (image predates the in-pod script) still DELIVERED the bytes,
    // so it counts as synced for hash purposes.
    await this.store.update(rec.id, { configHash: payload.hash }).catch(() => undefined);
    await this.emit(rec, "config_refreshed", {
      refreshed: result.refreshed,
      files: payload.claudeFiles?.length ?? 0,
      auto: true,
      ...(result.note ? { note: result.note } : {}),
    });
  }

  /** UNSCOPED lookup for preview routing (the requester may be anonymous when the
   * pod is public). Returns just what the gateway needs to make the auth + proxy
   * decision, or null if no such pod. Do NOT use for owner-scoped operations. */
  async lookupForPreview(
    id: string,
  ): Promise<{ podId: string; ownerId: string; previewPublic: boolean } | null> {
    const rec = await this.store.get(id);
    return rec ? { podId: rec.id, ownerId: rec.ownerId, previewPublic: rec.previewPublic } : null;
  }

  async destroy(ownerId: string, id: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    // Persist the state FIRST: teardown takes 10-20s (machine destroy + volume
    // detach retries) and the UI must keep showing "removing" across refreshes.
    await this.store.update(id, { status: "destroying" });
    try {
      await this.providerFor(rec.provider).destroy(id);
    } catch (e) {
      // Leave the row in "destroying" rather than resurrecting a broken pod;
      // a retry of destroy is idempotent.
      throw e;
    }
    // Emit BEFORE deleting the row: this closes the pod's final awake interval,
    // and it's the one event most likely to be wanted after the pod is gone
    // (what did this actually cost?). pod_events has no FK, so it survives.
    await this.emit(rec, "destroyed", { machineId: rec.machineId });
    await this.store.delete(id);
  }

  /**
   * Re-enqueue a FAILED pod for provisioning (owner-scoped). Resets the durable
   * job state to a fresh, unleased claim so the provisioner loop rebuilds it on
   * its next tick — createPod is idempotent by pod id, so any partial machine is
   * adopted rather than duplicated. Throws on a non-error pod so a stale Retry
   * button can't disturb a healthy one.
   */
  async retryProvision(ownerId: string, id: string): Promise<PodRecord> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "error") {
      throw new ControlError(`pod ${id} is not in a failed state`, "invalid");
    }
    return this.store.update(id, {
      status: "provisioning",
      provisionError: null,
      provisionAttempts: 0,
      provisionLeaseUntil: null,
    });
  }

  /** Live resource metrics for ONE pod (Stats tab), owner-scoped. Null when the
   * pod isn't running or its agent is unreachable / too old to serve /metrics. */
  async podMetrics(
    ownerId: string,
    id: string,
    windowMs?: number,
  ): Promise<MetricsSnapshot | null> {
    const rec = await this.owned(ownerId, id);
    if (rec.status !== "running") return null;
    return this.providerFor(rec.provider)
      .fetchMetrics(id, windowMs)
      .catch(() => null);
  }

  /**
   * Usage for ONE pod, derived from its event log. Owner-scoped (the cockpit's
   * Stats tab). Users see usage; cost stays in the backoffice (decided 2026-07-17).
   */
  async podUsage(ownerId: string, id: string): Promise<PodUsage | null> {
    const rec = await this.owned(ownerId, id);
    // Pass the pod's live status so a trailing interval the log couldn't observe
    // (a suspend from before the event log existed) reflects reality, not "running".
    return usageForPod(await this.store.listEvents(id), Date.now(), rec.status);
  }

  /**
   * Apply a new pod image IN PLACE, keeping the volume — `~/work`, the agent's
   * plan/data and the Claude login all survive (docs/plans/pre-alpha-plan.md P2.5).
   * A running pod cold-restarts (its live conversation ends; the agent resumes via
   * `claude --continue` + the greeter's resume nudge). A suspended pod is left
   * asleep and picks the image up on its next wake — we never wake one to update it.
   */
  /**
   * Start an image update and RETURN IMMEDIATELY. The recreate takes minutes
   * (stop → recreate → boot → re-push spec → agent ready); awaiting it inside a
   * server action held Next's action queue, which blocked every navigation in
   * the dashboard — the cockpit appeared frozen (reported 2026-07-24). The work
   * runs detached and reports progress through pod_events, which the cockpit
   * polls, so the UI stays live and can show the real stage + elapsed time.
   */
  async startPodImageUpdate(ownerId: string, id: string, image: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    // Mark the update in-flight ON THE ROW before returning. This is the render
    // source of truth: the pods list and the cockpit both read updatingSince, so
    // the pod shows "Updating…" straight from the backend and survives a
    // navigate-away/refresh — NOT client-only state (regression fixed 2026-07-24).
    await this.store.update(id, {
      updatingSince: new Date().toISOString(),
      updateStage: "starting",
      maintenanceKind: "update",
    });
    await this.emit(rec, "update_started", { to: image });
    // Detached on purpose: no await. Failures land as an update_failed event AND
    // clear the in-flight flag, so the UI reports them instead of the caller.
    void this.runPodImageUpdate(rec, id, image).catch(async (e) => {
      this.log.error("update_pod_image_failed", { podId: id, err: e });
      await this.store
        .update(id, { updatingSince: null, updateStage: null, maintenanceKind: null })
        .catch(() => undefined);
      await this.emit(rec, "update_failed", { error: (e as Error)?.message ?? String(e) });
    });
  }

  /** Whether an update is in flight for this pod, and the stage it's on — read
   * from the DURABLE row fields (updatingSince/updateStage), so it's consistent
   * with what the list shows and refresh-safe. Reconcile still owns `status`;
   * these fields are orthogonal. `error` is the last failure since the pod isn't
   * updating and its image is still behind (surfaced by the caller if wanted). */
  async podUpdateProgress(
    ownerId: string,
    id: string,
  ): Promise<{ active: boolean; stage: string | null; startedAt: string | null; error: string | null }> {
    const rec = await this.owned(ownerId, id);
    if (rec.updatingSince) {
      return { active: true, stage: rec.updateStage, startedAt: rec.updatingSince, error: null };
    }
    // Not updating: surface the most recent update_failed (if any) so the cockpit
    // can show why the last attempt didn't take, even after a reload.
    const events = await this.store.listEvents(id);
    const lastFailed = [...events].reverse().find((e) => e.type === "update_failed");
    return {
      active: false,
      stage: null,
      startedAt: null,
      error: lastFailed ? ((lastFailed.meta?.error as string) ?? "Update failed") : null,
    };
  }

  private async runPodImageUpdate(
    rec: PodRecord,
    id: string,
    image: string,
  ): Promise<PodRecord> {
    const from = rec.imageDigest;
    // Same as suspend: the recreate kills the agent mid-task. Ask for a handoff before
    // the provider touches the instance. This sits INSIDE the detached runner so the
    // brief wait is covered by the durable update-progress the cockpit already renders,
    // rather than making the owner's click feel hung.
    await this.store.update(id, { updateStage: "handoff" }).catch(() => undefined);
    await requestHandoff({ provider: this.providerFor(rec.provider), podId: id, log: this.log });
    // Resolve the env FRESH so the update delivers the CURRENT .claude layer
    // (skills/rules) to the pod — an update used to refresh only the image, so a
    // skill shipped after pod-creation never reached existing pods (2026-07-28).
    // Best-effort: an env renamed out from under a live pod must not fail its
    // image update — that pod just keeps its existing layer.
    let claudeFiles: { guest_path: string; raw_value: string }[] | undefined;
    // Freshly-resolved permission preset, so an update refreshes a pod's permissions from
    // current code instead of the frozen preset it was created with (see updateImage /
    // refreshSpecPermissions). Same resolve as the .claude layer below — one call.
    let permissions: unknown;
    try {
      const envDir = path.join(this.config.environmentsRoot, rec.environmentName);
      const resolved = await resolveWithConfig(envDir);
      permissions = resolved.permissions;
      const files = await buildInitFiles({
        id,
        resolved,
        envDir,
        name: rec.name ?? undefined,
        githubRepo: rec.githubRepo ?? undefined,
        agents: (rec.agents as never) ?? undefined,
      });
      claudeFiles = files.filter((f) => f.guest_path.startsWith("/etc/podbay/claude/"));
    } catch (e) {
      this.log.warn("update_claude_layer_resolve_failed", { podId: id, err: e });
    }
    const info = await this.providerFor(rec.provider).updateImage(
      id,
      image,
      (stage) => {
        // Persist the phase to the row (render truth) AND keep the event for audit.
        void this.store.update(id, { updateStage: stage }).catch(() => undefined);
        void this.emit(rec, "update_stage", { stage });
      },
      { claudeFiles, permissions },
    );
    const to = info.imageDigest ?? image.split("@")[1] ?? null;
    // The recreate just delivered this env's current layer — record its hash so the drift sweep
    // sees the pod as in-sync and doesn't redundantly re-deliver. Only when it resolved (null hash =
    // env didn't resolve = we delivered no layer, so leave the prior hash untouched).
    const cfgHash = configLayerHash(claudeFiles, permissions);
    const updated = await this.store.update(id, {
      imageDigest: to,
      ...(cfgHash ? { configHash: cfgHash } : {}),
      machineId: info.machineId ?? rec.machineId,
      status: info.status,
      // Update finished — clear the in-flight flag so the row stops reading
      // "updating" and the digest/status below become authoritative again.
      updatingSince: null,
      updateStage: null,
      maintenanceKind: null,
      // The pod restarts, so the OLD bridge session is dead. Clearing this stops
      // the cockpit handing out a link to a session that no longer exists;
      // reconcile repopulates it once the greeter re-enables RC.
      sessionUrl: null,
    });
    // Incus recreates the instance from a FRESH root fs on an image update, so
    // /etc/podbay/secrets.env is gone — re-inject from the vault (DB is the source
    // of truth; the app reads secrets at start, and the post-update restart picks
    // them up). Best-effort; a later reconcile/wake also re-injects.
    if (info.status === "running" && this.config.secretVault) {
      const keys = await this.config.secretVault.listKeys(id).catch(() => [] as string[]);
      if (keys.length > 0) await this.pushSecrets(id).catch(() => undefined);
    }
    // from→to is the rollback target and the failure detector (docs P2.5).
    await this.emit(rec, "updated", { from, to });
    return updated;
  }

  /** Bump lastActiveAt on terminal activity (no provider call). Owner-scoped. */
  async markActive(ownerId: string, id: string): Promise<void> {
    await this.owned(ownerId, id);
    await this.store.update(id, { lastActiveAt: new Date().toISOString() });
  }

  /**
   * Prune published base images beyond a retention count (image-manifest spec).
   * NEVER deletes an image that is in `protect` (e.g. the manifest's current) nor
   * one still referenced by a live pod's `imageDigest`; keeps the newest `keepRecent`
   * plus those. Returns the fingerprints it deleted so the caller can drop their
   * manifest rows. No-op if no provider manages a base-image store.
   */
  async pruneImages(opts: {
    keepRecent: number;
    protect: string[];
  }): Promise<{ deleted: string[]; kept: string[] }> {
    const provs = [this.provider, ...Object.values(this.config.providers ?? {})];
    const prov = provs.find((p) => p.listBaseImages && p.deleteBaseImage);
    if (!prov?.listBaseImages || !prov.deleteBaseImage) return { deleted: [], kept: [] };

    const images = (await prov.listBaseImages()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const referenced = new Set(
      (await this.store.list()).map((p) => p.imageDigest).filter((d): d is string => !!d),
    );
    const protect = new Set(opts.protect);
    const keep = new Set<string>();
    images.slice(0, Math.max(0, opts.keepRecent)).forEach((i) => keep.add(i.fingerprint));
    for (const i of images) {
      if (referenced.has(i.fingerprint) || protect.has(i.fingerprint)) keep.add(i.fingerprint);
    }
    const deleted: string[] = [];
    for (const img of images) {
      if (keep.has(img.fingerprint)) continue;
      try {
        await prov.deleteBaseImage(img.fingerprint);
        deleted.push(img.fingerprint);
      } catch (e) {
        this.log.warn("image_prune_delete_failed", { fingerprint: img.fingerprint, err: e });
      }
    }
    this.log.info("images_pruned", { deleted: deleted.length, kept: keep.size });
    return { deleted, kept: [...keep] };
  }

  /** Record that the pod's agent has logged in (onboarding milestone). Idempotent
   * — set once; a later re-login on the same pod doesn't move the timestamp. The
   * gateway calls this when it observes the authed status frame. */
  async recordAuthed(ownerId: string, id: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.authedAt) return;
    // Login done → the captured sign-in URL is spent; clear it so a stale link
    // never shows.
    await this.store.update(id, { authedAt: new Date().toISOString(), authUrl: null });
  }

  /** Record the Claude sign-in URL captured from the pod terminal during first
   * login (onboarding milestone), so the cockpit's Sign-in step shows it from
   * durable state and survives a refresh. Ignored once the pod is authed (the URL
   * is spent). Idempotent by value. */
  async recordAuthUrl(ownerId: string, id: string, authUrl: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.authedAt || rec.authUrl === authUrl) return;
    await this.store.update(id, { authUrl });
  }

  /** Record the pod's remote-control session deep link (onboarding milestone).
   * Idempotent for a given URL; the gateway calls this when it observes the
   * session URL in a links frame. Powers the durable "Open in Claude app". */
  async recordSessionUrl(ownerId: string, id: string, sessionUrl: string): Promise<void> {
    const rec = await this.owned(ownerId, id);
    if (rec.sessionUrl === sessionUrl) return;
    await this.store.update(id, { sessionUrl });
  }

  /** Validate launch-time secrets against the env's declared set: reject keys the
   * env doesn't declare (typo/injection guard), trim values and drop blanks. Returns
   * the cleaned values or undefined when empty. Required-ness is enforced in the
   * launch UI (Launch is disabled until required fields are filled), not here — the
   * server still allows launching with a required secret unset so the "run now, add
   * it later" path keeps working. Throws before any provisioning. */
  private validateLaunchSecrets(
    declared: { key: string; required: boolean }[],
    provided: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    const declaredKeys = new Set(declared.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(provided ?? {})) {
      if (!declaredKeys.has(key)) {
        throw new ControlError(`unknown secret for this environment: ${key}`, "invalid");
      }
      const v = (value ?? "").trim();
      if (v) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  // --- app secrets (opsx pod-secrets) ---

  /** The env's declared secrets crossed with which the owner has set (never the
   * values). Drives the write-only secrets panel. Owner-scoped. */
  async listSecrets(ownerId: string, podId: string): Promise<SecretStatus[]> {
    const rec = await this.owned(ownerId, podId);
    const declared = await this.declaredSecrets(rec.environmentName);
    const setKeys = this.config.secretVault
      ? new Set(await this.config.secretVault.listKeys(podId))
      : new Set<string>();
    const out: SecretStatus[] = declared.map((d) => ({
      key: d.key,
      description: d.description,
      required: d.required,
      set: setKeys.has(d.key),
      url: d.url,
      declared: true,
    }));
    // Surface any set-but-no-longer-declared key so the owner can still clear it —
    // EXCEPT the reserved BYO-repo clone token, which is internal plumbing, not a
    // user-facing app secret.
    const declaredKeys = new Set(declared.map((d) => d.key));
    for (const k of setKeys) {
      if (RESERVED_SECRET_KEYS.has(k)) continue;
      if (!declaredKeys.has(k))
        out.push({ key: k, description: null, required: false, set: true, url: null, declared: false });
    }
    return out;
  }

  /** Set an app secret for a pod (encrypted at rest). Owner-scoped. When the pod
   * is running, the new value is pushed live; otherwise it lands on next wake. */
  async setSecret(ownerId: string, podId: string, key: string, value: string): Promise<void> {
    const rec = await this.owned(ownerId, podId);
    if (!this.config.secretVault) throw new ControlError("secrets are not configured", "invalid");
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new ControlError(`invalid secret key: ${key}`, "invalid");
    }
    // Reserved namespace: PODBAY_* keys are platform-managed (the reserved agent API keys
    // `PODBAY_AGENT_*`, the `PODBAY_GH_CLONE_TOKEN`). They're hidden from the listing, but the
    // owner could still WRITE one and clobber platform state — reject on the write side too.
    if (/^PODBAY_/.test(key)) {
      throw new ControlError(`'${key}' is a reserved platform secret and cannot be set`, "invalid");
    }
    await this.config.secretVault.set(podId, key, value);
    if (rec.status === "running") await this.pushSecrets(podId);
  }

  /** Decrypt and return ONE app secret value for the OWNER's cockpit reveal.
   *
   * This is the ONLY path that returns a plaintext secret to a browser, so it is
   * deliberately narrow: owner-scoped (never the admin/support view), one key at a
   * time (never a bulk list), and AUDITED (`secret_revealed`). It exposes nothing
   * new to the owner — they can already read the same value from their pod terminal
   * (`printenv KEY`, `podbay secrets get KEY`, `/etc/podbay/secrets.env`); it just
   * saves them from copying secrets into a second store to verify one. */
  async revealSecret(ownerId: string, podId: string, key: string): Promise<string> {
    const rec = await this.owned(ownerId, podId);
    if (!this.config.secretVault) throw new ControlError("secrets are not configured", "invalid");
    const value = await this.config.secretVault.retrieve(podId, key);
    if (value === null) throw new ControlError(`secret not set: ${key}`, "not_found");
    await this.emit(rec, "secret_revealed", { key });
    return value;
  }

  /** Reveal ALL currently-set app secrets as a KEY→value map, for a bulk `.env` export. Includes
   * declared + arbitrary added vars but NOT reserved internal keys (same filter as listSecrets).
   * Emits ONE `secrets_exported` audit event rather than N reveals. Owner-scoped. */
  async revealAllSecrets(ownerId: string, podId: string): Promise<Record<string, string>> {
    const rec = await this.owned(ownerId, podId);
    if (!this.config.secretVault) throw new ControlError("secrets are not configured", "invalid");
    const out: Record<string, string> = {};
    for (const s of await this.listSecrets(ownerId, podId)) {
      if (!s.set) continue;
      const value = await this.config.secretVault.retrieve(podId, s.key);
      if (value !== null) out[s.key] = value;
    }
    await this.emit(rec, "secrets_exported", { count: Object.keys(out).length });
    return out;
  }

  /** Clear an app secret. Owner-scoped. Pushes the remaining set live if running. */
  async clearSecret(ownerId: string, podId: string, key: string): Promise<void> {
    const rec = await this.owned(ownerId, podId);
    if (!this.config.secretVault) return;
    await this.config.secretVault.clear(podId, key);
    if (rec.status === "running") await this.pushSecrets(podId);
  }

  /** Whether an env declares any secrets — drives whether the UI offers a
   * secrets panel for pods of that env. */
  async environmentDeclaresSecrets(environmentName: string): Promise<boolean> {
    return (await this.declaredSecrets(environmentName)).length > 0;
  }

  /** Resolve an env's declared secrets; empty when the env is unknown/invalid. */
  private async declaredSecrets(
    environmentName: string,
  ): Promise<{ key: string; description: string | null; required: boolean; url: string | null }[]> {
    if (!isSafeName(environmentName)) return [];
    try {
      const resolved = await resolveWithConfig(path.join(this.config.environmentsRoot, environmentName));
      return resolved.secrets;
    } catch {
      return [];
    }
  }

  /** Push the pod's current secret set to the running pod as env vars (system op).
   * Best-effort: a failure leaves the DB as source of truth for the next wake. */
  private async pushSecrets(podId: string): Promise<void> {
    if (!this.config.secretVault) return;
    const secrets = await this.config.secretVault.retrieveAll(podId);
    try {
      await (await this.providerOf(podId)).injectSecrets(podId, secrets);
    } catch (e) {
      this.log.warn("secret_inject_failed", { podId, error: (e as Error).message });
    }
  }

  /** Refresh a record's status from provider truth (system op, not owner-scoped). */
  async reconcile(id: string): Promise<PodRecord> {
    let record = await this.store.get(id);
    if (!record) throw new ControlError(`pod ${id} not found`, "not_found");
    // "provisioning" is the provisioner worker's to own — its machine may not
    // exist yet, and the worker is the authority that flips it to running or
    // error. Never let a reconcile (e.g. from listPods) clobber it.
    if (record.status === "provisioning") return record;
    const prov = this.providerFor(record.provider);
    const info = await prov.getPod(id);
    const status = await this.liveStatus(id, info.status, prov);
    // Backfill the authoritative machine identity for LEGACY rows created before
    // these columns existed (both null on pods predating them). machineId powers
    // duplicate-prevention on re-provision; imageDigest powers update-detection —
    // without it a legacy pod can never be offered an update. Fill only when null
    // so we never fight updatePodImage or the provisioner, which own these for
    // managed pods. Cheap: the provider read already happened above.
    const backfill: { machineId?: string; imageDigest?: string } = {};
    if (!record.machineId && info.machineId) backfill.machineId = info.machineId;
    if (!record.imageDigest && info.imageDigest) backfill.imageDigest = info.imageDigest;
    if (backfill.machineId || backfill.imageDigest) {
      record = await this.store.update(id, backfill);
    }
    // Capture/refresh the remote-control session URL server-side. The gateway only
    // sees it when a client is proxying the pod, but the boot greeter enables RC
    // with no client watching — so without this the "Open in Claude app" link never
    // lands. We must also REFRESH it, not just fill it once: every cold boot mints a
    // NEW bridge session, so a pod that restarts (wake, or an in-place image update)
    // would otherwise serve a DEAD link forever. Verified live 2026-07-17: an image
    // update changed session_013kWzFQ… → session_01GXQRNG….
    if (status === "running") {
      const url = await prov.agentSessionUrl(id).catch(() => null);
      if (url && url !== record.sessionUrl) {
        await this.recordSessionUrl(record.ownerId, id, url).catch(() => undefined);
        record = { ...record, sessionUrl: url };
      }
      // Onboarding state (sign-in URL, and the transition to authed) normally reaches the DB via
      // the pod-agent PUSHING it over the control link to the gateway. A self-host (no gateway) has
      // no push, so PULL it from /healthz here while the pod is still onboarding. Idempotent, so in
      // cloud this is harmless belt-and-suspenders (recordAuthed/recordAuthUrl no-op once set).
      if (!record.sessionUrl) {
        const agent = (await prov.podHealth(id).catch(() => null))?.agents?.[0];
        if (agent?.authed && !record.authedAt) {
          await this.recordAuthed(record.ownerId, id).catch(() => undefined);
          record = { ...record, authedAt: new Date().toISOString(), authUrl: null };
        } else if (!record.authedAt && agent?.authUrl && agent.authUrl !== record.authUrl) {
          await this.recordAuthUrl(record.ownerId, id, agent.authUrl).catch(() => undefined);
          record = { ...record, authUrl: agent.authUrl };
        }
      }
    }
    // Ingest the pod's self-repairs into the event log. The watchdog logs to the
    // pod's journal, which only an operator with box access can read — the OWNER
    // needs "Claude restarted twice while I was away" in their timeline.
    //
    // Deduped against the log ITSELF (emit only repairs newer than the newest
    // recorded one) rather than a new column: no migration, and the log is already
    // the thing we would compare against. Consequence, accepted: repairs surface
    // when something reconciles the pod (cockpit load, dashboard, admin) rather
    // than the instant they happen — the pod's live state always shows them
    // immediately via /healthz.
    if (status === "running") {
      await this.ingestRepairs(record, prov).catch(() => undefined);
      await this.exchangeFetchMemory(record, prov).catch(() => undefined);
      await this.exchangeMessages(record, prov).catch(() => undefined);
      // Auto-sync the config layer if the env drifted from what this pod last received — the
      // reconcile hook that replaces the manual "Sync config" button (best-effort; see the method).
      await this.reconcileConfigDrift(record, prov).catch(() => undefined);
    }

    if (status !== record.status) {
      // First time the pod is reachable (wake/boot): re-inject its secrets, since
      // the in-pod file is ephemeral and the DB is the source of truth. Only when
      // the pod actually has secrets set, so pod-free-of-secrets pays no exec.
      if (status === "running" && this.config.secretVault) {
        const keys = await this.config.secretVault.listKeys(id).catch(() => [] as string[]);
        if (keys.length > 0) await this.pushSecrets(id);
      }
      // The out-of-band catcher: Fly restarted/suspended the machine, it crashed,
      // or someone ran `fly` by hand. Without emitting here the timeline lies for
      // every transition we didn't personally cause.
      if (status === "running" || status === "suspended") {
        await this.emit(record, status, { reason: "reconciled", from: record.status });
      }
      return this.store.update(id, { status });
    }
    return record;
  }

  /** Fly "started" only means the machine is on; hold "waking" until the
   * pod-agent actually accepts a connection, so "running" means connectable. */
  private async liveStatus(
    id: string,
    flyStatus: PodStatus,
    prov: SandboxProvider = this.provider,
  ): Promise<PodStatus> {
    if (flyStatus !== "running") return flyStatus;
    return (await prov.agentReady(id)) ? "running" : "waking";
  }

  /** Sleep pods idle beyond the threshold, skipping keepAwake. Returns slept ids. */
  async sleepIdlePods(thresholdMs: number, now = Date.now()): Promise<string[]> {
    const slept: string[] = [];
    for (const r of await this.store.list()) {
      if (r.keepAwake) continue;
      // Incus pods run 24/7 — suspend is an explicit USER verb now, never
      // automatic (the 2026-07-20 sleep-kill pivot, docs/strategy/infra-strategy.md).
      // Only legacy Fly pods still idle-sleep; every go-forward pod is Incus. Self-host
      // `local` (Docker) pods are go-forward too — an auto `docker stop` on the owner's
      // own machine is surprising and kills their agent — so they never idle-sleep either.
      if (r.provider === "incus" || r.provider === "local") continue;
      // Settle transient "waking" pods to their true status first, so a woken
      // pod becomes idle-eligible instead of stuck "waking" (which would never
      // auto-sleep — a cost leak).
      let status = r.status;
      if (status === "waking") status = (await this.reconcile(r.id).catch(() => r)).status;
      if (status !== "running") continue;
      if (now - Date.parse(r.lastActiveAt) < thresholdMs) continue;
      const prov = this.providerFor(r.provider);
      // Looks idle by the gateway clock (no client connected) — but the agent may
      // be working via remote control, which never touches our gateway. Ask the
      // agent what it's ACTUALLY doing before suspending.
      //
      // Ask Claude itself (`busy`/`shell` = working) — do NOT infer work from
      // terminal output. Measured live 2026-07-17: a session parked at `waiting`
      // repaints every ~15–32s, so output-based idle resets forever and the pod
      // never sleeps (5h+ observed); `busy` meanwhile pairs with ~0ms idle. Output
      // is also wrong the other way: a long silent tool call looks idle and would
      // be suspended mid-work. See docs/plans/pre-alpha-plan.md P0.1.
      const agentState = await prov.agentStatus(r.id).catch(() => null);
      if (agentState === "busy" || agentState === "shell") {
        // Genuinely working (mid-turn or running a foreground tool) — keep it up
        // and bump the clock so it isn't re-examined every sweep.
        await this.store.update(r.id, { lastActiveAt: new Date(now).toISOString() });
        continue;
      }
      if (agentState === null) {
        // No status (older CLI / unreachable) → fall back to the output clock.
        // Weaker, but better than suspending an agent we can't ask.
        const agentIdle = await prov.agentIdleMs(r.id).catch(() => null);
        if (agentIdle !== null && agentIdle < thresholdMs) {
          await this.store.update(r.id, {
            lastActiveAt: new Date(now - agentIdle).toISOString(),
          });
          continue;
        }
      }
      // status is idle/waiting (or unknown-with-stale-output) → sleep it. A
      // BACKGROUND task leaves the agent at `waiting`, so long background work
      // must declare itself via keepAwake (checked above), not by keeping the
      // screen warm.
      const info = await prov.sleep(r.id);
      await this.store.update(r.id, { status: info.status });
      await this.emit(r, "suspended", { reason: "idle", agentState });
      slept.push(r.id);
    }
    return slept;
  }

  /** Maintenance wake: wake pods dormant (asleep + untouched) beyond `dormantMs`,
   * so the agent CLI gets a chance to refresh its rotating login before it expires
   * (~30d) and the pod doesn't deep-archive. Capped at `maxPerSweep` to bound cost;
   * waking resets lastActiveAt, so each pod is maintenance-woken at most once per
   * `dormantMs`. always-on pods are already up and are skipped. System op. Best-effort.
   * Disabled unless the gateway passes a positive `dormantMs`. */
  async maintenanceWakePods(dormantMs: number, maxPerSweep = 5, now = Date.now()): Promise<string[]> {
    if (!(dormantMs > 0)) return [];
    const woken: string[] = [];
    for (const r of await this.store.list()) {
      if (woken.length >= maxPerSweep) break;
      if (r.keepAwake) continue;
      if (r.status !== "suspended") continue;
      if (now - Date.parse(r.lastActiveAt) < dormantMs) continue;
      try {
        await this.providerFor(r.provider).wake(r.id);
        await this.store.update(r.id, {
          status: "waking",
          lastActiveAt: new Date(now).toISOString(),
        });
        woken.push(r.id);
        this.log.info("maintenance_wake", { podId: r.id });
      } catch {
        /* best-effort — a failed wake is retried next sweep */
      }
    }
    // Claude Code only refreshes lazily on activity, so a bare wake won't renew the
    // login. Once each woken pod is reachable, trigger one trivial CLI call to force
    // the on-demand refresh (verified), then it idle-sleeps normally — M1 captures
    // the rotated token on that sleep. Best-effort, bounded.
    await Promise.all(woken.map((id) => this.forceTokenRefresh(id)));
    return woken;
  }

  /** Wait (bounded) for a woken pod to be reachable, then run one tiny headless
   * agent call so the CLI refreshes its rotating login. Best-effort. */
  private async forceTokenRefresh(id: string, timeoutMs = 90_000): Promise<void> {
    const prov = await this.providerOf(id);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await prov.agentReady(id).catch(() => false)) {
        await prov
          .exec(id, ["su", "-", "dev", "-c", "timeout 45 claude -p 'ok' >/dev/null 2>&1 || true"])
          .catch(() => undefined);
        return;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  /** A memorable slug not already used by a pod record. */
  private async uniqueSlug(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const slug = generateSlug();
      if (!(await this.store.get(slug))) return slug;
    }
    throw new ControlError("could not allocate a unique pod slug", "invalid");
  }

  private async owned(ownerId: string, id: string): Promise<PodRecord> {
    const record = await this.store.get(id);
    // Cross-owner (or missing) is reported as not-found — don't leak existence.
    if (!record || record.ownerId !== ownerId) {
      throw new ControlError(`pod ${id} not found`, "not_found");
    }
    return record;
  }
}

/** Prevent path traversal in environment names. */
function isSafeName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** User-facing message when a pod's environment no longer exists (renamed or
 * removed). Says what's wrong and what to do — the pod can't be rebuilt from a
 * vanished template, so the only path is to launch a new one. */
export function envMissingMessage(environmentName: string): string {
  return (
    `The environment “${environmentName}” no longer exists — it was renamed or removed, ` +
    `so this pod can’t be rebuilt from it. Nothing you can do here will bring it back; ` +
    `delete this pod and launch a new one from the current catalog.`
  );
}
