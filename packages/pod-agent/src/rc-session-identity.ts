import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Replaces the `coldStart` boolean for deciding whether the greeter should
 * `/rename` the Claude-app remote-control session to the pod's title.
 *
 * `coldStart` was derived from "did the pod-agent PROCESS restart", but the
 * tmux-hosted Claude process — and therefore the RC session it owns — can
 * survive a pod-agent-only restart (a service bounce). In that case the OLD
 * logic (`coldStart: true` on every boot greet) would send `/rename` again
 * even though it's the SAME RC session, and could clobber a title the owner
 * set themselves in the Claude app in the meantime.
 *
 * The fix: observe the RC session's own identity (Claude Code's
 * `bridgeSessionId`, surfaced by `signals.ts`'s `sessionStateFromDisk().url`)
 * and persist only a HASH of the last-observed one — never the raw id/URL,
 * per the design's privacy-adjacent constraint (a live session identifier is
 * sensitive even in Podbay's own file). Comparing the current observation
 * against the persisted hash tells us whether the RC session's identity
 * actually changed, independent of whether the pod-agent process restarted.
 *
 * See openspec/changes/rc-reconnect-hardening/design.md, decision 3.
 */

/** Podbay-owned, mode-0600 state file: the last-observed RC session id's hash. */
export const DEFAULT_RC_SESSION_HASH_PATH = "/home/dev/.podbay-rc-session-hash";

/** Short, non-reversible-enough-to-matter digest — this is a change-detector, not a
 * security boundary; a full SHA-256 hex digest is simply more than we need to store. */
export function hashRcSessionId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}

/** Read the persisted hash, or undefined if there is none (first run, or the
 * file is missing/corrupt/unreadable — treated the same as "no prior hash"). */
export function readRcSessionHash(path: string = DEFAULT_RC_SESSION_HASH_PATH): string | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Persist a hash, mode 0600 (owner read/write only) — re-asserted with an explicit
 * chmod so a pre-existing file with looser permissions (or an umask on create)
 * can't leave the state file group/world-readable. Best-effort: a write failure
 * here should never crash the greeter over a non-essential side channel. */
export function writeRcSessionHash(hash: string, path: string = DEFAULT_RC_SESSION_HASH_PATH): void {
  try {
    writeFileSync(path, hash, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    /* best-effort — a failed write just means the next boot re-evaluates from scratch */
  }
}

export interface RcRenameDecision {
  /** Whether `/rename <pod-title>` should run now. */
  shouldRename: boolean;
  /** The hash to persist as the new "last observed" value — undefined means
   * "leave the persisted state exactly as it was" (nothing new was observed,
   * or the observation matched what's already persisted). */
  hashToPersist?: string;
}

/**
 * Pure decision: given the CURRENTLY observed RC session id (the `sessionStateFromDisk().url`
 * string, or undefined if unobservable) and the PRIOR persisted hash (undefined if none),
 * decide whether `/rename` should run and what should be persisted afterward.
 *
 * - same id as last time  → same RC session survived (e.g. a pod-agent-only restart, or a
 *   native `--continue` reattach) → do NOT rename; preserve whatever title is already there.
 * - different id, or no prior hash → a fresh or replacement RC session → RENAME, and persist
 *   the new id's hash so the next comparison is against this session.
 * - no CURRENT observable id, but ALSO no prior hash → there is nothing a rename could
 *   clobber (we have never recorded a session for this pod), and the greeter only reaches
 *   the rename step at all once it has confirmed RC is ACTIVE — which it accepts from the
 *   PANE (`RC_ACTIVE_RE`) as well as from the session file. That asymmetry is a real window,
 *   not a hypothetical: the pane can read "remote control is active · …/session_x" before
 *   `~/.claude/sessions/<pid>.json` exists for `sessionStateFromDisk()` to parse. Skipping
 *   the rename there would silently drop the whole point of the cold-restart naming fix
 *   (a fresh session left as "Resume session context"), so RENAME as best effort — with no
 *   hash to persist, since we still have no id to record. Caught by CI's real-tmux
 *   `greeter.test.ts`, which this sandbox cannot run (2026-08-27).
 * - no CURRENT observable id, but a prior hash EXISTS → we have previously recorded a
 *   session for this pod and cannot prove the current one differs, so a rename risks
 *   clobbering a title the owner set. Do NOT rename, and leave the persisted hash alone.
 */
export function decideRcRename(
  currentId: string | undefined,
  priorHash: string | undefined,
): RcRenameDecision {
  if (currentId === undefined) {
    // Nothing recorded yet ⇒ nothing to clobber ⇒ name it (see the doc comment above).
    return { shouldRename: priorHash === undefined, hashToPersist: undefined };
  }
  const currentHash = hashRcSessionId(currentId);
  if (currentHash === priorHash) {
    return { shouldRename: false, hashToPersist: undefined };
  }
  return { shouldRename: true, hashToPersist: currentHash };
}

/**
 * Convenience wrapper for callers (the greeter) that just want "should I rename right
 * now, given what I currently observe" — reads the persisted hash, applies
 * {@link decideRcRename}, and (only when the decision says something new was observed)
 * writes the updated hash back out. Safe to call on every greet.
 */
export function resolveRcRename(
  currentId: string | undefined,
  path: string = DEFAULT_RC_SESSION_HASH_PATH,
): RcRenameDecision {
  const prior = readRcSessionHash(path);
  const decision = decideRcRename(currentId, prior);
  if (decision.hashToPersist) writeRcSessionHash(decision.hashToPersist, path);
  return decision;
}
