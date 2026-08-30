import http from "node:http";
import net, { type Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { PodControlHub, type PodLink } from "./pod-control-hub.js";
import { TunnelRouter } from "./relay-tunnel-router.js";
import { RelayRegistry } from "./relay-registry.js";
import { ControlError } from "@podbay/control-plane";
import { createLogger, type Logger } from "@podbay/shared/log";
import { attachHeartbeat, type HeartbeatSocket } from "@podbay/shared/heartbeat";
import { isAgentMessage, type AgentMessage } from "@podbay/shared/protocol";
import type { GatewayConfig } from "./config.js";

/** Parse a proxied agent frame, or null. Used only to observe (activity +
 * onboarding milestones) — the frame is forwarded verbatim regardless. */
function parseAgentFrame(raw: unknown): AgentMessage | null {
  try {
    const m = JSON.parse(raw?.toString() ?? "");
    return isAgentMessage(m) ? m : null;
  } catch {
    return null;
  }
}

/** The remote-control session deep link the greeter's /remote-control emits. */
const SESSION_URL_RE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;
// The Claude OAuth sign-in link (mirrors the cockpit's isAuthUrl). A session URL
// has no oauth/login segment, so the two never collide.
const AUTH_URL_RE = /https:\/\/(claude\.(com|ai)|[a-z.]*anthropic\.com)\/[^\s]*(oauth|login)/i;
/**
 * Where a tunnel health canary dials: podbay's own front door, never a third party.
 * `PODBAY_TUNNEL_CANARY_TARGET` overrides (`host` or `host:port`); otherwise the app
 * origin's host. Returns undefined when neither is known — a canary then reports
 * "unknown" rather than picking some site on the owner's behalf.
 */
function canaryTarget(appOrigin?: string): { host: string; port: number } | undefined {
  const raw = process.env.PODBAY_TUNNEL_CANARY_TARGET?.trim();
  if (raw) {
    const [host, port] = raw.split(":");
    if (host) return { host, port: Number(port) || 443 };
  }
  try {
    if (appOrigin) return { host: new URL(appOrigin).hostname, port: 443 };
  } catch {
    /* not a URL — fall through */
  }
  return undefined;
}

// Strip ANSI escape sequences so the Codex device-code scan reads plain text.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** A relay row disconnected longer than this is reaped — long enough that the cockpit's flap history
 * stays useful for a while after a drop, short enough that ancient dead rows don't accumulate. */
const RELAY_STALE_CONNECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** How often the reaper is allowed to run (it rides the frequent idle tick, but the cleanup is
 * daily-scale, so most ticks skip it). */
const RELAY_REAP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Extract the Codex one-time device sign-in code from a buffer of terminal output,
 * or null. Gated on the unambiguous `codex/device` marker so it only matches during a
 * Codex device login (never a stray XXXX-XXXXX token). Caller strips ANSI first.
 * Exported for unit tests (the gateway's WS tests can't run without a PTY). */
export function extractCodexDeviceCode(cleanBuf: string): string | null {
  if (!cleanBuf.includes("codex/device")) return null;
  const m = cleanBuf.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/);
  return m ? m[0] : null;
}

/**
 * The authenticated terminal front door. Verifies the Podbay session, checks pod
 * ownership, wakes the pod, and proxies the WebSocket to the pod's (unauthenticated,
 * private-network) pod-agent. Also runs the control-plane idle policy on a timer.
 */
export class GatewayServer {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly controlHub: PodControlHub | null;
  private readonly relays: RelayRegistry | null;
  /** Egress-tunnel routing (streams pod↔owner's relay) — exists whenever relays do. */
  private readonly tunnels: TunnelRouter | null;
  private controlTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private relayTimer?: ReturnType<typeof setInterval>;
  private reconcileCursor = 0;
  /** Last time we reaped long-dead relay rows (throttle — the idle tick fires far more often than a
   * daily-scale cleanup needs). 0 ⇒ reap on the first tick after boot. */
  private lastRelayReapAt = 0;
  private readonly opts: Required<
    Pick<
      GatewayConfig,
      | "host"
      | "port"
      | "idleThresholdMs"
      | "tickMs"
      | "reconcilePerSweep"
      | "provisionIntervalMs"
      | "wakeTimeoutMs"
      | "maintenanceDormantMs"
      | "maintenanceMaxPerSweep"
      | "maintenanceRefreshIdleMs"
    >
  >;
  private idleTimer?: NodeJS.Timeout;
  private provisionTimer?: NodeJS.Timeout;
  private readonly appOrigin?: string;
  private readonly log: Logger;

  constructor(private readonly config: GatewayConfig) {
    this.log = config.logger ?? createLogger("gateway");
    this.opts = {
      host: config.host ?? "::",
      port: config.port ?? 8090,
      idleThresholdMs: config.idleThresholdMs ?? 15 * 60 * 1000,
      tickMs: config.tickMs ?? 60 * 1000,
      // 10/min covers a 100-pod fleet in ten minutes without a herd.
      reconcilePerSweep: config.reconcilePerSweep ?? 10,
      // Off here by default: the provisioner runs in the WEB process (Next
      // instrumentation), which owns launchPod + all pod controls, so its
      // provider is the lifecycle authority. Opt-in if a gateway should run it.
      provisionIntervalMs: config.provisionIntervalMs ?? 0,
      // First boot streams the rootfs lazily + runs init (~40-60s before the agent
      // listens) — the window must outlast it or the client sees a flap cycle.
      wakeTimeoutMs: config.wakeTimeoutMs ?? 75 * 1000,
      // Maintenance wake OFF by default (0) — it spends compute, so it's opt-in
      // (PODBAY_MAINTENANCE_DORMANT_DAYS). See docs/strategy/compute-strategy.md.
      maintenanceDormantMs: config.maintenanceDormantMs ?? 0,
      maintenanceMaxPerSweep: config.maintenanceMaxPerSweep ?? 5,
      // Running-idle token refresh ON by default (7d) — this is the afisha-class fix, not opt-in.
      // The fleet never idle-sleeps, so a running-but-idle agent's login is renewed by nothing else.
      maintenanceRefreshIdleMs: config.maintenanceRefreshIdleMs ?? 7 * 24 * 60 * 60 * 1000,
    };
    this.appOrigin = config.appOrigin?.replace(/\/$/, "");
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

    // Control sockets to pods (fetch memory now, relay later). Only when a fetch
    // memory sink is provided — without it the gateway runs exactly as before, so
    // this is additive and cannot break the terminal/preview paths.
    this.relays = this.config.relays ?? null;
    // Tunnel routing rides the same relay: the pod's SOCKS proxy opens streams, this
    // routes them to the owner's relay and enforces the platform-side guards.
    this.tunnels = this.relays
      ? new TunnelRouter({
          ownerOf: (podId) => this.config.control.ownerOf(podId).catch(() => null),
          podName: (podId) => this.config.control.nameOf?.(podId)?.catch(() => null) ?? Promise.resolve(null),
          relayLink: (ownerId) => this.relays!.linkFor(ownerId),
          toPod: (podId, msg) => this.controlHub?.sendTunnel(podId, msg) ?? false,
          log: (event, detail) => this.log.info(event, detail ?? {}),
          canaryTarget: canaryTarget(this.appOrigin),
        })
      : null;
    // The hub carries fetch memory AND relay traffic, so it exists if EITHER is
    // configured — relay routing must not depend on fetch memory being on.
    this.controlHub = (this.config.fetchMemory || this.relays)
      ? new PodControlHub({
          connect: (podId) => this.openControlLink(podId),
          memory: this.config.fetchMemory,
          onRelayFetch: this.relays ? (podId, req) => void this.routeRelayFetch(podId, req) : undefined,
          onTunnelOpen: this.relays
            ? (podId, streamId, host, port) => void this.tunnels?.open(podId, streamId, host, port)
            : undefined,
          onTunnelFromPod: this.relays
            ? (podId, streamId, frame) => void this.tunnels?.fromPod(podId, streamId, frame)
            : undefined,
          onPodGone: this.relays ? (podId) => this.tunnels?.dropPod(podId) : undefined,
          relayStateFor: this.relays
            ? async (podId) => {
                const ownerId = await this.config.control.ownerOf(podId).catch(() => null);
                if (!ownerId) return null;
                const st = this.relays!.state(ownerId);
                return { connected: st.connected, domains: st.domains };
              }
            : undefined,
          onRelayPairRequest:
            this.relays && this.config.relayAuthority
              ? (podId, req) => void this.routeRelayPairRequest(podId, req)
              : undefined,
          log: (event, detail) => this.log.info(event, detail ?? {}),
        })
      : null;
    this.http = http.createServer((req, res) => {
      const slug = this.previewSlug(req);
      if (slug) return void this.handlePreviewHttp(slug, req, res);
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: true }));
        return;
      }
      // Live relay metrics for the admin dashboard — the queue/rate state lives only
      // in this process's RelayRegistry, so the web app fetches it here (bearer
      // ADMIN_API_TOKEN, same pattern as the web's /api/admin/images).
      if (req.url === "/admin/relay-state") {
        const token = process.env.ADMIN_API_TOKEN;
        if (!token) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "ADMIN_API_TOKEN not configured" }));
          return;
        }
        if ((req.headers.authorization ?? "") !== `Bearer ${token}`) {
          res.writeHead(401);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        // Fetch metrics + the TUNNEL's live usage (connections/bytes per domain). The
        // router already meters it; without this it was collected and never shown.
        res.end(
          JSON.stringify(
            this.relays
              ? {
                  ...this.relays.metrics(),
                  tunnel: this.tunnels?.usageSnapshot() ?? { open: 0, domains: [], owners: [], pods: [] },
                }
              : null,
          ),
        );
        return;
      }
      // Tunnel health for ONE owner — the cockpit's "is my tunnel actually working?"
      // signal. Same bearer as above (server-to-server); the web action scopes it to the
      // signed-in user's own id, so an owner can never probe someone else's relay.
      // POST runs a fresh canary; GET returns the last known result without spending a
      // connection on the owner's machine.
      const health = req.url?.startsWith("/relay-tunnel-health") ? new URL(req.url, "http://gw") : null;
      if (health) {
        const token = process.env.ADMIN_API_TOKEN;
        if (!token || (req.headers.authorization ?? "") !== `Bearer ${token}`) {
          res.writeHead(token ? 401 : 503);
          res.end();
          return;
        }
        const ownerId = health.searchParams.get("owner");
        if (!ownerId || !this.tunnels) {
          res.writeHead(ownerId ? 503 : 400);
          res.end();
          return;
        }
        const tunnels = this.tunnels;
        void (req.method === "POST" ? tunnels.canary(ownerId) : Promise.resolve(tunnels.healthOf(ownerId)))
          .then((h) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ health: h, usage: tunnels.ownerUsage(ownerId) }));
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.http.on("upgrade", (req, socket, head) => void this.onUpgrade(req, socket as Socket, head));
  }

  private async onUpgrade(req: http.IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const rejectLogged = (code: number, msg: string, ctx: Record<string, unknown> = {}) => {
      this.log.warn("ws_rejected", { reason: msg, status: code, ...ctx });
      reject(socket, code, msg);
    };
    try {
      // Preview host (e.g. Next.js HMR WebSocket) → raw tunnel to the app port.
      const previewSlug = this.previewSlug(req);
      if (previewSlug) return await this.handlePreviewUpgrade(previewSlug, req, socket, head);

      // The owner's relay, connecting OUTBOUND from their machine. No inbound port,
      // no tunnel, no third party — which is the whole reason it is shaped this way.
      if ((req.url ?? "").startsWith("/relay")) {
        return this.handleRelayUpgrade(req, socket, head, rejectLogged);
      }

      const podId = parsePodId(req.url ?? "");
      if (!podId) return rejectLogged(400, "missing pod id", { url: req.url });

      const userId = await this.config.authenticate(req);
      if (!userId) return rejectLogged(401, "unauthenticated", { podId });

      // Ownership: getPod is owner-scoped and throws not_found on miss/cross-owner.
      try {
        const pod = await this.config.control.getPod(userId, podId);
        // Explicit suspend/resume: a suspended pod stays down until the OWNER
        // clicks Resume — we never auto-wake on connect (that was the old auto-
        // sleep model). The client renders a "Suspended — Resume to use" state.
        if (pod.status === "suspended") {
          return rejectLogged(409, "pod is suspended — resume it to connect", {
            podId,
            userId,
            status: pod.status,
          });
        }
        if (pod.status !== "running") {
          // "waking" (a Resume the owner already triggered) or "provisioning" — a
          // start is already in flight, so WAIT for it; we don't initiate a wake.
          const running = await this.waitRunning(userId, podId);
          if (!running) return rejectLogged(504, "pod did not start", { podId, userId });
        }
      } catch (e) {
        if (e instanceof ControlError && e.code === "not_found") {
          return rejectLogged(404, "not found", { podId, userId });
        }
        return rejectLogged(500, "control error", { podId, userId, err: e });
      }

      const agentUrl = await this.config.resolveAgentUrl(podId);
      // The machine reports "started" before the pod-agent is listening —
      // retry the upstream connect instead of bouncing the client with 502s.
      const upstream = await this.connectUpstream(agentUrl, this.opts.wakeTimeoutMs);
      if (!upstream) return rejectLogged(502, "pod-agent unreachable", { podId, userId });
      this.log.info("ws_accepted", { podId, userId });
      this.wss.handleUpgrade(req, socket, head, (client) => this.pipe(client, upstream, userId, podId));
    } catch (e) {
      this.log.error("ws_upgrade_error", { err: e });
      reject(socket, 500, "gateway error");
    }
  }

  /** Dial the pod-agent, retrying while it boots; null after the deadline. */
  /**
   * Accept a relay connection from an owner's machine.
   *
   * Authenticated by a one-time pairing code in the URL, not by a session cookie: the
   * relay is a CLI on someone's laptop, not a browser. The code is minted in the
   * dashboard, is single-use, and is spent even if expired — so a leaked one cannot be
   * ground against.
   */
  private handleRelayUpgrade(
    req: http.IncomingMessage,
    socket: Socket,
    head: Buffer,
    rejectLogged: (code: number, msg: string, ctx?: Record<string, unknown>) => void,
  ): void {
    if (!this.relays) return rejectLogged(404, "relay not enabled");
    const auth = this.config.relayAuthority;
    if (!auth) return rejectLogged(404, "relay auth not configured");
    const params = new URL(req.url ?? "/", "http://x").searchParams;
    const code = params.get("code") ?? "";
    const token = params.get("token") ?? "";
    // A relay presents a one-time `code` on first pairing, or a reusable `token` on
    // every reconnect after. One of the two is required.
    if (!code && !token) return rejectLogged(400, "missing pairing code or token");

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const link = {
        send: (payload: string): boolean => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(payload);
          return true;
        },
        close: () => ws.close(),
      };

      // ownerId is not known until the async redeem resolves, but the relay sends its
      // first frame (relay-online, carrying its login domains) the instant the socket
      // opens. `ws` drops a 'message' with no listener, so attach one NOW and buffer
      // until we are ready — the same pre-listener race that bit the control socket.
      let ownerId: string | null = null;
      const pending: string[] = [];
      const onFrame = (raw: string): void => {
        try {
          const msg = JSON.parse(raw) as {
            type?: string; id?: string; status?: number; body?: string; error?: string;
            loginDomains?: unknown;
          };
          if (msg.type === "relay-online") {
            const domains = Array.isArray(msg.loginDomains)
              ? msg.loginDomains.filter((d): d is string => typeof d === "string")
              : [];
            void auth.markConnected(ownerId!, domains).catch(() => undefined);
            this.broadcastRelayState(ownerId!, true, domains);
            return;
          }
          if (msg.type?.startsWith("tunnel-")) {
            // Frames from the owner's relay for a tunnelled stream. The router accepts
            // them only for a stream IT gave this owner, so a relay cannot address
            // another owner's stream.
            this.tunnels?.fromRelay(ownerId!, msg as { type: string; id?: string; b64?: string; reason?: string });
            return;
          }
          if (msg.type === "fetch-result" && msg.id) {
            // complete() fires the resolver registered at submit, which routes the
            // result down to the pod under the pod's own id. Accepted only from the
            // owner whose relay was given it.
            const done = this.relays!.complete(ownerId!, {
              id: msg.id, status: msg.status ?? 0, body: msg.body ?? "", error: msg.error,
            });
            if (!done) this.log.info("relay_result_unmatched", { ownerId, id: msg.id });
          }
        } catch {
          this.log.info("relay_bad_frame", { ownerId });
        }
      };
      ws.on("message", (raw) => {
        const s = String(raw);
        if (ownerId) onFrame(s);
        else pending.push(s);
      });

      void (async () => {
        // A reusable token (reconnect) is tried first; a one-time code (first pairing)
        // otherwise. Only a code-pairing issues a fresh reconnect token to hand back.
        let owner: string | null;
        let issuedToken: string | null = null;
        try {
          if (token) {
            owner = await auth.validateReconnectToken(token);
          } else {
            owner = await auth.redeemPairingCode(code);
            if (owner) issuedToken = await auth.issueReconnectToken(owner).catch(() => null);
          }
        } catch (e) {
          this.log.warn("relay_redeem_error", { err: String(e) });
          ws.close(1011, "relay auth error");
          return;
        }
        if (!owner) {
          // 4401 (not an HTTP reject): the client watches for this specific code and
          // STOPS, rather than reconnecting forever against a spent credential.
          this.log.warn("relay_pairing_rejected", { via: token ? "token" : "code" });
          ws.close(4401, "invalid or expired pairing credential");
          return;
        }
        ownerId = owner;
        this.relays!.attach(ownerId, link);
        this.log.info("relay_connected", { ownerId, via: token ? "token" : "code" });
        // Hello FIRST. Flushing before it would hand the relay work before it knew it
        // was paired — the client cannot tell a queued fetch from a handshake reply. The
        // reconnect token rides the hello so the relay can persist it and survive blips.
        ws.send(JSON.stringify({ type: "relay-hello", ownerId, ...(issuedToken ? { token: issuedToken } : {}) }));

        // Record the connection and heartbeat it, so the admin view and a pod's
        // relay-state can read "connected" from the DB, not the gateway's memory.
        await auth.markConnected(ownerId, []).catch(() => undefined);
        this.broadcastRelayState(ownerId, true, []);
        // Prove the tunnel actually carries traffic, once, now — so the cockpit can say
        // "working" instead of only "connected". Fire-and-forget: a failed probe is a
        // dashboard signal, never a reason to refuse the relay.
        void this.tunnels?.canary(ownerId).catch(() => undefined);
        // Liveness heartbeat ON THE RELAY SOCKET. The gateway previously had NONE — it kept a
        // blind 30s timer bumping the DB "last seen" whether or not the socket was alive, so a
        // HALF-OPEN link (Mac sleep/wake, a residential blip; no FIN/RST) read as "connected"
        // indefinitely. Pods then sent into a dead pipe and timed out for minutes with ZERO errors
        // surfaced (root cause, 2026-08-18). Now: ping/pong DETECTS the half-open; `onAlive` drives
        // the DB freshness from REAL pongs (not a timer that lies); `onDead` records the outage; and
        // terminate() → the `close` handler below runs the existing cleanup + reconnect. A slightly
        // tolerant window (15s/10s) avoids false-positive flapping on a jittery home uplink.
        let lastBeat = 0;
        // Diagnostic (2026-08-18): WHY does a relay flap? `gatewayKilled` = our own heartbeat found
        // the link half-open and terminate()d it; combined with the WS close CODE it tells us the
        // cause WITHOUT the owner's Mac logs: gatewayKilled → the pods-timing-out half-open case;
        // code 1006 + !gatewayKilled → the MAC killed it abruptly (its own aggressive heartbeat, or a
        // network death); code 1001 → clean going-away (sleep/quit); `sinceMs` = link uptime.
        let gatewayKilled = false;
        const openedAt = Date.now();
        const stopHb = attachHeartbeat(ws as unknown as HeartbeatSocket, {
          pingIntervalMs: 15_000,
          pongTimeoutMs: 10_000,
          onAlive: () => {
            const t = Date.now();
            if (t - lastBeat < 20_000) return; // real traffic fires this often — don't spam the DB
            lastBeat = t;
            void auth.heartbeat(ownerId!).catch(() => undefined);
          },
          onDead: () => {
            gatewayKilled = true;
            this.log.warn("relay_half_open", { ownerId });
          },
        });

        ws.on("close", (code?: number, reason?: unknown) => {
          stopHb();
          this.relays!.disconnect(ownerId!, link);
          // Every tunnelled stream of this owner's is now unreachable — close them at
          // the pod rather than leaving apps hanging on a relay that is gone.
          this.tunnels?.dropOwner(ownerId!);
          // markDisconnected records the drop (owner-visible outage history) as well as clearing
          // the connected state.
          void auth.markDisconnected(ownerId!).catch(() => undefined);
          this.broadcastRelayState(ownerId!, false, []);
          this.log.info("relay_disconnected", {
            ownerId,
            code,
            reason: String(reason ?? "").slice(0, 80) || undefined,
            gatewayKilled,
            sinceMs: Date.now() - openedAt,
          });
        });
        ws.on("error", () => {
          stopHb();
          this.relays!.disconnect(ownerId!, link);
          this.tunnels?.dropOwner(ownerId!);
        });

        // Drain frames that arrived during the redeem, then flush anything queued while
        // the owner's machine was asleep — after the handshake, so it arrives as work.
        for (const s of pending.splice(0)) onFrame(s);
        const flushed = this.relays!.pump(ownerId);
        if (flushed > 0) this.log.info("relay_queue_flushed", { ownerId, count: flushed });
      })();
    });
  }

  /**
   * Tell an owner's currently-connected pods whether their relay is available, so an
   * agent can report a source as reachable-via-relay before it tries — or fall back to
   * asking the owner to bring one up. Best-effort: it walks the connected pods and
   * matches by owner, which is cheap because the connected set is small.
   */
  private broadcastRelayState(ownerId: string, connected: boolean, domains: string[]): void {
    if (!this.controlHub) return;
    for (const podId of this.controlHub.connectedPods()) {
      void this.config.control
        .ownerOf(podId)
        .then((owner) => {
          if (owner === ownerId) this.controlHub!.sendRelayState(podId, connected, domains);
        })
        .catch(() => undefined);
    }
  }

  /**
   * A pod asked its owner's relay to fetch a URL. Resolve the owner, mint a
   * gateway-authoritative id (never trust the pod's for routing), submit to the relay,
   * and when the result comes back route it DOWN to the pod under the pod's OWN id so
   * its waiter matches.
   */
  private async routeRelayFetch(podId: string, req: { id: string; url: string; domain: string }): Promise<void> {
    if (!this.relays || !this.controlHub) return;
    const ownerId = await this.config.control.ownerOf(podId).catch(() => null);
    if (!ownerId) {
      this.controlHub.sendRelayResult(podId, { id: req.id, status: 0, body: "", error: "no owner for pod" });
      return;
    }
    // Gateway-authoritative display name for the owner's dashboard (falls back to podId
    // on the relay when unset). Best-effort — a lookup miss never blocks the fetch.
    const podName = (await this.config.control.nameOf?.(podId)?.catch(() => null)) ?? undefined;
    const gwId = this.relays.mintId();
    // The resolver fires from the /relay handler's complete(); it sends the result to
    // the pod under the pod's original id.
    this.relays.await(ownerId, podId, gwId, (result) =>
      this.controlHub!.sendRelayResult(podId, { id: req.id, status: result.status, body: result.body, error: result.error }),
    );
    const out = this.relays.submit(ownerId, { id: gwId, podId, podName, url: req.url, domain: req.domain });
    if (out.status === "refused") {
      // Nothing will resolve the awaiter — fail it now.
      this.relays.complete(ownerId, { id: gwId, status: 0, body: "", error: out.reason });
    } else if (out.status === "queued") {
      // A relay-state hint would help the agent; the result will arrive when it drains.
    }
  }

  /**
   * A pod asked its owner to bring up a relay. Mint a pairing code for that owner and
   * hand back the one line they run on their own machine.
   *
   * Minting on the pod's behalf is safe: whoever holds the pod already acts as the
   * owner, and the code alone does nothing — it only becomes useful when the owner runs
   * `relay start` on a residential machine, which is the whole point.
   */
  private async routeRelayPairRequest(podId: string, req: { id: string }): Promise<void> {
    if (!this.controlHub || !this.config.relayAuthority || !this.config.relayConnectUrl) return;
    const ownerId = await this.config.control.ownerOf(podId).catch(() => null);
    if (!ownerId) return; // no owner → nothing to pair; the pod just gets no reply and times out
    try {
      const { code, expiresAt } = await this.config.relayAuthority.mintPairingCode(ownerId);
      const base = this.config.relayConnectUrl.replace(/\/$/, "");
      const command = `npx @podbay/relay@latest start --gateway ${base} --code ${code}`;
      this.controlHub.sendRelayPairCode(podId, { id: req.id, command, expiresAt });
    } catch (e) {
      this.log.warn("relay_pair_mint_failed", { podId, err: String(e) });
    }
  }

  /** Open a control WebSocket to a pod and adapt it to the hub's PodLink. The gateway
   * dials; the pod only answers — no credential in this path. */
  private async openControlLink(podId: string): Promise<PodLink> {
    const base = await this.config.resolveAgentUrl(podId);
    const ws = new WebSocket(`${base.replace(/\/$/, "")}/control`);

    // Attach the message sink BEFORE anything awaits, or a control-hello (or any frame)
    // the pod sends the instant the socket opens is dropped — ws does not buffer
    // messages before a listener exists.
    const buffered: string[] = [];
    let handler: ((raw: string) => void) | null = null;
    let onFirst: ((raw: string) => void) | null = null;
    ws.on("message", (d) => {
      const s = String(d);
      if (handler) handler(s);
      else if (onFirst) { const f = onFirst; onFirst = null; f(s); }
      else buffered.push(s);
    });
    ws.on("error", () => {});

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { ws.terminate(); reject(new Error("control connect timed out")); }, 10_000);
      ws.once("open", () => { clearTimeout(t); resolve(); });
      ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    // Handshake: the FIRST frame must be control-hello. Take it from the buffer if it
    // already arrived, else wait for the next one.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { ws.terminate(); reject(new Error("no control-hello (older pod-agent?)")); }, 5000);
      const handle = (raw: string) => {
        clearTimeout(t);
        try {
          const m = JSON.parse(raw) as { type?: string };
          if (m.type === "control-hello") resolve();
          else { ws.close(); reject(new Error(`not a control socket (first frame: ${m.type})`)); }
        } catch { ws.close(); reject(new Error("unparseable handshake")); }
      };
      const first = buffered.shift();
      if (first !== undefined) handle(first);
      else onFirst = handle;
    });

    return {
      send: (json) => { if (ws.readyState === WebSocket.OPEN) ws.send(json); },
      close: () => ws.close(),
      onMessage: (h) => { handler = h; for (const m of buffered.splice(0)) h(m); },
      onClose: (h) => ws.on("close", () => h()),
    };
  }


  private async connectUpstream(url: string, timeoutMs: number): Promise<WebSocket | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ws = await new Promise<WebSocket | null>((resolve) => {
        const s = new WebSocket(url);
        s.once("open", () => resolve(s));
        s.once("error", () => resolve(null));
      });
      if (ws) return ws;
      if (Date.now() >= deadline) return null;
      await sleep(500);
    }
  }

  private async waitRunning(userId: string, podId: string) {
    const deadline = Date.now() + this.opts.wakeTimeoutMs;
    while (Date.now() < deadline) {
      const pod = await this.config.control.getPod(userId, podId).catch(() => null);
      // "waking" = the machine is up but the agent isn't confirmed reachable yet
      // (status-honesty). Proceed on either — connectUpstream (terminal) and the
      // proxy (preview) are the real readiness gates and retry until the agent answers.
      if (pod?.status === "running" || pod?.status === "waking") return pod;
      await sleep(300);
    }
    return null;
  }

  private pipe(client: WebSocket, upstream: WebSocket, userId: string, podId: string): void {
    client.on("message", (d, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(d, { binary: isBinary });
    });
    // Persist onboarding milestones AT MOST ONCE per connection (the service is
    // idempotent anyway). These make the launch wizard's login/ready steps a
    // reflection of DB state — durable across refresh/close/sleep — rather than
    // ephemeral client state. Only status/URLs are written; never credentials.
    let recordedAuthed = false;
    let recordedSession = false;
    let recordedAuthUrl = false;
    let outputBuf = ""; // rolling terminal output, for the Codex device-code scan
    upstream.on("message", (d, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(d, { binary: isBinary });
      if (isBinary) return;
      const msg = parseAgentFrame(d);
      if (!msg) return;
      if (msg.type === "output") {
        // Codex device-login: unlike Claude's auth URL (a structured links frame),
        // Codex prints its one-time sign-in CODE as raw terminal output. Capture it
        // so the cockpit's Codex sign-in step can show it (refresh-safe, like the
        // Claude auth URL). Gated on the unambiguous `codex/device` marker in a
        // small rolling buffer, so it only fires during a Codex login. Stored via
        // recordAuthUrl — for a Codex pod that field carries the CODE (the URL is
        // static: auth.openai.com/codex/device).
        if (!recordedAuthUrl) {
          outputBuf = (outputBuf + stripAnsi(msg.data)).slice(-4000);
          const code = extractCodexDeviceCode(outputBuf);
          if (code) {
            recordedAuthUrl = true;
            void this.config.control.recordAuthUrl(userId, podId, code).catch((e) =>
              this.log.warn("record_codex_code_failed", { podId, userId, err: e }),
            );
          }
        }
      }
      if (msg.type === "status" && msg.cred?.authed && !recordedAuthed) {
        recordedAuthed = true;
        void this.config.control.recordAuthed(userId, podId).catch((e) =>
          this.log.warn("record_authed_failed", { podId, userId, err: e }),
        );
      }
      if (msg.type === "links") {
        if (!recordedSession) {
          const url = msg.urls.find((u) => SESSION_URL_RE.test(u));
          if (url) {
            recordedSession = true;
            void this.config.control.recordSessionUrl(userId, podId, url).catch((e) =>
              this.log.warn("record_session_url_failed", { podId, userId, err: e }),
            );
          }
        }
        // The Claude sign-in URL rides the same links frame during first login.
        // Persist it so the cockpit's Sign-in step shows the link from the backend
        // (refresh-safe), the way the session URL already is. Not a session URL.
        if (!recordedAuthUrl) {
          const authUrl = msg.urls.find((u) => AUTH_URL_RE.test(u) && !SESSION_URL_RE.test(u));
          if (authUrl) {
            recordedAuthUrl = true;
            void this.config.control.recordAuthUrl(userId, podId, authUrl).catch((e) =>
              this.log.warn("record_auth_url_failed", { podId, userId, err: e }),
            );
          }
        }
      }
    });
    let closed = false;
    const closeBoth = (why: string) => () => {
      if (!closed) {
        closed = true;
        this.log.info("ws_detached", { podId, userId, why });
        // The pod dropped its side of the terminal — a restart (an update takes effect
        // exactly here). If it was on the stale-image cooldown, clear it so the next
        // sweep re-checks whether it now supports /control, rather than making an
        // updated pod wait out the long backoff. Only on upstream_close: a user closing
        // a tab (client_close) is not a restart and must not trigger a re-poke.
        if (why === "upstream_close") this.controlHub?.resetControlCooldown(podId);
      }
      if (client.readyState === WebSocket.OPEN) client.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    client.on("close", closeBoth("client_close"));
    upstream.on("close", closeBoth("upstream_close"));
    client.on("error", closeBoth("client_error"));
    upstream.on("error", closeBoth("upstream_error"));
  }

  // --- Preview URL proxy (<slug>.<previewBase> → pod app port) ---

  /** The slug if this request targets a preview host, else null. */
  private previewSlug(req: http.IncomingMessage): string | null {
    const base = this.config.previewBase;
    if (!base || !this.config.resolvePreviewOrigin) return null;
    const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
    const suffix = "." + base.toLowerCase();
    if (!host.endsWith(suffix)) return null;
    const slug = host.slice(0, -suffix.length);
    // A single DNS label of the pod-slug alphabet; the lookup is the real gate.
    return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
  }

  /** Resolve slug → pod + decide access. Returns the pod, OR a PreviewError describing the failure —
   * the caller renders it (an HTTP page via sendPreviewError, or a socket reject for a WS upgrade).
   * The status mapping is uniform across every preview entry point. */
  private async resolvePreviewAccess(
    slug: string,
    req: http.IncomingMessage,
  ): Promise<{ podId: string; ownerId: string } | { error: PreviewError }> {
    // "No pod here" covers BOTH a non-existent pod AND a private pod that isn't yours — returning 403
    // for the latter would confirm the pod exists to a stranger (enumeration). Same 404 for both.
    const notHere: PreviewError = { code: 404, title: "No pod here", message: "There's no pod at this address." };
    const pod = await this.config.control.lookupForPreview(slug);
    if (!pod) return { error: notHere };
    // `previewAppAuth` is delegated auth: the pod runs an agent-harness backend (e.g. T3 Code) that
    // guards its OWN endpoint with a pairing token, so the gateway forwards :3000 as public transport
    // — a podbay cookie would just block the third-party app that only carries its own token. The
    // UPSTREAM app is the gate. (Owner-only stays the default; `public` is the generic anyone-can-view.)
    if (!pod.previewPublic && !pod.previewAppAuth) {
      const userId = await this.config.authenticate(req).catch(() => null);
      if (!userId) {
        return {
          error: {
            code: 401,
            title: "Sign in to view this preview",
            message: "This pod's preview is owner-only. Sign in to view it.",
          },
        };
      }
      if (userId !== pod.ownerId) {
        this.log.warn("preview_denied", { slug, authed: true });
        return { error: notHere };
      }
    }
    const state = await this.previewRunState(pod.ownerId, pod.podId);
    if (state === "suspended") {
      const dash = this.appOrigin
        ? `${this.appOrigin}/dashboard/pods/${encodeURIComponent(slug)}`
        : undefined;
      return {
        error: {
          code: 503,
          title: "This pod is suspended",
          message: "Resume it to view the preview — nothing wakes a suspended pod automatically.",
          dashboardUrl: dash,
        },
      };
    }
    if (state !== "running") {
      // starting / waking / provisioning / a transient lookup failure → temporarily unavailable.
      return {
        error: {
          code: 503,
          title: "This pod is starting",
          message: "The pod is coming up — the preview will appear here in a moment.",
          retryAfter: 5,
        },
      };
    }
    return { podId: pod.podId, ownerId: pod.ownerId };
  }

  /** The pod's readiness for a preview. Explicit suspend/resume: a suspended pod is NOT auto-woken by
   * a preview hit — the owner resumes it. A waking/provisioning pod is waited for briefly. */
  private async previewRunState(
    ownerId: string,
    podId: string,
  ): Promise<"running" | "suspended" | "starting" | "unavailable"> {
    try {
      const pod = await this.config.control.getPod(ownerId, podId);
      if (pod.status === "running") return "running";
      if (pod.status === "suspended") return "suspended";
      return (await this.waitRunning(ownerId, podId)) ? "running" : "starting";
    } catch {
      return "unavailable";
    }
  }

  /** THE one place a preview failure becomes a response: the correct HTTP status ALWAYS (so monitors,
   * caches and crawlers behave), with a body content-negotiated by Accept — a friendly UTF-8 HTML card
   * for browsers, plain UTF-8 text for API/fetch. A signed-out browser on an owner-only preview is
   * redirected to sign in (the cookie is domain-shared, so re-opening the link then works). */
  private sendPreviewError(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    o: PreviewError,
  ): void {
    if (res.headersSent) return;
    const isGet = (req.method ?? "GET") === "GET";
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    if (o.code === 401 && wantsHtml && isGet && this.appOrigin) {
      res.writeHead(302, { Location: `${this.appOrigin}/signin` });
      res.end();
      return;
    }
    const headers: Record<string, string> = {};
    if (o.retryAfter) headers["Retry-After"] = String(o.retryAfter);
    if (wantsHtml && isGet) {
      res.writeHead(o.code, { "Content-Type": "text/html; charset=utf-8", ...headers });
      res.end(previewStatusPage(o));
    } else {
      res.writeHead(o.code, { "Content-Type": "text/plain; charset=utf-8", ...headers });
      res.end(o.message);
    }
  }

  private async handlePreviewHttp(
    slug: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const acc = await this.resolvePreviewAccess(slug, req);
      if ("error" in acc) {
        this.sendPreviewError(req, res, acc.error);
        return;
      }
      const pod = acc;
      const origin = await this.config.resolvePreviewOrigin!(pod.podId);
      const target = new URL(req.url ?? "/", origin);
      const upstream = http.request(
        target,
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (pres) => {
          res.writeHead(pres.statusCode ?? 502, pres.headers);
          pres.pipe(res);
        },
      );
      // Pod is running but nothing is serving :3000 (app not started, or crashed mid-session). Same
      // uniform 503 + auto-retry as the other "temporarily unavailable" states.
      upstream.on("error", () => {
        this.sendPreviewError(req, res, {
          code: 503,
          title: "Nothing serving the preview yet",
          message:
            "The pod is running, but no app is listening on :3000 — start your dev server and this page refreshes on its own.",
          retryAfter: 5,
        });
      });
      req.pipe(upstream);
    } catch (e) {
      this.log.error("preview_http_error", { slug, err: e });
      this.sendPreviewError(req, res, {
        code: 500,
        title: "Gateway error",
        message: "The preview gateway hit an error. Try again in a moment.",
      });
    }
  }

  private async handlePreviewUpgrade(
    slug: string,
    req: http.IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    const acc = await this.resolvePreviewAccess(slug, req);
    if ("error" in acc) {
      reject(socket, acc.error.code, acc.error.message);
      return;
    }
    const pod = acc;
    try {
      const origin = new URL(await this.config.resolvePreviewOrigin!(pod.podId));
      const upstream = net.connect(Number(origin.port), origin.hostname.replace(/^\[|\]$/g, ""));
      upstream.on("connect", () => {
        // Replay the upgrade request verbatim (rawHeaders preserves order/casing).
        let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        upstream.write(raw + "\r\n");
        if (head?.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      const bail = () => socket.destroy();
      upstream.on("error", bail);
      socket.on("error", bail);
    } catch (e) {
      this.log.error("preview_ws_error", { slug, err: e });
      reject(socket, 500, "gateway error");
    }
  }

  /** Run the control-plane idle policy once (also called on the timer). */
  async sweepIdle(): Promise<string[]> {
    return this.config.control.sleepIdlePods(this.opts.idleThresholdMs);
  }

  /** Maintenance sweep: (1) wake dormant pods (keepalive, opt-in) and (2) refresh the login of
   * RUNNING-but-idle pods before it hard-expires (on by default — the afisha-class fix). */
  async sweepMaintenance(): Promise<string[]> {
    const woken = await this.config.control.maintenanceWakePods(
      this.opts.maintenanceDormantMs,
      this.opts.maintenanceMaxPerSweep,
    );
    const refreshed = await this.config.control
      .refreshRunningIdlePods(this.opts.maintenanceRefreshIdleMs, this.opts.maintenanceMaxPerSweep)
      .catch(() => [] as string[]);
    // Unstick any T3 enable orphaned by a gateway restart mid-provision (so it fails + is retryable
    // instead of spinning forever). Best-effort; never let it break the sweep.
    const unstuck = await this.config.control.reconcileStuckT3Enables?.().catch(() => [] as string[]) ?? [];
    // Unstick a HUNG image update — the detached recreate has no timeout, so a wedged incus op (or a
    // gateway restart mid-recreate) strands the pod STOPPED and the cockpit on "Updating" forever
    // (test:1, 2026-08-29). Wake the pod on its prior image + fail the update so it's retryable.
    const unstuckUpdates =
      (await this.config.control.reconcileStuckUpdates?.().catch(() => [] as string[])) ?? [];
    return [...woken, ...refreshed, ...unstuck, ...unstuckUpdates];
  }

  /** Reap relay connection rows that have been disconnected for a long time (a relay paired once and
   * never returned, or an owner since deleted) — so the table holds live/recently-flapped relays, not
   * ancient dead ones. Throttled to at most once per REAP_INTERVAL since a long-dead row is not urgent.
   * No-op when relay auth isn't configured (OSS). Returns how many were removed this call. */
  async sweepRelayReap(now = Date.now()): Promise<number> {
    const auth = this.config.relayAuthority;
    if (!auth) return 0;
    if (now - this.lastRelayReapAt < RELAY_REAP_INTERVAL_MS) return 0;
    this.lastRelayReapAt = now;
    return auth.reapStaleConnections(RELAY_STALE_CONNECTION_TTL_MS);
  }

  /**
   * Refresh pod status against the provider, a slice per tick.
   *
   * Nothing else does this on a timer: sleepIdlePods returns early for Incus pods, and
   * every other reconcile is triggered by someone opening a page. So a crashed pod
   * keeps reading "running" and a recovered one keeps reading "suspended" — and the
   * control sweep, the idle policy and fleet health all inherit that staleness.
   *
   * Rotated in slices rather than reconciling everything each tick: reconcile talks to
   * the provider per pod, and a large fleet would turn one timer into a thundering
   * herd. A cursor in memory is enough — a restart just restarts the rotation.
   */
  async sweepReconcile(): Promise<string[]> {
    const ids = await this.config.control.listReconcilableIds().catch(() => [] as string[]);
    if (ids.length === 0) return [];
    const size = Math.min(this.opts.reconcilePerSweep, ids.length);
    const slice: string[] = [];
    for (let i = 0; i < size; i++) {
      slice.push(ids[(this.reconcileCursor + i) % ids.length]!);
    }
    this.reconcileCursor = (this.reconcileCursor + size) % ids.length;
    await Promise.all(
      slice.map((id) => this.config.control.reconcile(id).catch(() => undefined)),
    );
    return slice;
  }

  /** Build any pods stuck in "provisioning" (durable provisioning worker). */
  async sweepProvision(): Promise<string[]> {
    return this.config.control.provisionPending();
  }

  async listen(): Promise<{ host: string; port: number }> {
    await new Promise<void>((r) => this.http.listen(this.opts.port, this.opts.host, r));
    this.idleTimer = setInterval(() => {
      void this.sweepIdle().catch(() => undefined);
      void this.sweepMaintenance().catch(() => undefined);
      void this.sweepRelayReap().catch(() => undefined); // self-throttled; no-op without relay auth
    }, this.opts.tickMs);
    let reconcileRunning = false;
    // Drain relay queues on a short tick: a request held back for pacing must go out
    // when its slot frees, not when someone happens to retry.
    if (this.relays) {
      this.relayTimer = setInterval(() => {
        this.relays!.sweep(); // expire stale codes + awaiters before pumping
        for (const ownerId of this.relays!.pendingOwners()) this.relays!.pump(ownerId);
      }, 1000);
    }
    // Status refresh first, so the control sweep acts on fresh status rather than on
    // whatever a page view last happened to write.
    this.reconcileTimer = setInterval(() => {
      if (reconcileRunning) return; // a slow provider must not stack reconciles
      reconcileRunning = true;
      void this.sweepReconcile()
        .catch((e) => this.log.warn("reconcile_sweep_failed", { err: e }))
        .finally(() => {
          reconcileRunning = false;
        });
    }, this.opts.tickMs);
    if (this.controlHub) {
      let controlRunning = false;
      const sweepControl = async () => {
        if (controlRunning) return;
        controlRunning = true;
        try {
          const running = await this.config.control.listRunningIds().catch(() => [] as string[]);
          await this.controlHub!.ensure(running);
          await this.controlHub!.pushPlan();
        } finally {
          controlRunning = false;
        }
      };
      void sweepControl();
      this.controlTimer = setInterval(() => void sweepControl().catch(() => undefined), this.opts.tickMs);
    }
    if (this.opts.provisionIntervalMs > 0) {
      // Guard against overlap on a slow tick — build sequentially.
      let running = false;
      this.provisionTimer = setInterval(() => {
        if (running) return;
        running = true;
        void this.sweepProvision()
          .catch((e) => this.log.warn("provision_sweep_failed", { err: e }))
          .finally(() => {
            running = false;
          });
      }, this.opts.provisionIntervalMs);
    }
    const addr = this.http.address();
    const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
    return { host: this.opts.host, port };
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.provisionTimer) clearInterval(this.provisionTimer);
    if (this.controlTimer) clearInterval(this.controlTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.controlHub?.closeAll();
    // Terminate rather than wait: wss.close() only resolves once every client has
    // gone, so one wedged relay or terminal would block shutdown indefinitely.
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.http.close(() => r()));
  }
}

function parsePodId(url: string): string | null {
  const m = url.match(/\/pods\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function reject(socket: Socket, code: number, msg: string): void {
  socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A small, self-contained page for "nothing is serving :3000 yet" — served with 503
 * from the preview proxy. No external assets (the pod's app may be the only thing that
 * would serve them), theme-neutral dark, and it says what to DO rather than a raw error. */
/** A preview failure, resolved once and rendered per-transport (HTTP page or WS socket reject). */
type PreviewError = {
  code: number;
  title: string;
  message: string;
  retryAfter?: number;
  dashboardUrl?: string;
};

/** THE one preview-status page for browsers (every unavailable/denied state routes through here):
 * a correctly UTF-8-encoded card with the state's title + message, an optional dashboard link (the
 * suspended case), and optional auto-retry (starting / no-app). One template, message by state. */
function previewStatusPage(o: {
  title: string;
  message: string;
  retryAfter?: number;
  dashboardUrl?: string;
}): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const link = o.dashboardUrl
    ? `<p class="hint"><a href="${esc(o.dashboardUrl)}" style="color:#5cc8ff;text-decoration:none">Go to your dashboard →</a></p>`
    : "";
  const retry = o.retryAfter
    ? `<p class="hint">This page auto-retries every few seconds.</p><script>setTimeout(function(){location.reload()},${Math.round(o.retryAfter * 1000)})</script>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<style>
  html,body{margin:0;height:100%;background:#0b0e13;color:#e7ebf2;
    font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:460px;text-align:center;background:#151a23;border:1px solid #232b38;
    border-radius:16px;padding:32px 28px}
  .dot{width:10px;height:10px;border-radius:50%;border:2px solid #69727f;display:inline-block;margin-right:8px;vertical-align:middle}
  h1{font-size:19px;margin:0 0 8px;letter-spacing:-.01em}
  p{color:#98a2b3;margin:0 0 14px}
  .hint{font-size:13px;color:#69727f;margin-top:18px}
</style></head><body><div class="wrap"><div class="card">
  <h1><span class="dot"></span>${esc(o.title)}</h1>
  <p>${esc(o.message)}</p>
  ${link}${retry}
</div></div></body></html>`;
}
