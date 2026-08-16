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

describe("relay heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pings on the interval and terminates when the pong window lapses (~interval+timeout)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // ping sent, pong window opens
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500); // no pong within the window → dead → terminate → close → reconnect
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it("does NOT terminate a link that pongs within the window", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // ping
    ws.emit("pong"); // answered in time
    vi.advanceTimersByTime(1000); // next ping, still healthy
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("counts any inbound frame as liveness, not just pongs", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    vi.advanceTimersByTime(1000); // ping, window open
    ws.emit("message", "x"); // traffic closes the window
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("stops on close (no further pings or terminates)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws, OPTS);
    ws.emit("close");
    vi.advanceTimersByTime(5000);
    expect(ws.ping).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("defaults to ~15s worst-case detection (10s ping + 5s pong)", () => {
    const ws = fakeWs();
    attachHeartbeat(ws); // defaults
    vi.advanceTimersByTime(10_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });
});
