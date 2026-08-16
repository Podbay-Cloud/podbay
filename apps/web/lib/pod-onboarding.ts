/**
 * Where a pod is in the launch flow, DERIVED from durable DB state (status +
 * onboarding milestones) rather than any client state. The server computes this
 * on every load so the wizard survives refresh/close/reopen — and even a sleep —
 * showing the same step. The client refines it live from agent signals, but the
 * DB is the source of truth.
 */

export type SetupStep = "creating" | "login" | "agent" | "ready";

/** Full launch progression including the pre-pod configure step (for the bar). */
export const WIZARD_STEPS = ["configure", "creating", "login", "agent", "ready"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  configure: "Configure",
  creating: "Create",
  login: "Sign in",
  agent: "Start agent",
  ready: "Ready",
};

/** After login, give remote control this long to surface its session URL before
 * we call the pod "ready" anyway (RC is best-effort and needs a subscription). */
export const RC_WAIT_MS = 90_000;

/** Codex has NO remote-control session URL to wait for — once it's authed the
 * kickoff respawns and it's usable within seconds. So instead of sitting on the
 * full RC_WAIT_MS fallback (which left the cockpit on "Starting your agent" for
 * 90s while Codex was already answering in the terminal), give just a short grace
 * for the respawn, then call it ready. */
export const CODEX_READY_GRACE_MS = 6_000;

export interface OnboardingFields {
  status: string;
  authedAt: string | null;
  sessionUrl: string | null;
  /** Active agent (agents[0]) — Codex has no RC, so its ready signal differs. */
  agent?: string | null;
}

/** How long after login we linger on "agent" before calling the pod ready, given
 * the agent: Claude waits for its RC session URL (RC_WAIT_MS), Codex only needs
 * the respawn grace since it has no session URL. */
export function readyWaitMsForAgent(agent: string | null | undefined): number {
  return agent === "codex" ? CODEX_READY_GRACE_MS : RC_WAIT_MS;
}

/** The current step from durable fields alone. sessionUrl ⇒ ready; logged-in ⇒
 * "agent" briefly then "ready"; agent reachable (running) but not logged-in ⇒
 * "login"; anything earlier ⇒ "creating". */
export function deriveSetupStep(p: OnboardingFields, now = Date.now()): SetupStep {
  if (p.sessionUrl) return "ready";
  if (p.authedAt) {
    return now - Date.parse(p.authedAt) < readyWaitMsForAgent(p.agent) ? "agent" : "ready";
  }
  if (p.status === "running") return "login";
  return "creating";
}
