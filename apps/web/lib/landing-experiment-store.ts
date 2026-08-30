import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  createAppDb,
  desc,
  eq,
  landingExperimentAssignments,
  landingExperimentAudit,
  landingExperimentEvents,
  landingExperimentRuns,
  sql,
  type Database,
} from "@podbay/db";
import {
  ACTIVE_LANDING_EXPERIMENT,
  LANDING_EVENT_TYPES,
  LANDING_EXPERIMENTS,
  SELFHOST_HOMEPAGE_CONTROL,
  getLandingExperimentDefinition,
  isLandingEvent,
  isLandingVisitorId,
  isMutableLandingDefinition,
  isVariantForExperiment,
  landingPreviewPath,
  type LandingDeliveryMode,
  type LandingExperimentDefinition,
  type LandingExperimentEvent,
  type LandingVariant,
} from "./landing-experiment-config";

export type ExperimentRuntimeStatus = "active" | "stopped";

export interface ExperimentRuntime {
  status: ExperimentRuntimeStatus;
  pinnedVariant: LandingVariant | null;
  startedAt: Date;
  stoppedAt: Date | null;
  rejectedEvents: number;
  duplicateEvents: number;
  ingestionFailures: number;
}

export interface LandingEventInput {
  experimentId?: string;
  visitorId: string;
  variant: LandingVariant;
  type: LandingExperimentEvent;
  eligible?: boolean;
  userId?: string | null;
  item?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

const FUNNEL: LandingExperimentEvent[] = [
  "landing_exposure",
  "landing_primary_cta",
  "signin_completed",
  "pod_created",
  "agent_connected",
  "first_project_opened",
];

function definitionFor(experimentId: string): LandingExperimentDefinition {
  const definition = getLandingExperimentDefinition(experimentId);
  if (!definition) throw new Error("Unknown landing experiment");
  return definition;
}

function bounded(value: string | null | undefined, max = 160): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
}

async function ensureRun(db: Database, definition: LandingExperimentDefinition) {
  await db
    .insert(landingExperimentRuns)
    .values({ experimentId: definition.id })
    .onConflictDoNothing();
  const [run] = await db
    .select()
    .from(landingExperimentRuns)
    .where(eq(landingExperimentRuns.experimentId, definition.id))
    .limit(1);
  if (!run) throw new Error("Landing experiment runtime could not be initialized");
  return run;
}

function normalizeRuntime(
  run: typeof landingExperimentRuns.$inferSelect,
  definition: LandingExperimentDefinition,
): ExperimentRuntime {
  return {
    status: run.status === "stopped" ? "stopped" : "active",
    pinnedVariant: isVariantForExperiment(definition, run.pinnedVariant)
      ? run.pinnedVariant
      : null,
    startedAt: run.startedAt,
    stoppedAt: run.stoppedAt,
    rejectedEvents: run.rejectedEvents,
    duplicateEvents: run.duplicateEvents,
    ingestionFailures: run.ingestionFailures,
  };
}

export async function getExperimentRuntime(
  db = createAppDb(),
  experimentId: string = ACTIVE_LANDING_EXPERIMENT.id,
): Promise<ExperimentRuntime> {
  const definition = definitionFor(experimentId);
  return normalizeRuntime(await ensureRun(db, definition), definition);
}

export async function getExperimentRuntimeSafe(
  experimentId: string = ACTIVE_LANDING_EXPERIMENT.id,
): Promise<ExperimentRuntime> {
  try {
    return await getExperimentRuntime(undefined, experimentId);
  } catch {
    return {
      status: "active",
      pinnedVariant: null,
      startedAt: new Date(),
      stoppedAt: null,
      rejectedEvents: 0,
      duplicateEvents: 0,
      ingestionFailures: 0,
    };
  }
}

async function incrementHealth(
  field: "rejectedEvents" | "duplicateEvents" | "ingestionFailures",
  db = createAppDb(),
  experimentId: string = ACTIVE_LANDING_EXPERIMENT.id,
): Promise<void> {
  try {
    const definition = definitionFor(experimentId);
    await ensureRun(db, definition);
    await db
      .update(landingExperimentRuns)
      .set({
        [field]: sql`${landingExperimentRuns[field]} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(landingExperimentRuns.experimentId, definition.id));
  } catch {
    // Health telemetry must never become a second failure path.
  }
}

export async function recordRejectedLandingEvent(): Promise<void> {
  await incrementHealth("rejectedEvents");
}

export async function recordLandingEvent(
  input: LandingEventInput,
  db = createAppDb(),
): Promise<"recorded" | "duplicate" | "excluded" | "stopped"> {
  const experimentId = input.experimentId ?? ACTIVE_LANDING_EXPERIMENT.id;
  const definition = getLandingExperimentDefinition(experimentId);
  if (
    !definition ||
    !isLandingVisitorId(input.visitorId) ||
    !isVariantForExperiment(definition, input.variant) ||
    !isLandingEvent(input.type)
  ) {
    await incrementHealth("rejectedEvents", db);
    return "excluded";
  }

  const runtime = await getExperimentRuntime(db, experimentId);
  if (runtime.status === "stopped" && input.type === "landing_exposure") return "stopped";

  const now = new Date();
  const eligible = input.eligible ?? true;
  try {
    await db
      .insert(landingExperimentAssignments)
      .values({
        experimentId,
        visitorId: input.visitorId,
        variant: input.variant,
        eligible,
        userId: input.userId ?? null,
        referrer: bounded(input.referrer, 300),
        utmSource: bounded(input.utmSource),
        utmMedium: bounded(input.utmMedium),
        utmCampaign: bounded(input.utmCampaign),
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [
          landingExperimentAssignments.experimentId,
          landingExperimentAssignments.visitorId,
        ],
        set: {
          lastSeenAt: now,
          userId: input.userId ?? undefined,
          eligible,
        },
      });

    if (!eligible) return "excluded";

    const inserted = await db
      .insert(landingExperimentEvents)
      .values({
        id: randomUUID(),
        experimentId,
        visitorId: input.visitorId,
        userId: input.userId ?? null,
        variant: input.variant,
        type: input.type,
        item: bounded(input.item, 100),
        at: now,
      })
      .onConflictDoNothing()
      .returning({ id: landingExperimentEvents.id });

    if (inserted.length === 0) {
      await incrementHealth("duplicateEvents", db, experimentId);
      return "duplicate";
    }
    return "recorded";
  } catch (error) {
    await incrementHealth("ingestionFailures", db, experimentId);
    throw error;
  }
}

export async function linkLandingAttribution(
  userId: string,
  visitorId: string | null,
  variant: string | null,
): Promise<void> {
  if (
    !visitorId ||
    !isLandingVisitorId(visitorId) ||
    !isVariantForExperiment(ACTIVE_LANDING_EXPERIMENT, variant)
  ) return;
  await recordLandingEvent({
    visitorId,
    variant,
    type: "signin_completed",
    userId,
  }).catch(() => undefined);
}

export async function recordAttributedUserEvent(
  userId: string,
  type: Extract<
    LandingExperimentEvent,
    "pod_created" | "agent_connected" | "first_project_opened"
  >,
  item?: string,
  db = createAppDb(),
): Promise<void> {
  const [assignment] = await db
    .select()
    .from(landingExperimentAssignments)
    .where(
      and(
        eq(landingExperimentAssignments.experimentId, ACTIVE_LANDING_EXPERIMENT.id),
        eq(landingExperimentAssignments.userId, userId),
      ),
    )
    .orderBy(desc(landingExperimentAssignments.lastSeenAt))
    .limit(1);
  if (!assignment || !isVariantForExperiment(ACTIVE_LANDING_EXPERIMENT, assignment.variant)) {
    return;
  }
  await recordLandingEvent(
    {
      visitorId: assignment.visitorId,
      variant: assignment.variant,
      type,
      userId,
      item,
      eligible: assignment.eligible,
    },
    db,
  ).catch(() => undefined);
}

type VariantFunnel = Record<LandingExperimentEvent, number>;

function emptyFunnel(): VariantFunnel {
  return Object.fromEntries(LANDING_EVENT_TYPES.map((event) => [event, 0])) as VariantFunnel;
}

export interface VariantExperimentReport {
  assignments: number;
  funnel: VariantFunnel;
  exposureDenominator: number;
}

export interface ExperimentSummary {
  id: string;
  label: string;
  hypothesis: string;
  status: ExperimentRuntimeStatus;
  pinnedVariant: LandingVariant | null;
  startedAt: Date;
  stoppedAt: Date | null;
  eligibleVisitors: number;
  exposures: number;
  primaryConversions: number;
  deliveryMode: LandingDeliveryMode;
  allocation: Readonly<Partial<Record<LandingVariant, number>>>;
  activeDefinition: boolean;
  mutableDefinition: boolean;
  controlType: LandingExperimentDefinition["controlType"];
}

export interface ExperimentDetail extends ExperimentSummary {
  variantOrder: readonly LandingVariant[];
  primaryMetric: LandingExperimentEvent;
  activationMetrics: readonly LandingExperimentEvent[];
  guardrailMetric: LandingExperimentEvent;
  observationWindow: string;
  minimumExposuresPerVariant: number;
  baseline: string;
  retentionDays: number;
  narrativeFreeze: string;
  variants: Partial<Record<LandingVariant, VariantExperimentReport>>;
  previewLinks: Array<{ variant: LandingVariant; href: string }>;
  acquisition: Array<{
    variant: LandingVariant;
    source: string;
    campaign: string;
    visitors: number;
  }>;
  sampleProgress: {
    minimumObserved: number;
    targetPerVariant: number;
    percent: number;
  };
  assignmentBalance: {
    status: "insufficient" | "ok" | "warning";
    maxStandardDeviation: number;
  };
  health: {
    rejectedEvents: number;
    duplicateEvents: number;
    ingestionFailures: number;
    ineligibleAssignments: number;
  };
  recentEvents: Array<{
    at: Date;
    variant: string;
    type: string;
    item: string | null;
    attributed: boolean;
  }>;
  audit: Array<{
    at: Date;
    action: string;
    actorUserId: string;
    previousStatus: string;
    previousPinnedVariant: string | null;
    nextStatus: string;
    nextPinnedVariant: string | null;
  }>;
}

export function wilsonInterval(successes: number, total: number): [number, number] | null {
  if (total <= 0) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export async function getExperimentDetail(
  experimentId: string = ACTIVE_LANDING_EXPERIMENT.id,
  db = createAppDb(),
): Promise<ExperimentDetail | null> {
  const definition = getLandingExperimentDefinition(experimentId);
  if (!definition) return null;
  const run = await ensureRun(db, definition);
  const [assignments, events, audit] = await Promise.all([
    db
      .select()
      .from(landingExperimentAssignments)
      .where(eq(landingExperimentAssignments.experimentId, experimentId)),
    db
      .select()
      .from(landingExperimentEvents)
      .where(eq(landingExperimentEvents.experimentId, experimentId))
      .orderBy(desc(landingExperimentEvents.at)),
    db
      .select()
      .from(landingExperimentAudit)
      .where(eq(landingExperimentAudit.experimentId, experimentId))
      .orderBy(desc(landingExperimentAudit.at)),
  ]);

  const variants = Object.fromEntries(
    definition.variants.map((variant) => [
      variant,
      { assignments: 0, funnel: emptyFunnel(), exposureDenominator: 0 },
    ]),
  ) as Partial<Record<LandingVariant, VariantExperimentReport>>;

  const acquisition = new Map<string, number>();
  let eligibleVisitors = 0;
  let ineligibleAssignments = 0;
  for (const assignment of assignments) {
    if (!isVariantForExperiment(definition, assignment.variant)) continue;
    if (assignment.eligible) {
      eligibleVisitors += 1;
      variants[assignment.variant]!.assignments += 1;
      const source = assignment.utmSource ?? assignment.referrer ?? "Direct / unknown";
      const campaign = assignment.utmCampaign ?? "None";
      const key = `${assignment.variant}\u0000${source}\u0000${campaign}`;
      acquisition.set(key, (acquisition.get(key) ?? 0) + 1);
    } else {
      ineligibleAssignments += 1;
    }
  }

  for (const event of events) {
    if (!isVariantForExperiment(definition, event.variant) || !isLandingEvent(event.type)) continue;
    variants[event.variant]!.funnel[event.type] += 1;
  }
  for (const variant of definition.variants) {
    variants[variant]!.exposureDenominator = variants[variant]!.funnel.landing_exposure;
  }

  const runtime = normalizeRuntime(run, definition);
  const exposures = definition.variants.reduce(
    (total, variant) => total + variants[variant]!.funnel.landing_exposure,
    0,
  );
  const primaryConversions = definition.variants.reduce(
    (total, variant) => total + variants[variant]!.funnel[definition.primaryMetric],
    0,
  );
  const minimumObserved = Math.min(
    ...definition.variants.map((variant) => variants[variant]!.funnel.landing_exposure),
  );
  const maxStandardDeviation = definition.variants.reduce((max, variant) => {
    const share = (definition.allocation[variant] ?? 0) / 100;
    const expected = eligibleVisitors * share;
    const deviation = Math.abs(variants[variant]!.assignments - expected);
    const standardDeviation = Math.sqrt(eligibleVisitors * share * (1 - share));
    return Math.max(max, standardDeviation ? deviation / standardDeviation : 0);
  }, 0);

  return {
    id: definition.id,
    label: definition.label,
    hypothesis: definition.hypothesis,
    status: runtime.status,
    pinnedVariant: runtime.pinnedVariant,
    startedAt: runtime.startedAt,
    stoppedAt: runtime.stoppedAt,
    eligibleVisitors,
    exposures,
    primaryConversions,
    deliveryMode: definition.deliveryMode,
    allocation: definition.allocation,
    activeDefinition: definition.id === ACTIVE_LANDING_EXPERIMENT.id,
    mutableDefinition: isMutableLandingDefinition(definition.id),
    controlType: definition.controlType,
    variantOrder: definition.variants,
    primaryMetric: definition.primaryMetric,
    activationMetrics: definition.activationMetrics,
    guardrailMetric: definition.guardrailMetric,
    observationWindow: definition.observationWindow,
    minimumExposuresPerVariant: definition.minimumExposuresPerVariant,
    baseline: definition.baseline,
    retentionDays: definition.retentionDays,
    narrativeFreeze: definition.narrativeFreeze,
    variants,
    previewLinks: definition.variants.map((variant) => ({
      variant,
      href: landingPreviewPath(variant),
    })),
    acquisition: [...acquisition.entries()]
      .map(([key, visitors]) => {
        const [variant, source, campaign] = key.split("\u0000");
        return { variant: variant as LandingVariant, source, campaign, visitors };
      })
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 30),
    sampleProgress: {
      minimumObserved,
      targetPerVariant: definition.minimumExposuresPerVariant,
      percent: Math.min(
        100,
        Math.round((minimumObserved / definition.minimumExposuresPerVariant) * 100),
      ),
    },
    assignmentBalance: {
      status:
        eligibleVisitors < 30
          ? "insufficient"
          : maxStandardDeviation >= 3
            ? "warning"
            : "ok",
      maxStandardDeviation,
    },
    health: {
      rejectedEvents: runtime.rejectedEvents,
      duplicateEvents: runtime.duplicateEvents,
      ingestionFailures: runtime.ingestionFailures,
      ineligibleAssignments,
    },
    recentEvents: events.slice(0, 100).map((event) => ({
      at: event.at,
      variant: event.variant,
      type: event.type,
      item: event.item,
      attributed: Boolean(event.userId),
    })),
    audit: audit.map((entry) => ({
      at: entry.at,
      action: entry.action,
      actorUserId: entry.actorUserId,
      previousStatus: entry.previousStatus,
      previousPinnedVariant: entry.previousPinnedVariant,
      nextStatus: entry.nextStatus,
      nextPinnedVariant: entry.nextPinnedVariant,
    })),
  };
}

export async function listExperimentSummaries(
  db = createAppDb(),
): Promise<ExperimentSummary[]> {
  const details = await Promise.all(
    [...LANDING_EXPERIMENTS]
      .reverse()
      .map((definition) => getExperimentDetail(definition.id, db)),
  );
  return details.filter((detail): detail is ExperimentDetail => detail !== null).map((detail) => ({
    id: detail.id,
    label: detail.label,
    hypothesis: detail.hypothesis,
    status: detail.status,
    pinnedVariant: detail.pinnedVariant,
    startedAt: detail.startedAt,
    stoppedAt: detail.stoppedAt,
    eligibleVisitors: detail.eligibleVisitors,
    exposures: detail.exposures,
    primaryConversions: detail.primaryConversions,
    deliveryMode: detail.deliveryMode,
    allocation: detail.allocation,
    activeDefinition: detail.activeDefinition,
    mutableDefinition: detail.mutableDefinition,
    controlType: detail.controlType,
  }));
}

export async function stopExperiment(
  actorUserId: string,
  experimentId: string,
  db = createAppDb(),
): Promise<ExperimentRuntime> {
  if (experimentId !== ACTIVE_LANDING_EXPERIMENT.id) {
    throw new Error("Historical landing experiments are read-only");
  }
  const definition = definitionFor(experimentId);
  const current = await ensureRun(db, definition);
  const nextPinned = isVariantForExperiment(definition, current.pinnedVariant)
    ? current.pinnedVariant
    : definition.fallbackVariant;
  if (current.status === "stopped" && current.pinnedVariant === nextPinned) {
    return normalizeRuntime(current, definition);
  }
  const now = new Date();
  await db
    .update(landingExperimentRuns)
    .set({
      status: "stopped",
      pinnedVariant: nextPinned,
      stoppedAt: now,
      updatedBy: actorUserId,
      updatedAt: now,
    })
    .where(eq(landingExperimentRuns.experimentId, experimentId));
  await db.insert(landingExperimentAudit).values({
    id: randomUUID(),
    experimentId,
    actorUserId,
    action: "stop",
    previousStatus: current.status,
    previousPinnedVariant: current.pinnedVariant,
    nextStatus: "stopped",
    nextPinnedVariant: nextPinned,
    at: now,
  });
  return getExperimentRuntime(db, experimentId);
}

export async function pinExperimentVariant(
  actorUserId: string,
  experimentId: string,
  variant: string,
  db = createAppDb(),
): Promise<ExperimentRuntime> {
  if (!isMutableLandingDefinition(experimentId)) {
    throw new Error("Historical landing experiments are read-only");
  }
  const definition = definitionFor(experimentId);
  if (!isVariantForExperiment(definition, variant)) throw new Error("Unknown landing variant");
  await ensureRun(db, definition);
  const now = new Date();
  const auditId = randomUUID();
  await db.execute(sql`
    WITH current AS MATERIALIZED (
      SELECT status, pinned_variant
      FROM landing_experiment_runs
      WHERE experiment_id = ${experimentId}
      FOR UPDATE
    ), updated AS (
      UPDATE landing_experiment_runs AS run
      SET status = 'stopped',
          pinned_variant = ${variant},
          stopped_at = COALESCE(run.stopped_at, ${now}),
          updated_by = ${actorUserId},
          updated_at = ${now}
      FROM current
      WHERE run.experiment_id = ${experimentId}
        AND NOT (current.status = 'stopped' AND current.pinned_variant IS NOT DISTINCT FROM ${variant})
      RETURNING current.status AS previous_status,
                current.pinned_variant AS previous_pinned_variant
    ), audited AS (
      INSERT INTO landing_experiment_audit (
        id, experiment_id, actor_user_id, action,
        previous_status, previous_pinned_variant,
        next_status, next_pinned_variant, at
      )
      SELECT ${auditId}, ${experimentId}, ${actorUserId}, 'pin',
             previous_status, previous_pinned_variant,
             'stopped', ${variant}, ${now}
      FROM updated
      RETURNING id
    )
    SELECT id FROM audited
  `);
  return getExperimentRuntime(db, experimentId);
}

export async function clearExperimentPin(
  actorUserId: string,
  experimentId: string,
  db = createAppDb(),
): Promise<ExperimentRuntime> {
  if (experimentId !== SELFHOST_HOMEPAGE_CONTROL.id) {
    throw new Error("Only the homepage promotion can be unpinned");
  }
  const definition = definitionFor(experimentId);
  await ensureRun(db, definition);
  const now = new Date();
  const auditId = randomUUID();
  await db.execute(sql`
    WITH current AS MATERIALIZED (
      SELECT status, pinned_variant
      FROM landing_experiment_runs
      WHERE experiment_id = ${experimentId}
      FOR UPDATE
    ), updated AS (
      UPDATE landing_experiment_runs AS run
      SET status = 'active',
          pinned_variant = NULL,
          stopped_at = NULL,
          updated_by = ${actorUserId},
          updated_at = ${now}
      FROM current
      WHERE run.experiment_id = ${experimentId}
        AND NOT (current.status = 'active' AND current.pinned_variant IS NULL)
      RETURNING current.status AS previous_status,
                current.pinned_variant AS previous_pinned_variant
    ), audited AS (
      INSERT INTO landing_experiment_audit (
        id, experiment_id, actor_user_id, action,
        previous_status, previous_pinned_variant,
        next_status, next_pinned_variant, at
      )
      SELECT ${auditId}, ${experimentId}, ${actorUserId}, 'unpin',
             previous_status, previous_pinned_variant,
             'active', NULL, ${now}
      FROM updated
      RETURNING id
    )
    SELECT id FROM audited
  `);
  return getExperimentRuntime(db, experimentId);
}

export async function isSelfhostHomepageEnabled(): Promise<boolean> {
  const runtime = await getExperimentRuntimeSafe(SELFHOST_HOMEPAGE_CONTROL.id);
  return runtime.status === "stopped" && runtime.pinnedVariant === "selfhost";
}

export const LANDING_FUNNEL_EVENTS = FUNNEL;
