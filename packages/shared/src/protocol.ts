/**
 * Wire protocol between a terminal client (web frontend) and the in-pod agent.
 * JSON text frames in v0. Shared so the agent and the frontend use one contract.
 */

/** One tmux window = one tab in the web terminal (docs/plans/multi-agent-plan.md,
 * "cheap-tabs"). A window usually hosts one agent (or a plain shell); `agent` is the
 * agent id when the pod-agent knows it, else undefined (e.g. a user-opened shell). */
export interface WindowInfo {
  /** tmux window index (stable id for select/close). */
  index: number;
  name: string;
  active: boolean;
  agent?: string;
}

/** Remote Control lifecycle classification — models RC OUTCOMES, not provider process
 * labels, because "a session URL was captured at some point" is not proof the bridge is
 * currently live (see openspec/changes/rc-reconnect-hardening/design.md, decision 2):
 *   - `active`: current evidence says the interactive bridge is live.
 *   - `recovering`: a bounded native reconnect/recovery attempt is in progress.
 *   - `down`: the login is valid but RC is confirmed unavailable.
 *   - `login-required`: RC cannot start until the owner completes `/login` (covers both a
 *     hard-expired credential file AND a live pane-detected auth failure/blocking OAuth dialog).
 *   - `unknown`: insufficient current evidence — never inferred as active from history. */
export type RcState = "active" | "recovering" | "down" | "login-required" | "unknown";

/** Per-agent truth reported on the pod's /healthz — what the cockpit's agent
 * cards render from. One entry per CLI the pod hosts (primary + added).
 * `authed` = that CLI's credentials file exists on the pod; `rcActive` = its
 * remote-control channel is up (Codex: daemon running; Claude: session URL
 * captured). Derived on the pod, never guessed from pod-level DB fields. */
export interface PodAgentState {
  id: string;
  /** tmux window index hosting this agent, when known. */
  window: number | null;
  authed: boolean;
  /** The credentials file exists but the login token has hard-expired — the agent is effectively
   * logged out and needs to reconnect (distinct from never-signed-in). Drives the cockpit's
   * "sign-in expired · Reconnect" affordance. */
  loginExpired?: boolean;
  /** A LIVE auth failure detected from the terminal (the CLI printed "Login expired"/"run /login")
   * that the credential-file expiry misses — a mid-session logout while the stored expiry is still in
   * the future. Same "reconnect" affordance as loginExpired, from the live signal. */
  needsReauth?: boolean;
  /** The active login's HARD expiry (ms since epoch) — the moment past which no refresh is possible.
   * Drives the "login expiring in N days" warning (cockpit + dashboard) since a subscription login has
   * a fixed ~monthly hard expiry nothing on the pod extends. Null when unknown / api-key / setup-token
   * not near expiry. See docs/strategy/agent-auth-lifecycle.md. */
  expiresAt?: number | null;
  rcActive: boolean;
  /** The RC lifecycle classification behind `rcActive` (see {@link RcState}). Optional so an
   * OLDER pod image that never sends it doesn't break a newer consumer — a tri-state rollout
   * concern, not an error; treat an absent value the same as `"unknown"`. `rcActive` remains the
   * backward-compatible projection: true if and only if `rcState === "active"`. */
  rcState?: RcState;
  /** This agent's captured sign-in value while unauthenticated — Claude: its OAuth
   * URL; Codex: its one-time device code. Null once signed in / not yet printed.
   * Per-agent so an ADDED agent gets the cockpit's link-and-paste sign-in instead
   * of being sent to the terminal. */
  authUrl?: string | null;
  /** This agent's OWN remote-control hand-off link, once captured (Claude only).
   * Per-agent because an added Claude's link prints in its own window. */
  sessionUrl?: string | null;
}

/** A problem the pod is reporting about itself (pod-agent health checks). Empty
 * list = healthy; surfaces render nothing rather than a wall of green rows. */
export interface PodIssue {
  id: string;
  severity: "critical" | "warn" | "info";
  title: string;
  detail: string;
  fixable: boolean;
  agent?: string;
}

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  /** Switch the active tmux window (a tab click). tmux mirrors ONE window to the
   * single output stream, so selecting a window is what makes its output show. */
  | { type: "select-window"; index: number }
  /** Open a new tmux window (the tab strip's "+"), then make it active. */
  | { type: "new-window" }
  | { type: "ping" };

export type AgentMessage =
  | { type: "output"; data: string }
  | { type: "links"; urls: string[] }
  /** paneChars: non-whitespace chars visible in the pane — 0 while the agent
   *  CLI is still cold-starting, so the client can show a "starting…" state.
   *  cred: the agent's login state, used by the gateway to capture credentials
   *  to the vault on the unauthenticated→authenticated transition (hash only —
   *  never the secret). */
  | {
      type: "status";
      idleMs: number;
      idle: boolean;
      ready: boolean;
      paneChars?: number;
      cred?: { agent: string; authed: boolean; hash: string };
    }
  /** The pod's current tmux windows, pushed whenever the set or active window
   * changes, so the client can render/refresh its tab strip. */
  | { type: "windows"; windows: WindowInfo[] }
  | { type: "exit"; code: number }
  | { type: "pong" };

export type ProtocolMessage = ClientMessage | AgentMessage;

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

export function isClientMessage(x: unknown): x is ClientMessage {
  if (!isObj(x)) return false;
  switch (x.type) {
    case "input":
      return typeof x.data === "string";
    case "resize":
      return typeof x.cols === "number" && typeof x.rows === "number";
    case "select-window":
      return typeof x.index === "number";
    case "new-window":
      return true;
    case "ping":
      return true;
    default:
      return false;
  }
}

function isWindowInfo(x: unknown): x is WindowInfo {
  return (
    isObj(x) &&
    typeof x.index === "number" &&
    typeof x.name === "string" &&
    typeof x.active === "boolean" &&
    (x.agent === undefined || typeof x.agent === "string")
  );
}

export function isAgentMessage(x: unknown): x is AgentMessage {
  if (!isObj(x)) return false;
  switch (x.type) {
    case "output":
      return typeof x.data === "string";
    case "links":
      return Array.isArray(x.urls) && x.urls.every((u) => typeof u === "string");
    case "status": {
      const cred = x.cred as Record<string, unknown> | undefined;
      return (
        typeof x.idleMs === "number" &&
        typeof x.idle === "boolean" &&
        typeof x.ready === "boolean" &&
        (x.paneChars === undefined || typeof x.paneChars === "number") &&
        (cred === undefined ||
          (typeof cred.agent === "string" &&
            typeof cred.authed === "boolean" &&
            typeof cred.hash === "string"))
      );
    }
    case "windows":
      return Array.isArray(x.windows) && x.windows.every(isWindowInfo);
    case "exit":
      return typeof x.code === "number";
    case "pong":
      return true;
    default:
      return false;
  }
}

/** Parse a raw WS frame into a ClientMessage, or null if invalid. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const x = JSON.parse(raw);
    return isClientMessage(x) ? x : null;
  } catch {
    return null;
  }
}
