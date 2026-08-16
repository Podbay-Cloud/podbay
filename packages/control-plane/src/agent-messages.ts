import { and, eq, gte, asc } from "@podbay/db";
import { agentMessages, type Database } from "@podbay/db";

/**
 * The owner-scoped store for messages between a user's own pods.
 *
 * Every value here originates in a pod outbox — i.e. an untrusted string over the
 * reconcile drain — so the boundary is defended in this class, not trusted to callers:
 * ids, body length, and pod refs are bounded before they can mint a row. The one field
 * a pod must NOT get to choose is who the message is FROM: the service attributes
 * `fromPod` from the pod it drained, so a sender cannot forge its identity.
 *
 * Owner-scoping is not enforced here (the class takes whatever owner it is handed) —
 * it is enforced one layer up, where the service resolves `toPod` only within the
 * sender's own fleet before calling `route`. That keeps the isolation predicate in one
 * place (the same `owned(...)` used everywhere else) rather than split across layers.
 */

/** A body longer than this is rejected at the boundary — a message is a request, not a
 * payload channel, and an unbounded body is a way for one pod to mint huge rows. */
export const MSG_MAX_BODY = 4000;
/** The client nonce is a PK; bound its length and charset so a pod cannot mint unbounded
 * distinct ids or smuggle control characters into the key. */
export const MSG_MAX_ID_LEN = 128;
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Pod refs (slug or display name) — bounded, printable, single line. */
const REF_MAX = 80;

export interface RouteMessage {
  /** Client nonce from the outbox (the PK — a re-drain is idempotent on it). */
  id: string;
  ownerId: string;
  /** Attributed by the service from the drained pod — never the outbox line's claim. */
  fromPod: string;
  toPod: string;
  body: string;
  /** The pod's send time, for display/ordering. Defaults to now if absent/invalid. */
  createdAt?: Date;
}

export interface InboxMessage {
  id: string;
  fromPod: string;
  body: string;
  createdAt: string;
}

/** Reserved sender for system notices (delivery bounces) routed back to a pod. Not a
 * real pod; the delivery formatter gives it a friendly label. */
export const SYSTEM_SENDER = "podbay";
/** Per sender→recipient rate cap over the window — the loop guard. Two autonomous
 * agents cannot ping-pong past this without being throttled. Generous enough that a
 * human-paced relay never trips it. */
export const MSG_PAIR_CAP = 20;
export const MSG_RATE_WINDOW_MS = 10 * 60 * 1000;

/** A pod as an addressing target: its slug and optional display name. */
export interface PodRef {
  id: string;
  name: string | null;
}

export type ResolveResult =
  | { kind: "ok"; id: string }
  | { kind: "ambiguous"; candidates: PodRef[] }
  | { kind: "none" };

/** Normalize a human reference the way both id and display name are compared: lowercase,
 * trimmed, internal whitespace folded to hyphens ("Cheerful Donkey" → "cheerful-donkey"). */
export function normalizeRef(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Resolve a loose human reference ("crawler", "afisha", "cheerful donkey") to ONE pod in
 * a fleet — or report that it is ambiguous or unknown.
 *
 * A forgiving ladder, but never a guess: exact (id or name) → normalized-exact → prefix
 * → substring/token. The FIRST tier that matches decides; a tier that matches two or more
 * pods returns `ambiguous` (it does NOT fall through to a looser tier), because the one
 * outcome worse than a bounce is delivering to the wrong pod. Zero matches anywhere →
 * `none`. Callers (the CLI for instant feedback, the service as the authority) share this
 * so the two never disagree.
 */
export function resolvePodRef(fleet: PodRef[], ref: string): ResolveResult {
  const r = normalizeRef(ref);
  if (!r) return { kind: "none" };
  const rows = fleet.map((p) => ({
    p,
    nid: p.id.toLowerCase(),
    nname: (p.name ?? "").toLowerCase().replace(/\s+/g, "-"),
  }));
  const tiers: ((x: (typeof rows)[number]) => boolean)[] = [
    (x) => x.nid === r || (x.nname !== "" && x.nname === r),
    (x) => x.nid.startsWith(r) || (x.nname !== "" && x.nname.startsWith(r)),
    (x) => x.nid.includes(r) || (x.nname !== "" && x.nname.includes(r)),
  ];
  for (const t of tiers) {
    const m = rows.filter(t);
    if (m.length === 1) return { kind: "ok", id: m[0]!.p.id };
    if (m.length > 1) return { kind: "ambiguous", candidates: m.map((x) => x.p) };
  }
  return { kind: "none" };
}

/** Thrown by `route` when a message is malformed — the caller drops it (one bad line
 * must never discard a whole pod's drain), same posture as fetch-memory. */
export class InvalidMessage extends Error {}

export class AgentMessages {
  constructor(private readonly db: Database) {}

  private static validate(m: RouteMessage): void {
    if (!ID_RE.test(m.id)) throw new InvalidMessage(`bad message id`);
    if (typeof m.body !== "string" || m.body.length === 0) throw new InvalidMessage("empty body");
    if (m.body.length > MSG_MAX_BODY) throw new InvalidMessage("body too long");
    for (const [k, v] of [["fromPod", m.fromPod], ["toPod", m.toPod], ["ownerId", m.ownerId]] as const) {
      if (typeof v !== "string" || v.length === 0 || v.length > REF_MAX) {
        throw new InvalidMessage(`bad ${k}`);
      }
    }
  }

  /**
   * Record a routed message as pending. Idempotent on (owner_id, id) (onConflictDoNothing): the
   * outbox drain is at-least-once, so the SAME message can arrive on two polls — the PK
   * collapses it to one row, which is where deliver-at-most-once actually begins.
   * Returns true if this call inserted the row (false = a duplicate re-drain).
   */
  async route(m: RouteMessage): Promise<boolean> {
    AgentMessages.validate(m);
    const rows = await this.db
      .insert(agentMessages)
      .values({
        id: m.id,
        ownerId: m.ownerId,
        fromPod: m.fromPod,
        toPod: m.toPod,
        body: m.body,
        status: "pending",
        createdAt: m.createdAt ?? new Date(),
      })
      .onConflictDoNothing({ target: [agentMessages.ownerId, agentMessages.id] })
      .returning({ id: agentMessages.id });
    return rows.length > 0;
  }

  /** Pending messages for one recipient, oldest first — the delivery scan. Scoped to the
   * owner so a lookup can never surface another tenant's traffic. */
  async pendingFor(ownerId: string, toPod: string, limit = 50): Promise<InboxMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.ownerId, ownerId),
          eq(agentMessages.toPod, toPod),
          eq(agentMessages.status, "pending"),
        ),
      )
      .orderBy(asc(agentMessages.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      fromPod: r.fromPod,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Flip a message to delivered so a later poll never re-injects it. Idempotent. */
  async markDelivered(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(agentMessages)
      .set({ status: "delivered", deliveredAt: at })
      .where(eq(agentMessages.id, id));
  }

  /** How many messages this sender→recipient pair produced since `since` — the rate
   * guard's input (a pair that exceeds the cap in a window is throttled). */
  async pairCountSince(ownerId: string, fromPod: string, toPod: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ id: agentMessages.id })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.ownerId, ownerId),
          eq(agentMessages.fromPod, fromPod),
          eq(agentMessages.toPod, toPod),
          gte(agentMessages.createdAt, since),
        ),
      );
    return rows.length;
  }
}
