/**
 * Detect a DEAD WebSocket link and force it closed so the owner's reconnect (or the
 * gateway's cleanup) fires.
 *
 * A slept laptop or a network change leaves a WebSocket HALF-OPEN: no FIN/RST arrives, so
 * `close` never fires and the socket still reads as OPEN. Whoever holds that link then sits
 * on a zombie — reporting "connected" while all traffic silently fails — until something
 * forces a reconnect. (Relay: reported by the afisha crawler 2026-08-11. Gateway→relay:
 * the source of the "dashboard says connected, pods time out, 0 errors" report 2026-08-18.)
 *
 * A ping/pong heartbeat closes the gap: ping every `pingIntervalMs`, and if the pong (or any
 * other inbound frame) doesn't arrive within `pongTimeoutMs`, the link is dead → `onDead()`
 * then `terminate()` → the `close` handler runs. Worst-case detection is
 * `pingIntervalMs + pongTimeoutMs`. `onAlive` fires on every proof-of-life (pong/frame), so a
 * caller can drive its OWN liveness state (e.g. a DB "last seen") from REAL traffic instead of
 * a blind timer that lies during a half-open window.
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
  /** Called on every proof-of-life (a pong, or ANY inbound frame). Use it to refresh your own
   * liveness state from REAL traffic — never from a blind timer. Throttle inside if it's costly. */
  onAlive?: () => void;
  /** Called ONCE when the pong window expires (link declared dead), just before `terminate()`.
   * Use it to log / count the outage — the thing that was invisible before. */
  onDead?: () => void;
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
  // A pong OR any inbound frame proves the link is live — a busy link may never sit idle
  // long enough to need a ping, and that's fine. Clearing the pong window means "answered".
  const markAlive = (): void => {
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = undefined;
    }
    opts.onAlive?.();
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
      // No pong/traffic within the window → the link is a zombie. Surface it, then force it
      // closed so `close` fires and cleanup/reconnect runs.
      pongTimer = undefined;
      try {
        opts.onDead?.();
      } catch {
        /* a logging/counting callback must never break the terminate */
      }
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
