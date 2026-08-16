import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { GatewayServer } from "../src/server.js";
import { RelayRegistry } from "../src/relay-registry.js";
import { FakeRelayAuthority } from "./fake-relay-authority.js";
import type { PodService } from "@podbay/control-plane";

let gateway: GatewayServer;
let relays: RelayRegistry;
let authority: FakeRelayAuthority;
let url: string;

const stubControl = {
  listReconcilableIds: async () => [],
  // The hub's control sweep now runs whenever relays are configured, so the stub must
  // answer this too (empty: no pods to dial in these socket-only tests).
  listRunningIds: async () => [],
} as unknown as PodService;

beforeEach(async () => {
  relays = new RelayRegistry();
  authority = new FakeRelayAuthority();
  gateway = new GatewayServer({
    control: stubControl,
    authenticate: async () => null,
    resolveAgentUrl: async () => "ws://127.0.0.1:1",
    host: "127.0.0.1",
    port: 0,
    tickMs: 60_000,
    relays,
    relayAuthority: authority,
  });
  const { port } = await gateway.listen();
  url = `ws://127.0.0.1:${port}`;
});
afterEach(async () => gateway.close());

/**
 * A client that buffers frames from construction.
 *
 * The gateway greets a relay the instant it upgrades, so attaching a listener only
 * after `open` resolves loses that frame — a race in the test, not in the product,
 * since a real client attaches its handler in the same tick it opens the socket.
 */
class RelayClient {
  readonly ws: WebSocket;
  private readonly buf: Record<string, unknown>[] = [];
  private waiter?: (m: Record<string, unknown>) => void;

  constructor(fullUrl: string) {
    this.ws = new WebSocket(fullUrl);
    this.ws.on("message", (d) => {
      const msg = JSON.parse(String(d)) as Record<string, unknown>;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = undefined;
        w(msg);
      } else this.buf.push(msg);
    });
  }
  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }
  next(): Promise<Record<string, unknown>> {
    const queued = this.buf.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => (this.waiter = resolve));
  }
  send(o: unknown) { this.ws.send(JSON.stringify(o)); }
  close() { this.ws.close(); }
}

const open = async (path: string): Promise<RelayClient> => {
  const c = new RelayClient(`${url}${path}`);
  await c.opened();
  return c;
};

const nextMessage = (c: RelayClient) => c.next();

/**
 * The relay connects OUTBOUND from the owner's machine — no inbound port, no tunnel.
 * These drive a real socket against a real gateway, so the pairing and the round trip
 * are proven rather than assumed.
 */
describe("relay socket", () => {
  it("accepts a relay that presents a valid pairing code", async () => {
    authority.put("GOODCODE", "owner-a");
    const ws = await open("/relay?code=GOODCODE");
    expect(await nextMessage(ws)).toMatchObject({ type: "relay-hello", ownerId: "owner-a" });
    ws.close();
  });

  it("closes a connection presenting an unknown code", async () => {
    const ws = await open("/relay?code=NOPE");
    const closed = await new Promise<number>((r) => ws.ws.once("close", (c) => r(c)));
    expect(closed).toBe(4401);
  });

  it("rejects the upgrade with no code at all", async () => {
    await expect(open("/relay")).rejects.toThrow();
  });

  it("carries a fetch to the relay and its result back", async () => {
    authority.put("C1", "owner-a");
    const ws = await open("/relay?code=C1");
    await nextMessage(ws); // relay-hello

    const dispatched = nextMessage(ws);
    const out = relays.submit("owner-a", {
      id: "req-1", podId: "pod-1", url: "https://reddit.com/r/x", domain: "reddit.com",
    });
    expect(out.status).toBe("dispatched");
    expect(await dispatched).toMatchObject({ type: "fetch", id: "req-1", domain: "reddit.com" });

    // The relay answers; the waiter resolves.
    const result = new Promise((r) => relays.await("owner-a", "pod-1", "req-1", r));
    ws.send({ type: "fetch-result", id: "req-1", status: 200, body: "PAGE" });
    expect(await result).toMatchObject({ status: 200, body: "PAGE" });
    ws.close();
  });

  it("forgets the relay when its socket drops, so state reports disconnected", async () => {
    authority.put("C2", "owner-a");
    const ws = await open("/relay?code=C2");
    await nextMessage(ws);
    expect(relays.state("owner-a").connected).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 60));
    expect(relays.state("owner-a").connected).toBe(false);
  });

  it("flushes what queued while the owner's machine was asleep", async () => {
    // Nobody connected yet → queued, not failed.
    expect(relays.submit("owner-a", {
      id: "q1", podId: "pod-1", url: "https://reddit.com/a", domain: "reddit.com",
    }).status).toBe("queued");

    authority.put("C3", "owner-a");
    const ws = await open("/relay?code=C3");
    await nextMessage(ws); // relay-hello
    expect(await nextMessage(ws)).toMatchObject({ type: "fetch", id: "q1" });
    ws.close();
  });

  it("hands a reconnect token at code-pairing, and accepts a reconnect with that token", async () => {
    authority.put("PAIRCODE", "owner-a");
    const first = await open("/relay?code=PAIRCODE");
    const hello = await nextMessage(first);
    expect(hello).toMatchObject({ type: "relay-hello", ownerId: "owner-a" });
    const token = (hello as { token?: string }).token;
    expect(typeof token).toBe("string"); // issued on code-pairing
    first.close();
    await new Promise((r) => setTimeout(r, 30));

    // Reconnect with the TOKEN (no code) — as the daemon does after a blip.
    const again = await open(`/relay?token=${token}`);
    expect(await nextMessage(again)).toMatchObject({ type: "relay-hello", ownerId: "owner-a" });
    again.close();
  });

  it("rejects a reconnect with an unknown token (4401)", async () => {
    const ws = await open("/relay?token=bogus");
    const closed = await new Promise<number>((r) => ws.ws.once("close", (c) => r(c)));
    expect(closed).toBe(4401);
  });

  it("records the owner's login domains from the relay-online frame", async () => {
    authority.put("C5", "owner-a");
    const ws = await open("/relay?code=C5");
    await nextMessage(ws); // relay-hello
    ws.send({ type: "relay-online", loginDomains: ["reddit.com", "x.com", 42] });
    await new Promise((r) => setTimeout(r, 40));
    // Non-string entries are dropped; the rest are recorded for the owner's pods.
    expect(authority.connected.get("owner-a")).toEqual(["reddit.com", "x.com"]);
    ws.close();
  });

  it("survives a garbage frame from the relay", async () => {
    authority.put("C4", "owner-a");
    const ws = await open("/relay?code=C4");
    await nextMessage(ws);
    ws.ws.send("not json");
    await new Promise((r) => setTimeout(r, 40));
    expect(relays.state("owner-a").connected).toBe(true);
    ws.close();
  });
});
