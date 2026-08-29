/**
 * The SHARED pod visual-state derivation — one source of truth for the dashboard card AND the pod
 * page, so a pod reads the same (status word, dot colour, agent activity) in both places. Pure
 * functions over lifecycle status + live signals; no React, no JSX, so it's trivially testable.
 */

/** Live signals for one pod, serialized from control-plane PodLiveSignals. All fields degrade to
 * null/absent when the pod didn't answer or runs an older image — callers then render from lifecycle
 * status alone and CLAIM nothing live. */
export interface PodCardLive {
  /** Server lifecycle status at poll time — keeps status current between full reloads. */
  status?: string;
  updating?: boolean;
  agentStatus: string | null;
  /** Codex activity (`busy` | `idle` | null) from its rollout-log mtime. */
  codexStatus?: string | null;
  agentWaitingFor: string | null;
  /** The agent's true idle duration in ms (session-file mtime) — the accurate basis for the
   * idle-update dwell + label; null when the pod doesn't report it. */
  agentIdleMs?: number | null;
  agents: { id: string; authed: boolean; loginExpired?: boolean; needsReauth?: boolean; expiresAt?: number | null }[];
  appListening: boolean | null;
  criticalIssue: { title: string; detail: string } | null;
  unreachable: boolean;
}

/** One visual state for the spine + pill, derived from lifecycle + live signals. */
export function deriveState(
  status: string,
  updating: boolean,
  live: PodCardLive | null | undefined,
  hasClaude: boolean,
  t3?: { control?: boolean; enabling?: boolean } | null,
): {
  spine: string;
  chip: { label: string; className: string; dot: string; pulse?: boolean } | null; // null → lifecycle badge
  activity: { text: string; dot: string } | null; // the agent line, in words
  ribbon: string | null;
} {
  const NEED = { chip: "border-warning/45 bg-warning/10 text-warning", dot: "bg-warning" };
  const WORK = { chip: "border-success/40 bg-success/10 text-success", dot: "bg-success" };
  const WAIT = { chip: "border-sky-400/35 bg-sky-400/10 text-sky-400", dot: "bg-sky-400" };
  const IDLE = { chip: "border-border bg-white/[0.04] text-muted-foreground", dot: "bg-muted-foreground/70" };
  const BAD = { chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" };
  // T3 uses its OWN `external` token (violet), NOT `enable` (sky #38bdf8): `enable` is the
  // enable/connect BUTTON affordance and is the identical hex to WAIT's sky-400 above, so reusing it
  // here made "T3 Code" and "Waiting for you" pixel-identical chips separable only by their label
  // (owner report, 2026-08-27). Two different states must never share a colour.
  const T3 = { chip: "border-external/40 bg-external/10 text-external", dot: "bg-external" };

  // T3 Code state outranks every Claude-session/agent signal below — while T3 owns the pod its Claude
  // agent reads as not-signed-in (its RC is yielded to T3), which would otherwise render as "Needs you
  // — Claude needs sign-in". An in-flight IMAGE update still wins (it's handled after this via the
  // `!updating` guard / the lifecycle branch), but nothing else does. Independent of `live`, because
  // the state is durable and should show the moment the card renders, not only once signals arrive.
  if (!updating && status === "running" && t3?.enabling)
    return { spine: "bg-external", chip: { label: "Enabling T3…", className: T3.chip, dot: T3.dot, pulse: true }, activity: { text: "enabling T3 Code", dot: T3.dot }, ribbon: null };
  if (!updating && status === "running" && t3?.control)
    return { spine: "bg-external", chip: { label: "T3 Code", className: T3.chip, dot: T3.dot }, activity: { text: "in T3 Code control", dot: T3.dot }, ribbon: null };

  if (status === "running" && !updating && live) {
    if (live.unreachable)
      return {
        spine: "bg-destructive",
        chip: { label: "Unreachable", className: BAD.chip, dot: BAD.dot },
        activity: null,
        ribbon: "The pod isn't answering — it reports as running but its agent can't be reached",
      };
    // An EXPIRED agent login outranks activity: a logged-out agent reads as "idle" from its status
    // signal, so without this the card would call a signed-out pod fine. Show it as a "needs you"
    // state (amber, pulsing) so it's visible from the dashboard, not just deep in the cockpit.
    const expiredAgent = live.agents?.find((a) => a.loginExpired || a.needsReauth);
    if (expiredAgent) {
      const who = expiredAgent.id === "codex" ? "Codex" : "Claude";
      return {
        spine: "bg-warning",
        chip: { label: "Sign-in expired", className: NEED.chip, dot: NEED.dot, pulse: true },
        activity: { text: `${who} sign-in expired — reconnect`, dot: NEED.dot },
        ribbon: `${who}'s sign-in has expired — reconnect it in the pod's Control tab`,
      };
    }
    // An agent that is simply NOT SIGNED IN (authed:false, and not the expired case above) sits at the
    // /login screen — a "needs sign-in", NOT a command approval. Its `agentWaitingFor:"dialog open"` is
    // the LOGIN dialog; without catching it here it fell through to the generic dialog branch below and
    // mislabeled a signed-out pod as "asking to approve a command" (first10, 2026-08-24).
    const signInAgent = live.agents?.find((a) => !a.authed && !a.loginExpired && !a.needsReauth);
    if (signInAgent) {
      const who = signInAgent.id === "codex" ? "Codex" : "Claude";
      return {
        spine: "bg-warning",
        chip: { label: "Needs you", className: NEED.chip, dot: NEED.dot, pulse: true },
        activity: { text: `${who} needs sign-in`, dot: NEED.dot },
        ribbon: `${who} needs to sign in — open the pod to finish signing in`,
      };
    }
    // A login nearing its hard expiry (but not yet expired) — a subtle amber ribbon so the pod still
    // shows its real activity, but "reconnect soon" is visible from the dashboard. ~7-day window; the
    // pod-agent's own tiered warning drives the cockpit. See docs/strategy/agent-auth-lifecycle.md.
    const EXPIRING_MS = 7 * 24 * 60 * 60 * 1000;
    const expiring = live.agents?.find(
      (a) => !a.loginExpired && !a.needsReauth && a.expiresAt != null && a.expiresAt > Date.now() && a.expiresAt - Date.now() < EXPIRING_MS,
    );
    const expiringRibbon = expiring
      ? `${expiring.id === "codex" ? "Codex" : "Claude"}'s login expires in ~${Math.max(1, Math.round((expiring.expiresAt! - Date.now()) / (24 * 60 * 60 * 1000)))}d — reconnect soon in the Control tab`
      : null;
    const ribbon = live.criticalIssue ? live.criticalIssue.title : expiringRibbon;
    // Only a genuine CRITICAL issue reddens the spine; a merely-expiring login stays its normal colour.
    const spineFor = (base: string) => (live.criticalIssue ? "bg-destructive" : base);
    // agentStatus/agentWaitingFor is CLAUDE's activity signal — never apply it to a Codex-only pod
    // (which has none). Its state comes from codexStatus instead, and the SPINE must match the
    // codexChip the render shows: green when Working, the same soft grey as Claude-idle when Idle.
    if (!hasClaude)
      return {
        spine: spineFor(live.codexStatus === "busy" ? "bg-success" : "bg-[#526079]"),
        chip: null,
        activity: null,
        ribbon,
      };
    const dialog = typeof live.agentWaitingFor === "string" && /dialog/i.test(live.agentWaitingFor);
    if (dialog)
      return {
        spine: spineFor("bg-warning"),
        chip: { label: "Needs you", className: NEED.chip, dot: NEED.dot, pulse: true },
        activity: { text: "asking to approve a command", dot: NEED.dot },
        ribbon,
      };
    switch (live.agentStatus) {
      // `shell` (the agent running a shell command) IS working — fold it into busy so
      // it's green "Working", not a separate sky state that collided with "Waiting".
      case "busy":
      case "shell":
        return {
          spine: spineFor("bg-success"),
          chip: { label: "Working", className: WORK.chip, dot: WORK.dot, pulse: true },
          activity: { text: "working", dot: WORK.dot },
          ribbon,
        };
      case "waiting":
        return {
          spine: spineFor("bg-sky-400"),
          chip: { label: "Waiting for you", className: WAIT.chip, dot: WAIT.dot },
          activity: { text: "waiting for your reply", dot: WAIT.dot },
          ribbon,
        };
      case "idle":
        return {
          // Idle = running but quiet — a VISIBLE soft grey (was too dim, read as
          // suspended). Suspended (below) gets the dimmer tone; the two are swapped.
          spine: spineFor("bg-[#526079]"),
          chip: { label: "Idle", className: IDLE.chip, dot: IDLE.dot },
          activity: { text: "idle", dot: IDLE.dot },
          ribbon,
        };
      default:
        return { spine: spineFor("bg-success/50"), chip: null, activity: null, ribbon };
    }
  }
  // Not running with usable live signals: lifecycle drives the card. The spine tone
  // MIRRORS StatusDot's tones (pod-status.tsx) so the card and the pod page agree — and
  // an in-flight update is AMBER while a suspended pod is muted grey, never the same.
  if (updating) return { spine: "bg-warning", chip: null, activity: null, ribbon: null };
  const spine =
    status === "error" || status === "gone"
      ? "bg-destructive"
      : status === "suspended"
        ? "bg-border" // dim/off — resting, and dimmer than idle (swapped per feedback)
        : status === "running"
          ? "bg-success/60"
          : "bg-warning"; // provisioning / waking / destroying
  return { spine, chip: null, activity: null, ribbon: null };
}

/** Codex's own pill — the SAME Working/Idle vocabulary Claude gets (pairing shows separately as
 * device pills). Only for a reachable, non-onboarding, Codex-ONLY pod; null otherwise. */
export function codexChipFor(input: {
  reachable: boolean;
  onboarding: boolean;
  hasClaude: boolean;
  agents: string[];
  codexStatus: string | null;
}): { label: string; className: string } | null {
  if (!(input.reachable && !input.onboarding && !input.hasClaude && input.agents.includes("codex")))
    return null;
  return input.codexStatus === "busy"
    ? { label: "Working", className: "text-success bg-success/12" }
    : { label: "Idle", className: "text-muted-foreground bg-white/[0.05]" };
}

