import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { auditFile, eventsDir } from "./config.js";

export type RelayMode = "fetch" | "tunnel";
export type RelayOutcome =
  | "ok"
  | "site-refused"
  | "owner-blocked"
  | "safety-blocked"
  | "rate-limited"
  | "network-error";
export type RelaySource = { podId: string; podName?: string } | { system: "health-check" };

/** The only detailed event shape allowed across the local persistence boundary. */
export interface RelayEventV2 {
  v: 2;
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  source?: RelaySource;
  mode: RelayMode;
  outcome: RelayOutcome;
  target: string;
  finalTarget?: string;
  host: string;
  httpStatus?: number;
  session: boolean;
  reason?: string;
  bytesUp?: number;
  bytesDown?: number;
}

/** Rows written by pb <= 0.1.6. */
export interface AuditEntry {
  host: string;
  status: number;
  ms: number;
  session: boolean;
  error?: string;
  kind?: RelayMode;
  bytes?: number;
  at?: string;
}

export interface SafeFetchTarget { target: string; host: string }

/** Strip the credential-bearing and high-entropy portions before an event exists. */
export function safeFetchTarget(value: string): SafeFetchTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return null;
    return { target: url.toString(), host };
  } catch {
    return null;
  }
}

export function safeTunnelTarget(hostValue: string, port: number): { target: string; host: string } | null {
  const host = hostValue.trim().toLowerCase().replace(/\.$/, "");
  if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, target: host.includes(":") ? `[${host}]:${port}` : `${host}:${port}` };
}

export function fetchOutcome(status: number, error?: string): RelayOutcome {
  if (error) return "network-error";
  if (status === 403) return "site-refused";
  if (status === 429) return "rate-limited";
  if (status >= 200 && status < 400) return "ok";
  return "network-error";
}

function sourceOf(value: unknown): RelaySource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as { podId?: unknown; podName?: unknown; system?: unknown };
  if (typeof source.podId === "string" && source.podId.trim()) {
    const out: { podId: string; podName?: string } = { podId: source.podId.slice(0, 160) };
    // Gateway-authoritative display name, bounded like the id. Optional — absent means
    // the dashboard shows the id. (Old rows / old gateways simply omit it.)
    if (typeof source.podName === "string" && source.podName.trim()) out.podName = source.podName.slice(0, 160);
    return out;
  }
  if (source.system === "health-check") return { system: "health-check" };
  return undefined;
}

function boundedText(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

/** Rebuild a record from allowed fields, sanitizing targets again at the write boundary. */
export function sanitizeEvent(input: RelayEventV2): RelayEventV2 | null {
  const safe = input.mode === "fetch"
    ? safeFetchTarget(input.target)
    : (() => {
        const match = input.target.match(/^\[?([^\]]+?)\]?:([0-9]+)$/);
        return match ? safeTunnelTarget(match[1]!, Number(match[2])) : null;
      })();
  if (!safe) return null;
  const final = input.mode === "fetch" && input.finalTarget ? safeFetchTarget(input.finalTarget)?.target : undefined;
  return {
    v: 2,
    id: boundedText(input.id, 200) ?? crypto.randomUUID(),
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: new Date(input.finishedAt).toISOString(),
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
    source: sourceOf(input.source),
    mode: input.mode,
    outcome: input.outcome,
    target: safe.target,
    ...(final ? { finalTarget: final } : {}),
    host: safe.host,
    ...(Number.isInteger(input.httpStatus) ? { httpStatus: input.httpStatus } : {}),
    session: input.mode === "fetch" && input.session === true,
    ...(boundedText(input.reason) ? { reason: boundedText(input.reason) } : {}),
    ...(input.mode === "tunnel" ? {
      bytesUp: Math.max(0, Math.round(Number(input.bytesUp) || 0)),
      bytesDown: Math.max(0, Math.round(Number(input.bytesDown) || 0)),
    } : {}),
  };
}

function legacyToV2(row: AuditEntry, index: number, fallbackAt: string): RelayEventV2 | null {
  const mode = row.kind === "tunnel" ? "tunnel" : "fetch";
  const at = typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) ? row.at : fallbackAt;
  const target = mode === "tunnel"
    ? safeTunnelTarget(String(row.host ?? "unknown.invalid"), 443)?.target
    : safeFetchTarget(`https://${String(row.host ?? "unknown.invalid")}/`)?.target;
  if (!target) return null;
  return sanitizeEvent({
    v: 2,
    id: `legacy-${index}-${Date.parse(at) || 0}`,
    startedAt: at,
    finishedAt: new Date((Date.parse(at) || Date.now()) + Math.max(0, Number(row.ms) || 0)).toISOString(),
    durationMs: Math.max(0, Number(row.ms) || 0),
    mode,
    outcome: fetchOutcome(Number(row.status) || 0, row.error),
    target,
    host: String(row.host ?? "unknown.invalid"),
    ...(mode === "fetch" ? { httpStatus: Number(row.status) || 0 } : {}),
    session: row.session === true,
    ...(row.error ? { reason: row.error } : {}),
    ...(mode === "tunnel" ? { bytesUp: 0, bytesDown: Math.max(0, Number(row.bytes) || 0) } : {}),
  });
}

export interface EventQuery {
  since?: string;
  podId?: string;
  mode?: RelayMode;
  outcome?: RelayOutcome;
  site?: string;
  offset?: number;
  limit?: number;
}

/** Bounded, day-partitioned, owner-local JSONL with an in-memory retained index. */
export class RelayEventStore {
  private index: RelayEventV2[] = [];
  private lastPrunedDay = "";
  private selectedRetentionDays: 7 | 30 | 90;
  readonly root: string;

  constructor(private readonly options: {
    root?: string;
    legacyFile?: string;
    retentionDays?: 7 | 30 | 90;
    maxBytes?: number;
    now?: () => number;
  } = {}) {
    this.root = options.root ?? eventsDir();
    this.selectedRetentionDays = options.retentionDays ?? 30;
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
  private retentionDays(): number { return this.selectedRetentionDays; }

  setRetentionDays(days: 7 | 30 | 90): void { this.selectedRetentionDays = days; }

  init(): this {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    this.prune(true);
    this.reload();
    return this;
  }

  private eventFiles(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .map((name) => path.join(this.root, name));
  }

  private parseLines(text: string): RelayEventV2[] {
    const out: RelayEventV2[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as RelayEventV2;
        if (parsed.v === 2) {
          const safe = sanitizeEvent(parsed);
          if (safe) out.push(safe);
        }
      } catch { /* one corrupt row does not hide its siblings */ }
    }
    return out;
  }

  reload(): void {
    const rows: RelayEventV2[] = [];
    for (const file of this.eventFiles()) {
      try { rows.push(...this.parseLines(readFileSync(file, "utf8"))); } catch { /* unreadable partition */ }
    }
    const legacy = this.options.legacyFile ?? auditFile();
    try {
      const fallback = new Date(statSync(legacy).mtimeMs).toISOString();
      readFileSync(legacy, "utf8").split("\n").forEach((line, index) => {
        if (!line) return;
        try {
          const event = legacyToV2(JSON.parse(line) as AuditEntry, index, fallback);
          if (event) rows.push(event);
        } catch { /* malformed legacy row */ }
      });
    } catch { /* no legacy log */ }
    const cutoff = this.now() - this.retentionDays() * 86_400_000;
    this.index = rows
      .filter((event) => Date.parse(event.finishedAt) >= cutoff)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  append(input: RelayEventV2): boolean {
    try {
      const event = sanitizeEvent(input);
      if (!event) return false;
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      const day = event.startedAt.slice(0, 10);
      const file = path.join(this.root, `${day}.jsonl`);
      appendFileSync(file, JSON.stringify(event) + "\n", { mode: 0o600 });
      chmodSync(file, 0o600);
      this.index.unshift(event);
      this.prune();
      return true;
    } catch {
      return false; // audit must never fail relay transport
    }
  }

  query(query: EventQuery = {}): RelayEventV2[] {
    const since = query.since ? Date.parse(query.since) : Number.NEGATIVE_INFINITY;
    const site = query.site?.toLowerCase();
    const rows = this.index.filter((event) =>
      Date.parse(event.startedAt) >= since &&
      (!query.podId || (!!event.source && "podId" in event.source && event.source.podId === query.podId)) &&
      (!query.mode || event.mode === query.mode) &&
      (!query.outcome || event.outcome === query.outcome) &&
      (!site || event.host.includes(site))
    );
    const offset = Math.max(0, query.offset ?? 0);
    return rows.slice(offset, offset + Math.min(10_000, Math.max(1, query.limit ?? 500)));
  }

  exportJson(): string { return JSON.stringify(this.index, null, 2); }

  clear(): void {
    for (const file of this.eventFiles()) rmSync(file, { force: true });
    rmSync(this.options.legacyFile ?? auditFile(), { force: true });
    this.index = [];
  }

  storageBytes(): number {
    let total = 0;
    for (const file of this.eventFiles()) { try { total += statSync(file).size; } catch {} }
    try { total += statSync(this.options.legacyFile ?? auditFile()).size; } catch {}
    return total;
  }

  prune(force = false): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (!force && this.lastPrunedDay === today) return;
    this.lastPrunedDay = today;
    const cutoffDay = new Date(this.now() - this.retentionDays() * 86_400_000).toISOString().slice(0, 10);
    for (const file of this.eventFiles()) {
      if (path.basename(file, ".jsonl") < cutoffDay) rmSync(file, { force: true });
    }
    const legacy = this.options.legacyFile ?? auditFile();
    try { if (statSync(legacy).mtimeMs < this.now() - this.retentionDays() * 86_400_000) rmSync(legacy, { force: true }); } catch {}
    const ceiling = this.options.maxBytes ?? 50 * 1024 * 1024;
    const files = this.eventFiles();
    let total = files.reduce((sum, file) => { try { return sum + statSync(file).size; } catch { return sum; } }, 0);
    try { total += statSync(legacy).size; } catch {}
    const candidates = [legacy, ...files];
    for (const file of candidates) {
      if (total <= ceiling) break;
      try { const size = statSync(file).size; rmSync(file, { force: true }); total -= size; } catch {}
    }
  }
}

/** Compatibility writer for callers not yet migrated to v2. */
export function record(entry: AuditEntry): void {
  try {
    const at = new Date().toISOString();
    const converted = legacyToV2({ ...entry, at }, 0, at);
    if (converted) new RelayEventStore().init().append(converted);
  } catch { /* best effort */ }
}

export interface AuditSummary {
  total: number;
  ok: number;
  failed: number;
  sessionFetches: number;
  tunnelConnections: number;
  tunnelBytes: number;
  byHost: { host: string; count: number; failed: number; session: boolean; tunnel: number; bytes: number }[];
}

function isOk(row: { status: number; error?: string }): boolean {
  return !row.error && row.status >= 200 && row.status < 400;
}

/** Legacy summary kept for compatibility with older integrations and tests. */
export function summarize(text: string): AuditSummary {
  const rows = text.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as AuditEntry]; } catch { return []; }
  });
  const byHost = new Map<string, { count: number; failed: number; session: boolean; tunnel: number; bytes: number }>();
  let ok = 0, failed = 0, sessionFetches = 0, tunnelConnections = 0, tunnelBytes = 0;
  for (const row of rows) {
    const host = byHost.get(row.host) ?? { count: 0, failed: 0, session: false, tunnel: 0, bytes: 0 };
    const good = isOk(row);
    if (row.kind === "tunnel") { host.tunnel++; host.bytes += row.bytes ?? 0; tunnelConnections++; tunnelBytes += row.bytes ?? 0; }
    else host.count++;
    if (!good) host.failed++;
    if (row.session) { host.session = true; sessionFetches++; }
    byHost.set(row.host, host);
    if (good) ok++; else failed++;
  }
  return { total: rows.length, ok, failed, sessionFetches, tunnelConnections, tunnelBytes,
    byHost: [...byHost.entries()].map(([host, value]) => ({ host, ...value })).sort((a, b) => b.count + b.tunnel - a.count - a.tunnel) };
}

export function readSummary(): AuditSummary {
  try { return summarize(readFileSync(auditFile(), "utf8")); } catch { return summarize(""); }
}
