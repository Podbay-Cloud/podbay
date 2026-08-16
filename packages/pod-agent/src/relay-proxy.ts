import { createServer, type Server, type Socket } from "node:net";
import { classifyRelayRefusal } from "@podbay/shared";
import {
  REP,
  parseGreeting,
  greetingReply,
  parseConnect,
  connectReply,
  isDisallowedTarget,
} from "./relay-socks.js";
import type { DialOutcome } from "./relay-tunnel.js";

/**
 * The pod-side relay proxy: a localhost SOCKS5 endpoint that apps point
 * `PODBAY_RELAY_PROXY` at. Every CONNECT is carried over the control link to the owner's
 * relay, which dials the target from THEIR network — so a crawler keeps its live DOM and
 * its recipes, and only its egress address changes.
 *
 * Two invariants this file exists to hold:
 *  - **Fail closed.** With no relay connected the CONNECT is refused with a clean SOCKS
 *    error. It must never hang, and must never quietly fall back to the pod's own
 *    (datacenter) egress — an app would then think the relay worked.
 *  - **Never the owner's LAN.** A target that is a private/loopback literal is refused
 *    here, before anything is dialed (the owner's relay re-checks after DNS).
 *
 * The transport is injected, so the whole server is testable against a fake relay with no
 * gateway, no owner, and no network.
 */

/** One tunnelled connection to a target, as seen by the proxy. */
export interface TunnelStream {
  write(chunk: Buffer): void;
  end(): void;
  onData(cb: (chunk: Buffer) => void): void;
  onEnd(cb: () => void): void;
}

/**
 * Open a tunnelled connection through the owner's relay. Resolves null when the tunnel
 * can't serve it (no relay connected, or the platform/owner refused) → the proxy fails
 * the CONNECT closed.
 */
export type TunnelDialer = (host: string, port: number) => Promise<DialOutcome>;

export interface RelayProxyOpts {
  dial: TunnelDialer;
  /** Bind port; 0 lets the OS choose (tests). Bound to 127.0.0.1 only — never exposed. */
  port?: number;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/** Read exactly one framed chunk from a socket (the SOCKS handshake is small and
 * arrives in one or two segments; we accumulate until the parser is satisfied). */
function readOnce(sock: Socket, parse: (b: Buffer) => boolean): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 8192) return done(null); // a SOCKS handshake is never this big
      if (parse(buf)) done(buf);
    };
    const onEnd = (): void => done(null);
    const done = (v: Buffer | null): void => {
      sock.off("data", onData);
      sock.off("end", onEnd);
      sock.off("error", onEnd);
      resolve(v);
    };
    sock.on("data", onData);
    sock.on("end", onEnd);
    sock.on("error", onEnd);
  });
}

export class RelayProxy {
  private server: Server | null = null;

  constructor(private readonly opts: RelayProxyOpts) {}

  /** Start listening on 127.0.0.1; resolves with the bound port. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((sock) => void this.onConnection(sock));
      server.on("error", reject);
      server.listen(this.opts.port ?? 0, "127.0.0.1", () => {
        this.server = server;
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private async onConnection(sock: Socket): Promise<void> {
    sock.on("error", () => sock.destroy()); // a client vanishing is normal, never fatal
    try {
      // 1. Greeting.
      const greet = await readOnce(sock, (b) => parseGreeting(b).ok);
      if (!greet) {
        sock.destroy();
        return;
      }
      const g = parseGreeting(greet);
      if (!g.noAuth) {
        sock.end(greetingReply(false));
        return;
      }
      sock.write(greetingReply(true));

      // 2. CONNECT request.
      const reqBuf = await readOnce(sock, (b) => "req" in parseConnect(b) || "fail" in parseConnect(b));
      if (!reqBuf) {
        sock.destroy();
        return;
      }
      const parsed = parseConnect(reqBuf);
      if ("fail" in parsed) {
        sock.end(connectReply(parsed.fail));
        return;
      }
      const { host, port } = parsed.req;

      // 3. Never the owner's LAN — refused before anything is dialed.
      if (isDisallowedTarget(host)) {
        this.opts.log?.("relay_proxy_ssrf_refused", { host, port });
        sock.end(connectReply(REP.NOT_ALLOWED));
        return;
      }

      // 4. Dial through the owner's relay. No relay → fail CLOSED (never fall back to
      //    the pod's own egress; the app must learn the relay isn't serving it).
      const outcome = await this.opts.dial(host, port);
      if (!("stream" in outcome)) {
        // Distinguish WHY: a capacity/rate limit is soft + retryable, "no-relay" is a hard down.
        // A fail-closed workload must be able to tell them apart (afisha-crawler 2026-08-09).
        const kind = classifyRelayRefusal(outcome.refused);
        this.opts.log?.("relay_proxy_refused", { host, port, reason: outcome.refused, kind });
        sock.end(connectReply(REP.CONNECTION_REFUSED));
        return;
      }
      const stream = outcome.stream;

      // 5. Connected — splice the two directions.
      sock.write(connectReply(REP.OK));
      stream.onData((chunk) => {
        if (!sock.destroyed) sock.write(chunk);
      });
      stream.onEnd(() => {
        if (!sock.destroyed) sock.end();
      });
      sock.on("data", (chunk: Buffer) => stream.write(chunk));
      sock.on("end", () => stream.end());
      sock.on("close", () => stream.end());
      this.opts.log?.("relay_proxy_connected", { host, port });
    } catch (e) {
      this.opts.log?.("relay_proxy_error", { err: String(e) });
      sock.destroy();
    }
  }
}
