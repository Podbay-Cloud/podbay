import { describe, it, expect, afterEach } from "vitest";
import { connect, type Socket } from "node:net";
import { RelayProxy, type TunnelStream } from "../src/relay-proxy.js";
import { REP } from "../src/relay-socks.js";

/**
 * Drives the REAL proxy over a REAL socket with a fake relay behind it — so the SOCKS
 * handshake, the fail-closed path and the byte splicing are exercised end to end without
 * a gateway, an owner, or the network.
 */

let proxy: RelayProxy | null = null;
afterEach(async () => {
  await proxy?.close();
  proxy = null;
});

/** A fake tunnelled stream that records what the pod sent and can push bytes back. */
function fakeStream() {
  let onData: (c: Buffer) => void = () => {};
  let onEnd: () => void = () => {};
  const sent: Buffer[] = [];
  let ended = false;
  return {
    stream: {
      write: (c) => sent.push(c),
      end: () => (ended = true),
      onData: (cb) => (onData = cb),
      onEnd: (cb) => (onEnd = cb),
    } as TunnelStream,
    sent: () => Buffer.concat(sent).toString(),
    ended: () => ended,
    push: (s: string) => onData(Buffer.from(s)),
    finish: () => onEnd(),
  };
}

/** Minimal SOCKS5 client: greet → CONNECT → return the reply byte + the live socket. */
async function socksConnect(
  port: number,
  host: string,
  dstPort: number,
  methods = [0x00],
): Promise<{ rep: number; sock: Socket }> {
  const sock = connect(port, "127.0.0.1");
  await new Promise<void>((r, j) => {
    sock.once("connect", () => r());
    sock.once("error", j);
  });
  const read = (): Promise<Buffer> =>
    new Promise((r) => sock.once("data", (d: Buffer) => r(d)));

  sock.write(Buffer.from([0x05, methods.length, ...methods]));
  const greet = await read();
  if (greet[1] !== 0x00) return { rep: -1, sock }; // method rejected

  const hostBuf = Buffer.from(host, "utf8");
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(dstPort);
  sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
  const reply = await read();
  return { rep: reply[1]!, sock };
}

describe("RelayProxy (pod-side SOCKS5 → owner's relay)", () => {
  it("tunnels a connection and splices bytes both ways", async () => {
    const f = fakeStream();
    proxy = new RelayProxy({ dial: async () => ({ stream: f.stream }) });
    const port = await proxy.listen();

    const { rep, sock } = await socksConnect(port, "example.com", 443);
    expect(rep).toBe(REP.OK);

    // pod app → target
    sock.write("GET / HTTP/1.1\r\n");
    await new Promise((r) => setTimeout(r, 40));
    expect(f.sent()).toContain("GET / HTTP/1.1");

    // target → pod app
    const got = new Promise<string>((r) => sock.once("data", (d: Buffer) => r(d.toString())));
    f.push("HTTP/1.1 200 OK\r\n");
    expect(await got).toContain("200 OK");

    sock.destroy();
  });

  it("FAILS CLOSED when no relay is connected — never falls back to pod egress", async () => {
    let dialed = 0;
    proxy = new RelayProxy({
      dial: async () => {
        dialed++;
        return { refused: "no relay" };
      },
    });
    const port = await proxy.listen();

    const { rep, sock } = await socksConnect(port, "example.com", 443);
    expect(rep).toBe(REP.CONNECTION_REFUSED);
    expect(dialed).toBe(1);
    sock.destroy();
  });

  it("refuses the owner's LAN before dialing anything (SSRF)", async () => {
    let dialed = 0;
    proxy = new RelayProxy({
      dial: async () => {
        dialed++;
        return { stream: fakeStream().stream };
      },
    });
    const port = await proxy.listen();

    for (const host of ["127.0.0.1", "192.168.1.10", "169.254.169.254", "localhost"]) {
      const { rep, sock } = await socksConnect(port, host, 80);
      expect(rep, `${host} must be refused`).toBe(REP.NOT_ALLOWED);
      sock.destroy();
    }
    expect(dialed, "SSRF targets must never reach the dialer").toBe(0);
  });

  it("closes the tunnel when the app disconnects", async () => {
    const f = fakeStream();
    proxy = new RelayProxy({ dial: async () => ({ stream: f.stream }) });
    const port = await proxy.listen();
    const { sock } = await socksConnect(port, "example.com", 443);
    sock.end();
    await new Promise((r) => setTimeout(r, 60));
    expect(f.ended()).toBe(true);
  });

  it("rejects a client that offers no no-auth method", async () => {
    proxy = new RelayProxy({ dial: async () => ({ stream: fakeStream().stream }) });
    const port = await proxy.listen();
    const { rep, sock } = await socksConnect(port, "example.com", 443, [0x02]);
    expect(rep).toBe(-1); // 0xFF no-acceptable-methods
    sock.destroy();
  });
});
