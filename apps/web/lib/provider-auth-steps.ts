/**
 * The ONE source of truth for provider sign-in (t3-unattended-integration, D6). Sign-in is not "a T3
 * thing" or "a launch thing" — it is "bring each chosen provider to the auth state this pod's mode
 * needs." Every entry point (launch, switch-to-T3, cockpit add-provider, renew/expiry) computes its
 * steps here and feeds the ONE ProviderAuthWizard, so there is no duplicated sign-in flow.
 *
 * A "provider" is an agent CLI (T3's term): claude-code, codex, and later cursor/grok/opencode.
 * Pure + no React → trivially unit-tested (which is the point — the branching is where bugs hide).
 */

export type ProviderId = "claude-code" | "codex" | "cursor" | "grok" | "opencode";
export type ControlMode = "podbay" | "t3";
export type AgentAuth = "subscription" | "api-key" | "setup-token";

/** The auth action a single provider needs for the target mode. */
export type AuthStepKind =
  | "claude-subscription" // interactive /login — required for Podbay native Remote Control
  | "claude-setup-token" // the ~1-year inference-only token — what T3 (unattended) uses
  | "codex-device"; // ChatGPT device-auth

export interface AuthStep {
  provider: ProviderId;
  kind: AuthStepKind;
}

/** Current per-provider auth state on the pod (from healthz + the pod's auth mode). */
export interface ProviderAuthState {
  id: ProviderId;
  /** healthz `authed` (file-based). */
  authed: boolean;
  /** The pod's claude auth mode; only meaningful for claude-code. */
  agentAuth?: AgentAuth | null;
}

/**
 * The steps that are MISSING to bring `providers` to what `mode` needs — nothing for a provider already
 * in the right state (that is the "partial wizard": switching a pod that's already partly signed in only
 * runs what's left; adding a provider later runs only that one).
 *
 * The one subtlety worth stating (velsa 2026-08-24): the setup-token is INFERENCE-ONLY, so it can drive a
 * pod only under **T3** (T3 uses its own channel, no native RC). Under **Podbay** control, Claude needs a
 * **subscription** login for RC — so a setup-token pod switched to Podbay control DOES need a fresh
 * subscription sign-in, and a subscription pod switched to T3 DOES need the setup-token.
 */
export function computeAuthSteps(input: {
  providers: ProviderId[];
  mode: ControlMode;
  current: ProviderAuthState[];
}): AuthStep[] {
  const { providers, mode, current } = input;
  const steps: AuthStep[] = [];
  for (const p of providers) {
    const cur = current.find((c) => c.id === p);
    if (p === "claude-code") {
      if (mode === "t3") {
        // T3 (unattended) runs Claude on the 1-year setup-token; run it unless already setup-token.
        if (cur?.agentAuth !== "setup-token") steps.push({ provider: p, kind: "claude-setup-token" });
      } else {
        // Podbay needs a subscription login (native RC). Needed if not signed in, OR if the pod is on a
        // setup-token — inference-only can't do RC, so it's not adequate for Podbay control.
        if (!cur?.authed || cur?.agentAuth === "setup-token")
          steps.push({ provider: p, kind: "claude-subscription" });
      }
    } else if (p === "codex") {
      // Codex has no 1-year-token analog: device-auth if not signed in; kept as-is under any mode.
      if (!cur?.authed) steps.push({ provider: p, kind: "codex-device" });
    }
    // cursor/grok/opencode: added when those providers ship (their CLI's login step).
  }
  return steps;
}
