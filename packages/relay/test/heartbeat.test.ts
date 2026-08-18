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

// pingInterval 1000, so a "suspended" tick is one landing >2500ms late.
const OPTS = { pingIntervalMs: 1000, maxMissedPings: 2, suspendFactor: 2.5 };

describe("relay heartbeat (hardened against macOS throttling)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does NOT terminate on a single unanswered interval — needs maxMissedPings in a row", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // tick 1: ping, window opens
    expect(ws.ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // tick 2: one miss (missed=1) — NOT dead yet
    expect(ws.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // tick 3: second consecutive miss (missed=2) → dead
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it("a pong within the window resets the miss count (one blip never kills the link)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // ping
    vi.advanceTimersByTime(1000); // miss 1
    ws.emit("pong"); // answered → reset
    vi.advanceTimersByTime(1000); // miss would be 1 again, not 2
    vi.advanceTimersByTime(1000); // miss 2 now... but each answered gap resets — still alive here
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("any inbound frame counts as liveness, not just pongs", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000); // miss 1
    ws.emit("message", "x"); // traffic = alive → reset
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("a FROZEN process (a tick far overdue) resets instead of false-terminating on wake", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // ping
    vi.advanceTimersByTime(1000); // miss 1 (missed=1, one away from death)
    // Simulate an OS freeze: jump the wall clock far ahead, then fire ONE overdue tick.
    vi.setSystemTime(Date.now() + 10_000);
    vi.advanceTimersByTime(1000); // this tick lands ~10s late → suspension → reset, NOT terminate
    expect(ws.terminate).not.toHaveBeenCalled();
    // …and it recovers normally afterward (a pong keeps it alive).
    ws.emit("pong");
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("fires onAlive on proof-of-life and onDead once before terminate", () => {
    const onAlive = vi.fn();
    const order: string[] = [];
    const onDead = vi.fn(() => order.push("dead"));
    const ws = fakeWs();
    (ws.terminate as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("terminate"));
    attachHeartbeat(ws, { ...OPTS, onAlive, onDead });
    ws.emit("pong");
    expect(onAlive).toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // ping
    vi.advanceTimersByTime(1000); // miss 1
    vi.advanceTimersByTime(1000); // miss 2 → dead
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["dead", "terminate"]);
  });

  it("stops on close (no further pings or terminates)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    ws.emit("close");
    vi.advanceTimersByTime(5000);
    expect(ws.ping).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
  });
});
