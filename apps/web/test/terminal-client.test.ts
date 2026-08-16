import { describe, it, expect, vi } from "vitest";
import { TerminalClient, type SocketLike } from "../lib/terminal-client";

/** Controllable mock socket. */
class MockSocket implements SocketLike {
  readyState = 1;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  // test helpers
  open() {
    this.onopen?.({});
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function make() {
  const sockets: MockSocket[] = [];
  const client = new TerminalClient({
    gatewayUrl: "wss://gw",
    podId: "pod-1",
    socketFactory: () => {
      const s = new MockSocket();
      sockets.push(s);
      return s;
    },
  });
  return { client, sockets };
}

describe("TerminalClient", () => {
  it("connects to <gateway>/pods/<id> and reports state", () => {
    const { client, sockets } = make();
    const states: string[] = [];
    client.on("state", (s) => states.push(s));
    client.connect();
    sockets[0].open();
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("dispatches output/links/status frames (mock socket)", () => {
    const { client, sockets } = make();
    const out: string[] = [];
    let links: string[] = [];
    let status: unknown = null;
    client.on("output", (d) => out.push(d));
    client.on("links", (u) => (links = u));
    client.on("status", (s) => (status = s));
    client.connect();
    sockets[0].open();
    sockets[0].emit({ type: "output", data: "hello" });
    sockets[0].emit({ type: "links", urls: ["https://a", "https://b"] });
    sockets[0].emit({ type: "status", idleMs: 5, idle: false, ready: true });
    expect(out).toEqual(["hello"]);
    expect(links).toEqual(["https://a", "https://b"]);
    expect(status).toEqual({ idleMs: 5, idle: false, ready: true });
  });

  it("ignores malformed and non-agent frames", () => {
    const { client, sockets } = make();
    const out: string[] = [];
    client.on("output", (d) => out.push(d));
    client.connect();
    sockets[0].open();
    sockets[0].onmessage?.({ data: "not json" });
    sockets[0].emit({ type: "bogus" });
    expect(out).toEqual([]);
  });

  it("sends input and resize as protocol frames", () => {
    const { client, sockets } = make();
    client.connect();
    sockets[0].open();
    client.sendInput("ls\n");
    client.sendResize(80, 24);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ type: "input", data: "ls\n" });
    expect(JSON.parse(sockets[0].sent[1])).toEqual({ type: "resize", cols: 80, rows: 24 });
  });

  it("dispatches the windows frame and sends select-window (cheap-tabs)", () => {
    const { client, sockets } = make();
    let windows: unknown = null;
    client.on("windows", (w) => (windows = w));
    client.connect();
    sockets[0].open();
    sockets[0].emit({
      type: "windows",
      windows: [
        { index: 0, name: "claude", active: true, agent: "claude-code" },
        { index: 1, name: "shell", active: false },
      ],
    });
    expect(windows).toEqual([
      { index: 0, name: "claude", active: true, agent: "claude-code" },
      { index: 1, name: "shell", active: false },
    ]);
    client.selectWindow(1);
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({ type: "select-window", index: 1 });
  });

  it("reconnects after an unexpected drop", () => {
    vi.useFakeTimers();
    const { client, sockets } = make();
    client.connect();
    sockets[0].open();
    // simulate unexpected close (not manual)
    sockets[0].onclose?.({});
    vi.advanceTimersByTime(600);
    expect(sockets.length).toBe(2); // reconnected
    vi.useRealTimers();
  });

  it("does not reconnect after manual close", () => {
    vi.useFakeTimers();
    const { client, sockets } = make();
    client.connect();
    sockets[0].open();
    client.close();
    vi.advanceTimersByTime(5000);
    expect(sockets.length).toBe(1);
    vi.useRealTimers();
  });
});
