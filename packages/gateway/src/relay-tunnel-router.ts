import { isDisallowedTarget } from "@podbay/shared/net-guard";
import { RELAY_LIMITS } from "@podbay/shared";

/**
 * Routes egress-tunnel streams between a pod and its owner's relay.
 *
 * The pod opens a stream with an id of its own; the gateway pairs it with a
 * gateway-minted id and only ever addresses the relay with that. A pod therefore cannot
 * name — or hijack — a sibling's stream, the same reason relay fetch ids are minted here.
 *
 * This is also where the platform-side guards live, because the pod cannot be trusted to
 * enforce anything against itself:
 *  - the target host is taken from the CONNECT, and a private/loopback target is refused
 *    (the ONE shared SSRF check, so pod and gateway can never drift);
 *  - concurrency is capped per pod and per owner, so one pod cannot exhaust the relay;
 *  - new connections are capped per domain per minute, to protect the SOURCE from being
 *    hammered in the owner's name;
 *  - a refused stream is never counted against the rate budget (a refusal is not use).
 *
 * Metering is domain-level only — connections and bytes, never a path, never content.
 */

export interface TunnelRouterDeps {
  ownerOf(podId: string): Promise<string | null>;
  /** The pod's owner-chosen display name (gateway-resolved), for the owner's dashboard.
   * Optional/additive — absent falls back to podId on the relay. */
  podName?(podId: string): Promise<string | null>;
  /** The owner's live relay socket, or null when no relay is connected. */
  relayLink(ownerId: string): { send(payload: string): boolean } | null;
  /** Send a frame down to a pod's control link. */
  toPod(podId: string, msg: Record<string, unknown>): boolean;
  now?(): number;
  log?(event: string, detail?: Record<string, unknown>): void;
  policy?: Partial<TunnelPolicy>;
  /**
   * Where a health canary dials. Deliberately PODBAY'S OWN host: proving the tunnel works
   * must not spend the owner's connection on a third party they never agreed to touch.
   * Absent → canaries report "unknown" rather than inventing a target.
   */
  canaryTarget?: { host: string; port: number };
}

export interface TunnelPolicy {
  maxPerPod: number;
  maxPerOwner: number;
  /** New connections per domain per minute, per owner. */
  ratePerDomainPerMin: number;
}

// Single source of truth (packages/shared) so the pod-agent reports the SAME cap it's enforced at.
const DEFAULT_POLICY: TunnelPolicy = { ...RELAY_LIMITS };

interface Stream {
  gwId: string;
  podId: string;
  podStreamId: string;
  ownerId: string;
  host: string;
  port: number;
  bytesUp: number;
  bytesDown: number;
  at: number;
}

/**
 * Is the tunnel actually carrying traffic, as opposed to merely being connected?
 *
 * "Connected" only says the owner's websocket is up — it says nothing about whether a
 * CONNECT through it reaches the internet. That gap is exactly where a user gets stuck:
 * the cockpit says connected, their app fails, and nothing distinguishes the two.
 *
 * `ok` is recorded two ways: an active canary (`probe: true`), and passively whenever
 * real traffic gets a `tunnel-ready` back. Failure is recorded ONLY from a canary — a
 * real stream failing usually means that one target was unreachable, which is not the
 * tunnel being broken, and reporting it as such would cry wolf.
 */
export type TunnelHealthState = "ok" | "failed" | "unknown";

export interface TunnelHealth {
  state: TunnelHealthState;
  /** Epoch ms of the observation. */
  at: number;
  /** CONNECT round-trip, for canaries. */
  ms?: number;
  reason?: string;
  /** True when actively probed; false when observed from real traffic. */
  probe: boolean;
}

/** Usage for the cockpit + admin dashboards. */
export interface TunnelUsage {
  open: number;
  domains: { domain: string; connections: number; bytesUp: number; bytesDown: number }[];
  /** Per relay owner — cumulative since this gateway started, like the domain rollup. */
  owners: {
    ownerId: string;
    open: number;
    connections: number;
    bytesUp: number;
    bytesDown: number;
    health: TunnelHealth | null;
  }[];
  /**
   * Per pod — LIVE ONLY, derived from streams open right now. Per-pod attribution is
   * deliberately never accumulated or persisted (see the metering rule in 5.1): an
   * operator may see who is using the tunnel this moment, not build a history of it.
   */
  pods: { podId: string; open: number; domains: string[]; bytesUp: number; bytesDown: number }[];
}

/** How long a canary waits for the relay to say it connected before calling it failed. */
const CANARY_TIMEOUT_MS = 10_000;

/**
 * How long a connection blocked ONLY by the concurrency caps is held, waiting for a slot,
 * before it is refused. A crawler opens a whole page's sub-resources at once; that burst
 * momentarily blows past the per-pod cap, and refusing outright loses connections it would
 * have served a beat later. Holding briefly turns the ceiling into back-pressure instead of
 * a wall. Kept well under the pod's 30s dial timeout so the GATEWAY decides the outcome, not
 * the pod timing out first. Reported by the afisha crawler, 2026-08-11.
 */
const HOLD_MS = 6_000;

/** A connection parked at the concurrency ceiling, waiting for a slot to free. */
interface Waiter {
  podId: string;
  podStreamId: string;
  ownerId: string;
  host: string;
  port: number;
  podName: string | null;
  /** The cap that parked it — used verbatim if the hold lapses, so the pod still classifies
   * the eventual refusal as capacity (not a hang or a hard error). */
  reason: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Outcome of trying to place a stream right now: served, hold-for-a-slot, or hard-refuse. */
type PlaceResult = { ok: true } | { wait: string } | { refuse: string };

export class TunnelRouter {
  private readonly byGw = new Map<string, Stream>();
  private readonly byPod = new Map<string, Map<string, Stream>>(); // podId → podStreamId → stream
  private readonly recent = new Map<string, number[]>(); // `${ownerId}|${domain}` → open timestamps
  private readonly usage = new Map<string, { connections: number; bytesUp: number; bytesDown: number }>();
  private readonly byOwner = new Map<string, { connections: number; bytesUp: number; bytesDown: number }>();
  private readonly health = new Map<string, TunnelHealth>();
  /** In-flight canaries, keyed by their gateway stream id. Kept OUT of `byGw` so no
   * pod-routing path can ever be handed a stream with no pod behind it. */
  private readonly canaries = new Map<string, { ownerId: string; settle(h: TunnelHealth): void }>();
  /** Connections held at the concurrency ceiling, oldest first (FIFO). */
  private readonly waiters: Waiter[] = [];
  private seq = 0;
  private readonly policy: TunnelPolicy;

  constructor(private readonly deps: TunnelRouterDeps) {
    this.policy = { ...DEFAULT_POLICY, ...(deps.policy ?? {}) };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private refuse(podId: string, podStreamId: string, reason: string): void {
    this.deps.log?.("tunnel_refused", { podId, reason });
    this.deps.toPod(podId, { type: "tunnel-refused", id: podStreamId, reason });
  }

  /** A pod wants a tunnelled connection. Applies every guard, then asks the owner's relay —
   * or, when only the concurrency cap is in the way, holds it briefly for a slot. */
  async open(podId: string, podStreamId: string, host: string, port: number): Promise<void> {
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return this.refuse(podId, podStreamId, "bad target");
    }
    // The owner's LAN is never reachable from a pod — checked here too, not only on the
    // pod, because a compromised pod-agent could skip its own check.
    if (isDisallowedTarget(host)) return this.refuse(podId, podStreamId, "target not allowed");

    const ownerId = await this.deps.ownerOf(podId).catch(() => null);
    if (!ownerId) return this.refuse(podId, podStreamId, "no owner for pod");

    if (!this.deps.relayLink(ownerId)) return this.refuse(podId, podStreamId, "no relay connected");

    // Gateway-authoritative display name for the owner's dashboard (falls back to podId).
    const podName = this.deps.podName ? await this.deps.podName(podId).catch(() => null) : null;
    const w = { podId, podStreamId, ownerId, host, port, podName };

    const r = this.tryPlace(w);
    if ("ok" in r) return;
    if ("refuse" in r) return this.refuse(podId, podStreamId, r.refuse);
    // Blocked ONLY by a concurrency cap → hold for a slot instead of refusing.
    this.enqueue(w, r.wait);
  }

  /**
   * Try to serve a stream right now. Returns `{ ok }` when it was sent to the relay and
   * recorded, `{ wait }` (with the cap that blocked it) when only concurrency is in the way
   * — the one case the caller may hold and retry — and `{ refuse }` for a hard stop that
   * waiting cannot fix. Used for both the first attempt and each drain of the hold queue,
   * so a queued connection passes the exact same guards a fresh one does.
   */
  private tryPlace(w: Omit<Waiter, "reason" | "timer">): PlaceResult {
    const link = this.deps.relayLink(w.ownerId);
    if (!link) return { refuse: "no relay connected" };

    const podStreams = this.byPod.get(w.podId);
    if ((podStreams?.size ?? 0) >= this.policy.maxPerPod) {
      return { wait: "too many open connections for this pod" };
    }
    let ownerOpen = 0;
    for (const s of this.byGw.values()) if (s.ownerId === w.ownerId) ownerOpen++;
    if (ownerOpen >= this.policy.maxPerOwner) {
      return { wait: "too many open connections for this relay" };
    }

    const domain = w.host.toLowerCase();
    const key = `${w.ownerId}|${domain}`;
    const cutoff = this.now() - 60_000;
    const hits = (this.recent.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= this.policy.ratePerDomainPerMin) {
      return { refuse: "rate limit for this site" };
    }

    const gwId = `tn-${++this.seq}`;
    if (!link.send(JSON.stringify({ type: "tunnel-open", id: gwId, host: w.host, port: w.port, source: { podId: w.podId, ...(w.podName ? { podName: w.podName } : {}) } }))) {
      // The socket went away between the lookup and the send — not the pod's fault, and
      // NOT counted against the rate budget (a refusal is not use).
      return { refuse: "relay unavailable" };
    }
    hits.push(this.now());
    this.recent.set(key, hits);

    const stream: Stream = {
      gwId, podId: w.podId, podStreamId: w.podStreamId, ownerId: w.ownerId, host: domain, port: w.port,
      bytesUp: 0, bytesDown: 0, at: this.now(),
    };
    this.byGw.set(gwId, stream);
    if (!this.byPod.has(w.podId)) this.byPod.set(w.podId, new Map());
    this.byPod.get(w.podId)!.set(w.podStreamId, stream);
    const u = this.usage.get(domain) ?? { connections: 0, bytesUp: 0, bytesDown: 0 };
    u.connections++;
    this.usage.set(domain, u);
    const o = this.byOwner.get(w.ownerId) ?? { connections: 0, bytesUp: 0, bytesDown: 0 };
    o.connections++;
    this.byOwner.set(w.ownerId, o);
    return { ok: true };
  }

  /** Park a connection at the ceiling. The queue is bounded per pod and per owner so a pod
   * that is genuinely overloading the relay (not just spiking) is refused now rather than
   * growing an unbounded backlog — the "one pod cannot exhaust the relay" guarantee, held
   * across the hold window too. */
  private enqueue(w: Omit<Waiter, "reason" | "timer">, reason: string): void {
    const queuedForPod = this.waiters.reduce((n, x) => n + (x.podId === w.podId ? 1 : 0), 0);
    const queuedForOwner = this.waiters.reduce((n, x) => n + (x.ownerId === w.ownerId ? 1 : 0), 0);
    if (queuedForPod >= this.policy.maxPerPod || queuedForOwner >= this.policy.maxPerOwner) {
      return this.refuse(w.podId, w.podStreamId, reason);
    }
    const waiter: Waiter = {
      ...w,
      reason,
      timer: setTimeout(() => {
        this.removeWaiter(waiter);
        this.refuse(waiter.podId, waiter.podStreamId, waiter.reason);
      }, HOLD_MS),
    };
    if (typeof waiter.timer.unref === "function") waiter.timer.unref();
    this.waiters.push(waiter);
    this.deps.log?.("tunnel_queued", { podId: w.podId, reason, depth: this.waiters.length });
  }

  /** A slot freed — try to admit held connections, oldest first. A still-capped waiter must
   * not block a later one that now fits (they belong to different pods/domains), so scan the
   * whole queue rather than stopping at the first that can't yet be placed. */
  private drainWaiters(): void {
    if (this.waiters.length === 0) return;
    for (const w of [...this.waiters]) {
      const r = this.tryPlace(w);
      if ("wait" in r) continue; // still no slot — keep holding until its timer lapses
      this.removeWaiter(w);
      if ("refuse" in r) this.refuse(w.podId, w.podStreamId, r.refuse);
    }
  }

  private removeWaiter(w: Waiter): void {
    const i = this.waiters.indexOf(w);
    if (i < 0) return; // already drained/timed-out
    this.waiters.splice(i, 1);
    clearTimeout(w.timer);
  }

  private purgeWaiters(match: (w: Waiter) => boolean, refuseReason: string | null): void {
    for (const w of this.waiters.filter(match)) {
      this.removeWaiter(w);
      if (refuseReason) this.refuse(w.podId, w.podStreamId, refuseReason);
    }
  }

  /**
   * Actively prove the tunnel works for one owner: open a stream to podbay's own host,
   * wait for the relay to say it connected, then close it immediately without sending a
   * byte. Costs the owner one TCP connection and no meaningful data.
   *
   * Deliberately NOT periodic — it runs when a relay connects and when the owner asks.
   * A background heartbeat through someone's home connection is not ours to schedule.
   */
  async canary(ownerId: string): Promise<TunnelHealth> {
    const target = this.deps.canaryTarget;
    if (!target) {
      return this.setHealth(ownerId, { state: "unknown", at: this.now(), probe: true, reason: "no canary target configured" });
    }
    const link = this.deps.relayLink(ownerId);
    if (!link) {
      return this.setHealth(ownerId, { state: "failed", at: this.now(), probe: true, reason: "no relay connected" });
    }
    const gwId = `cn-${++this.seq}`;
    const started = this.now();
    const result = await new Promise<TunnelHealth>((resolve) => {
      let done = false;
      const settle = (h: TunnelHealth): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.canaries.delete(gwId);
        resolve(h);
      };
      const timer = setTimeout(() => {
        // Tell the relay to forget it — a canary that timed out here may still be dialing
        // on the owner's machine, and leaving it open would leak a socket per probe.
        this.deps.relayLink(ownerId)?.send(JSON.stringify({ type: "tunnel-close", id: gwId }));
        settle({ state: "failed", at: this.now(), ms: this.now() - started, probe: true, reason: "timed out" });
      }, CANARY_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
      this.canaries.set(gwId, { ownerId, settle });
      if (!link.send(JSON.stringify({ type: "tunnel-open", id: gwId, host: target.host, port: target.port, source: { system: "health-check" } }))) {
        settle({ state: "failed", at: this.now(), probe: true, reason: "relay unavailable" });
      }
    });
    this.deps.log?.("tunnel_canary", { ownerId, state: result.state, ms: result.ms, reason: result.reason });
    return this.setHealth(ownerId, result);
  }

  /** Last known health for an owner's tunnel — null when never observed or probed. */
  healthOf(ownerId: string): TunnelHealth | null {
    return this.health.get(ownerId) ?? null;
  }

  /** One owner's own tunnel usage, for their cockpit. Their machine, their numbers —
   * but still domain-free here: the full breakdown is `relay dashboard`, on their box. */
  ownerUsage(ownerId: string): { open: number; connections: number; bytesUp: number; bytesDown: number } {
    let open = 0;
    for (const s of this.byGw.values()) if (s.ownerId === ownerId) open++;
    return { open, ...(this.byOwner.get(ownerId) ?? { connections: 0, bytesUp: 0, bytesDown: 0 }) };
  }

  private setHealth(ownerId: string, h: TunnelHealth): TunnelHealth {
    this.health.set(ownerId, h);
    return h;
  }

  /** Bytes / close coming UP from the pod, forwarded to the owner's relay. */
  fromPod(podId: string, podStreamId: string, frame: { kind: "data"; b64: string } | { kind: "close" }): boolean {
    const stream = this.byPod.get(podId)?.get(podStreamId);
    if (!stream) return false;
    const link = this.deps.relayLink(stream.ownerId);
    if (frame.kind === "data") {
      const n = Math.ceil((frame.b64.length * 3) / 4);
      stream.bytesUp += n;
      this.addBytes(stream, n, 0);
      return Boolean(link?.send(JSON.stringify({ type: "tunnel-data", id: stream.gwId, b64: frame.b64 })));
    }
    link?.send(JSON.stringify({ type: "tunnel-close", id: stream.gwId }));
    this.drop(stream);
    return true;
  }

  /** Frames coming back from the owner's relay, forwarded down to the pod. Accepted only
   * from the owner whose relay was given the stream. */
  fromRelay(
    ownerId: string,
    msg: { type: string; id?: string; b64?: string; reason?: string },
  ): boolean {
    if (!msg.id) return false;
    // A canary is the gateway's own stream, not any pod's — settle it here and never let
    // it fall through to pod routing.
    const probe = this.canaries.get(msg.id);
    if (probe) {
      if (probe.ownerId !== ownerId) return false;
      if (msg.type === "tunnel-ready") {
        probe.settle({ state: "ok", at: this.now(), probe: true });
        // Nothing to say over it; close immediately so the probe costs one handshake.
        this.deps.relayLink(ownerId)?.send(JSON.stringify({ type: "tunnel-close", id: msg.id }));
      } else if (msg.type === "tunnel-refused" || msg.type === "tunnel-close") {
        probe.settle({ state: "failed", at: this.now(), probe: true, reason: msg.reason ?? "relay closed the probe" });
      }
      return true;
    }
    const stream = this.byGw.get(msg.id);
    if (!stream || stream.ownerId !== ownerId) return false;
    switch (msg.type) {
      case "tunnel-ready":
        // Real traffic just proved the whole path end to end — a stronger signal than any
        // probe, and free. (Only success is inferred this way; see TunnelHealth.)
        this.setHealth(ownerId, { state: "ok", at: this.now(), probe: false });
        return this.deps.toPod(stream.podId, { type: "tunnel-ready", id: stream.podStreamId });
      case "tunnel-data": {
        const b64 = msg.b64 ?? "";
        const n = Math.ceil((b64.length * 3) / 4);
        stream.bytesDown += n;
        this.addBytes(stream, 0, n);
        return this.deps.toPod(stream.podId, { type: "tunnel-data", id: stream.podStreamId, b64 });
      }
      case "tunnel-refused":
        this.drop(stream);
        return this.deps.toPod(stream.podId, {
          type: "tunnel-refused", id: stream.podStreamId, reason: msg.reason ?? "relay refused",
        });
      case "tunnel-close":
        this.drop(stream);
        return this.deps.toPod(stream.podId, { type: "tunnel-close", id: stream.podStreamId });
      default:
        return false;
    }
  }

  /** The pod's control link dropped — forget its streams and tell the relay to close them. */
  dropPod(podId: string): void {
    // The pod is gone — nothing to tell it; just drop anything it had queued.
    this.purgeWaiters((w) => w.podId === podId, null);
    const streams = this.byPod.get(podId);
    if (!streams) return;
    for (const s of [...streams.values()]) {
      this.deps.relayLink(s.ownerId)?.send(JSON.stringify({ type: "tunnel-close", id: s.gwId }));
      this.drop(s);
    }
  }

  /** The owner's relay went away — every stream of theirs fails closed at the pod. */
  dropOwner(ownerId: string): void {
    // The relay's gone, so held connections can't be served — fail them closed at the pod.
    this.purgeWaiters((w) => w.ownerId === ownerId, "relay disconnected");
    for (const [id, probe] of [...this.canaries.entries()]) {
      if (probe.ownerId !== ownerId) continue;
      this.canaries.delete(id);
      probe.settle({ state: "failed", at: this.now(), probe: true, reason: "relay disconnected" });
    }
    for (const s of [...this.byGw.values()]) {
      if (s.ownerId !== ownerId) continue;
      this.deps.toPod(s.podId, { type: "tunnel-close", id: s.podStreamId });
      this.drop(s);
    }
  }

  /** Usage for the dashboards — never a URL, never content. */
  usageSnapshot(): TunnelUsage {
    const openByOwner = new Map<string, number>();
    const pods = new Map<string, { open: number; domains: Set<string>; bytesUp: number; bytesDown: number }>();
    for (const s of this.byGw.values()) {
      openByOwner.set(s.ownerId, (openByOwner.get(s.ownerId) ?? 0) + 1);
      const p = pods.get(s.podId) ?? { open: 0, domains: new Set<string>(), bytesUp: 0, bytesDown: 0 };
      p.open++;
      p.domains.add(s.host);
      p.bytesUp += s.bytesUp;
      p.bytesDown += s.bytesDown;
      pods.set(s.podId, p);
    }
    // Every owner we have ever routed for, plus any with only a health record (a relay
    // that connected and was probed but has carried nothing yet — worth showing).
    const ownerIds = new Set([...this.byOwner.keys(), ...this.health.keys(), ...openByOwner.keys()]);
    return {
      open: this.byGw.size,
      domains: [...this.usage.entries()]
        .map(([domain, u]) => ({ domain, ...u }))
        .sort((a, b) => b.connections - a.connections),
      owners: [...ownerIds]
        .map((ownerId) => ({
          ownerId,
          open: openByOwner.get(ownerId) ?? 0,
          ...(this.byOwner.get(ownerId) ?? { connections: 0, bytesUp: 0, bytesDown: 0 }),
          health: this.health.get(ownerId) ?? null,
        }))
        .sort((a, b) => b.connections - a.connections),
      pods: [...pods.entries()]
        .map(([podId, p]) => ({ podId, open: p.open, domains: [...p.domains], bytesUp: p.bytesUp, bytesDown: p.bytesDown }))
        .sort((a, b) => b.open - a.open),
    };
  }

  /** Accumulate byte deltas as they flow, so the dashboards show live usage rather than
   * only what has already finished. Domain and owner roll up cumulatively; the per-pod
   * view is derived from open streams instead, so it disappears when the pod stops. */
  private addBytes(s: Stream, up: number, down: number): void {
    const u = this.usage.get(s.host) ?? { connections: 0, bytesUp: 0, bytesDown: 0 };
    u.bytesUp += up;
    u.bytesDown += down;
    this.usage.set(s.host, u);
    const o = this.byOwner.get(s.ownerId) ?? { connections: 0, bytesUp: 0, bytesDown: 0 };
    o.bytesUp += up;
    o.bytesDown += down;
    this.byOwner.set(s.ownerId, o);
  }

  private drop(s: Stream): void {
    this.byGw.delete(s.gwId);
    const m = this.byPod.get(s.podId);
    m?.delete(s.podStreamId);
    if (m && m.size === 0) this.byPod.delete(s.podId);
    // Bytes were already accumulated as they flowed (addBytes) — counting them again
    // here would double every finished stream.
    // This freed a per-pod AND a per-owner slot — admit anyone held for either.
    this.drainWaiters();
  }
}
