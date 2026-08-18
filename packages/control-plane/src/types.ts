import type { PodStatus } from "@podbay/provider";
import type { PodSize, AgentCli, AgentAuth } from "@podbay/shared";

export type { PodStatus };

/** Persisted control-plane record for a pod. Provider is the source of live status. */
export type LifecyclePolicy = "auto" | "awake-hours" | "always-on" | "scheduled";

export const LIFECYCLE_POLICIES: readonly LifecyclePolicy[] = [
  "auto",
  "awake-hours",
  "always-on",
  "scheduled",
] as const;

/**
 * A pod lifecycle transition. `running`/`suspended` are the pair the running-interval
 * maths folds over; `updated` carries {from,to} image digests.
 */
export type PodEventType =
  | "created"
  | "running"
  | "suspended"
  // Legacy alias for "suspended" — the event type before the 2026-08-02 rename.
  // Existing audit-log rows are migrated, but the union keeps it so readers that
  // fold historical events stay type-safe and tolerant.
  | "sleeping"
  | "destroyed"
  | "updated"
  | "resized"
  | "error"
  // Image-update progress (UI only). The usage fold ignores unknown types, so
  // these never affect billing — see metrics.ts OPENS/CLOSES.
  | "agent_added"
  | "codex_rc_toggled"
  // The owner edited the pod's Claude settings from the cockpit. meta: { keys: string[] }.
  | "claude_settings_changed"
  // Live config-refresh: pod-base content (skills/rules/settings) pushed + re-applied to a
  // RUNNING pod without a recreate. meta: { refreshed, files, note? }.
  | "config_refreshed"
  | "admin_action"
  // The owner revealed a stored secret value in the cockpit. meta: { key }. Audited
  // because it is the one path that returns a plaintext secret to a browser.
  | "secret_revealed"
  | "secrets_exported"
  | "pod_repaired"
  | "repair_gave_up"
  // An out-of-memory kill. meta: { victim, rss, victimIsAgent }. Even when the agent
  // survives (a child build/browser process was the victim), it is worth recording.
  | "oom_killed"
  | "update_started"
  | "update_stage"
  | "update_failed"
  // Resize is a restart too, so it brackets like an update — the timeline reads
  // both as maintenance windows rather than inventing a suspend that never happened.
  | "resize_started"
  | "resize_failed";

export interface PodEvent {
  id: string;
  podId: string;
  /** Denormalized so usage stays attributable after the pod row is deleted. */
  ownerId: string;
  type: PodEventType;
  at: string;
  meta: Record<string, unknown> | null;
  /** When the owner dismissed this event's cockpit banner (durable, cross-device). */
  dismissedAt?: string | null;
}

export interface PodRecord {
  id: string;
  ownerId: string;
  environmentName: string;
  /** Optional display name; null falls back to the slug (`id`). */
  name: string | null;
  status: PodStatus;
  region: string;
  keepAwake: boolean;
  /** Lifecycle policy: auto (idle-sleep) | awake-hours | always-on | scheduled. */
  lifecycle: LifecyclePolicy;
  /** Auto-update opt-out (fleet-updates): "inherit" = included in the "update idle pods" bulk action
   * / future auto-update; "off" = never, and excluded from the bulk button (a pod running a service
   * the owner updates deliberately). Default "inherit". */
  autoUpdate: "inherit" | "off";
  /** Preview URL access: false = owner-authed only, true = public. */
  previewPublic: boolean;
  /** BYO-repo: "owner/name" GitHub repo cloned into ~/work at first boot, or null
   * (docs/plans/byo-repo-plan.md). Non-sensitive; the clone token rides as a reserved
   * encrypted pod-secret, never on this row. */
  githubRepo: string | null;
  /** The agent(s) this pod runs, chosen at launch (multi-agent-plan.md slice 3).
   * null = fall back to the environment's declared agents; a set value overrides it. */
  agents: AgentCli[] | null;
  /** Auth mode (api-key-pod-mode.md): "subscription" (default) or "api-key". null =
   * fall back to the environment's default. */
  agentAuth: AgentAuth | null;
  /** Onboarding milestones (durable) — when the agent first reported logged-in,
   * and the captured remote-control session deep link. Both null until reached;
   * they drive the launch wizard's step and survive refresh/close/sleep. */
  authedAt: string | null;
  /** The Claude sign-in URL captured from the pod terminal during first login, so
   * the cockpit's Sign-in step shows the link from durable state (refresh-safe).
   * Set by the gateway; cleared once the pod is authed. */
  authUrl: string | null;
  /** Codex devices the OWNER confirmed pairing for (self-reported — pairing isn't
   * observable from the pod). Null/[] = none confirmed yet. */
  codexDevices: { name: string; at: string }[] | null;
  sessionUrl: string | null;
  /** The pod's machine id, recorded the instant the provider creates it — the
   * AUTHORITATIVE pod→machine link. Fly's listMachines is eventually consistent, so
   * a provision retry could miss a machine created moments earlier and build a
   * second (one pod → 3 machines, all billing — seen live 2026-07-17). With this,
   * a retry adopts the known machine (a consistent by-id read) instead of racing a
   * list. Null only before the machine exists (or for pre-0012 rows). */
  machineId: string | null;
  /** Image digest the machine runs; written at create + at update. Drives "update
   * available" without a live Fly call, and the backoffice fleet-drift view. */
  imageDigest: string | null;
  /** Durable image-update progress. `updatingSince` (ISO) is set when an update
   * starts and cleared when it finishes/fails; while non-null the pod is updating,
   * whatever imageDigest still says. `updateStage` is the coarse phase for display.
   * These are the RENDER source of truth so the list card + cockpit reflect an
   * in-flight update straight from the backend, refresh-safe (never client-only). */
  updatingSince: string | null;
  /** Which maintenance is in flight: an update or a resize. Both restart the pod and
   * share updatingSince/updateStage, so this is what lets a surface say the right
   * word instead of calling every restart an "update". */
  maintenanceKind: "update" | "resize" | null;
  updateStage: string | null;
  /** Which SandboxProvider hosts this pod ('fly' | 'incus'). Written at launch;
   * every provider call routes through it (docs/strategy/infra-strategy.md M1). */
  provider: string;
  /** Compute tier (@podbay/shared POD_TIERS). `size` gives reserved CPU/RAM;
   * `diskGb` is the hard quota and only grows (a resize-down keeps the larger
   * disk), so it may exceed the size's default. */
  size: PodSize;
  diskGb: number;
  /** Self-host explicit sizing (self-host-pod-sizing): a `local` pod's chosen CPU cores and
   * memory (MB). null ⇒ no explicit limit (unlimited; the OSS default) / a cloud tier pod uses
   * `size` instead. Applied as `docker run --cpus/--memory` by LocalProvider. */
  cpus?: number | null;
  memoryMb?: number | null;
  /** Provisioning job state (durable machine build). `provisionAttempts` counts
   * build tries; `provisionLeaseUntil` is the worker's claim lease (null = free);
   * `provisionError` is the last failure. See docs/runbooks/durable-provisioning-plan.md. */
  provisionAttempts: number;
  provisionLeaseUntil: string | null;
  provisionError: string | null;
  /** When the owner saw the post-create "how to connect" walkthrough; null = not yet.
   * Set once so it never re-runs, durable across devices (pod-launch-wizard). */
  walkthroughSeenAt: string | null;
  /** Manual dashboard ordering (drag-to-reorder); null = never hand-placed. */
  position: number | null;
  createdAt: string;
  lastActiveAt: string;
}

export type ControlErrorCode = "not_found" | "invalid" | "slot_limit";

export class ControlError extends Error {
  code: ControlErrorCode;
  constructor(message: string, code: ControlErrorCode) {
    super(message);
    this.name = "ControlError";
    this.code = code;
  }
}

/** One unhealthy pod in the fleet sweep (backoffice). */
export interface FleetHealthRow {
  id: string;
  name: string | null;
  ownerId: string;
  environmentName: string;
  worst: "critical" | "warn";
  issues: { id: string; severity: string; title: string; detail: string; fixable: boolean; agent?: string }[];
}

/**
 * What the DASHBOARD CARD needs to say about one running pod, live: what the agent
 * is doing, whether anything serves the preview port, and whether the pod is in
 * live-critical trouble right now. Derived from ONE /healthz read per pod, cached
 * briefly (the dashboard re-renders on a timer; each render must not re-sweep).
 */
export interface PodLiveSignals {
  id: string;
  /** The pod's LIFECYCLE status (running/suspended/updating…) at poll time — so the
   * dashboard card reflects a server-side transition (e.g. an update starting) on the
   * next poll, not only on a full page reload. */
  status: string;
  /** An image update is in flight (from the durable row) — the card shows "Updating…". */
  updating: boolean;
  /** `busy` | `shell` | `idle` | `waiting` — the agent CLI's own state. Null when
   * unknown (older image, no session, or the pod didn't answer). */
  agentStatus: string | null;
  /** Codex activity (`busy` | `idle` | null) from its rollout-log mtime. */
  codexStatus: string | null;
  /** The CLI's "what am I blocked on" detail (e.g. "dialog open"), when reported. */
  agentWaitingFor: string | null;
  /** Per-agent activity for multi-agent pods: id + that agent's authed state. */
  agents: { id: string; authed: boolean }[];
  /** true/false = the pod reported whether :3000 is serving; null = unknown
   * (image predates the field, or unreachable) — the card must NOT claim "no app". */
  appListening: boolean | null;
  /** A live CRITICAL pod-level problem (disk full, repair gave up), if any. */
  criticalIssue: { title: string; detail: string } | null;
  /** The pod reports as running but its agent didn't answer. */
  unreachable: boolean;
}
