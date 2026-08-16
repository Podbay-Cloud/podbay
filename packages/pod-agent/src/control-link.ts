/**
 * The pod's half of the control socket.
 *
 * The GATEWAY dials this — the pod never initiates a connection, so there is still
 * nothing for it to authenticate to and no pod credential to mint or leak. That
 * property is the whole reason this is a socket the gateway opens rather than one the
 * pod opens, and it is easy to lose in a refactor: if you ever find yourself adding a
 * token here, the direction has been reversed by mistake.
 *
 * Message handling is a pure function over injected effects so it can be tested
 * without a socket, a gateway, or a pod.
 */

export type ControlInbound =
  /** The fleet's current fetch plan, to cache locally for `podbay fetch plan`. */
  | { type: "fetch-plan"; domains: Record<string, unknown> }
  /** Whether the owner has a relay connected, and for which domains — so an agent can
   * report a source as pending BEFORE it tries. */
  | { type: "relay-state"; connected: boolean; domains: string[] }
  /** A relay finished a fetch this pod asked for. */
  | { type: "relay-result"; id: string; status: number; body: string; error?: string }
  /** The gateway minted a pairing code + ready-to-run command in reply to this pod's
   * relay-pair-request, so the pod can show the owner exactly what to run. */
  | { type: "relay-pair-code"; id: string; command: string; expiresAt: number }
  /** ── Egress tunnel (SOCKS) ────────────────────────────────────────────────────
   * The owner's relay reached the target and the stream is open for bytes. */
  | { type: "tunnel-ready"; id: string }
  /** The tunnel will not serve this stream (no relay, policy refusal, dial failed).
   * The proxy fails the CONNECT closed — it never falls back to pod egress. */
  | { type: "tunnel-refused"; id: string; reason?: string }
  /** Bytes from the target, base64 (the control link is JSON text). */
  | { type: "tunnel-data"; id: string; b64: string }
  /** The far end closed. */
  | { type: "tunnel-close"; id: string }
  | { type: "ping" };

export type ControlOutbound =
  | { type: "fetch-outcomes"; reports: unknown[] }
  | { type: "relay-fetch"; id: string; url: string; domain: string }
  /** "My owner has no relay and I need one" — asks the gateway to mint a code. */
  | { type: "relay-pair-request"; id: string }
  /** ── Egress tunnel (SOCKS) ──────────────────────────────────────────────────── */
  | { type: "tunnel-open"; id: string; host: string; port: number }
  | { type: "tunnel-data"; id: string; b64: string }
  | { type: "tunnel-close"; id: string }
  | { type: "pong" };

export interface ControlDeps {
  writePlan(json: string): void;
  writeRelayState(json: string): void;
  /** Deliver a relay result to whoever is waiting on it. Returns false if nobody is —
   * a result for a request this pod never made is discarded, not applied. */
  deliverRelayResult(id: string, payload: { status: number; body: string; error?: string }): boolean;
  /** Deliver a minted pairing command to whoever asked for it. Same discard-if-unmatched
   * rule as a relay result. */
  deliverPairCode(id: string, payload: { command: string; expiresAt: number }): boolean;
  /** Tunnel stream events, delivered to the waiting SOCKS connection. Each returns false
   * when no such stream is open here — a frame for a stream this pod never opened (or
   * has already closed) is discarded, never applied. */
  deliverTunnelEvent?(
    id: string,
    event:
      | { kind: "ready" }
      | { kind: "refused"; reason?: string }
      | { kind: "data"; chunk: Buffer }
      | { kind: "close" },
  ): boolean;
  send(msg: ControlOutbound): void;
  log?(event: string, detail?: Record<string, unknown>): void;
}

/**
 * Handle one inbound message. Never throws: a malformed frame from anywhere must not
 * take down the socket that carries everything else.
 */
export function handleControlMessage(raw: string, deps: ControlDeps): void {
  let msg: ControlInbound;
  try {
    msg = JSON.parse(raw) as ControlInbound;
  } catch {
    deps.log?.("control_bad_json");
    return;
  }
  if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") {
    deps.log?.("control_bad_shape");
    return;
  }

  try {
    switch (msg.type) {
      case "fetch-plan":
        // Written whole, not merged: a partial plan that looks complete is worse than
        // an old one, because nothing downstream can tell the difference.
        deps.writePlan(JSON.stringify({ domains: msg.domains ?? {} }));
        return;
      case "relay-state":
        deps.writeRelayState(
          JSON.stringify({
            connected: Boolean(msg.connected),
            domains: Array.isArray(msg.domains) ? msg.domains : [],
            since: new Date().toISOString(),
          }),
        );
        return;
      case "relay-result":
        if (!deps.deliverRelayResult(msg.id, { status: msg.status, body: msg.body, error: msg.error })) {
          deps.log?.("control_unmatched_relay_result", { id: msg.id });
        }
        return;
      case "relay-pair-code":
        if (!deps.deliverPairCode(msg.id, { command: msg.command, expiresAt: msg.expiresAt })) {
          deps.log?.("control_unmatched_pair_code", { id: msg.id });
        }
        return;
      case "tunnel-ready":
      case "tunnel-refused":
      case "tunnel-data":
      case "tunnel-close": {
        // A tunnel frame for a stream this pod does not have open is dropped, not
        // applied — the same discard-if-unmatched rule the relay result follows.
        const event =
          msg.type === "tunnel-ready"
            ? ({ kind: "ready" } as const)
            : msg.type === "tunnel-refused"
              ? ({ kind: "refused", reason: msg.reason } as const)
              : msg.type === "tunnel-data"
                ? ({ kind: "data", chunk: Buffer.from(msg.b64, "base64") } as const)
                : ({ kind: "close" } as const);
        if (!deps.deliverTunnelEvent?.(msg.id, event)) {
          deps.log?.("control_unmatched_tunnel_frame", { id: msg.id, type: msg.type });
        }
        return;
      }
      case "ping":
        deps.send({ type: "pong" });
        return;
      default:
        deps.log?.("control_unknown_type", { type: (msg as { type: string }).type });
    }
  } catch (e) {
    // A handler that throws must not kill the connection either.
    deps.log?.("control_handler_failed", { type: msg.type, err: String(e) });
  }
}

/**
 * Read and clear the buffered fetch outcomes, ready to send.
 *
 * Clearing is the caller's job and happens only after a successful send — losing a
 * pod's history to a socket that dropped mid-frame is worse than sending it twice.
 */
export function takeOutcomes(read: () => string, clear: () => void, max = 500): unknown[] {
  let text = "";
  try {
    text = read();
  } catch {
    return [];
  }
  const lines = text.split("\n").filter(Boolean).slice(-max);
  const parsed = lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  if (parsed.length > 0) clear();
  return parsed;
}
