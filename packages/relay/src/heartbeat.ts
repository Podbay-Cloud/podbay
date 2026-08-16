/**
 * Detect a DEAD gateway link and force it closed so the relay's reconnect fires.
 *
 * The relay already reconnects with backoff on `ws.on("close")` — but a slept laptop
 * or a network change leaves the WebSocket HALF-OPEN: no FIN/RST arrives, so `close`
 * never fires and the socket still reads as OPEN. The relay then sits on a zombie link,
 * reporting "connected" while all egress silently fails, until the owner manually
 * restarts it (reported by the afisha crawler, 2026-08-11).
 *
 * A ping/pong heartbeat closes that gap: we ping every `pingIntervalMs`, and if the pong
 * (or any other inbound frame) doesn't arrive within `pongTimeoutMs`, the link is dead →
 * `terminate()` → the existing `close` handler runs its backoff reconnect. Worst-case
 * detection is `pingIntervalMs + pongTimeoutMs`; the short pong window keeps that tight so
 * a crawler that wakes with the host loses seconds, not a whole run.
 */
export interface HeartbeatSocket {
  on(event: "pong" | "message" | "close", listener: (...args: unknown[]) => void): unknown;
  off?(event: "pong" | "message" | "close", listener: (...args: unknown[]) => void): unknown;
  ping(): void;
  terminate(): void;
}

export interface HeartbeatOptions {
  /** How often to ping an otherwise-idle link. Default 10s. */
  pingIntervalMs?: number;
  /** How long to wait for a pong (or any frame) before declaring the link dead. Default 5s. */
  pongTimeoutMs?: number;
}

/**
 * Attach a liveness heartbeat to an OPEN socket. Returns a cleanup function; it also
 * self-clears on `close`, so callers can usually just call it and forget it.
 */
export function attachHeartbeat(ws: HeartbeatSocket, opts: HeartbeatOptions = {}): () => void {
  const pingIntervalMs = opts.pingIntervalMs ?? 10_000;
  const pongTimeoutMs = opts.pongTimeoutMs ?? 5_000;
  const unref = (t: unknown): void => {
    (t as { unref?: () => void }).unref?.();
  };

  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  // A pong OR any inbound frame proves the link is live — a busy relay may never sit idle
  // long enough to need a ping, and that's fine. Clearing the pong window means "answered".
  const markAlive = (): void => {
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = undefined;
    }
  };
  ws.on("pong", markAlive);
  ws.on("message", markAlive);

  const pingTimer = setInterval(() => {
    if (pongTimer) return; // a previous ping's window is still open — don't stack
    try {
      ws.ping();
    } catch {
      /* socket closing between ticks */
    }
    pongTimer = setTimeout(() => {
      // No pong/traffic within the window → the link is a zombie. Force it closed so
      // `close` fires and the reconnect runs.
      pongTimer = undefined;
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }, pongTimeoutMs);
    unref(pongTimer);
  }, pingIntervalMs);
  unref(pingTimer);

  const clear = (): void => {
    clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    ws.off?.("pong", markAlive);
    ws.off?.("message", markAlive);
  };
  ws.on("close", clear);
  return clear;
}
