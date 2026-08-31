import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  doublePrecision,
  bigint,
  index,
  uniqueIndex,
  primaryKey,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Schema for the tables better-auth requires (user, session, account,
 * verification). Kept to portable Postgres so it runs on Neon and pglite alike.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Podbay access gate (invite-only alpha). better-auth ignores this column; the
  // DB default covers its inserts.
  approved: boolean("approved").notNull().default(false),
  // Admin "Later": an access request the operator set aside to revisit, without approving or
  // rejecting it. Null = a normal pending request (or already approved). Approving clears it.
  deferredAt: timestamp("deferred_at"),
  // When the owner first finished (or skipped) the post-create "how it works"
  // walkthrough. Per-USER, not per-pod: once they've seen it on ANY pod it never
  // re-runs on a new one. Null = never seen. (Superseded pods.walkthroughSeenAt,
  // which re-showed the tour on every new pod — 2026-08-15.)
  walkthroughSeenAt: timestamp("walkthrough_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Append-only pod lifecycle log — the source for uptime / sleep / cycles /
 * billable awake-seconds and the backoffice fleet view (docs/plans/observability-plan.md).
 *
 * Deliberately has **no FK to pods**: a cascade would delete a pod's history the
 * moment the pod is deleted, which is exactly when you still need it (cost
 * accounting, "what did this user actually burn"). `ownerId` is denormalized for
 * the same reason — after the pod row is gone, usage must still be attributable.
 * Written ONLY by the control plane, which is the only layer that observes a
 * transition and the only one that works while a pod is asleep.
 */
export const podEvents = pgTable(
  "pod_events",
  {
    id: text("id").primaryKey(),
    podId: text("pod_id").notNull(),
    ownerId: text("owner_id").notNull(),
    /** created | running | suspended | destroyed | updated | error */
    type: text("type").notNull(),
    at: timestamp("at").notNull().defaultNow(),
    /** Free-form context: {from,to} for an image update, an error message, etc. */
    meta: jsonb("meta"),
    /** When the owner dismissed this event's cockpit banner (server-side, so the
     * dismissal is durable + cross-device). Null = not dismissed. */
    dismissedAt: timestamp("dismissed_at"),
  },
  (t) => [index("pod_events_pod_at_idx").on(t.podId, t.at)],
);

/** Podbay pods, owned by a user. Backs @podbay/control-plane's PodStore. */
export const pods = pgTable(
  "pods",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    environmentName: text("environment_name").notNull(),
    // Optional display name; null falls back to the slug (the pod id).
    name: text("name"),
    status: text("status").notNull(),
    region: text("region").notNull(),
    keepAwake: boolean("keep_awake").notNull().default(false),
    lifecycle: text("lifecycle").notNull().default("auto"),
    // Auto-update opt-out (fleet-updates): "inherit" = follow the account default / included in the
    // "update idle pods" bulk action; "off" = never auto-update and excluded from the bulk button
    // (for a pod running a service the owner updates deliberately). Nullable-safe: default covers
    // existing rows; old code ignores it. See docs/plans/fleet-updates.md.
    autoUpdate: text("auto_update").notNull().default("inherit"),
    // Preview URL access: false = owner-authed only, true = anyone with the URL.
    previewPublic: boolean("preview_public").notNull().default(false),
    // Delegated-auth preview (agent-harness backends like T3 Code): the gateway forwards :3000
    // as public transport, but access is gated by the UPSTREAM app's OWN auth (e.g. T3's pairing
    // token), not a podbay cookie. Distinct from previewPublic so the UX can label it honestly
    // ("guarded by the app's own login") and a backend flavor can set it, not a manual toggle.
    previewAppAuth: boolean("preview_app_auth").notNull().default(false),
    // BYO-repo: a "owner/name" GitHub repo cloned into ~/work at first boot
    // (docs/plans/byo-repo-plan.md). Non-sensitive; the clone token rides as a reserved
    // encrypted pod-secret, never on this row.
    githubRepo: text("github_repo"),
    // The agent(s) this pod runs, chosen at launch (multi-agent-plan.md, "cheap-tabs"
    // slice 3). NULL = fall back to the environment's declared agents; a set value
    // (the user's launch pick, and later "Add agent" appends) OVERRIDES the env default.
    // One entry per agent type; a second CLAUDE is out of v1 (shared ~/.claude).
    agents: jsonb("agents").$type<string[]>(),
    // How this pod authenticates its agent: "subscription" (the user's /login) or
    // "api-key" (a BYO key, stored as the reserved PODBAY_AGENT_* secret). NULL = fall
    // back to the environment's default (api-key-pod-mode.md).
    agentAuth: text("agent_auth").$type<"subscription" | "api-key" | "setup-token">(),
    // Onboarding milestones — the DURABLE source of truth for the launch wizard's
    // login/remote-control sub-steps, so the page survives refresh/close/reopen
    // and even a sleep. Written by the gateway when it observes the agent's
    // signals (never a client). Null until reached.
    authedAt: timestamp("authed_at"),
    sessionUrl: text("session_url"),
    // The Claude sign-in (OAuth) URL captured from the pod's terminal during first
    // login, so the cockpit's "Sign in" step shows the link from the BACKEND and
    // survives a refresh mid-login (not client-only). Set by the gateway from the
    // links frame; cleared once the pod is authed (the URL is then spent).
    authUrl: text("auth_url"),
    // Codex remote-control devices the OWNER has confirmed pairing for. Self-reported
    // on purpose: pairing is recorded server-side by OpenAI and is NOT observable from
    // the pod (the daemon's enrollment row is identical paired or not), so the honest
    // options were "no completion state at all" or "let the user tell us". Each entry
    // is { name, at } — the name is whatever the owner calls that device, which also
    // gives the cockpit the "who connected" answer nothing else can supply.
    codexDevices: jsonb("codex_devices").$type<{ name: string; at: string }[]>(),
    // The pod's machine, recorded the instant the provider creates it. This is the
    // AUTHORITATIVE pod→machine link: Fly's listMachines is eventually consistent,
    // so a provision retry could not see a machine created moments earlier and
    // built another (one pod → 3 machines + 3 volumes, all billing — seen live
    // 2026-07-17). Consulting our own row instead removes that dependency; a
    // machine is looked up by ID (a consistent read) rather than found in a list.
    machineId: text("machine_id"),
    // The image digest the machine is running, written at create and at update.
    // Powers "update available" (compare against the pinned PODBAY_BASE_IMAGE)
    // without a live Fly call per dashboard render, and the backoffice's fleet
    // drift view. See docs/plans/pre-alpha-plan.md P2.5.
    imageDigest: text("image_digest"),
    // Hash of the `.claude`/skills/permissions config layer LAST DELIVERED to this pod
    // (set on create, image-update, and every live config-refresh). The reconcile sweep
    // compares it against the env's current resolved layer to auto-sync a running pod on
    // drift — no manual "Sync config" button. Null on legacy rows and until first delivery.
    configHash: text("config_hash"),
    // Image-update progress, DURABLE on the row so every surface (list card,
    // cockpit) reflects "updating" straight from the backend and survives a
    // navigate-away/refresh — never client-only state. `updatingSince` is set when
    // an update starts and cleared when it finishes or fails; while non-null the
    // pod is updating regardless of what imageDigest still says. `updateStage` is
    // the coarse phase for display (stopping → recreating → …). The event log
    // keeps the audit trail; these two are the render source of truth.
    updatingSince: timestamp("updating_since"),
    updateStage: text("update_stage"),
    /**
     * WHICH maintenance is in flight — an update or a resize. Both stop and restart
     * the pod and both use the two columns above, so without this the surfaces
     * cannot tell them apart and a resize reads as "Updating…", sending the owner
     * looking for an image change that isn't happening.
     *
     * This replaces encoding the kind as a `resize:` prefix on updateStage, which
     * worked but made a string a contract between the control plane and the cockpit.
     */
    maintenanceKind: text("maintenance_kind").$type<"update" | "resize">(),
    // T3 Code control (t3-code-first-class). `t3Control` is the steady-state flag —
    // true while an external harness (T3 Code) owns the pod's agents; it drives the
    // "in control" banner + hides the conflicting Podbay controls, and is the render
    // source of truth (durable, refresh-safe). `t3Since`/`t3Stage` are the transient
    // enable/disable wizard progress (mirrors updatingSince/updateStage): t3Since set
    // while provisioning, t3Stage the coarse phase (preparing → downloading → …).
    t3Control: boolean("t3_control").notNull().default(false),
    t3Since: timestamp("t3_since"),
    t3Stage: text("t3_stage"),
    // t3Connected (t3-connect-account-wizard): the pod's t3 is signed into the OWNER's T3 cloud account
    // and this environment is linked, so it syncs to their devices + is remotely reachable. Distinct
    // from t3Control (agents handed to T3): a pod is "in control" before the owner connects their account.
    t3Connected: boolean("t3_connected").notNull().default(false),
    // Which SandboxProvider hosts this pod ('fly' | 'incus'). Written at launch
    // from the configured default; every provider call routes through it — the
    // seam for the self-hosted migration (docs/strategy/infra-strategy.md M1).
    provider: text("provider").notNull().default("fly"),
    // Compute tier (docs/strategy/pricing-model.md, @podbay/shared POD_TIERS). `size`
    // gives reserved CPU/RAM; `diskGb` is the hard quota and can only GROW —
    // a resize-down keeps the larger disk, so diskGb may exceed the size's
    // default. Default 's'/10 == the old fixed 2/4/10 (backfills existing pods).
    size: text("size").notNull().default("s"),
    diskGb: integer("disk_gb").notNull().default(10),
    // Self-host explicit sizing (self-host-pod-sizing): when set, these override the tier's
    // reserved CPU/RAM for a `local` pod and are applied as `docker run --cpus/--memory`. NULL =
    // no explicit limit (unlimited, the OSS default) / cloud tier pods use `size` instead.
    cpus: doublePrecision("cpus"),
    memoryMb: integer("memory_mb"),
    // Provisioning job bookkeeping (docs/runbooks/durable-provisioning-plan.md). The row
    // IS the job: a background worker in the gateway claims "provisioning" pods
    // by setting a lease, builds the machine, and flips the status. Durable and
    // retryable — survives a web/gateway restart.
    provisionAttempts: integer("provision_attempts").notNull().default(0),
    provisionLeaseUntil: timestamp("provision_lease_until"),
    provisionError: text("provision_error"),
    // When the owner has seen the post-create "how to connect" walkthrough. Null =
    // not yet; set once so it never re-runs (durable across devices).
    walkthroughSeenAt: timestamp("walkthrough_seen_at"),
    // Manual dashboard ordering (drag-to-reorder). Null = never hand-placed; the
    // list falls back to its default sort for null-position pods. Lower = earlier.
    position: integer("position"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  },
  (t) => [index("pods_owner_id_idx").on(t.ownerId)],
);

/**
 * Per-pod app secrets the USER supplies (BotFather token, API keys) for the app
 * the agent builds — distinct from the CLI-login vault above (opsx `pod-secrets`).
 * `blob` is AES-256-GCM ciphertext (@podbay/shared/crypto) — never plaintext.
 * `key` is the env-var name; the value is injected into the pod at boot.
 */
export const podSecrets = pgTable(
  "pod_secrets",
  {
    podId: text("pod_id")
      .notNull()
      .references(() => pods.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    blob: text("blob").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.podId, t.key] })],
);

/**
 * The owner's durable, encrypted GitHub connection — the SINGLE source of truth every pod draws
 * from (docs/plans/byo-repo-plan.md; global-github-connection). One per user. `tokenEnc` is
 * AES-256-GCM ciphertext (@podbay/shared/crypto, PODBAY_CRED_KEY) — never plaintext, never sent to
 * the client. Connect once (dashboard Settings); every pod (launch + add-to-existing) reuses it.
 * `expiresAt` NULL = durable (the go-forward default); a non-null value is the legacy 24h launch
 * buffer, still honored so old rows expire during a rollout. Disconnect deletes the row AND clears
 * the token from every owned pod; reconnect restores it to all.
 */
export const githubConnections = pgTable("github_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenEnc: text("token_enc").notNull(),
  login: text("login").notNull(),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  // NULL = a durable, owner-managed connection (the go-forward default): it does not expire on its
  // own and is the single source of truth every pod draws from. A non-null value is the legacy 24h
  // launch-buffer TTL, still honored so old rows expire as before during a rollout.
  expiresAt: timestamp("expires_at"),
});

/**
 * Pod-base image manifest — one row per published image, so an image update is
 * legible (what each digest brings) and prunable (which are safe to delete).
 * docs/plans/image-manifest — the digest was a bare env string with no record.
 * `env` defaults to "pod-base" (the monolith); it generalizes if we ever split to
 * per-env images. Notes are auto-derived from the git commit range at record time.
 */
export const podBaseImages = pgTable("pod_base_images", {
  digest: text("digest").primaryKey(), // incus image fingerprint
  alias: text("alias"), // incus alias, e.g. pod-base-20260722-2010
  env: text("env").notNull().default("pod-base"),
  fromSha: text("from_sha"), // git range start (prev image's toSha)
  toSha: text("to_sha"), // git HEAD the image was built from
  notes: text("notes"), // auto-derived release notes (commit range)
  summary: text("summary"), // optional one-line human summary
  // Optional semantic-version LABEL for a release (release-versioning change). NULLABLE and additive:
  // the 64-char digest stays the image's identity for every boot/compare decision — version affects
  // presentation only, and every pre-versioning row is NULL and renders with the digest as before.
  // Stored per-row (not derived) so rollback shows the re-promoted image's OWN version going backwards.
  version: text("version"),
  sizeBytes: bigint("size_bytes", { mode: "number" }), // image bytes exceed int4 (2GB+)
  // current | superseded | rolled-back
  status: text("status").notNull().default("superseded"),
  builtAt: timestamp("built_at"),
  builtBy: text("built_by"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

/** Runtime state for a code-defined landing experiment. Definitions and
 * allocation stay immutable in code; admins can only stop or pin a variant. */
export type LandingExperimentVariant = "outcomes" | "agent-computer" | "agent-home" | "selfhost";
export type LandingExperimentRuntimeStatus = "active" | "stopped";
export type LandingExperimentEventType =
  | "landing_exposure"
  | "landing_primary_cta"
  | "landing_example_select"
  | "landing_starter_select"
  | "landing_playbook_select"
  | "signin_completed"
  | "pod_created"
  | "agent_connected"
  | "first_project_opened";

export const landingExperimentRuns = pgTable(
  "landing_experiment_runs",
  {
    experimentId: text("experiment_id").primaryKey(),
    status: text("status").$type<LandingExperimentRuntimeStatus>().notNull().default("active"),
    pinnedVariant: text("pinned_variant").$type<LandingExperimentVariant>(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at"),
    rejectedEvents: integer("rejected_events").notNull().default(0),
    duplicateEvents: integer("duplicate_events").notNull().default(0),
    ingestionFailures: integer("ingestion_failures").notNull().default(0),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("landing_runs_status_check", sql`${t.status} in ('active', 'stopped')`),
    check(
      "landing_runs_pin_check",
      sql`${t.pinnedVariant} is null or ${t.pinnedVariant} in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')`,
    ),
  ],
);

/** One stable anonymous assignment per experiment. No raw IP or arbitrary
 * metadata is retained; campaign fields are bounded by the web ingestion layer. */
export const landingExperimentAssignments = pgTable(
  "landing_experiment_assignments",
  {
    experimentId: text("experiment_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    variant: text("variant").$type<LandingExperimentVariant>().notNull(),
    eligible: boolean("eligible").notNull().default(true),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.visitorId] }),
    check(
      "landing_assignments_variant_check",
      sql`${t.variant} in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')`,
    ),
    index("landing_assignments_user_idx").on(t.userId),
    index("landing_assignments_variant_idx").on(t.experimentId, t.variant),
  ],
);

/** First-party landing funnel. The unique key intentionally records the first
 * occurrence of each funnel event per anonymous participant. */
export const landingExperimentEvents = pgTable(
  "landing_experiment_events",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    variant: text("variant").$type<LandingExperimentVariant>().notNull(),
    type: text("type").$type<LandingExperimentEventType>().notNull(),
    item: text("item"),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("landing_events_funnel_once_idx").on(t.experimentId, t.visitorId, t.type),
    check("landing_events_variant_check", sql`${t.variant} in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')`),
    check(
      "landing_events_type_check",
      sql`${t.type} in ('landing_exposure', 'landing_primary_cta', 'landing_example_select', 'landing_starter_select', 'landing_playbook_select', 'signin_completed', 'pod_created', 'agent_connected', 'first_project_opened')`,
    ),
    index("landing_events_experiment_at_idx").on(t.experimentId, t.at),
    index("landing_events_user_idx").on(t.userId),
  ],
);

/** Immutable audit trail for the only two mutable experiment operations:
 * stopping enrollment and pinning a declared variant. */
export const landingExperimentAudit = pgTable(
  "landing_experiment_audit",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: text("action").$type<"stop" | "pin" | "unpin">().notNull(),
    previousStatus: text("previous_status")
      .$type<LandingExperimentRuntimeStatus>()
      .notNull(),
    previousPinnedVariant: text("previous_pinned_variant").$type<LandingExperimentVariant>(),
    nextStatus: text("next_status").$type<LandingExperimentRuntimeStatus>().notNull(),
    nextPinnedVariant: text("next_pinned_variant").$type<LandingExperimentVariant>(),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [
    index("landing_audit_experiment_at_idx").on(t.experimentId, t.at),
    check("landing_audit_action_check", sql`${t.action} in ('stop', 'pin', 'unpin')`),
    check(
      "landing_audit_status_check",
      sql`${t.previousStatus} in ('active', 'stopped') and ${t.nextStatus} in ('active', 'stopped')`,
    ),
    check(
      "landing_audit_pin_check",
      sql`(${t.previousPinnedVariant} is null or ${t.previousPinnedVariant} in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')) and (${t.nextPinnedVariant} is null or ${t.nextPinnedVariant} in ('outcomes', 'agent-computer', 'agent-home', 'selfhost'))`,
    ),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  pods,
  podEvents,
  podSecrets,
  githubConnections,
  podBaseImages,
  landingExperimentRuns,
  landingExperimentAssignments,
  landingExperimentEvents,
  landingExperimentAudit,
};
export type Schema = typeof schema;

/**
 * What we have learned about fetching a given domain.
 *
 * A capability map, deliberately NOT a research log. Storing a full URL here would
 * turn a fleet-wide table into a record of what every owner reads, which is the
 * thing that makes "shared" unacceptable. Domain, rung, outcome — nothing else, and
 * no pod or owner attribution.
 *
 * Expiry is derived from `lastVerified` rather than stored, so changing the TTL is a
 * config change instead of a migration.
 */
export const fetchMemory = pgTable(
  "fetch_memory",
  {
    /** Owner the verdict was learned by (pre-Alpha security M1). "" = the TRUSTED global
     * baseline (podbay-seeded / pre-multi-tenant rows). A fetch report from an untrusted
     * tenant pod is attributed to THAT owner, so one pod can only steer its own owner's
     * fetch ladder — a plan pushed to a pod = the global baseline + its own owner's rows,
     * never another tenant's. */
    ownerId: text("owner_id").notNull().default(""),
    /** Registrable host, lowercased, no scheme/path/port/www. */
    domain: text("domain").notNull(),
    /** api | direct | browser | archive | reader | relay */
    rung: text("rung").notNull(),
    okCount: integer("ok_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),
    /** ok | blocked | challenged | login | empty */
    lastOutcome: text("last_outcome").notNull(),
    lastVerified: timestamp("last_verified").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.domain, t.rung] }),
    index("fetch_memory_owner_domain_idx").on(t.ownerId, t.domain),
  ],
);

/**
 * Durable, owner-scoped messages between a user's OWN pods (agent-messaging).
 *
 * The routing rail reuses the reconcile poll and tmux injection podbay already has:
 * a sending pod appends to a local outbox on its volume (no outbound credential), the
 * poll drains it and inserts a row here, and delivery injects a framed turn into the
 * recipient's session. Everything is gated on `owner_id` — a message can never cross
 * owners, enforced by resolving `to_pod` only within the sender's fleet.
 *
 * `id` is a client-generated nonce minted in the pod outbox: it is the PK precisely so
 * a re-drained outbox (at-least-once by design) inserts the same message once —
 * deliver-at-most-once starts at ingest, not delivery.
 */
export const agentMessages = pgTable(
  "agent_messages",
  {
    /** Client nonce from the pod outbox. PART of the PK (with owner_id) so a re-drain is
     * idempotent PER OWNER — while the SAME nonce from two DIFFERENT owners stays two distinct
     * messages rather than the second being silently swallowed as a duplicate. */
    id: text("id").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Sender pod slug — attributed by the drain (the pod it came from), never trusted
     * from the outbox line, so a sender cannot spoof its identity. */
    fromPod: text("from_pod").notNull(),
    /** Recipient pod slug, resolved within the owner's fleet at routing time. */
    toPod: text("to_pod").notNull(),
    body: text("body").notNull(),
    /** pending → delivered. Delivery flips it so a later poll never re-injects. */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => [
    // Composite PK: idempotent re-drain per owner, without cross-owner nonce collisions.
    primaryKey({ columns: [t.ownerId, t.id] }),
    // The delivery scan: pending messages for one recipient, oldest first.
    index("agent_messages_recipient_idx").on(t.ownerId, t.toPod, t.status),
    // The rate-guard scan: recent traffic on a sender→recipient pair.
    index("agent_messages_pair_idx").on(t.ownerId, t.fromPod, t.toPod, t.createdAt),
  ],
);

/**
 * A short-lived, one-time code that lets an owner's relay authenticate to the gateway.
 *
 * DB-backed on purpose: the web app mints the code and the GATEWAY redeems it, and
 * those are separate processes (podbay-web vs podbay-gateway) that share only the
 * database, never memory. Same shape as Codex device pairing — owner-bound, expiring,
 * single-use (`spentAt` set on first redeem, so a leaked code buys one race at most).
 */
export const relayPairingCodes = pgTable(
  "relay_pairing_codes",
  {
    /** The opaque code the owner pastes into `relay start --code`. */
    code: text("code").primaryKey(),
    ownerId: text("owner_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set when the code is first redeemed; a second redeem is refused. */
    spentAt: timestamp("spent_at"),
  },
  (t) => [index("relay_pairing_owner_idx").on(t.ownerId)],
);

/**
 * The live fact that an owner has a relay connected — the source of truth OUTSIDE the
 * gateway's memory, so the admin fleet view and a pod's relay-state both have somewhere
 * to read from. The gateway upserts on connect and heartbeat, deletes on a clean
 * disconnect; a row whose `lastSeenAt` has gone stale (gateway crash) is treated as
 * disconnected by readers rather than trusted.
 */
export const relayConnections = pgTable("relay_connections", {
  ownerId: text("owner_id").primaryKey(),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  /** Domains the owner has done `relay login` for — shown to their pods so an
   * agent can report a source as reachable-as-them before trying. Never the fetch log. */
  loginDomains: jsonb("login_domains").$type<string[]>().notNull().default([]),
  /** Relay-liveness observability (2026-08-18): the row is NO LONGER deleted on disconnect — it's
   * marked with `disconnectedAt` and `dropCount++`, so the owner can SEE that the relay dropped/
   * flapped (previously invisible: "connected, 0 errors"). `disconnectedAt` NULL = currently up.
   * A reconnect (markConnected) clears `disconnectedAt` but PRESERVES `dropCount`. */
  disconnectedAt: timestamp("disconnected_at"),
  dropCount: integer("drop_count").notNull().default(0),
});

/**
 * A durable, REUSABLE token the relay uses to RECONNECT.
 *
 * The pairing code is single-use (right for initial pairing), but that made the relay
 * die on any gateway restart or network blip — its reconnect re-presented the spent
 * code and got rejected. So at pairing the gateway also issues one of these: long-lived
 * (weeks), reusable, owner-bound. The relay stores it and reconnects with `?token=`;
 * the gateway validates it WITHOUT consuming it. Revoked on `relay reset`.
 */
export const relayTokens = pgTable(
  "relay_tokens",
  {
    token: text("token").primaryKey(),
    ownerId: text("owner_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    /** Bumped each reconnect, so a stale token can be pruned and the admin view can
     * show when a relay last actually used it. */
    lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  },
  (t) => [index("relay_tokens_owner_idx").on(t.ownerId)],
);
