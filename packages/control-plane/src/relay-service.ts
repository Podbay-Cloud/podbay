import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, desc } from "@podbay/db";
import { relayPairingCodes, relayConnections, relayTokens, fetchMemory, type Database } from "@podbay/db";

/**
 * The relay's control-plane surface: pairing codes and live connection state.
 *
 * DB-backed because the two ends live in different processes. The web app mints a
 * pairing code (owner is signed in there); the GATEWAY redeems it (that is where the
 * relay's WebSocket lands) and records the connection. They share the database and
 * nothing else — so a code, and the fact that a relay is connected, have to be rows,
 * not memory.
 *
 * Nothing here records what the relay fetched. Traffic is read back from `fetch_memory`
 * (the `relay` rung), which is domain/outcome only — the same privacy boundary the
 * shared memory table already enforces. A relay's own fetch log stays on the owner's
 * machine, surfaced by `relay dashboard`, never shipped here.
 */

/** Long enough to paste into a terminal and run; short enough that a leaked code is
 * mostly dead on arrival. */
export const RELAY_CODE_TTL_MS = 10 * 60_000;

/** A connection whose last heartbeat is older than this is treated as gone — covers a
 * gateway that crashed without deleting the row. The gateway heartbeats well inside it. */
export const RELAY_STALE_MS = 90_000;

/** How long a reconnect token stays valid. Long enough that a relay left running for
 * weeks survives every restart/blip without re-pairing; bounded so an abandoned token
 * eventually dies. Revoked explicitly by `relay reset`. */
export const RELAY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RelayConnectionRow {
  ownerId: string;
  connectedAt: string;
  lastSeenAt: string;
  loginDomains: string[];
}

export interface RelayTrafficRow {
  domain: string;
  okCount: number;
  failCount: number;
  lastOutcome: string;
  lastVerified: string;
}

export class RelayService {
  constructor(private readonly db: Database) {}

  /** Mint a one-time pairing code for an owner. The caller (web) has already checked
   * the owner is signed in; this just records the grant. */
  async mintPairingCode(ownerId: string, now = Date.now()): Promise<{ code: string; expiresAt: number }> {
    // url-safe, unguessable, and not so long it wraps in a terminal.
    const code = randomBytes(18).toString("base64url");
    const expiresAt = new Date(now + RELAY_CODE_TTL_MS);
    await this.db.insert(relayPairingCodes).values({ code, ownerId, expiresAt });
    return { code, expiresAt: expiresAt.getTime() };
  }

  /**
   * Redeem a code, returning the owner it belongs to — or null if it is unknown,
   * expired, or already spent.
   *
   * The spend is a single UPDATE ... WHERE not-spent AND not-expired ... RETURNING, so
   * two relays racing the same leaked code cannot both win: the database picks one.
   */
  async redeemPairingCode(code: string, now = Date.now()): Promise<string | null> {
    if (!code) return null;
    const rows = await this.db
      .update(relayPairingCodes)
      .set({ spentAt: new Date(now) })
      .where(
        and(
          eq(relayPairingCodes.code, code),
          isNull(relayPairingCodes.spentAt),
          gt(relayPairingCodes.expiresAt, new Date(now)),
        ),
      )
      .returning({ ownerId: relayPairingCodes.ownerId });
    return rows[0]?.ownerId ?? null;
  }

  /**
   * Issue a durable, reusable reconnect token for an owner, handed to the relay at
   * pairing. Unlike the one-time code, this survives reconnects — so a gateway restart
   * or a network blip does not force re-pairing.
   */
  async issueReconnectToken(ownerId: string, now = Date.now()): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    const at = new Date(now);
    await this.db
      .insert(relayTokens)
      .values({ token, ownerId, createdAt: at, expiresAt: new Date(now + RELAY_TOKEN_TTL_MS), lastUsedAt: at });
    return token;
  }

  /**
   * Validate a reconnect token, returning the owner it belongs to — WITHOUT consuming
   * it (it is reusable). Bumps lastUsedAt so abandoned tokens are distinguishable.
   * Returns null if unknown or expired.
   */
  async validateReconnectToken(token: string, now = Date.now()): Promise<string | null> {
    if (!token) return null;
    const rows = await this.db
      .update(relayTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(and(eq(relayTokens.token, token), gt(relayTokens.expiresAt, new Date(now))))
      .returning({ ownerId: relayTokens.ownerId });
    return rows[0]?.ownerId ?? null;
  }

  /** Drop all reconnect tokens for an owner (`relay reset`, or a security revoke). */
  async revokeReconnectTokens(ownerId: string): Promise<void> {
    await this.db.delete(relayTokens).where(eq(relayTokens.ownerId, ownerId));
  }

  /** Record (or refresh) that an owner has a relay connected. Upsert so a reconnect
   * after a blip does not stack rows. */
  async markConnected(ownerId: string, loginDomains: string[] = [], now = Date.now()): Promise<void> {
    const at = new Date(now);
    await this.db
      .insert(relayConnections)
      .values({ ownerId, connectedAt: at, lastSeenAt: at, loginDomains })
      .onConflictDoUpdate({
        target: relayConnections.ownerId,
        set: { lastSeenAt: at, loginDomains },
      });
  }

  /** Keep-alive: the gateway calls this while the socket is up. */
  async heartbeat(ownerId: string, now = Date.now()): Promise<void> {
    await this.db
      .update(relayConnections)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(relayConnections.ownerId, ownerId));
  }

  /** Clean disconnect — the socket closed and we know it. */
  async markDisconnected(ownerId: string): Promise<void> {
    await this.db.delete(relayConnections).where(eq(relayConnections.ownerId, ownerId));
  }

  /** Is this owner's relay connected right now? Stale rows (a crashed gateway) read as
   * disconnected rather than being trusted. */
  async isConnected(ownerId: string, now = Date.now()): Promise<{ connected: boolean; loginDomains: string[] }> {
    const rows = await this.db
      .select()
      .from(relayConnections)
      .where(eq(relayConnections.ownerId, ownerId));
    const row = rows[0];
    if (!row || now - row.lastSeenAt.getTime() >= RELAY_STALE_MS) {
      return { connected: false, loginDomains: [] };
    }
    return { connected: true, loginDomains: row.loginDomains ?? [] };
  }

  /** Admin fleet view: every currently-connected relay. Stale rows omitted. */
  async listConnections(now = Date.now()): Promise<RelayConnectionRow[]> {
    const rows = await this.db.select().from(relayConnections).orderBy(desc(relayConnections.connectedAt));
    return rows
      .filter((r) => now - r.lastSeenAt.getTime() < RELAY_STALE_MS)
      .map((r) => ({
        ownerId: r.ownerId,
        connectedAt: r.connectedAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        loginDomains: r.loginDomains ?? [],
      }));
  }

  /**
   * What the relay rung has fetched, fleet-wide — for the admin monitor. Read from
   * shared fetch memory (rung = relay), so it is domain/outcome/count only, never a
   * URL or an owner. Worst-behaved first: those are the ones worth looking at.
   */
  async traffic(limit = 200): Promise<RelayTrafficRow[]> {
    const rows = await this.db
      .select()
      .from(fetchMemory)
      .where(eq(fetchMemory.rung, "relay"))
      .orderBy(desc(fetchMemory.failCount), desc(fetchMemory.lastVerified))
      .limit(limit);
    return rows.map((r) => ({
      domain: r.domain,
      okCount: r.okCount,
      failCount: r.failCount,
      lastOutcome: r.lastOutcome,
      lastVerified: r.lastVerified.toISOString(),
    }));
  }
}
