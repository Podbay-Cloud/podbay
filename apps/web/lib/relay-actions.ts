"use server";

import { RelayService, type RelayConnectionRow, type RelayTrafficRow } from "@podbay/control-plane";
import { createAppDb } from "@podbay/db";
import { requireApprovedUser, requireAdmin } from "./access";

/**
 * Relay pairing and monitoring, from the web side.
 *
 * The owner mints a pairing command here (they are signed in); the gateway redeems it
 * where the relay's socket lands. Both talk to the same database — that is the whole
 * reason pairing is a row and not a message between the two processes.
 */

function relayService(): RelayService {
  return new RelayService(createAppDb());
}

/** The public wss:// a relay dials to reach the gateway, for the copy-paste command.
 * Explicit override, else derived from the preview base (gateway.<root>). */
function relayConnectUrl(): string {
  if (process.env.PODBAY_RELAY_CONNECT_URL) return process.env.PODBAY_RELAY_CONNECT_URL;
  const base = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "");
  if (base && base.split(".").length > 2) return `wss://gateway.${base.split(".").slice(1).join(".")}`;
  if (base) return `wss://gateway.${base}`;
  return "wss://gateway.podbay.cloud";
}

export interface RelayCommand {
  command: string;
  /** Epoch ms the code stops working — the UI counts down from here. */
  expiresAt: number;
}

/**
 * Mint a fresh pairing code for the signed-in owner and return the one line they run
 * on their own machine. Owner-scoped: the code is bound to THIS user, so it can only
 * ever connect a relay as them.
 */
export async function mintRelayCommand(): Promise<RelayCommand> {
  const user = await requireApprovedUser();
  const { code, expiresAt } = await relayService().mintPairingCode(user.id);
  const command = `npx @podbay/relay@latest start --gateway ${relayConnectUrl()} --code ${code}`;
  return { command, expiresAt };
}

/** Whether the signed-in owner has a relay connected right now, and for which sites. */
export async function myRelayStatus(): Promise<{
  connected: boolean;
  loginDomains: string[];
  dropCount: number;
  lastDroppedAt: string | null;
}> {
  const user = await requireApprovedUser();
  return relayService().isConnected(user.id);
}

/**
 * Whether the tunnel actually CARRIES traffic, as opposed to the relay merely being
 * connected. Mirrors the gateway's `TunnelHealth` — kept as a local type so the web app
 * doesn't take a dependency on @podbay/gateway.
 */
export interface TunnelHealth {
  state: "ok" | "failed" | "unknown";
  at: number;
  ms?: number;
  reason?: string;
  probe: boolean;
}

/** Base URL of the gateway's HTTP side, or null when it isn't configured. */
function gatewayHttpBase(): string | null {
  const base = (process.env.NEXT_PUBLIC_GATEWAY_URL || relayConnectUrl())
    .replace(/^ws/, "http")
    .replace(/\/$/, "");
  return base || null;
}

/**
 * The owner's whole relay picture for the cockpit, in one call: connected?, which sites
 * they're signed into, whether the tunnel is actually reaching the internet, and how much
 * it has carried. One action so the cockpit can POLL it on a short interval — the row is
 * near-realtime, with no "recheck" button for the owner to babysit.
 *
 * Read-only: the health here is the gateway's LAST KNOWN result (it probes once on
 * connect, and real traffic keeps it fresh). We deliberately never open a connection
 * through the owner's machine just to render their dashboard.
 *
 * Owner-scoped by construction — the user id comes from the session, never the caller.
 */
export interface MyRelayLive {
  connected: boolean;
  loginDomains: string[];
  /** Relay-liveness observability (2026-08-18): how many times the relay has dropped/flapped, and
   * when it last dropped. Surfaces a flapping link that used to be invisible ("connected, 0 errors").
   * Survives reconnects, so it shows history even while currently connected. */
  dropCount: number;
  lastDroppedAt: string | null;
  health: TunnelHealth | null;
  /** Open now + totals since the gateway started. Null when not connected. The per-site
   * breakdown deliberately stays on the owner's machine (`relay dashboard`). */
  usage: { open: number; connections: number; bytesUp: number; bytesDown: number } | null;
}

export async function myRelayLive(): Promise<MyRelayLive> {
  const user = await requireApprovedUser();
  const status = await relayService().isConnected(user.id);
  // No relay → nothing to ask the gateway. Skip the round-trip entirely.
  const token = process.env.ADMIN_API_TOKEN;
  const base = gatewayHttpBase();
  if (!status.connected || !token || !base) {
    return { ...status, health: null, usage: null };
  }
  try {
    const res = await fetch(`${base}/relay-tunnel-health?owner=${encodeURIComponent(user.id)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      // HARD deadline — this can run while RENDERING the cockpit, and a gateway that
      // blackholes (drops SYNs rather than refusing) would otherwise hang the whole page.
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { ...status, health: null, usage: null };
    const t = (await res.json()) as {
      health: TunnelHealth | null;
      usage: MyRelayLive["usage"];
    };
    return { ...status, health: t.health, usage: t.usage };
  } catch {
    // The gateway being unreachable is not "the tunnel is broken" — say nothing rather
    // than show the owner a red light we cannot justify.
    return { ...status, health: null, usage: null };
  }
}

export interface RelayAdminView {
  connections: RelayConnectionRow[];
  traffic: RelayTrafficRow[];
}

/** Fleet relay view for admins: who is connected, and what the relay rung has fetched
 * (domain/outcome only, from shared memory — never a URL or who asked). */
export async function getRelayAdmin(): Promise<RelayAdminView> {
  await requireAdmin();
  const svc = relayService();
  const [connections, traffic] = await Promise.all([svc.listConnections(), svc.traffic()]);
  return { connections, traffic };
}

/** LIVE relay metrics (queue depth, req/min, policy) — matches the gateway's
 * RelayMetrics. Kept as a local type so the web app doesn't depend on @podbay/gateway. */
export interface RelayLiveMetrics {
  totals: { connected: number; queued: number; reqLastMin: number };
  owners: { ownerId: string; since: string | null; queued: number; domains: string[]; reqLastMin: number }[];
  perDomain: { domain: string; reqLastMin: number }[];
  perPod: { podId: string; reqLastMin: number; domains: string[] }[];
  policy: { queueMax: number; queueMaxPerPod: number; ratePerDomain: number; rateWindowMs: number };
  /** Egress-tunnel usage — connections + bytes per DOMAIN (never a URL, never content).
   * Absent from a gateway older than the tunnel. */
  tunnel?: {
    open: number;
    domains: { domain: string; connections: number; bytesUp: number; bytesDown: number }[];
    /** Per relay owner, cumulative since the gateway started. */
    owners?: {
      ownerId: string;
      open: number;
      connections: number;
      bytesUp: number;
      bytesDown: number;
      health: TunnelHealth | null;
    }[];
    /** Per pod — LIVE ONLY (open streams). Deliberately never accumulated. */
    pods?: { podId: string; open: number; domains: string[]; bytesUp: number; bytesDown: number }[];
  };
}

/**
 * The gateway's live in-memory relay state (queues/rates) — not in the DB, so we fetch
 * it from the gateway's admin endpoint (bearer ADMIN_API_TOKEN). Best-effort: returns
 * null when unconfigured or the gateway is unreachable, so the dashboard degrades to the
 * DB-backed sections rather than erroring.
 */
export async function getRelayLiveState(): Promise<RelayLiveMetrics | null> {
  await requireAdmin();
  const token = process.env.ADMIN_API_TOKEN;
  const base = gatewayHttpBase();
  if (!token || !base) return null;
  try {
    const res = await fetch(`${base}/admin/relay-state`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      // Same deadline reasoning as the health call: this blocks the admin page render.
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RelayLiveMetrics;
  } catch {
    return null;
  }
}
