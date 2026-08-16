/**
 * The relay's protocol brain: what to do with each fetch the gateway sends.
 *
 * The design (decided 2026-07-31): once the owner starts the relay, the pod may fetch
 * the public web through it freely — no per-request approval, because nobody watches a
 * terminal to click "allow". Oversight is after the fact: every fetch is audited, and
 * the owner monitors via `relay dashboard` and the admin dashboard.
 *
 * Two guards remain, and both protect the OWNER, not us:
 *  1. The relay refuses a URL that is not a plain web address or resolves to a bare IP
 *     or private host. A prompt-injected pod must not be able to make the owner's
 *     machine hit their own LAN (192.168.x, 10.x, localhost) — an SSRF the owner cannot
 *     see to consent to.
 *  2. WHICH sessions are used is decided by the fetcher: a domain the owner explicitly
 *     signed into (`relay login`) is fetched AS them; every other domain is fetched
 *     from a CLEAN context with no cookies. So "fetch as me" is opt-in per site, and a
 *     compromised pod cannot read accounts the owner never lent it.
 *
 * Pure over injected effects (fetcher, audit) so the decisions test without a browser.
 */

import {
  fetchOutcome,
  safeFetchTarget,
  type RelayEventV2,
  type RelaySource,
} from "./audit.js";
import type { RelayRuntime } from "./runtime.js";

export interface RelaySocket {
  send(json: string): void;
}

export interface FetchJob {
  id: string;
  url: string;
  source?: RelaySource;
}

export interface FetchOutput {
  status: number;
  body: string;
  finalUrl?: string;
  error?: string;
  /** Whether the fetch used the owner's signed-in session (a login domain) or a clean
   * context. Recorded in the audit so the owner can see it. */
  session?: boolean;
}

export type Fetcher = (job: FetchJob) => Promise<FetchOutput>;
export type AuditFn = (entry: RelayEventV2) => void;

/** Host of a URL, or null if it is not a public web host the relay may fetch. */
export function publicHostOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!h.includes(".") || h.includes(":")) return null;
  // No bare IPs, and no private / loopback ranges — this is the SSRF guard.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    if (/^(10|127)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h === "0.0.0.0") {
      return null;
    }
    return null; // a bare public IP is still refused — the relay lends NAMED sites
  }
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return null;
  return h;
}

interface Opts {
  maxConcurrent?: number;
  queueMax?: number;
  audit?: AuditFn;
  runtime?: RelayRuntime;
  /** Return a refusal reason before any browser work, or undefined to allow. */
  deny?: (source: RelaySource | undefined, host: string) => string | undefined;
  now?: () => number;
}

export class RelayClient {
  private active = 0;
  private readonly queue: FetchJob[] = [];

  constructor(
    private readonly socket: RelaySocket,
    private readonly fetcher: Fetcher,
    private readonly opts: Opts = {},
  ) {}

  private reply(id: string, out: FetchOutput): void {
    this.socket.send(JSON.stringify({ type: "fetch-result", id, ...out }));
  }

  async onMessage(raw: string): Promise<void> {
    let msg: { type?: string; id?: string; url?: string; source?: RelaySource };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "fetch" || !msg.id || !msg.url) return;

    const safe = safeFetchTarget(msg.url);
    const host = publicHostOf(msg.url);
    if (!safe || !host) {
      // The one thing we refuse rather than serve: a non-public / private target.
      const auditSafe = safe ?? safeFetchTarget("https://invalid.invalid/")!;
      this.audit({ id: msg.id, url: auditSafe.target, source: msg.source }, auditSafe, "safety-blocked", 0, false, "refused: not a public web URL");
      this.reply(msg.id, { status: 0, body: "", error: "the relay only fetches public web addresses" });
      return;
    }

    const denial = this.opts.deny?.(msg.source, host);
    if (denial) {
      this.audit({ id: msg.id, url: safe.target, source: msg.source }, safe, "owner-blocked", 0, false, denial);
      this.reply(msg.id, { status: 0, body: "", error: denial });
      return;
    }

    if (this.active >= (this.opts.maxConcurrent ?? 3)) {
      if (this.queue.length >= (this.opts.queueMax ?? 200)) {
        this.reply(msg.id, { status: 0, body: "", error: "relay busy — queue full" });
        return;
      }
      this.queue.push({ id: msg.id, url: msg.url, source: msg.source });
      return;
    }
    void this.run({ id: msg.id, url: msg.url, source: msg.source }, host, safe);
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }

  private audit(
    job: FetchJob,
    safe: { target: string; host: string },
    outcome: RelayEventV2["outcome"],
    started: number,
    session: boolean,
    reason?: string,
    status?: number,
    finalTarget?: string,
  ): void {
    const finished = this.now();
    this.opts.audit?.({
      v: 2,
      id: `fetch-${job.id}`,
      startedAt: new Date(started || finished).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: started ? Math.max(0, finished - started) : 0,
      source: job.source,
      mode: "fetch",
      outcome,
      target: safe.target,
      ...(finalTarget ? { finalTarget } : {}),
      host: safe.host,
      ...(status !== undefined ? { httpStatus: status } : {}),
      session,
      ...(reason ? { reason } : {}),
    });
  }

  private async run(job: FetchJob, host: string, safe = safeFetchTarget(job.url)!): Promise<void> {
    const denial = this.opts.deny?.(job.source, host);
    if (denial) {
      this.audit(job, safe, "owner-blocked", 0, false, denial);
      this.reply(job.id, { status: 0, body: "", error: denial });
      return;
    }
    this.active++;
    const started = this.now();
    this.opts.runtime?.begin({ id: job.id, source: job.source, mode: "fetch", target: safe.target, startedAt: new Date(started).toISOString() });
    try {
      const out = await this.fetcher(job);
      // A redirect that landed on a private target is the same SSRF, after the fact.
      if (out.finalUrl && !publicHostOf(out.finalUrl)) {
        this.reply(job.id, { status: 0, body: "", error: "redirected to a non-public address" });
        this.audit(job, safe, "safety-blocked", started, !!out.session, "redirect to private");
        return;
      }
      this.reply(job.id, out);
      const final = out.finalUrl ? safeFetchTarget(out.finalUrl)?.target : undefined;
      this.audit(job, safe, fetchOutcome(out.status, out.error), started, !!out.session, out.error, out.status, final);
    } catch (e) {
      this.reply(job.id, { status: 0, body: "", error: String(e) });
      this.audit(job, safe, "network-error", started, false, String(e), 0);
    } finally {
      this.opts.runtime?.finish(job.id);
      this.active--;
      const next = this.queue.shift();
      if (next) {
        const h = publicHostOf(next.url);
        const nextSafe = safeFetchTarget(next.url);
        if (h && nextSafe) void this.run(next, h, nextSafe);
      }
    }
  }
}
