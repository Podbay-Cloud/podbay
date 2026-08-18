/**
 * Detect a DEAD gateway link and force it closed so the relay's reconnect fires — WITHOUT
 * false-positiving on a jittery/throttled Mac.
 *
 * The relay reconnects with backoff on `ws.on("close")` — but a slept laptop or a network change
 * leaves the WebSocket HALF-OPEN: no FIN/RST, `close` never fires, the socket still reads OPEN, and
 * the relay sits on a zombie reporting "connected" while egress silently fails. So we ping and, if
 * the link stops answering, `terminate()` → `close` → reconnect.
 *
 * The SUBTLETY (root cause of the flapping reported 2026-08-18): on macOS a background Node process
 * gets its timers THROTTLED/COALESCED (App Nap, Wi-Fi power-save, Timer Coalescing) and PAUSED during
 * sleep. A naive "no pong in 5s → terminate" then kills a perfectly healthy link every time the OS
 * throttles us or we wake from a nap — a self-inflicted flap. This heartbeat is hardened against that:
 *
 *   1. WALL-CLOCK suspension detection — if a tick lands far later than scheduled, the OS froze us
 *      (nap/sleep), NOT the link. We can't judge liveness right after a freeze, so we RESET and
 *      re-verify with a fresh ping instead of terminating.
 *   2. N CONSECUTIVE misses (default 2) before declaring death — a single late pong (normal jitter)
 *      never kills the link; it takes a sustained silence.
 *   3. A TOLERANT interval (default 15s) — residential RTT is sub-second, so 15s×2 ≈ 30s worst-case
 *      detection is plenty fast while leaving generous headroom for jitter.
 *
 * Any inbound frame (not just a pong) counts as proof-of-life.
 */
export interface HeartbeatSocket {
  on(event: "pong" | "message" | "close", listener: (...args: unknown[]) => void): unknown;
  off?(event: "pong" | "message" | "close", listener: (...args: unknown[]) => void): unknown;
  ping(): void;
  terminate(): void;
}

export interface HeartbeatOptions {
  /** How often to ping. Default 15s (tolerant — a residential link answers in well under a second). */
  pingIntervalMs?: number;
  /** Consecutive unanswered pings before the link is declared dead. Default 2 (one blip never kills). */
  maxMissedPings?: number;
  /** A tick landing later than `pingIntervalMs × this` means the PROCESS was frozen (App Nap/sleep),
   * not the link — reset + re-verify rather than false-terminate. Default 2.5. */
  suspendFactor?: number;
  /** Called on every proof-of-life (pong or any inbound frame). */
  onAlive?: () => void;
  /** Called once when the link is declared dead, just before `terminate()`. */
  onDead?: () => void;
}

/**
 * Attach a liveness heartbeat to an OPEN socket. Returns a cleanup function; it also self-clears on
 * `close`, so callers can usually just call it and forget it.
 */
export function attachHeartbeat(ws: HeartbeatSocket, opts: HeartbeatOptions = {}): () => void {
  const pingIntervalMs = opts.pingIntervalMs ?? 15_000;
  const maxMissedPings = Math.max(1, opts.maxMissedPings ?? 2);
  const suspendFactor = opts.suspendFactor ?? 2.5;
  const now = (): number => Date.now();
  const unref = (t: unknown): void => {
    (t as { unref?: () => void }).unref?.();
  };

  let missed = 0;
  // Did a pong / any frame arrive since the last ping? Starts true so the first tick just pings.
  let answered = true;
  let lastTick = now();

  const markAlive = (): void => {
    missed = 0;
    answered = true;
    opts.onAlive?.();
  };
  ws.on("pong", markAlive);
  ws.on("message", markAlive);

  const timer = setInterval(() => {
    const t = now();
    const sinceLast = t - lastTick;
    lastTick = t;

    // (1) The OS froze us (App Nap / sleep / heavy throttle): this tick is way overdue. A frozen
    // process cannot tell a live link from a dead one — so DON'T terminate on the stale window.
    // Reset and re-verify with a fresh ping; the next few ticks decide honestly.
    if (sinceLast > pingIntervalMs * suspendFactor) {
      missed = 0;
      answered = false;
      try {
        ws.ping();
      } catch {
        /* socket closing between ticks */
      }
      return;
    }

    // (2) The previous ping went a full, on-time interval with no answer → a real miss.
    if (!answered) {
      missed += 1;
      if (missed >= maxMissedPings) {
        try {
          opts.onDead?.();
        } catch {
          /* a logging callback must never block the terminate */
        }
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        return;
      }
    }

    answered = false;
    try {
      ws.ping();
    } catch {
      /* socket closing between ticks */
    }
  }, pingIntervalMs);
  unref(timer);

  const clear = (): void => {
    clearInterval(timer);
    ws.off?.("pong", markAlive);
    ws.off?.("message", markAlive);
  };
  ws.on("close", clear);
  return clear;
}
