import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RelayEventStore,
  safeFetchTarget,
  safeTunnelTarget,
  sanitizeEvent,
  type RelayEventV2,
} from "../src/audit.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const temp = () => { const root = mkdtempSync(path.join(tmpdir(), "pb-events-")); roots.push(root); return root; };
const event = (overrides: Partial<RelayEventV2> = {}): RelayEventV2 => ({
  v: 2,
  id: "event-1",
  startedAt: "2026-08-05T10:00:00.000Z",
  finishedAt: "2026-08-05T10:00:01.000Z",
  durationMs: 1000,
  source: { podId: "research-otter-7f2a" },
  mode: "fetch",
  outcome: "ok",
  target: "https://example.com/private/report",
  host: "example.com",
  httpStatus: 200,
  session: false,
  ...overrides,
});

describe("relay v2 event sanitization", () => {
  it("removes URL credentials, query strings, and fragments", () => {
    expect(safeFetchTarget("https://user:pass@example.com/private/report?token=secret#row")).toEqual({
      target: "https://example.com/private/report",
      host: "example.com",
    });
  });

  it("sanitizes redirects again at the write boundary", () => {
    const safe = sanitizeEvent(event({
      target: "https://user:pass@example.com/start?secret=1#x",
      finalTarget: "https://example.com/final?token=two#y",
    }));
    expect(safe?.target).toBe("https://example.com/start");
    expect(safe?.finalTarget).toBe("https://example.com/final");
    expect(JSON.stringify(safe)).not.toMatch(/pass|secret|token=|#y/);
  });

  it("preserves the gateway-resolved pod display name, bounded to 160", () => {
    expect(sanitizeEvent(event({ source: { podId: "p1", podName: "My Crawler" } }))?.source)
      .toEqual({ podId: "p1", podName: "My Crawler" });
    // Over-long names are sliced like the id (never trust the wire).
    const long = sanitizeEvent(event({ source: { podId: "p1", podName: "x".repeat(500) } as never }));
    expect((long?.source as { podName?: string }).podName?.length).toBe(160);
    // Absent name (old gateway / old row) → source is just the id.
    expect(sanitizeEvent(event({ source: { podId: "p1" } }))?.source).toEqual({ podId: "p1" });
  });

  it("normalizes tunnel targets and rejects malformed targets", () => {
    expect(safeTunnelTarget("Example.COM.", 443)).toEqual({ target: "example.com:443", host: "example.com" });
    expect(safeTunnelTarget("bad host", 443)).toBeNull();
    expect(safeFetchTarget("file:///etc/passwd")).toBeNull();
  });
});

describe("day-partitioned local event history", () => {
  it("writes owner-only files and queries its retained in-memory index", () => {
    const root = temp();
    const store = new RelayEventStore({ root, legacyFile: path.join(root, "legacy.jsonl"), now: () => Date.parse("2026-08-05T12:00:00Z") }).init();
    expect(store.append(event())).toBe(true);
    const file = path.join(root, "2026-08-05.jsonl");
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.query({ podId: "research-otter-7f2a", site: "example", limit: 1 })).toHaveLength(1);
  });

  it("reads mixed v2, legacy, and malformed rows as sanitized events", () => {
    const root = temp();
    const legacy = path.join(root, "legacy.jsonl");
    writeFileSync(legacy, [
      JSON.stringify({ host: "old.example", status: 200, ms: 12, session: false, at: "2026-08-05T09:00:00Z" }),
      "not-json",
    ].join("\n"));
    writeFileSync(path.join(root, "2026-08-05.jsonl"), JSON.stringify(event()) + "\n{bad\n");
    const store = new RelayEventStore({ root, legacyFile: legacy, now: () => Date.parse("2026-08-05T12:00:00Z") }).init();
    const rows = store.query();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id.startsWith("legacy"))?.source).toBeUndefined();
  });

  it("prunes expired partitions and enforces a hard byte ceiling", () => {
    const root = temp();
    writeFileSync(path.join(root, "2026-06-01.jsonl"), JSON.stringify(event({ startedAt: "2026-06-01T00:00:00Z", finishedAt: "2026-06-01T00:00:01Z" })) + "\n");
    writeFileSync(path.join(root, "2026-08-04.jsonl"), JSON.stringify(event({ id: "large", reason: "x".repeat(300) })) + "\n");
    const store = new RelayEventStore({ root, legacyFile: path.join(root, "none"), retentionDays: 30, maxBytes: 120, now: () => Date.parse("2026-08-05T12:00:00Z") }).init();
    expect(readdirSync(root)).toEqual([]);
    expect(store.query()).toEqual([]);
  });

  it("exports only sanitized indexed fields and clears history independently", () => {
    const root = temp();
    const store = new RelayEventStore({ root, legacyFile: path.join(root, "legacy.jsonl"), now: () => Date.parse("2026-08-05T12:00:00Z") }).init();
    store.append(event({ target: "https://user:pass@example.com/path?q=secret#fragment" }));
    const exported = store.exportJson();
    expect(exported).toContain("https://example.com/path");
    expect(exported).not.toMatch(/user|pass|secret|fragment/);
    store.clear();
    expect(store.query()).toEqual([]);
    expect(store.storageBytes()).toBe(0);
  });

  it("treats a write failure as audit loss, never a transport exception", () => {
    const root = temp();
    const notDirectory = path.join(root, "file-not-dir");
    writeFileSync(notDirectory, "occupied");
    const store = new RelayEventStore({ root: notDirectory, legacyFile: path.join(root, "none") });
    expect(store.append(event())).toBe(false);
  });
});
