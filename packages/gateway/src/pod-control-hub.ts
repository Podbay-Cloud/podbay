/**
 * The gateway's end of the control sockets — one per running pod.
 *
 * The gateway DIALS each pod (the pod never initiates), carrying fetch memory now
 * and relay traffic later. Connection management is injected so the routing — record
 * what a pod learned, push back the fleet plan, ignore junk — is testable without a
 * real socket or a running pod.
 */

export interface PodLink {
  send(json: string): void;
  close(): void;
  /** Register the inbound handler; called once, at open. */
  onMessage(handler: (raw: string) => void): void;
  /** Called when the socket closes for any reason, so the hub can forget it. */
  onClose(handler: () => void): void;
}

export interface FetchMemorySink {
  /** Record a report ATTRIBUTED to the reporting pod's owner — the gateway resolves the
   * owner from podId (M1), so a tenant's verdict can't steer another owner's fetch plan. */
  record(podId: string, domain: string, rung: string, outcome: string): Promise<void>;
  /** The plan broadcast to every connected pod: the TRUSTED global baseline only. A pod's
   * own-owner verdicts reach it via the reconcile push (which is owner-scoped). */
  fleetPlan(): Promise<{ domains: Record<string, unknown> }>;
}

export interface PodControlHubDeps {
  /** Open a control socket to a pod. Throwing (or a socket that closes immediately)
   * is fine — the hub retries on the next ensure() pass. */
  connect(podId: string): Promise<PodLink>;
  /** Fetch-memory sink. Optional: the hub also carries relay traffic, which does not
   * need it — so a gateway with relays but no fetch memory still gets a hub. */
  memory?: FetchMemorySink;
  /** Relay request from a pod → wherever the relay layer routes it. Absent until the
   * relay socket exists; a request arriving with no router is logged, not lost
   * silently. */
  onRelayFetch?(podId: string, req: { id: string; url: string; domain: string }): void;
  /** A pod is asking the gateway to mint a pairing command its owner can run to bring
   * up a relay. */
  onRelayPairRequest?(podId: string, req: { id: string }): void;
  /** ── Egress tunnel ──────────────────────────────────────────────────────────
   * A pod wants a tunnelled connection, or is sending bytes/closing one. Routed to
   * the owner's relay by the TunnelRouter (which owns every guard). */
  onTunnelOpen?(podId: string, streamId: string, host: string, port: number): void;
  /** Current relay state for a pod's owner, so a freshly-opened control link can be
   * SYNCED rather than waiting for the next broadcast. */
  relayStateFor?(podId: string): Promise<{ connected: boolean; domains: string[] } | null>;
  /** A pod's control link went away — drop its tunnelled streams. */
  onPodGone?(podId: string): void;
  onTunnelFromPod?(
    podId: string,
    streamId: string,
    frame: { kind: "data"; b64: string } | { kind: "close" },
  ): void;
  log?(event: string, detail?: Record<string, unknown>): void;
}

interface Conn {
  link: PodLink;
  /** Guards against two ensure() passes racing to open the same pod. */
  opening: boolean;
}

export class PodControlHub {
  private readonly conns = new Map<string, Conn>();
  /** Pods whose connect failed recently, and when to try them again. Without this,
   * a pod that cannot support a control socket (an older image) would be re-dialled
   * every single sweep — a handshake, a reject, and a phantom connection each time. */
  private readonly cooldown = new Map<string, number>();

  constructor(
    private readonly deps: PodControlHubDeps,
    private readonly cooldownMs = 10 * 60_000,
    private readonly now: () => number = () => Date.now(),
    /** Simultaneous dials. Unbounded fan-out means a gateway restart tries to open a
     * socket to EVERY running pod at once, each with a handshake timeout, on one
     * vCPU — a connect storm exactly when the process is least able to absorb it. */
    private readonly maxConcurrentConnects = 8,
    /** A pod whose image predates the /control route lands the gateway's dial on its
     * TERMINAL handler as a phantom client — connect+close churns an old pod-agent's
     * client state (the makore RC flapping, 2026-07-31). Such a pod cannot support
     * control until it updates, so back off far harder than a transient failure: still
     * re-probe occasionally (an updated pod is picked up within this window, or on the
     * next gateway restart), but stop poking its terminal every few minutes. */
    private readonly staleImageCooldownMs = 60 * 60_000,
  ) {}

  /** Reconcile connections to the set of currently-running pods. Opens the missing,
   * closes the departed, and leaves the rest ALONE — a healthy socket must not be
   * torn down and rebuilt every sweep. */
  async ensure(runningPodIds: string[]): Promise<void> {
    const running = new Set(runningPodIds);

    for (const [podId, conn] of this.conns) {
      if (!running.has(podId)) {
        // null-safe: a placeholder still mid-dial has no link yet. Deleting it here
        // makes the in-flight connect orphan itself (its success path checks it is
        // still the tracked entry, and closes the link if not).
        conn.link?.close();
        this.conns.delete(podId);
        // The pod is gone — tell the relay to close any streams it still holds for it.
        this.deps.onPodGone?.(podId);
      }
    }
    for (const podId of this.cooldown.keys()) {
      if (!running.has(podId)) this.cooldown.delete(podId);
    }

    const toOpen = runningPodIds
      .filter((id) => !this.conns.has(id))
      .filter((id) => (this.cooldown.get(id) ?? 0) <= this.now());

    // Dial in bounded batches rather than all at once.
    for (let i = 0; i < toOpen.length; i += this.maxConcurrentConnects) {
      const batch = toOpen.slice(i, i + this.maxConcurrentConnects);
      await Promise.all(
        batch.map(async (podId) => {
          // Reserve the slot before the await, so a second ensure() cannot open a
          // duplicate socket to the same pod while this one is connecting.
          const placeholder: Conn = { link: null as unknown as PodLink, opening: true };
          this.conns.set(podId, placeholder);
          try {
            const link = await this.deps.connect(podId);
            // Removed while we were dialing (pod stopped, or a racing ensure): do not
            // adopt this socket — close it and leave.
            if (this.conns.get(podId) !== placeholder) {
              link.close();
              return;
            }
            placeholder.link = link;
            placeholder.opening = false;
            link.onMessage((raw) => this.onMessage(podId, raw));
            link.onClose(() => {
              // Only forget it if this is still the current connection — a
              // reconnect may already have replaced it.
              if (this.conns.get(podId) === placeholder) this.conns.delete(podId);
            });
            // Send the current plan immediately, so a freshly-connected pod is not
            // stuck on stale memory until the next push tick.
            await this.pushPlanTo(podId).catch(() => undefined);
            // …and the relay state, so a pod that joined AFTER its owner's relay knows
            // the relay exists instead of offering a pairing code for a live one.
            await this.syncRelayStateTo(podId).catch(() => undefined);
          } catch (e) {
            if (this.conns.get(podId) === placeholder) this.conns.delete(podId);
            // A capability miss (the pod answered, but its image has no /control route)
            // means poking its terminal handler achieved nothing and disturbed it — so
            // back off HARD. A transient failure (refused/timeout) keeps the short
            // cooldown, since the next sweep might succeed.
            const msg = String(e);
            const capabilityMiss = /not a control socket|no control-hello/i.test(msg);
            this.cooldown.set(
              podId,
              this.now() + (capabilityMiss ? this.staleImageCooldownMs : this.cooldownMs),
            );
            this.deps.log?.("control_connect_failed", { podId, err: msg, capabilityMiss });
          }
        }),
      );
    }
  }

  private onMessage(podId: string, raw: string): void {
    let msg: {
      type?: string; reports?: unknown[]; id?: string; url?: string; domain?: string;
      host?: string; port?: number; b64?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.deps.log?.("control_bad_json", { podId });
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "fetch-outcomes":
        void this.ingest(podId, Array.isArray(msg.reports) ? msg.reports : []);
        return;
      case "relay-fetch":
        // Route on id + url ONLY. The pod's `domain` is advisory and often absent — and
        // the relay layer re-derives the host from the URL for SSRF anyway, never
        // trusting a pod-supplied domain. Requiring it here silently dropped every real
        // relay request (the pod-agent sends no domain), which the e2e test missed
        // because its fake pod DID send one.
        if (msg.id && msg.url) {
          if (this.deps.onRelayFetch) {
            this.deps.onRelayFetch(podId, { id: msg.id, url: msg.url, domain: msg.domain ?? "" });
          } else {
            this.deps.log?.("relay_fetch_no_router", { podId });
          }
        }
        return;
      case "tunnel-open":
        if (msg.id && msg.host && typeof msg.port === "number") {
          this.deps.onTunnelOpen?.(podId, String(msg.id), String(msg.host), msg.port);
        }
        return;
      case "tunnel-data":
        if (msg.id) this.deps.onTunnelFromPod?.(podId, String(msg.id), { kind: "data", b64: String(msg.b64 ?? "") });
        return;
      case "tunnel-close":
        if (msg.id) this.deps.onTunnelFromPod?.(podId, String(msg.id), { kind: "close" });
        return;
      case "relay-pair-request":
        if (msg.id) {
          if (this.deps.onRelayPairRequest) this.deps.onRelayPairRequest(podId, { id: msg.id });
          else this.deps.log?.("relay_pair_no_router", { podId });
        }
        return;
      case "pong":
        return;
      default:
        this.deps.log?.("control_unknown_type", { podId, type: msg.type });
    }
  }

  private async ingest(podId: string, reports: unknown[]): Promise<void> {
    if (!this.deps.memory) return;
    for (const r of reports) {
      const row = r as { domain?: unknown; rung?: unknown; outcome?: unknown };
      if (typeof row.domain !== "string" || typeof row.rung !== "string" || typeof row.outcome !== "string") {
        continue; // one malformed row must not abort a pod's whole drain
      }
      // record() now validates rung/outcome AND the domain, throwing on anything
      // unrecognised; a bad row is dropped (and noted) rather than poisoning a
      // fleet-wide table.
      await this.deps.memory
        .record(podId, row.domain, row.rung, row.outcome)
        .catch(() => this.deps.log?.("fetch_outcome_rejected", { podId, rung: row.rung }));
    }
  }

  /** Push the current fleet plan to every connected pod. Called on a tick and once
   * per pod at connect. */
  async pushPlan(): Promise<void> {
    if (!this.deps.memory) return;
    const plan = await this.deps.memory.fleetPlan().catch(() => null);
    if (!plan) return;
    const payload = JSON.stringify({ type: "fetch-plan", ...plan });
    for (const conn of this.conns.values()) {
      if (!conn.opening) conn.link.send(payload);
    }
  }

  private async pushPlanTo(podId: string): Promise<void> {
    if (!this.deps.memory) return;
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return;
    const plan = await this.deps.memory.fleetPlan().catch(() => null);
    if (plan) conn.link.send(JSON.stringify({ type: "fetch-plan", ...plan }));
  }

  /**
   * SYNC relay state to a pod whose control link just opened.
   *
   * Relay state was only ever BROADCAST, on connect/disconnect. A pod whose link opened
   * after its owner's relay did therefore never learned about it: `podbay fetch` told the
   * owner "no relay — here is a pairing code" while their relay was up and serving
   * (seen live on moderate-peacock-59a7, 2026-08-04). Broadcast-without-sync is only
   * correct if nothing ever joins late, and pods join late all the time.
   */
  async syncRelayStateTo(podId: string): Promise<void> {
    if (!this.deps.relayStateFor) return;
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return;
    const state = await this.deps.relayStateFor(podId).catch(() => null);
    if (!state) return;
    conn.link.send(JSON.stringify({ type: "relay-state", ...state }));
  }

  /** Deliver a relay result down to the pod that asked. */
  sendRelayResult(podId: string, result: { id: string; status: number; body: string; error?: string }): boolean {
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return false;
    conn.link.send(JSON.stringify({ type: "relay-result", ...result }));
    return true;
  }

  /** Deliver a tunnel frame down to a pod's control link. */
  sendTunnel(podId: string, msg: Record<string, unknown>): boolean {
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return false;
    conn.link.send(JSON.stringify(msg));
    return true;
  }

  /** Deliver a minted pairing command down to the pod that asked. */
  sendRelayPairCode(podId: string, payload: { id: string; command: string; expiresAt: number }): boolean {
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return false;
    conn.link.send(JSON.stringify({ type: "relay-pair-code", ...payload }));
    return true;
  }

  /** Tell a pod whether its owner's relay is available, so its agents can report a
   * source as pending before trying. */
  sendRelayState(podId: string, connected: boolean, domains: string[]): boolean {
    const conn = this.conns.get(podId);
    if (!conn || conn.opening) return false;
    conn.link.send(JSON.stringify({ type: "relay-state", connected, domains }));
    return true;
  }

  /** Forget a pod's connect cooldown so the next sweep re-dials it immediately. Called
   * when the pod restarts (its terminal dropped upstream) — the moment an image update
   * takes effect — so a now-control-capable pod does not wait out the stale-image
   * backoff. Safe if there is no cooldown (a no-op). */
  resetControlCooldown(podId: string): void {
    this.cooldown.delete(podId);
  }

  connectedPods(): string[] {
    return [...this.conns.entries()].filter(([, c]) => !c.opening).map(([id]) => id);
  }

  closeAll(): void {
    for (const conn of this.conns.values()) conn.link?.close();
    this.conns.clear();
  }
}
