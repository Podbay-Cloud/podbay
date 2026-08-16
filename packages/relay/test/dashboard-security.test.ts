import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import { RelayEventStore, type RelayEventV2 } from "../src/audit.js";
import { load, revokeLoginDomain, save } from "../src/config.js";
import { serveDashboard } from "../src/dashboard.js";
import { RelayRuntime } from "../src/runtime.js";

let home: string;
const closes: Array<() => void> = [];
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "pb-dashboard-security-"));
  process.env.PB_RELAY_HOME = home;
});
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  delete process.env.PB_RELAY_HOME;
  rmSync(home, { recursive: true, force: true });
});

const event: RelayEventV2 = {
  v: 2, id: "one", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 1,
  source: { podId: "pod-a" }, mode: "fetch", outcome: "ok", target: "https://example.com/path", host: "example.com", httpStatus: 200, session: false,
};

async function running() {
  const store = new RelayEventStore({ root: path.join(home, "events"), legacyFile: path.join(home, "legacy") }).init();
  const runtime = new RelayRuntime();
  runtime.setGateway("connected");
  const stop = vi.fn();
  const dashboard = await serveDashboard(0, {
    store, runtime, routeToken: "a".repeat(64), csrfToken: "b".repeat(64),
    actions: { stop, revokeSession: (domain) => { revokeLoginDomain(domain); } },
  });
  closes.push(dashboard.close);
  const post = (action: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${dashboard.url}/actions/${action}`, {
    method: "POST",
    headers: { origin: new URL(dashboard.url).origin, "content-type": "application/json", "x-csrf-token": "b".repeat(64), ...headers },
    body: JSON.stringify(body),
  });
  return { dashboard, store, stop, post };
}

function statusWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
}

describe("authenticated loopback dashboard actions", () => {
  it("requires the per-process route and rejects hostile origin, CSRF, method, and content type", async () => {
    const { dashboard, post } = await running();
    expect((await fetch(new URL(dashboard.url).origin)).status).toBe(404);
    expect(await statusWithHost(dashboard.url, "evil.example")).toBe(400);
    expect((await fetch(`${dashboard.url}/actions/pod`)).status).toBe(405);
    expect((await post("pod", { podId: "pod-a", paused: true }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("pod", { podId: "pod-a", paused: true }, { "x-csrf-token": "wrong" })).status).toBe(403);
    expect((await post("pod", { podId: "pod-a", paused: true }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await fetch(`${new URL(dashboard.url).origin}/${"c".repeat(64)}/actions/pod`, { method: "POST" })).status).toBe(404);
    expect(load().pausedPodIds).toEqual([]);
  });

  it("changes only each confirmed scope and keeps sanitized history export readable", async () => {
    save({ loginDomains: ["account.example"], blockedDomains: ["kept.example"], pausedPodIds: [], retentionDays: 30, reconnectToken: "pairing-stays" });
    const { dashboard, store, stop, post } = await running();
    store.append(event);
    expect((await post("pod", { podId: "pod-a", paused: true })).status).toBe(200);
    expect(load()).toMatchObject({ pausedPodIds: ["pod-a"], blockedDomains: ["kept.example"], reconnectToken: "pairing-stays" });
    expect((await post("revoke-session", { domain: "account.example" })).status).toBe(200);
    expect(load()).toMatchObject({ loginDomains: [], blockedDomains: ["kept.example"], reconnectToken: "pairing-stays" });
    expect((await post("stop", {})).status).toBe(200);
    expect(stop).toHaveBeenCalledOnce();
    expect(store.query()).toHaveLength(1);
    const exported = await fetch(`${dashboard.url}/export`);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    expect(await exported.text()).toContain("https://example.com/path");
    expect((await post("clear-history", {})).status).toBe(200);
    expect(store.query()).toEqual([]);
    expect(load()).toMatchObject({ blockedDomains: ["kept.example"], reconnectToken: "pairing-stays" });
  });

  it("exposes no mutation routes in stopped read-only mode", async () => {
    const store = new RelayEventStore({ root: path.join(home, "events"), legacyFile: path.join(home, "legacy") }).init();
    const dashboard = await serveDashboard(0, { store, runtime: new RelayRuntime({ daemon: "stopped" }), readOnly: true, routeToken: "d".repeat(64), csrfToken: "e".repeat(64) });
    closes.push(dashboard.close);
    const response = await fetch(`${dashboard.url}/actions/clear-history`, {
      method: "POST", headers: { origin: new URL(dashboard.url).origin, "content-type": "application/json", "x-csrf-token": "e".repeat(64) }, body: "{}",
    });
    expect(response.status).toBe(404);
  });

  it("contains a data-provider failure without crashing the dashboard server", async () => {
    const store = new RelayEventStore({ root: path.join(home, "events"), legacyFile: path.join(home, "legacy") }).init();
    const dashboard = await serveDashboard(0, { store, runtime: new RelayRuntime(), config: () => { throw new Error("corrupt state"); }, routeToken: "f".repeat(64) });
    closes.push(dashboard.close);
    expect((await fetch(`${dashboard.url}/data`)).status).toBe(500);
    expect((await fetch(dashboard.url)).status).toBe(200);
  });
});
