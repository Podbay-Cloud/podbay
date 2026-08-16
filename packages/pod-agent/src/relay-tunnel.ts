import type { TunnelStream } from "./relay-proxy.js";

/**
 * The pod's tunnel multiplexer: turns each SOCKS CONNECT into a stream carried over the
 * (single) control link to the gateway, and routes the frames coming back to the right
 * connection.
 *
 * Stream ids are minted HERE and are local to this pod; the gateway pairs them with its
 * own ids, so a pod can never address another pod's stream. A frame for an id we do not
 * have open is dropped by `handleEvent` returning false (the control link logs it).
 *
 * Fail-closed is a property of `dial`: if the gateway refuses, or nothing answers within
 * the open timeout, it resolves null and the proxy returns a SOCKS refusal — it never
 * resolves a stream that isn't actually connected.
 */

export interface TunnelSend {
  (msg:
    | { type: "tunnel-open"; id: string; host: string; port: number }
    | { type: "tunnel-data"; id: string; b64: string }
    | { type: "tunnel-close"; id: string }): void;
}

export type TunnelEvent =
  | { kind: "ready" }
  | { kind: "refused"; reason?: string }
  | { kind: "data"; chunk: Buffer }
  | { kind: "close" };

/** A dial either connects (a stream) or is refused WITH a reason — so the proxy can tell a soft,
 * retryable limit (capacity/rate) from a hard "relay down", and log/classify it. */
export type DialOutcome = { stream: TunnelStream } | { refused: string };

interface OpenStream {
  onData: ((c: Buffer) => void)[];
  onEnd: (() => void)[];
  settle?: (o: DialOutcome) => void;
  ready: boolean;
}

/** How long to wait for the owner's relay to report the target connected. Bounded so a
 * hung/absent relay fails the CONNECT quickly instead of stalling the app. */
const OPEN_TIMEOUT_MS = 30_000;

export class TunnelMux {
  private readonly streams = new Map<string, OpenStream>();
  private seq = 0;

  constructor(
    private readonly send: TunnelSend,
    private readonly opts: { openTimeoutMs?: number; now?: () => number } = {},
  ) {}

  /** Number of streams currently open — for the concurrency ceiling + metering. */
  get openCount(): number {
    return this.streams.size;
  }

  /** Open a tunnelled connection; resolves `{ refused }` (with a reason) when it cannot be served
   * (fail closed). Never resolves a stream that isn't actually connected. */
  dial(host: string, port: number): Promise<DialOutcome> {
    const id = `t${++this.seq}-${(this.opts.now?.() ?? Date.now()).toString(36)}`;
    const st: OpenStream = { onData: [], onEnd: [], ready: false };
    this.streams.set(id, st);

    return new Promise<DialOutcome>((resolve) => {
      let done = false;
      const settle = (o: DialOutcome): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!("stream" in o)) this.streams.delete(id);
        resolve(o);
      };
      st.settle = settle;
      const timer = setTimeout(() => {
        // Nothing answered — tell the far end to drop it, and fail the CONNECT closed.
        this.send({ type: "tunnel-close", id });
        settle({ refused: "no-answer" });
      }, this.opts.openTimeoutMs ?? OPEN_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();

      this.send({ type: "tunnel-open", id, host, port });
    });
  }

  /** Route one inbound frame. False when no such stream is open here. */
  handleEvent(id: string, event: TunnelEvent): boolean {
    const st = this.streams.get(id);
    if (!st) return false;
    switch (event.kind) {
      case "ready": {
        if (st.ready) return true;
        st.ready = true;
        st.settle?.({
          stream: {
            write: (chunk) => {
              if (this.streams.has(id)) this.send({ type: "tunnel-data", id, b64: chunk.toString("base64") });
            },
            end: () => {
              if (this.streams.delete(id)) this.send({ type: "tunnel-close", id });
            },
            onData: (cb) => st.onData.push(cb),
            onEnd: (cb) => st.onEnd.push(cb),
          },
        });
        return true;
      }
      case "refused":
        // Carry the gateway's reason (e.g. "too many open connections for this pod") so the
        // proxy can classify capacity/rate/no-relay instead of a blanket "no relay".
        st.settle?.({ refused: event.reason ?? "refused" });
        return true;
      case "data":
        for (const cb of st.onData) cb(event.chunk);
        return true;
      case "close":
        this.streams.delete(id);
        for (const cb of st.onEnd) cb();
        st.settle?.({ refused: "closed" }); // a close before ready is a refusal
        return true;
    }
  }

  /** Drop every stream (relay disconnected / shutting down) — each app connection ends. */
  reset(): void {
    for (const [, st] of this.streams) {
      for (const cb of st.onEnd) cb();
      st.settle?.({ refused: "relay-reset" });
    }
    this.streams.clear();
  }
}
