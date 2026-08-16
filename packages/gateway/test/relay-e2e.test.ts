import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { GatewayServer } from "../src/server.js";
import { RelayRegistry } from "../src/relay-registry.js";
import { FakeRelayAuthority } from "./fake-relay-authority.js";
import type { PodService } from "@podbay/control-plane";

/**
 * The whole point of the wiring: a pod asks, the owner's relay answers, the result
 * comes back to the pod. This stands up a fake pod-agent (serving /control, which the
 * gateway dials) and a fake relay (connecting to /relay), around a real gateway, and
 * drives one fetch through the loop.
 */
let cleanup: Array<() => void> = [];
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; });

describe("relay end to end", () => {
  it("routes a pod's relay fetch to the relay and the result back to the pod", async () => {
    // Fake pod-agent: its /control endpoint says hello, then issues a relay-fetch and
    // captures the relay-result the gateway routes back.
    const podReqId = "pod-req-1";
    let resultToPod: Record<string, unknown> | null = null;
    const podAgent = new WebSocketServer({ port: 0 });
    podAgent.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "control-hello" }));
      // NO domain — the real pod-agent's submitRelayFetch sends only id + url. The
      // gateway must route without it (and derive the host from the URL itself).
      ws.send(JSON.stringify({ type: "relay-fetch", id: podReqId, url: "https://reddit.com/r/x" }));
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        if (m.type === "relay-result") resultToPod = m;
      });
    });
    const podPort = (podAgent.address() as import("node:net").AddressInfo).port;
    cleanup.push(() => podAgent.close());

    const relays = new RelayRegistry();
    const control = {
      listRunningIds: async () => ["pod-1"],
      ownerOf: async () => "owner-a",
    } as unknown as PodService;

    const authority = new FakeRelayAuthority();
    const gateway = new GatewayServer({
      control,
      authenticate: async () => null,
      resolveAgentUrl: async () => `ws://127.0.0.1:${podPort}`,
      host: "127.0.0.1",
      port: 0,
      tickMs: 60_000,
      relays,
      relayAuthority: authority,
    });
    const { port } = await gateway.listen();
    cleanup.push(() => void gateway.close());

    // The relay connects and answers any fetch it is handed.
    const code = "PAIR";
    authority.put(code, "owner-a");
    const relay = new WebSocket(`ws://127.0.0.1:${port}/relay?code=${code}`);
    relay.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.type === "fetch") {
        relay.send(JSON.stringify({ type: "fetch-result", id: m.id, status: 200, body: `FETCHED ${m.url}` }));
      }
    });
    await new Promise((r) => relay.once("open", r));
    cleanup.push(() => relay.close());

    // Kick the gateway to dial the fake pod's /control (which then issues the fetch).
    // The control sweep runs on listen(); wait for the round trip.
    const deadline = Date.now() + 8000;
    while (!resultToPod && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

    expect(resultToPod, "the pod should receive a relay-result").toBeTruthy();
    // Crucially, addressed with the POD's own request id, not the gateway's.
    expect(resultToPod).toMatchObject({ type: "relay-result", id: podReqId, status: 200 });
    expect(String(resultToPod!.body)).toContain("FETCHED https://reddit.com/r/x");
  });
});
