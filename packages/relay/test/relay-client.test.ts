import { describe, it, expect, beforeEach } from "vitest";
import { RelayClient, publicHostOf } from "../src/relay-client.js";

let sent: Record<string, unknown>[];
const socket = { send: (j: string) => sent.push(JSON.parse(j)) };
const okFetch = async () => ({ status: 200, body: "PAGE", finalUrl: "https://reddit.com/x" });
const m = (id: string, url: string, podId?: string) => JSON.stringify({ type: "fetch", id, url, ...(podId ? { source: { podId } } : {}) });
beforeEach(() => (sent = []));

describe("the relay serves the public web freely — no per-request approval", () => {
  it("fetches any public domain without any allowlist", async () => {
    const c = new RelayClient(socket, okFetch);
    await c.onMessage(m("j1", "https://some-random-site.com/x"));
    expect(sent[0]).toMatchObject({ status: 200, body: "PAGE" });
  });
});

describe("the guards that protect the OWNER, not us", () => {
  it("refuses a private / LAN target (SSRF the owner cannot see to consent to)", async () => {
    const c = new RelayClient(socket, okFetch);
    for (const url of ["http://192.168.1.1/admin", "http://10.0.0.5/", "http://localhost:8080/", "http://169.254.1.1/", "http://box.local/"]) {
      sent = [];
      await c.onMessage(m("j", url));
      expect(sent[0], url).toMatchObject({ error: expect.stringMatching(/public web/) });
    }
  });

  it("refuses a bare public IP too — the relay lends NAMED sites", async () => {
    const c = new RelayClient(socket, okFetch);
    await c.onMessage(m("j", "https://8.8.8.8/"));
    expect(sent[0]).toMatchObject({ error: expect.stringMatching(/public web/) });
  });

  it("refuses content a redirect carried to a private address", async () => {
    const c = new RelayClient(socket, async () => ({ status: 200, body: "x", finalUrl: "http://192.168.1.1/" }));
    await c.onMessage(m("j", "https://reddit.com/x"));
    expect(sent[0]).toMatchObject({ error: expect.stringMatching(/non-public/) });
  });

  it("publicHostOf classifies correctly", () => {
    expect(publicHostOf("https://reddit.com/x")).toBe("reddit.com");
    expect(publicHostOf("http://10.0.0.1/")).toBeNull();
    expect(publicHostOf("file:///etc/passwd")).toBeNull();
    expect(publicHostOf("https://localhost/")).toBeNull();
  });
});

describe("capacity: queue, do not refuse", () => {
  it("queues over the concurrency cap and drains as slots free", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let started = 0;
    const c = new RelayClient(socket, async () => { started++; await gate; return { status: 200, body: "x" }; }, { maxConcurrent: 2 });
    await c.onMessage(m("a", "https://a.com/")); await c.onMessage(m("b", "https://b.com/")); await c.onMessage(m("c", "https://c.com/"));
    expect(started).toBe(2);
    release(); await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("audits every fetch, including refusals", async () => {
    const audits: unknown[] = [];
    const c = new RelayClient(socket, okFetch, { audit: (e) => audits.push(e) });
    await c.onMessage(m("j1", "https://reddit.com/x"));
    await c.onMessage(m("j2", "http://10.0.0.1/"));
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ outcome: "safety-blocked", reason: expect.stringMatching(/refused/) });
  });

  it("retains gateway source and distinct site outcomes without query secrets", async () => {
    const audits: Record<string, unknown>[] = [];
    const c = new RelayClient(socket, async () => ({ status: 429, body: "slow", finalUrl: "https://example.com/final?token=two#x", session: true }), { audit: (e) => audits.push(e) });
    await c.onMessage(m("j1", "https://user:pass@example.com/start?secret=one#x", "pod-a"));
    expect(audits[0]).toMatchObject({ source: { podId: "pod-a" }, outcome: "rate-limited", target: "https://example.com/start", finalTarget: "https://example.com/final", httpStatus: 429, session: true });
    expect(JSON.stringify(audits[0])).not.toMatch(/pass|secret|token=/);
  });

  it("enforces a pod/site denial before browser work while siblings remain eligible", async () => {
    let calls = 0;
    const audits: Record<string, unknown>[] = [];
    const c = new RelayClient(socket, async () => { calls++; return okFetch(); }, {
      deny: (source, host) => source && "podId" in source && source.podId === "paused" || host === "blocked.example" ? "blocked by relay owner" : undefined,
      audit: (e) => audits.push(e),
    });
    await c.onMessage(m("a", "https://example.com/", "paused"));
    await c.onMessage(m("b", "https://blocked.example/", "sibling"));
    await c.onMessage(m("c", "https://example.com/", "sibling"));
    expect(calls).toBe(1);
    expect(sent.slice(0, 2).every((row) => String(row.error).includes("owner"))).toBe(true);
    expect(audits.filter((row) => row.outcome === "owner-blocked")).toHaveLength(2);
  });
});
