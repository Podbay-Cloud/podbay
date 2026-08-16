/**
 * Who is relaying, for whom, and whether a given fetch is allowed through.
 *
 * All policy, no sockets — a relay is just something you can `send` to, so the
 * decisions that matter (is this domain allowed, is the owner over their rate,
 * what happens when nobody is connected) are testable without a network.
 *
 * The rules encode one idea: the relay is the OWNER's own access, lent
 * deliberately and narrowly. Everything here defaults to refusing.
 */

export interface RelayLink {
  /** Returns false if the socket was not open — the request did not leave. */
  send(payload: string): boolean;
  close(): void;
}

export interface RelayFetchRequest {
  id: string;
  /** Pod that asked, so a result can be routed back to it. */
  podId: string;
  /** The pod's owner-chosen display name (gateway-resolved), for the owner's dashboard.
   * Optional/additive — absent falls back to podId on the relay. */
  podName?: string;
  url: string;
  domain: string;
}

export interface RelayFetchResult {
  id: string;
  status: number;
  body: string;
  finalUrl?: string;
  error?: string;
}

export type SubmitOutcome =
  | { status: "dispatched" }
  /**
   * Not right now — the relay is asleep, or the domain's budget is spent. Either way
   * the request WAITS rather than failing: the rate cap exists to protect the source
   * and the owner's address, and delaying protects both exactly as well as refusing
   * while still doing the job the caller asked for.
   */
  | { status: "queued"; position: number; readyInMs: number; reason?: string }
  /** Genuinely cannot be served: not lent, or the queue is full. */
  | { status: "refused"; reason: string };

export interface RelayState {
  connected: boolean;
  since: string | null;
  domains: string[];
  queued: number;
}

/** Live fleet-wide relay metrics for the admin dashboard — read from the gateway's
 * in-memory registry (queues, recent dispatches), which the web app can't see. */
export interface RelayMetrics {
  totals: { connected: number; queued: number; reqLastMin: number };
  owners: { ownerId: string; since: string | null; queued: number; domains: string[]; reqLastMin: number }[];
  perDomain: { domain: string; reqLastMin: number }[];
  /** Which POD is driving relay load, and to which domains — live only (the persisted
   * traffic stays domain-only; this ephemeral per-pod view is operator-visibility). */
  perPod: { podId: string; reqLastMin: number; domains: string[] }[];
  policy: { queueMax: number; queueMaxPerPod: number; ratePerDomain: number; rateWindowMs: number };
}

const CODE_TTL_MS = 10 * 60_000;
const QUEUE_MAX = 50;
/** Per-pod share of the queue, so one pod cannot fill it and starve its siblings. */
const QUEUE_MAX_PER_POD = 20;
/** Human pace, per domain. A relay borrows someone's identity and address; it must
 * not be able to hammer a site through them. */
const RATE_PER_DOMAIN = 10;
const RATE_WINDOW_MS = 60_000;

export class RelayRegistry {
  private readonly links = new Map<string, { link: RelayLink; since: number }>();
  private readonly codes = new Map<string, { ownerId: string; expiresAt: number }>();
  private readonly queues = new Map<string, RelayFetchRequest[]>();
  /** Recent dispatches per owner+domain, each remembering WHICH pod spent it — so a
   * refusal can name the sibling that used the budget instead of reading as a bug. */
  private readonly hits = new Map<string, { at: number; podId: string }[]>();
  /** Awaiters, bound to the owner+pod that asked, so one owner's relay cannot answer
   * another's request and a result routes only to the pod that made it. */
  private readonly waiting = new Map<
    string,
    { ownerId: string; podId: string; resolve: (r: RelayFetchResult) => void; expires: number }
  >();
  /** Gateway-minted request ids — never trust the pod's, which a sibling could replay. */
  private seq = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Owner-bound only. Attribution comes from gateway routing context, never pod input. */
  private relayFrame(req: RelayFetchRequest): string {
    return JSON.stringify({
      type: "fetch",
      id: req.id,
      url: req.url,
      domain: req.domain,
      source: { podId: req.podId, ...(req.podName ? { podName: req.podName } : {}) },
    });
  }

  /** Short-lived, one-time, owner-bound — the same shape as Codex device pairing, so
   * there is one pairing concept in the product rather than two. */
  mintPairingCode(ownerId: string, code: string): { code: string; expiresAt: number } {
    const expiresAt = this.now() + CODE_TTL_MS;
    this.codes.set(code, { ownerId, expiresAt });
    return { code, expiresAt };
  }

  redeem(code: string, link: RelayLink): { ownerId: string } | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    // Consumed whether or not it was still valid: a code that has been TRIED is
    // spent, so a leaked one cannot be ground against.
    this.codes.delete(code);
    if (entry.expiresAt < this.now()) return null;
    this.attach(entry.ownerId, link);
    return { ownerId: entry.ownerId };
  }

  /**
   * Register a relay link for an owner whose code was ALREADY validated elsewhere —
   * in production, against the shared database (the gateway and the web app that
   * minted the code are separate processes). The in-memory `redeem` above is retained
   * for the registry's own unit tests; both funnel here so there is one place that
   * enforces "one relay per owner".
   */
  attach(ownerId: string, link: RelayLink): void {
    // One relay per owner. A second connection replaces the first rather than
    // racing it — two machines answering the same fetch is not a feature.
    this.links.get(ownerId)?.link.close();
    this.links.set(ownerId, { link, since: this.now() });
  }

  /** Drop the relay for an owner ONLY if `link` is still the current one. The old
   * socket's async close fires after a replacement has already been set, so an
   * unconditional delete would tear down the NEW link. */
  disconnect(ownerId: string, link?: RelayLink): void {
    const cur = this.links.get(ownerId);
    if (!cur) return;
    if (link && cur.link !== link) return; // a newer relay already replaced this one
    this.links.delete(ownerId);
  }

  /** Recent dispatches in the window, pruned. */
  private recentHits(ownerId: string, domain: string): { at: number; podId: string }[] {
    const key = `${ownerId}:${domain}`;
    const cutoff = this.now() - RATE_WINDOW_MS;
    const recent = (this.hits.get(key) ?? []).filter((h) => h.at > cutoff);
    this.hits.set(key, recent);
    return recent;
  }

  private noteHit(ownerId: string, domain: string, podId: string): void {
    const key = `${ownerId}:${domain}`;
    this.hits.set(key, [...this.recentHits(ownerId, domain), { at: this.now(), podId }]);
  }

  /** The registrable host of a URL, or null if it is not a plain http(s) host. This
   * is the ONLY domain the policy trusts — the pod's own `domain` field is advisory
   * and never gates anything, or a pod could claim `reddit.com` while fetching an
   * internal address (SSRF through the owner's machine). */
  private hostOf(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      const h = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
      // No literal IPs: the relay lends access to NAMED sites the owner allowlisted,
      // not to arbitrary hosts on their LAN.
      if (/^[0-9.]+$/.test(h) || h.includes(":") || !h.includes(".")) return null;
      return h;
    } catch {
      return null;
    }
  }

  submit(ownerId: string, req: RelayFetchRequest): SubmitOutcome {
    // Authorisation lives on the OWNER's machine (clean-by-default; `relay login`
    // to use a session). The gateway keeps only the guards that do not depend on
    // trusting the pod: the host must be a public web address (no IPs / LAN — SSRF),
    // and the per-domain rate cap below.
    const domain = this.hostOf(req.url);
    if (!domain) {
      return { status: "refused", reason: `not a public web URL: ${req.url}` };
    }

    const live = this.links.get(ownerId);
    const waitMs = this.rateWaitMs(ownerId, domain);

    // Send now only if there is somewhere to send it AND the budget allows AND the
    // socket actually accepts it (a CLOSING socket silently drops — do not charge the
    // budget or claim dispatch for a request that never left).
    if (live && waitMs === 0) {
      const sent = live.link.send(this.relayFrame({ ...req, domain }));
      if (sent) {
        this.noteHit(ownerId, domain, req.podId);
        return { status: "dispatched" };
      }
      // fall through to queue: the link is going away.
    }

    const q = this.queues.get(ownerId) ?? [];
    // The only true refusals left are structural: the queue is full, globally or for
    // this pod. Everything else is "later".
    if (q.length >= QUEUE_MAX) {
      return { status: "refused", reason: "relay queue is full" };
    }
    if (q.filter((r) => r.podId === req.podId).length >= QUEUE_MAX_PER_POD) {
      return {
        status: "refused",
        reason: `this pod already has ${QUEUE_MAX_PER_POD} requests waiting on the relay`,
      };
    }
    q.push(req);
    this.queues.set(ownerId, q);

    let reason: string | undefined;
    if (!live) {
      reason = "the relay is not connected — this will run when the owner's machine is available";
    } else {
      // Name the sibling that spent the budget. "Rate limited" alone reads as a bug
      // when another of the owner's pods quietly used it.
      const others = [...new Set(this.recentHits(ownerId, domain).map((h) => h.podId))].filter(
        (p) => p !== req.podId,
      );
      const blame = others.length
        ? ` (mostly from your other pod${others.length > 1 ? "s" : ""}: ${others.join(", ")})`
        : "";
      reason = `pacing ${domain}${blame}; the relay shares one budget per domain across your pods`;
    }
    return { status: "queued", position: q.length, readyInMs: live ? waitMs : 0, reason };
  }

  /**
   * How long until this domain's budget allows another request. 0 means now.
   *
   * The cap is a PACE, not a gate: once the oldest request in the window ages out, a
   * slot frees. Reporting the wait lets a caller decide whether to keep holding.
   */
  private rateWaitMs(ownerId: string, domain: string): number {
    const recent = this.recentHits(ownerId, domain);
    if (recent.length < RATE_PER_DOMAIN) return 0;
    const oldest = Math.min(...recent.map((h) => h.at));
    return Math.max(0, oldest + RATE_WINDOW_MS - this.now());
  }

  /**
   * Send whatever the queue is now allowed to send.
   *
   * One drain for both reasons a request waits — the relay was offline, or the
   * domain's budget was spent. Called when a relay connects and on a timer, so a
   * paced request goes out the moment its slot frees rather than needing the caller
   * to retry.
   *
   * ROUND-ROBIN across pods, not strict FIFO: with one queue per owner, a pod that
   * queued fifty requests would otherwise be served completely before a sibling's
   * first. Interleaving keeps each pod's own order intact while giving them turns.
   */
  pump(ownerId: string): number {
    const live = this.links.get(ownerId);
    const q = this.queues.get(ownerId) ?? [];
    if (!live || q.length === 0) return 0;

    const byPod = new Map<string, RelayFetchRequest[]>();
    for (const req of q) {
      const list = byPod.get(req.podId) ?? [];
      list.push(req);
      byPod.set(req.podId, list);
    }
    const lanes = [...byPod.values()];
    const sentIds = new Set<string>();
    let sent = 0;

    // Walk the lanes in turn, stopping at whatever the pace allows. A domain whose
    // budget is spent simply keeps its requests queued for the next pump.
    for (let i = 0; lanes.some((l) => l.length > i); i++) {
      for (const lane of lanes) {
        const req = lane[i];
        if (!req) continue;
        if (this.rateWaitMs(ownerId, req.domain) > 0) continue;
        const ok = live.link.send(this.relayFrame(req));
        if (!ok) continue; // socket going away — leave it queued for the next pump
        this.noteHit(ownerId, req.domain, req.podId);
        sentIds.add(req.id);
        sent++;
      }
    }
    this.queues.set(
      ownerId,
      q.filter((r) => !sentIds.has(r.id)),
    );
    return sent;
  }

  /** The owner's live relay socket, or null when no relay is connected. Used by the
   * tunnel router to push stream frames at the owner's machine. */
  linkFor(ownerId: string): RelayLink | null {
    return this.links.get(ownerId)?.link ?? null;
  }

  /** A gateway-authoritative request id. The pod's own id is never trusted for
   * routing — a sibling pod could replay it to steal a result. */
  mintId(): string {
    return `rq-${++this.seq}`;
  }

  /**
   * Periodic hygiene: drop expired pairing codes and expired awaiters, and reject the
   * caller waiting on a dead request rather than leaving it to hang. Called on a timer.
   */
  sweep(): void {
    const now = this.now();
    for (const [code, e] of this.codes) if (e.expiresAt < now) this.codes.delete(code);
    for (const [id, e] of this.waiting) {
      if (e.expires < now) {
        this.waiting.delete(id);
        e.resolve({ id, status: 0, body: "", error: "relay timed out" });
      }
    }
  }

  /** Owners with anything still waiting, so a caller knows who to pump. */
  pendingOwners(): string[] {
    return [...this.queues.entries()].filter(([, q]) => q.length > 0).map(([id]) => id);
  }

  /**
   * Register interest in a result. Bound to owner+pod so only THAT owner's relay can
   * complete it, and expired after ttlMs so a relay that dies mid-fetch cannot leak the
   * resolver (or hang whatever awaits it) forever.
   */
  await(
    ownerId: string,
    podId: string,
    id: string,
    resolve: (r: RelayFetchResult) => void,
    ttlMs = 90_000,
  ): void {
    this.waiting.set(id, { ownerId, podId, resolve, expires: this.now() + ttlMs });
  }

  /** A relay reports a result. `byOwner` is the owner whose relay sent it — a result
   * may only complete a request that owner's relay was actually given. */
  complete(byOwner: string, result: RelayFetchResult): boolean {
    const entry = this.waiting.get(result.id);
    if (!entry || entry.ownerId !== byOwner) return false;
    this.waiting.delete(result.id);
    entry.resolve(result);
    return true;
  }

  /** Which pod a pending request belongs to, so the gateway routes the result down to
   * the right one. */
  podFor(id: string): string | null {
    return this.waiting.get(id)?.podId ?? null;
  }

  state(ownerId: string): RelayState {
    const live = this.links.get(ownerId);
    const queue = this.queues.get(ownerId) ?? [];
    // With the allowlist gone, `domains` no longer means "what is permitted" — it means
    // "what is waiting". An agent can use it to say which sources are pending on the
    // relay before it even tries them. Derived from the URL's real host, never the
    // pod's advisory `domain` field.
    const domains = [...new Set(queue.map((r) => this.hostOf(r.url)).filter((d): d is string => Boolean(d)))];
    return {
      connected: Boolean(live),
      since: live ? new Date(live.since).toISOString() : null,
      domains,
      queued: queue.length,
    };
  }

  /** Fleet-wide live metrics for the admin dashboard. `reqLastMin` is dispatches in
   * the rate window (60s) — the closest to "requests/sec" we have without a histogram.
   * Reads only in-memory state; safe + cheap to call per admin page load. */
  metrics(): RelayMetrics {
    const perDomain = new Map<string, number>();
    const reqByOwner = new Map<string, number>();
    const perPod = new Map<string, { reqLastMin: number; domains: Set<string> }>();
    for (const key of this.hits.keys()) {
      const sep = key.indexOf(":");
      const ownerId = key.slice(0, sep);
      const domain = key.slice(sep + 1);
      const recent = this.recentHits(ownerId, domain); // also prunes stale hits
      if (recent.length === 0) continue;
      perDomain.set(domain, (perDomain.get(domain) ?? 0) + recent.length);
      reqByOwner.set(ownerId, (reqByOwner.get(ownerId) ?? 0) + recent.length);
      for (const h of recent) {
        let pp = perPod.get(h.podId);
        if (!pp) {
          pp = { reqLastMin: 0, domains: new Set() };
          perPod.set(h.podId, pp);
        }
        pp.reqLastMin += 1;
        pp.domains.add(domain);
      }
    }
    const owners = [...this.links.keys()].map((ownerId) => {
      const st = this.state(ownerId);
      return { ownerId, since: st.since, queued: st.queued, domains: st.domains, reqLastMin: reqByOwner.get(ownerId) ?? 0 };
    });
    return {
      totals: {
        connected: this.links.size,
        queued: owners.reduce((n, o) => n + o.queued, 0),
        reqLastMin: [...perDomain.values()].reduce((n, v) => n + v, 0),
      },
      owners: owners.sort((a, b) => b.reqLastMin - a.reqLastMin),
      perDomain: [...perDomain.entries()]
        .map(([domain, reqLastMin]) => ({ domain, reqLastMin }))
        .sort((a, b) => b.reqLastMin - a.reqLastMin),
      perPod: [...perPod.entries()]
        .map(([podId, v]) => ({ podId, reqLastMin: v.reqLastMin, domains: [...v.domains] }))
        .sort((a, b) => b.reqLastMin - a.reqLastMin),
      policy: {
        queueMax: QUEUE_MAX,
        queueMaxPerPod: QUEUE_MAX_PER_POD,
        ratePerDomain: RATE_PER_DOMAIN,
        rateWindowMs: RATE_WINDOW_MS,
      },
    };
  }
}
