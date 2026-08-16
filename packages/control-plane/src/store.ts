import type { PodEvent, PodRecord, PodStatus} from "./types.js";

/** Persistence abstraction. In-memory now; a Postgres/Drizzle impl comes later. */
export interface PodStore {
  create(record: PodRecord): Promise<PodRecord>;
  get(id: string): Promise<PodRecord | null>;
  listByOwner(ownerId: string): Promise<PodRecord[]>;
  /** Pods in the given statuses. A filtered query, so a sweep does not load every row
   * (including long-destroyed ones) once a minute. */
  listByStatus(statuses: PodStatus[]): Promise<PodRecord[]>;
  /** All records — for system-wide operations like the idle policy. */
  list(): Promise<PodRecord[]>;
  update(id: string, patch: Partial<PodRecord>): Promise<PodRecord>;
  delete(id: string): Promise<void>;
  /** Atomically claim up to `limit` unleased "provisioning" pods for the caller:
   * set their lease to `leaseUntil` and bump `provisionAttempts`, returning the
   * ones this caller won. Race-safe across processes (compare-and-swap on the
   * lease), so multiple gateway workers never build the same pod. */
  claimProvisioning(now: string, leaseUntil: string, limit: number): Promise<PodRecord[]>;
  /** Append a lifecycle event. Append-only and never cascade-deleted with the pod:
   * the history is exactly what you need AFTER a pod is gone (cost accounting). */
  appendEvent(event: PodEvent): Promise<void>;
  /** Events for one pod (oldest first), or for ALL pods when podId is omitted —
   * the fleet view folds these into awake intervals. */
  listEvents(podId?: string): Promise<PodEvent[]>;
  /** Mark one event's cockpit banner dismissed (idempotent). */
  dismissEvent(eventId: string): Promise<void>;
}

export class InMemoryPodStore implements PodStore {
  private readonly records = new Map<string, PodRecord>();
  private readonly events: PodEvent[] = [];

  async appendEvent(event: PodEvent): Promise<void> {
    this.events.push({ ...event });
  }
  async listEvents(podId?: string): Promise<PodEvent[]> {
    return this.events
      .filter((e) => !podId || e.podId === podId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ ...e }));
  }
  async dismissEvent(eventId: string): Promise<void> {
    const e = this.events.find((x) => x.id === eventId);
    if (e) e.dismissedAt = new Date().toISOString();
  }

  async create(record: PodRecord): Promise<PodRecord> {
    this.records.set(record.id, { ...record });
    return { ...record };
  }
  async get(id: string): Promise<PodRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async listByOwner(ownerId: string): Promise<PodRecord[]> {
    return [...this.records.values()].filter((r) => r.ownerId === ownerId).map((r) => ({ ...r }));
  }
  async listByStatus(statuses: PodStatus[]): Promise<PodRecord[]> {
    const want = new Set(statuses);
    return (await this.list()).filter((p) => want.has(p.status));
  }

  async list(): Promise<PodRecord[]> {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
  async update(id: string, patch: Partial<PodRecord>): Promise<PodRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`pod record ${id} not found`);
    const next = { ...r, ...patch, id: r.id };
    this.records.set(id, next);
    return { ...next };
  }
  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
  async claimProvisioning(now: string, leaseUntil: string, limit: number): Promise<PodRecord[]> {
    const nowMs = Date.parse(now);
    const free = (r: PodRecord) =>
      r.status === "provisioning" &&
      (r.provisionLeaseUntil === null || Date.parse(r.provisionLeaseUntil) < nowMs);
    const claimed: PodRecord[] = [];
    for (const r of [...this.records.values()]
      .filter(free)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)) {
      const next = {
        ...r,
        provisionLeaseUntil: leaseUntil,
        provisionAttempts: r.provisionAttempts + 1,
      };
      this.records.set(r.id, next);
      claimed.push({ ...next });
    }
    return claimed;
  }
}
