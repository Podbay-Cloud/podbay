import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { attachHeartbeat, type HeartbeatSocket } from "../src/heartbeat.js";

function fakeWs() {
  const ee = new EventEmitter();
  const ping = vi.fn();
  const terminate = vi.fn();
  const ws = ee as unknown as HeartbeatSocket & EventEmitter & { ping: typeof ping; terminate: typeof terminate };
  ws.ping = ping;
  ws.terminate = terminate;
  return ws;
}

const OPTS = { pingIntervalMs: 1000, pongTimeoutMs: 500 };

// The gateway drives its "relay is live" state (DB lastSeenAt) from onAlive, and counts an outage
// from onDead — so a half-open link is detected + surfaced instead of silently timing out.
describe("shared heartbeat — onAlive / onDead callbacks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onAlive on every proof-of-life (pong AND any inbound frame)", () => {
    const onAlive = vi.fn();
    const ws = fakeWs();
    attachHeartbeat(ws, { ...OPTS, onAlive });
    ws.emit("pong");
    ws.emit("message", "x");
    expect(onAlive).toHaveBeenCalledTimes(2);
  });

  it("fires onDead exactly once, before terminate, when the pong window lapses", () => {
    const order: string[] = [];
    const onDead = vi.fn(() => order.push("dead"));
    const ws = fakeWs();
    (ws.terminate as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("terminate"));
    attachHeartbeat(ws, { ...OPTS, onDead });
    vi.advanceTimersByTime(1000); // ping, window opens
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500); // no pong → dead
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["dead", "terminate"]); // surfaced BEFORE the socket is torn down
  });

  it("does NOT fire onDead when the link answers in time", () => {
    const onDead = vi.fn();
    const ws = fakeWs();
    attachHeartbeat(ws, { ...OPTS, onDead });
    vi.advanceTimersByTime(1000);
    ws.emit("pong");
    vi.advanceTimersByTime(1000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it("a throwing onDead never blocks terminate (cleanup must not depend on telemetry)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, { ...OPTS, onDead: () => { throw new Error("logging blew up"); } });
    vi.advanceTimersByTime(1500);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });
});
