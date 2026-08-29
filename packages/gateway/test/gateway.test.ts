import http from "node:http";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { AgentServer } from "@podbay/pod-agent";
import { PodService, InMemoryPodStore, type PodRecord } from "@podbay/control-plane";
import type {
  CreatePodInput,
  ExecResult,
  PodInfo,
  PodStatus,
  SandboxProvider,
} from "@podbay/provider";
import { GatewayServer } from "../src/server.js";

const info = (id: string, status: PodStatus): PodInfo => ({
  id,
  status,
  region: "fra",
  endpoint: null,
  keepAwake: false,
});

/** Minimal provider: gateway only exercises wake/sleep via the control plane. */
const provider: SandboxProvider = {
  async createPod(i: CreatePodInput) {
    return info(i.id, "running");
  },
  async getPod(id) {
    return info(id, "running");
  },
  async listPods() {
    return [];
  },
  async exec(): Promise<ExecResult> {
    return { exitCode: 0, stdout: "", stderr: "" };
  },
  async sleep(id) {
    return info(id, "suspended");
  },
  async wake(id) {
    return info(id, "running");
  },
  async setKeepAwake(id) {
    return info(id, "running");
  },
  async snapshot() {
    return { snapshotId: "s" };
  },
  async destroy() {},
  async endpoint() {
    return "";
  },
  async podAddress() {
    return previewOrigin;
  },
  async agentReady(id) {
    return info(id, "running").status === "running";
  },
  async agentIdleMs() {
    return null;
  },
  async agentSessionUrl() {
    return null;
  },
  async agentStatus() {
    return null;
  },
  async updateImage(id) {
    return info(id, "running");
  },
  async resize(id) {
    return info(id, "running");
  },
  async fetchMetrics() {
    return null;
  },
  async injectSecrets() {},
  async githubStatus() {
    return { connected: false, login: null };
  },
  async setGithubToken() {
    return { login: "octocat" };
  },
};

let agent: AgentServer;
let agentPort: number;
let store: InMemoryPodStore;
let gateway: GatewayServer;
let gwPort: number;
let previewTarget: http.Server;
let previewOrigin: string;
const clients: WebSocket[] = [];

beforeEach(async () => {
  agent = new AgentServer({ sessionName: `gw_${Date.now()}`, bootCommand: "bash --norc", host: "127.0.0.1", port: 0, tickMs: 1000 });
  agentPort = (await agent.listen()).port;

  // A stand-in for the pod's app on port 3000; the gateway proxies previews here.
  previewTarget = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`PREVIEW_OK ${req.url}`);
  });
  await new Promise<void>((r) => previewTarget.listen(0, "127.0.0.1", r));
  previewOrigin = `http://127.0.0.1:${(previewTarget.address() as import("node:net").AddressInfo).port}`;

  store = new InMemoryPodStore();
  const control = new PodService(provider, store, { environmentsRoot: "/tmp" });

  gateway = new GatewayServer({
    control,
    authenticate: async (req) => {
      const u = req.headers["x-podbay-user"];
      return typeof u === "string" ? u : null;
    },
    resolveAgentUrl: async () => `ws://127.0.0.1:${agentPort}`,
    previewBase: "preview.test",
    resolvePreviewOrigin: async () => previewOrigin,
    host: "127.0.0.1",
    port: 0,
    idleThresholdMs: 1000,
    tickMs: 60_000,
    provisionIntervalMs: 0, // provisioner tested at the control-plane level
    appOrigin: "https://app.test",
  });
  gwPort = (await gateway.listen()).port;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  await gateway.close();
  await agent.close();
  await new Promise<void>((r) => previewTarget.close(() => r()));
});

async function seed(id: string, ownerId: string, over: Partial<PodRecord> = {}) {
  const now = new Date().toISOString();
  await store.create({
    id,
    ownerId,
    environmentName: "nextjs-starter",
    name: null,
    status: "running",
    region: "fra",
    keepAwake: false,
    previewPublic: false,
    previewAppAuth: false,
    authedAt: null,
    sessionUrl: null,
    provisionAttempts: 0,
    provisionLeaseUntil: null,
    provisionError: null,
    createdAt: now,
    lastActiveAt: now,
    ...over,
  });
}

/** HTTP request to the gateway with a preview Host header. */
function previewGet(
  slug: string,
  opts: { path?: string; user?: string; accept?: string } = {},
): Promise<{ status: number; body: string; location?: string; contentType?: string; retryAfter?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: gwPort,
        path: opts.path ?? "/",
        headers: {
          host: `${slug}.preview.test`,
          ...(opts.user ? { "x-podbay-user": opts.user } : {}),
          ...(opts.accept ? { accept: opts.accept } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            location: res.headers.location as string | undefined,
            contentType: res.headers["content-type"] as string | undefined,
            retryAfter: res.headers["retry-after"] as string | undefined,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function connect(podId: string, user?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${gwPort}/pods/${podId}`,
      user ? { headers: { "x-podbay-user": user } } : undefined,
    );
    clients.push(ws);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`http ${res.statusCode}`)));
  });
}

function waitOutput(ws: WebSocket, needle: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = "";
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "output") {
        buf += m.data;
        if (buf.includes(needle)) resolve();
      }
    });
    setTimeout(() => reject(new Error(`timeout for ${needle}`)), ms);
  });
}

describe("terminal gateway", () => {
  it("refuses an unauthenticated connection (5.1)", async () => {
    await seed("pod1", "u1");
    await expect(connect("pod1")).rejects.toThrow(/401/);
  });

  it("refuses a cross-owner connection as not-found (5.2)", async () => {
    await seed("pod1", "u1");
    await expect(connect("pod1", "u2")).rejects.toThrow(/404/);
  });

  it("proxies terminal I/O for the owner to a real pod-agent (5.3)", async () => {
    await seed("pod1", "u1");
    const ws = await connect("pod1", "u1");
    await new Promise((r) => setTimeout(r, 500));
    ws.send(JSON.stringify({ type: "input", data: "echo gw_round_trip_777\n" }));
    await waitOutput(ws, "gw_round_trip_777");
  });

  it("does NOT wake a suspended pod on connect — rejects 409 (explicit resume, 5.4)", async () => {
    await seed("pod1", "u1", { status: "suspended" });
    // Explicit suspend/resume: a suspended pod stays down until the owner clicks
    // Resume. The terminal WS is rejected and the pod is NEVER auto-woken.
    await expect(connect("pod1", "u1")).rejects.toThrow("http 409");
    expect((await store.get("pod1"))?.status).toBe("suspended");
  });

  it("idle sweep sleeps an idle pod and skips keepAwake (5.5)", async () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    await seed("idle1", "u1", { lastActiveAt: old });
    await seed("keep1", "u1", { lastActiveAt: old, keepAwake: true });
    const slept = await gateway.sweepIdle();
    expect(slept).toEqual(["idle1"]);
    expect((await store.get("idle1"))?.status).toBe("suspended");
    expect((await store.get("keep1"))?.status).toBe("running");
  });
});

describe("preview proxy", () => {
  it("proxies to the app port for the owner and passes the path", async () => {
    await seed("brave-otter-4f2a", "u1");
    const res = await previewGet("brave-otter-4f2a", { path: "/foo?bar=1", user: "u1" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("PREVIEW_OK /foo?bar=1");
  });

  it("rejects an unauthenticated API request to a private preview (401)", async () => {
    await seed("brave-otter-4f2a", "u1");
    expect((await previewGet("brave-otter-4f2a")).status).toBe(401);
  });

  it("redirects an unauthenticated BROWSER to sign in for a private preview", async () => {
    await seed("brave-otter-4f2a", "u1");
    const res = await previewGet("brave-otter-4f2a", { accept: "text/html" });
    expect(res.status).toBe(302);
    expect(res.location).toBe("https://app.test/signin");
  });

  it("hides a private preview from a non-owner as 404 (no enumeration, not 403)", async () => {
    await seed("brave-otter-4f2a", "u1");
    // 404 for both "no such pod" and "not yours" — a 403 would confirm the pod exists to a stranger.
    expect((await previewGet("brave-otter-4f2a", { user: "u2" })).status).toBe(404);
  });

  it("allows anonymous access when the pod is public", async () => {
    await seed("brave-otter-4f2a", "u1", { previewPublic: true });
    const res = await previewGet("brave-otter-4f2a");
    expect(res.status).toBe(200);
    expect(res.body).toContain("PREVIEW_OK");
  });

  it("delegated-auth (previewAppAuth): forwards without a podbay cookie so a third-party app can reach it", async () => {
    // The pod runs an agent-harness backend (e.g. T3 Code) that guards its own endpoint with a
    // pairing token; a podbay cookie would block the app, which only carries its own token. Not public.
    await seed("brave-otter-4f2a", "u1", { previewPublic: false, previewAppAuth: true });
    const res = await previewGet("brave-otter-4f2a"); // no user/cookie
    expect(res.status).toBe(200);
    expect(res.body).toContain("PREVIEW_OK");
  });

  it("404s an unknown slug", async () => {
    expect((await previewGet("ghost-pod-0000", { user: "u1" })).status).toBe(404);
  });

  it("does NOT wake a suspended pod on preview request — 503 (explicit resume)", async () => {
    await seed("brave-otter-4f2a", "u1", { status: "suspended" });
    const res = await previewGet("brave-otter-4f2a", { user: "u1" });
    // Explicit suspend/resume: a preview hit never auto-wakes a suspended pod; the owner resumes it.
    // Suspended is a temporarily-unavailable service → 503, uniform with the other not-ready states.
    expect(res.status).toBe(503);
    expect((await store.get("brave-otter-4f2a"))?.status).toBe("suspended");
  });

  it("serves a preview error UTF-8, content-negotiated: HTML card for browsers, text for API", async () => {
    await seed("brave-otter-4f2a", "u1", { status: "suspended" });
    // Browser → a real HTML card, always charset=utf-8 (the em-dash used to mojibake to "â€"").
    const html = await previewGet("brave-otter-4f2a", { user: "u1", accept: "text/html" });
    expect(html.status).toBe(503);
    expect(html.contentType).toBe("text/html; charset=utf-8");
    expect(html.body).toContain("<!doctype html>");
    expect(html.body).toContain("This pod is suspended");
    // API / fetch → plain UTF-8 text (not HTML), so a program isn't handed a page.
    const api = await previewGet("brave-otter-4f2a", { user: "u1" });
    expect(api.status).toBe(503);
    expect(api.contentType).toBe("text/plain; charset=utf-8");
    expect(api.body).not.toContain("<!doctype");
    expect(api.body).toContain("Resume it");
  });
});

describe("status reconcile sweep", () => {
  it("rotates through pods a slice at a time instead of reconciling everything", async () => {
    // Nothing else refreshes Incus pod status on a timer, so this sweep is what keeps
    // the control sweep, the idle policy and fleet health from acting on stale rows.
    // It must cover the fleet WITHOUT reconciling every pod every minute.
    const seen: string[] = [];
    const fakeControl = {
      listReconcilableIds: async () => ["a", "b", "c", "d", "e"],
      reconcile: async (id: string) => {
        seen.push(id);
        return {} as never;
      },
    } as unknown as PodService;

    const gw = new GatewayServer({
      control: fakeControl,
      authenticate: async () => null,
      resolveAgentUrl: async () => "ws://127.0.0.1:1",
      host: "127.0.0.1",
      port: 0,
      tickMs: 60_000,
      reconcilePerSweep: 2,
    });

    expect(await gw.sweepReconcile()).toEqual(["a", "b"]);
    expect(await gw.sweepReconcile()).toEqual(["c", "d"]);
    // Wraps around, so no pod is starved at the end of the list.
    expect(await gw.sweepReconcile()).toEqual(["e", "a"]);
    expect(seen).toEqual(["a", "b", "c", "d", "e", "a"]);
  });

  it("does nothing, quietly, when there is nothing to reconcile", async () => {
    const gw = new GatewayServer({
      control: { listReconcilableIds: async () => [] } as unknown as PodService,
      authenticate: async () => null,
      resolveAgentUrl: async () => "ws://127.0.0.1:1",
      host: "127.0.0.1",
      port: 0,
    });
    expect(await gw.sweepReconcile()).toEqual([]);
  });

  it("survives a pod whose reconcile throws — one bad pod must not stop the sweep", async () => {
    const gw = new GatewayServer({
      control: {
        listReconcilableIds: async () => ["bad", "good"],
        reconcile: async (id: string) => {
          if (id === "bad") throw new Error("provider down");
          return {} as never;
        },
      } as unknown as PodService,
      authenticate: async () => null,
      resolveAgentUrl: async () => "ws://127.0.0.1:1",
      host: "127.0.0.1",
      port: 0,
      reconcilePerSweep: 2,
    });
    await expect(gw.sweepReconcile()).resolves.toEqual(["bad", "good"]);
  });
});
