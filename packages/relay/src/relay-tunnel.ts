import { connect, type Socket } from "node:net";
import { isDisallowedTarget } from "./net-guard.js";
import { safeTunnelTarget, type RelayEventV2, type RelaySource } from "./audit.js";
import type { RelayRuntime } from "./runtime.js";

/**
 * The owner's half of the egress tunnel: a pod asked (via the gateway) for a connection
 * to `host:port`; we make it FROM THIS MACHINE and stream the bytes back.
 *
 * The guard that only this end can enforce: **re-check after DNS**. The pod and gateway
 * can only refuse address *literals* — a hostname that resolves to 127.0.0.1 or
 * 192.168.x (a rebinding trick) gets past them. Here the socket is connected, so the
 * resolved peer address is known: if it turns out to be private, the connection is
 * dropped before a single byte flows. That is the difference between checking a string
 * and checking where the packets actually went.
 *
 * Everything IO is injected (dial, audit, clock) so the routing and the guard are tested
 * without opening a socket.
 */

export interface TunnelSink {
  send(json: string): void;
}

/** The minimum of a net.Socket this module uses — so tests can supply a fake. */
export interface DialedSocket {
  on(event: "data", cb: (chunk: Buffer) => void): unknown;
  on(event: "close" | "end" | "error", cb: () => void): unknown;
  write(chunk: Buffer): unknown;
  end(): unknown;
  destroy(): unknown;
  remoteAddress?: string;
}

export type Dialer = (host: string, port: number, onConnect: (s: DialedSocket) => void, onError: () => void) => DialedSocket;

const defaultDial: Dialer = (host, port, onConnect, onError) => {
  const s: Socket = connect({ host, port });
  s.once("connect", () => onConnect(s));
  s.once("error", onError);
  return s;
};

export interface TunnelAudit {
  (event: RelayEventV2): void;
}

export class RelayTunnel {
  private readonly streams = new Map<string, { sock: DialedSocket; host: string; port: number; up: number; down: number; source?: RelaySource; started: number }>();

  constructor(
    private readonly sink: TunnelSink,
    private readonly opts: {
      dial?: Dialer;
      audit?: TunnelAudit;
      runtime?: RelayRuntime;
      deny?: (source: RelaySource | undefined, host: string) => string | undefined;
      now?: () => number;
    } = {},
  ) {}

  get openCount(): number {
    return this.streams.size;
  }

  /** Handle one gateway frame. Returns false if it wasn't a tunnel frame. */
  handle(msg: { type?: string; id?: string; host?: string; port?: number; b64?: string; source?: RelaySource }): boolean {
    if (!msg.type?.startsWith("tunnel-")) return false;
    const id = msg.id;
    if (!id) return true;
    switch (msg.type) {
      case "tunnel-open":
        this.open(id, String(msg.host ?? ""), Number(msg.port ?? 0), msg.source);
        return true;
      case "tunnel-data": {
        const st = this.streams.get(id);
        if (st && msg.b64) {
          const chunk = Buffer.from(msg.b64, "base64");
          st.up += chunk.length;
          this.opts.runtime?.addBytes(id, "up", chunk.length);
          st.sock.write(chunk);
        }
        return true;
      }
      case "tunnel-close":
        this.dropStream(id, true);
        return true;
      default:
        return true;
    }
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }

  private audit(id: string, host: string, port: number, source: RelaySource | undefined, started: number, outcome: RelayEventV2["outcome"], reason?: string, bytesUp = 0, bytesDown = 0): void {
    const safe = safeTunnelTarget(host, port) ?? safeTunnelTarget("invalid.invalid", Number.isInteger(port) && port > 0 && port <= 65535 ? port : 1)!;
    const finished = this.now();
    this.opts.audit?.({
      v: 2,
      id: `tunnel-${id}`,
      startedAt: new Date(started || finished).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: started ? Math.max(0, finished - started) : 0,
      source,
      mode: "tunnel",
      outcome,
      target: safe.target,
      host: safe.host,
      session: false,
      bytesUp,
      bytesDown,
      ...(reason ? { reason } : {}),
    });
  }

  private refuse(id: string, host: string, port: number, source: RelaySource | undefined, outcome: RelayEventV2["outcome"], reason: string, started = 0): void {
    this.opts.runtime?.finish(id);
    this.audit(id, host, port, source, started, outcome, reason);
    this.sink.send(JSON.stringify({ type: "tunnel-refused", id, reason }));
  }

  private open(id: string, host: string, port: number, source?: RelaySource): void {
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return this.refuse(id, host, port, source, "safety-blocked", "bad target");
    }
    const denial = this.opts.deny?.(source, host.toLowerCase().replace(/\.$/, ""));
    if (denial) return this.refuse(id, host, port, source, "owner-blocked", denial);
    // Literal check (cheap, and catches the obvious attempt) …
    if (isDisallowedTarget(host)) return this.refuse(id, host, port, source, "safety-blocked", "target not allowed");

    const started = this.now();
    const safe = safeTunnelTarget(host, port)!;
    this.opts.runtime?.begin({ id, source, mode: "tunnel", target: safe.target, startedAt: new Date(started).toISOString() });
    const dial = this.opts.dial ?? defaultDial;
    const sock = dial(
      host,
      port,
      (s) => {
        // … and the check only this end can do: where did it ACTUALLY connect? A
        // hostname that resolves into the owner's LAN dies here, before any bytes.
        // Fail CLOSED: if we can't read where it actually connected (falsy remoteAddress), we
        // can't prove it isn't the owner's LAN — so refuse, don't wave it through.
        const peer = s.remoteAddress;
        if (!peer || isDisallowedTarget(peer)) {
          s.destroy();
          this.streams.delete(id);
          return this.refuse(id, host, port, source, "safety-blocked", "resolved to a private address", started);
        }
        this.sink.send(JSON.stringify({ type: "tunnel-ready", id }));
      },
      () => {
        this.streams.delete(id);
        this.refuse(id, host, port, source, "network-error", "could not connect", started);
      },
    );

    this.streams.set(id, { sock, host, port, up: 0, down: 0, source, started });
    sock.on("data", (chunk: Buffer) => {
      const st = this.streams.get(id);
      if (st) st.down += chunk.length;
      this.opts.runtime?.addBytes(id, "down", chunk.length);
      this.sink.send(JSON.stringify({ type: "tunnel-data", id, b64: chunk.toString("base64") }));
    });
    sock.on("close", () => this.dropStream(id, false));
    sock.on("error", () => this.dropStream(id, false, "network-error", "remote connection error"));
  }

  /** Close a stream. `fromGateway` means the pod hung up, so we don't echo a close back. */
  private dropStream(id: string, fromGateway: boolean, outcome: RelayEventV2["outcome"] = "ok", reason?: string): void {
    const st = this.streams.get(id);
    if (!st) return;
    this.streams.delete(id);
    this.opts.runtime?.finish(id);
    try {
      st.sock.end();
    } catch {
      /* already gone */
    }
    this.audit(id, st.host, st.port, st.source, st.started, outcome, reason, st.up, st.down);
    if (!fromGateway) this.sink.send(JSON.stringify({ type: "tunnel-close", id }));
  }

  /** Tear everything down (relay stopping / socket lost). */
  closeAll(): void {
    for (const id of [...this.streams.keys()]) this.dropStream(id, true);
  }
}
