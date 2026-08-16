/**
 * The agent-card state machine, as pure functions so it can be TESTED.
 *
 * Extracted after three UI regressions in one day, two of which were decision
 * bugs (not styling): the pairing wizard auto-opened on a pod that already had a
 * paired device, because "devices haven't loaded yet" was indistinguishable from
 * "no devices". A regex over the component can't catch that; a unit test can.
 */

export type LiveAgent = {
  id: string;
  window: number | null;
  authed: boolean;
  rcActive: boolean;
  authUrl?: string | null;
  sessionUrl?: string | null;
};

export type CardState =
  | "starting"
  | "not-running"
  | "needs-signin"
  | "claude-ready"
  | "claude-linked"
  | "codex-on"
  | "codex-off"
  | "unknown";

/** How long a missing agent reads as "starting" before it reads as "not running". */
export const SPAWN_GRACE_MS = 30_000;

export function agentCardState(input: {
  id: string;
  /** null = the pod hasn't answered yet. */
  live: LiveAgent[] | null;
  primaryAgent: string;
  /** Pod-level fallbacks, for images predating per-agent reporting. */
  sessionUrl: string | null;
  authedAt: string | null;
  legacyCodexRc: boolean;
  running: boolean;
  /** When this agent was first seen missing from a non-empty report. */
  missingSince?: number;
  /** An add/start is in flight for this agent. */
  startingNow: boolean;
  now: number;
}): CardState {
  const { id, live, running } = input;
  if (!running) return "unknown";

  const l = live?.find((s) => s.id === id);
  if (l) {
    if (!l.authed) return "needs-signin";
    if (id === "codex") return l.rcActive ? "codex-on" : "codex-off";
    return l.sessionUrl || input.sessionUrl ? "claude-linked" : "claude-ready";
  }

  // The pod reports per-agent truth but not THIS agent: still spawning, or its
  // window was lost.
  if (live !== null && live.length > 0) {
    if (input.startingNow) return "starting";
    const first = input.missingSince ?? input.now;
    return input.now - first < SPAWN_GRACE_MS ? "starting" : "not-running";
  }

  // Degraded: no per-agent data at all (old image, or first poll pending).
  if (id === input.primaryAgent) {
    if (id === "codex") return input.legacyCodexRc ? "codex-on" : "unknown";
    if (input.sessionUrl) return "claude-linked";
    return input.authedAt ? "claude-ready" : "unknown";
  }
  return "unknown";
}

/**
 * Should the Codex pairing wizard open WITHOUT the user asking?
 *
 * Exactly one case earns that: remote control is on and no device has ever been
 * confirmed — the user has an action to take and nothing else to click. Both
 * inputs must be LOADED first; treating not-yet-loaded as "nothing paired" is
 * what made the wizard pop open on a pod with a paired device.
 */
export function shouldAutoOpenPairing(input: {
  alreadyAutoOpened: boolean;
  hasCodex: boolean;
  /** null until the devices fetch answers. */
  devices: { name: string }[] | null;
  /** null until the pod answers. */
  live: LiveAgent[] | null;
  codexState: CardState;
}): boolean {
  if (input.alreadyAutoOpened || !input.hasCodex) return false;
  if (input.devices === null || input.live === null) return false; // not loaded → never assume
  return input.codexState === "codex-on" && input.devices.length === 0;
}
