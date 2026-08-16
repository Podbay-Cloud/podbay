import { describe, it, expect, vi } from "vitest";
import { TunnelMux, type DialOutcome } from "../src/relay-tunnel.js";

type Sent = { type: string; id: string; host?: string; port?: number; b64?: string };

function mux(openTimeoutMs = 50) {
  const sent: Sent[] = [];
  const m = new TunnelMux((msg) => sent.push(msg as Sent), { openTimeoutMs });
  return { m, sent, last: () => sent[sent.length - 1]! };
}

/** dial() now resolves { stream } | { refused: reason }; pull the stream or fail loudly. */
function streamOf(o: DialOutcome) {
  if (!("stream" in o)) throw new Error(`expected a stream, got ${JSON.stringify(o)}`);
  return o.stream;
}

describe("TunnelMux", () => {
  it("opens a stream and resolves once the far end reports ready", async () => {
    const { m, sent } = mux();
    const p = m.dial("example.com", 443);
    expect(sent[0]).toMatchObject({ type: "tunnel-open", host: "example.com", port: 443 });

    m.handleEvent(sent[0]!.id, { kind: "ready" });
    expect("stream" in (await p)).toBe(true);
    expect(m.openCount).toBe(1);
  });

  it("FAILS CLOSED on a refusal — carries the reason, never a live stream", async () => {
    const { m, sent } = mux();
    const p = m.dial("example.com", 443);
    m.handleEvent(sent[0]!.id, { kind: "refused", reason: "no relay" });
    expect(await p).toEqual({ refused: "no relay" });
    expect(m.openCount).toBe(0);
  });

  it("FAILS CLOSED when nothing answers, and tells the far end to drop it", async () => {
    const { m, sent } = mux(20);
    const p = m.dial("example.com", 443);
    expect(await p).toEqual({ refused: "no-answer" }); // open timeout
    expect(sent.some((s) => s.type === "tunnel-close")).toBe(true);
    expect(m.openCount).toBe(0);
  });

  it("carries bytes both ways", async () => {
    const { m, sent } = mux();
    const p = m.dial("example.com", 443);
    const id = sent[0]!.id;
    m.handleEvent(id, { kind: "ready" });
    const stream = streamOf(await p);

    const got: Buffer[] = [];
    stream.onData((c) => got.push(c));

    stream.write(Buffer.from("ping"));
    const dataFrame = sent.find((s) => s.type === "tunnel-data")!;
    expect(Buffer.from(dataFrame.b64!, "base64").toString()).toBe("ping");

    m.handleEvent(id, { kind: "data", chunk: Buffer.from("pong") });
    expect(Buffer.concat(got).toString()).toBe("pong");
  });

  it("ends the stream when the far end closes", async () => {
    const { m, sent } = mux();
    const p = m.dial("example.com", 443);
    const id = sent[0]!.id;
    m.handleEvent(id, { kind: "ready" });
    const stream = streamOf(await p);
    const onEnd = vi.fn();
    stream.onEnd(onEnd);

    m.handleEvent(id, { kind: "close" });
    expect(onEnd).toHaveBeenCalled();
    expect(m.openCount).toBe(0);
  });

  it("tells the far end when the app hangs up", async () => {
    const { m, sent } = mux();
    const p = m.dial("example.com", 443);
    const id = sent[0]!.id;
    m.handleEvent(id, { kind: "ready" });
    streamOf(await p).end();
    expect(sent.some((s) => s.type === "tunnel-close" && s.id === id)).toBe(true);
    expect(m.openCount).toBe(0);
  });

  it("drops a frame for a stream it does not have open", () => {
    const { m } = mux();
    expect(m.handleEvent("nope", { kind: "data", chunk: Buffer.from("x") })).toBe(false);
    expect(m.handleEvent("nope", { kind: "ready" })).toBe(false);
  });

  it("reset() ends every open stream (relay disconnected)", async () => {
    const { m, sent } = mux();
    const p = m.dial("a.com", 80);
    m.handleEvent(sent[0]!.id, { kind: "ready" });
    const stream = streamOf(await p);
    const onEnd = vi.fn();
    stream.onEnd(onEnd);

    m.reset();
    expect(onEnd).toHaveBeenCalled();
    expect(m.openCount).toBe(0);
  });
});
