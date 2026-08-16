import type { PodResources, ResolvedPod } from "@podbay/shared";

export type PodStatus =
  | "provisioning"
  | "running"
  | "suspended"
  | "waking"
  | "destroying"
  | "gone"
  | "error";

export interface PodInfo {
  id: string;
  status: PodStatus;
  region: string;
  /** Address the control plane connects to for the terminal bridge, if running. */
  endpoint: string | null;
  keepAwake: boolean;
  /** The backing machine id, so the control plane can record the authoritative
   * pod→machine link instead of re-deriving it from an eventually-consistent list. */
  machineId?: string;
  /** Image digest the machine runs (for "update available" + fleet drift). */
  imageDigest?: string;
}

export interface CreatePodInput {
  /** Deterministic Podbay pod id — the idempotency key. */
  id: string;
  /** A machine already known to belong to this pod (from the pod row). When set,
   * createPod ADOPTS it via a consistent by-id read instead of hunting for it in
   * Fly's eventually-consistent listMachines — which is how one pod ended up with
   * 3 machines + 3 volumes, all billing (2026-07-17). */
  knownMachineId?: string | null;
  /** Called the INSTANT a machine is created, before we wait for it to boot, so the
   * caller can persist the pod→machine link immediately. This is what shrinks the
   * "created but not yet recorded" window from ~a retry cycle to ~milliseconds. */
  onMachineCreated?: (machineId: string) => Promise<void>;
  /** Owner (user) reference. */
  owner: string;
  /** Resolved environment (from @podbay/shared). */
  resolved: ResolvedPod;
  /** Optional path to the environment directory, so the `.claude/` layer can be injected. */
  envDir?: string;
  /** Optional region override; defaults to the provider's configured region. */
  region?: string;
  /** Display name the user gave the pod (already trimmed/capped); lands in the
   * pod-spec so in-pod surfaces (e.g. the remote-control session title) use the
   * name the user chose, not the slug. */
  name?: string;
  /** Per-pod app secrets (UPPER_SNAKE key → plaintext value) to inject as
   * environment variables via /etc/podbay/secrets.env. Normally empty at launch
   * (set post-launch); the control plane re-injects on wake. Never logged. */
  secrets?: Record<string, string>;
  /** BYO-repo: a "owner/name" GitHub repo to clone into ~/work at first boot
   * (docs/plans/byo-repo-plan.md). Lands in the pod-spec; init.sh clones it using the
   * PODBAY_GH_CLONE_TOKEN secret. Replaces the env template as the workspace. */
  githubRepo?: string;
  /** Pod-level agent override (multi-agent-plan.md slice 3); undefined ⇒ the env's
   * declared agents. Lands in the pod-spec (via buildInitFiles). */
  agents?: ResolvedPod["agents"];
  /** Pod-level auth-mode override; undefined ⇒ the env's default. Lands in the pod-spec. */
  agentAuth?: ResolvedPod["agentAuth"];
  /** Compute tier resolved from the pod's size (@podbay/shared POD_TIERS). When
   * omitted the provider falls back to its configured defaults (legacy path). */
  resources?: PodResources;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A published base image in the provider's image store (image-manifest / prune). */
export interface BaseImage {
  fingerprint: string;
  aliases: string[];
  sizeBytes: number;
  createdAt: string;
}

export type ProviderErrorCode =
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "transient"
  | "invalid"
  | "unsupported";

export class ProviderError extends Error {
  code: ProviderErrorCode;
  override cause?: unknown;
  constructor(message: string, code: ProviderErrorCode, cause?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.cause = cause;
  }
}

/** Called with a coarse progress label while a long provider operation runs
 * (currently updateImage: stopping → recreating → starting → booting →
 * restarting agent → waiting for agent → finishing). Best-effort UI feedback —
 * a throwing or slow callback must never affect the operation itself. */
export type UpdateStage = (stage: string) => void;
