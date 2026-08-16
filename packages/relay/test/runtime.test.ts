import { describe, expect, it } from "vitest";
import { RelayRuntime } from "../src/runtime.js";

describe("relay daemon runtime", () => {
  it("tracks gateway transitions and active fetch/tunnel state deterministically", () => {
    let now = Date.parse("2026-08-05T10:00:00Z");
    const runtime = new RelayRuntime({ now: () => now, version: "0.2.0" });
    runtime.setGateway("connected");
    runtime.begin({ id: "fetch-1", mode: "fetch", target: "https://example.com/path", source: { podId: "pod-a" } });
    runtime.begin({ id: "tunnel-1", mode: "tunnel", target: "example.com:443", source: { podId: "pod-b" } });
    runtime.addBytes("tunnel-1", "up", 12);
    runtime.addBytes("tunnel-1", "down", 34);
    now += 5000;
    const snapshot = runtime.snapshot();
    expect(snapshot).toMatchObject({ gateway: "connected", stateSince: "2026-08-05T10:00:00.000Z", version: "0.2.0" });
    expect(snapshot.active.find((work) => work.id === "tunnel-1")).toMatchObject({ bytesUp: 12, bytesDown: 34 });
    runtime.finish("fetch-1");
    runtime.setGateway("reconnecting");
    expect(runtime.snapshot()).toMatchObject({ gateway: "reconnecting", stateSince: "2026-08-05T10:00:05.000Z" });
  });

  it("reports stopped read-only state without active work", () => {
    const runtime = new RelayRuntime({ daemon: "stopped", now: () => 0 });
    expect(runtime.snapshot()).toMatchObject({ daemon: "stopped", gateway: "unavailable", active: [] });
  });
});
