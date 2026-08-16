import { and, eq, or, lt, isNull, sql, asc, inArray } from "@podbay/db";
import { pods, podEvents, type Database } from "@podbay/db";
import type { PodStore } from "./store.js";
import type { PodEvent, PodEventType, PodRecord, PodStatus } from "./types.js";

type Row = typeof pods.$inferSelect;

/** `sleeping` was renamed to `suspended` (2026-08-02). Rows are migrated, but any
 * pre-migration / mid-rollout read is normalized here so nothing downstream ever
 * sees the legacy token. */
const normStatus = (s: string): PodStatus => (s === "sleeping" ? "suspended" : (s as PodStatus));

function toRecord(row: Row): PodRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    environmentName: row.environmentName,
    name: row.name,
    status: normStatus(row.status),
    region: row.region,
    keepAwake: row.keepAwake,
    lifecycle: row.lifecycle as PodRecord["lifecycle"],
    previewPublic: row.previewPublic,
    githubRepo: row.githubRepo ?? null,
    agents: (row.agents as PodRecord["agents"]) ?? null,
    agentAuth: (row.agentAuth as PodRecord["agentAuth"]) ?? null,
    authedAt: row.authedAt ? row.authedAt.toISOString() : null,
    sessionUrl: row.sessionUrl,
    authUrl: row.authUrl ?? null,
    codexDevices: (row.codexDevices as PodRecord["codexDevices"]) ?? null,
    machineId: row.machineId,
    imageDigest: row.imageDigest,
    updatingSince: row.updatingSince ? row.updatingSince.toISOString() : null,
    maintenanceKind: row.maintenanceKind ?? null,
    updateStage: row.updateStage ?? null,
    provider: row.provider,
    size: row.size as PodRecord["size"],
    diskGb: row.diskGb,
    cpus: row.cpus,
    memoryMb: row.memoryMb,
    provisionAttempts: row.provisionAttempts,
    provisionLeaseUntil: row.provisionLeaseUntil ? row.provisionLeaseUntil.toISOString() : null,
    provisionError: row.provisionError,
    walkthroughSeenAt: row.walkthroughSeenAt ? row.walkthroughSeenAt.toISOString() : null,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
  };
}

/** Postgres/Drizzle implementation of PodStore. Maps ISO strings ↔ timestamp columns. */
export class DrizzlePodStore implements PodStore {
  constructor(private readonly db: Database) {}

  async create(record: PodRecord): Promise<PodRecord> {
    await this.db.insert(pods).values({
      id: record.id,
      ownerId: record.ownerId,
      environmentName: record.environmentName,
      name: record.name,
      status: record.status,
      region: record.region,
      keepAwake: record.keepAwake,
      lifecycle: record.lifecycle,
      previewPublic: record.previewPublic,
      githubRepo: record.githubRepo,
      agents: record.agents,
      agentAuth: record.agentAuth,
      authedAt: record.authedAt ? new Date(record.authedAt) : null,
      sessionUrl: record.sessionUrl,
      authUrl: record.authUrl,
      codexDevices: record.codexDevices,
      machineId: record.machineId,
      imageDigest: record.imageDigest,
      updatingSince: record.updatingSince ? new Date(record.updatingSince) : null,
      maintenanceKind: record.maintenanceKind ?? null,
      updateStage: record.updateStage,
      provider: record.provider,
      size: record.size,
      diskGb: record.diskGb,
      cpus: record.cpus ?? null,
      memoryMb: record.memoryMb ?? null,
      provisionAttempts: record.provisionAttempts,
      provisionLeaseUntil: record.provisionLeaseUntil ? new Date(record.provisionLeaseUntil) : null,
      provisionError: record.provisionError,
      walkthroughSeenAt: record.walkthroughSeenAt ? new Date(record.walkthroughSeenAt) : null,
      position: record.position ?? null,
      createdAt: new Date(record.createdAt),
      lastActiveAt: new Date(record.lastActiveAt),
    });
    return record;
  }

  async get(id: string): Promise<PodRecord | null> {
    const rows = await this.db.select().from(pods).where(eq(pods.id, id));
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listByOwner(ownerId: string): Promise<PodRecord[]> {
    const rows = await this.db.select().from(pods).where(eq(pods.ownerId, ownerId));
    return rows.map(toRecord);
  }

  async listByStatus(statuses: PodStatus[]): Promise<PodRecord[]> {
    if (statuses.length === 0) return [];
    const rows = await this.db
      .select()
      .from(pods)
      .where(inArray(pods.status, statuses));
    return rows.map(toRecord);
  }

  async list(): Promise<PodRecord[]> {
    return (await this.db.select().from(pods)).map(toRecord);
  }

  async update(id: string, patch: Partial<PodRecord>): Promise<PodRecord> {
    const set: Partial<Row> = {};
    if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
    if (patch.environmentName !== undefined) set.environmentName = patch.environmentName;
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.region !== undefined) set.region = patch.region;
    if (patch.keepAwake !== undefined) set.keepAwake = patch.keepAwake;
    if (patch.lifecycle !== undefined) set.lifecycle = patch.lifecycle;
    if (patch.previewPublic !== undefined) set.previewPublic = patch.previewPublic;
    if (patch.authedAt !== undefined) set.authedAt = patch.authedAt ? new Date(patch.authedAt) : null;
    if (patch.sessionUrl !== undefined) set.sessionUrl = patch.sessionUrl;
    if (patch.authUrl !== undefined) set.authUrl = patch.authUrl;
    if (patch.codexDevices !== undefined) set.codexDevices = patch.codexDevices;
    if (patch.machineId !== undefined) set.machineId = patch.machineId;
    if (patch.imageDigest !== undefined) set.imageDigest = patch.imageDigest;
    if (patch.updatingSince !== undefined)
      set.updatingSince = patch.updatingSince ? new Date(patch.updatingSince) : null;
    if (patch.maintenanceKind !== undefined) set.maintenanceKind = patch.maintenanceKind;
    if (patch.updateStage !== undefined) set.updateStage = patch.updateStage;
    if (patch.provider !== undefined) set.provider = patch.provider;
    if (patch.agents !== undefined) set.agents = patch.agents; // "Add agent" appends post-launch
    if (patch.size !== undefined) set.size = patch.size;
    if (patch.diskGb !== undefined) set.diskGb = patch.diskGb;
    // Self-host explicit sizing — without these, a resize's `update({cpus, memoryMb})` built an
    // empty SET and Drizzle threw "No values to set" (the terminal resize bug, velsa 2026-08-13).
    if (patch.cpus !== undefined) set.cpus = patch.cpus;
    if (patch.memoryMb !== undefined) set.memoryMb = patch.memoryMb;
    if (patch.provisionAttempts !== undefined) set.provisionAttempts = patch.provisionAttempts;
    if (patch.provisionLeaseUntil !== undefined)
      set.provisionLeaseUntil = patch.provisionLeaseUntil ? new Date(patch.provisionLeaseUntil) : null;
    if (patch.provisionError !== undefined) set.provisionError = patch.provisionError;
    if (patch.walkthroughSeenAt !== undefined)
      set.walkthroughSeenAt = patch.walkthroughSeenAt ? new Date(patch.walkthroughSeenAt) : null;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.createdAt !== undefined) set.createdAt = new Date(patch.createdAt);
    if (patch.lastActiveAt !== undefined) set.lastActiveAt = new Date(patch.lastActiveAt);

    await this.db.update(pods).set(set).where(eq(pods.id, id));
    const updated = await this.get(id);
    if (!updated) throw new Error(`pod record ${id} not found`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(pods).where(eq(pods.id, id));
  }

  async claimProvisioning(now: string, leaseUntil: string, limit: number): Promise<PodRecord[]> {
    const nowD = new Date(now);
    const free = or(isNull(pods.provisionLeaseUntil), lt(pods.provisionLeaseUntil, nowD));
    // Candidate ids (non-locking read; two gateways may see the same list).
    const candidates = await this.db
      .select({ id: pods.id })
      .from(pods)
      .where(and(eq(pods.status, "provisioning"), free))
      .orderBy(pods.createdAt)
      .limit(limit);
    // Claim each with a conditional UPDATE: the lease guard is a compare-and-swap,
    // so exactly one instance's update matches (the other gets 0 rows and skips).
    const claimed: PodRecord[] = [];
    for (const { id } of candidates) {
      const rows = await this.db
        .update(pods)
        .set({
          provisionLeaseUntil: new Date(leaseUntil),
          provisionAttempts: sql`${pods.provisionAttempts} + 1`,
        })
        .where(and(eq(pods.id, id), eq(pods.status, "provisioning"), free))
        .returning();
      if (rows[0]) claimed.push(toRecord(rows[0]));
    }
    return claimed;
  }

  async appendEvent(event: PodEvent): Promise<void> {
    await this.db.insert(podEvents).values({
      id: event.id,
      podId: event.podId,
      ownerId: event.ownerId,
      type: event.type,
      at: new Date(event.at),
      meta: event.meta,
    });
  }

  async listEvents(podId?: string): Promise<PodEvent[]> {
    const rows = await (podId
      ? this.db.select().from(podEvents).where(eq(podEvents.podId, podId)).orderBy(asc(podEvents.at))
      : this.db.select().from(podEvents).orderBy(asc(podEvents.at)));
    return rows.map((r) => ({
      id: r.id,
      podId: r.podId,
      ownerId: r.ownerId,
      type: r.type as PodEventType,
      at: r.at.toISOString(),
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
    }));
  }

  async dismissEvent(eventId: string): Promise<void> {
    await this.db
      .update(podEvents)
      .set({ dismissedAt: new Date() })
      .where(eq(podEvents.id, eventId));
  }
}
