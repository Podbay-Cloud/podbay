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
  agents: { id: string; authed: boolean }[];
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

  if (status === "running" && !updating && live) {
    if (live.unreachable)
      return {
        spine: "bg-destructive",
        chip: { label: "Unreachable", className: BAD.chip, dot: BAD.dot },
        activity: null,
        ribbon: "The pod isn't answering — it reports as running but its agent can't be reached",
      };
    const ribbon = live.criticalIssue ? live.criticalIssue.title : null;
    const spineFor = (base: string) => (ribbon ? "bg-destructive" : base);
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

