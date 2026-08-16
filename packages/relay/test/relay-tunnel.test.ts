import { describe, it, expect, vi } from "vitest";
import { RelayTunnel, type DialedSocket, type Dialer } from "../src/relay-tunnel.js";

/** A fake dialed socket that records writes and can push bytes / events back. */
function fakeSocket(remoteAddress = "93.184.216.34") {
  const handlers: Record<string, ((c?: Buffer) => void)[]> = {};
  const written: Buffer[] = [];
  return {
    sock: {
      on(ev: string, cb: (c?: Buffer) => void) {
        (handlers[ev] ??= []).push(cb);
        return this;
      },
      write: (c: Buffer) => written.push(c),
      end: vi.fn(),
      destroy: vi.fn(),
      remoteAddress,
    } as unknown as DialedSocket & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> },
    written: () => Buffer.concat(written).toString(),
    emit: (ev: string, c?: Buffer) => handlers[ev]?.forEach((h) => h(c)),
  };
}

function harness(remoteAddress?: string, failConnect = false) {
  const sent: Record<string, unknown>[] = [];
  const audit: Record<string, unknown>[] = [];
  const f = fakeSocket(remoteAddress);
  const dial: Dialer = (_h, _p, onConnect, onError) => {
    if (failConnect) queueMicrotask(onError);
    else queueMicrotask(() => onConnect(f.sock));
    return f.sock;
  };
  const t = new RelayTunnel({ send: (j) => sent.push(JSON.parse(j)) }, { dial, audit: (r) => audit.push(r) });
  return { t, sent, audit, f, last: () => sent[sent.length - 1]! };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("RelayTunnel (owner side)", () => {
  it("dials the target and reports ready, then streams both ways", async () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    expect(h.last()).toMatchObject({ type: "tunnel-ready", id: "s1" });

    // gateway → target
    h.t.handle({ type: "tunnel-data", id: "s1", b64: Buffer.from("GET /").toString("base64") });
    expect(h.f.written()).toBe("GET /");

    // target → gateway
    h.f.emit("data", Buffer.from("HTTP/1.1 200"));
    const back = h.sent.find((m) => m.type === "tunnel-data")!;
    expect(Buffer.from(back.b64 as string, "base64").toString()).toBe("HTTP/1.1 200");
  });

  it("REFUSES a hostname that resolves into the owner's LAN (post-DNS re-check)", async () => {
    const h = harness("192.168.1.50"); // DNS rebinding: public name, private address
    h.t.handle({ type: "tunnel-open", id: "s1", host: "totally-public.example", port: 80 });
    await tick();
    expect(h.last()).toMatchObject({ type: "tunnel-refused", reason: "resolved to a private address" });
    expect(h.f.sock.destroy).toHaveBeenCalled();
    expect(h.sent.some((m) => m.type === "tunnel-ready")).toBe(false); // never opened
  });

  it("refuses a private literal without dialing", () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "127.0.0.1", port: 80 });
    expect(h.last()).toMatchObject({ type: "tunnel-refused", reason: "target not allowed" });
  });

  it("reports a failed connection as a refusal", async () => {
    const h = harness(undefined, true);
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    expect(h.last()).toMatchObject({ type: "tunnel-refused", reason: "could not connect" });
  });

  it("closes the socket when the pod hangs up, without echoing a close back", async () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    h.t.handle({ type: "tunnel-close", id: "s1" });
    expect(h.f.sock.end).toHaveBeenCalled();
    expect(h.sent.filter((m) => m.type === "tunnel-close")).toHaveLength(0);
    expect(h.t.openCount).toBe(0);
  });

  it("tells the gateway when the TARGET closes", async () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    h.f.emit("close");
    expect(h.sent.some((m) => m.type === "tunnel-close" && m.id === "s1")).toBe(true);
  });

  it("records a socket error as a network failure, not a success", async () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    h.f.emit("error");
    expect(h.audit.at(-1)).toMatchObject({ outcome: "network-error", reason: "remote connection error" });
  });

  it("audits every stream with host + bytes, allowed or refused", async () => {
    const h = harness();
    h.t.handle({ type: "tunnel-open", id: "s1", host: "example.com", port: 443 });
    await tick();
    h.t.handle({ type: "tunnel-data", id: "s1", b64: Buffer.alloc(10).toString("base64") });
    h.f.emit("data", Buffer.alloc(20));
    h.f.emit("close");
    expect(h.audit.at(-1)).toMatchObject({ host: "example.com", target: "example.com:443", bytesUp: 10, bytesDown: 20, outcome: "ok" });

    h.t.handle({ type: "tunnel-open", id: "s2", host: "10.0.0.1", port: 80 });
    expect(h.audit.at(-1)).toMatchObject({ host: "10.0.0.1", outcome: "safety-blocked" });
  });

  it("retains pod attribution and owner-blocks before dialing", () => {
    let dials = 0;
    const sent: Record<string, unknown>[] = [];
    const audit: Record<string, unknown>[] = [];
    const t = new RelayTunnel({ send: (j) => sent.push(JSON.parse(j)) }, {
      dial: ((..._args: unknown[]) => { dials++; throw new Error("must not dial"); }) as unknown as Dialer,
      deny: (source) => source && "podId" in source && source.podId === "paused" ? "pod paused by relay owner" : undefined,
      audit: (event) => audit.push(event),
    });
    t.handle({ type: "tunnel-open", id: "blocked", host: "example.com", port: 443, source: { podId: "paused" } });
    expect(dials).toBe(0);
    expect(sent[0]).toMatchObject({ type: "tunnel-refused", reason: expect.stringMatching(/paused/) });
    expect(audit[0]).toMatchObject({ source: { podId: "paused" }, outcome: "owner-blocked" });
  });

  it("ignores non-tunnel frames", () => {
    const h = harness();
    expect(h.t.handle({ type: "fetch-result", id: "x" })).toBe(false);
  });
});
