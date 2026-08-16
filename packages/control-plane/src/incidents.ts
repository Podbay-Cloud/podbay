import type { PodEventType } from "./types.js";

/**
 * Turn a raw pod event into an incident: its severity, a plain-language message, whether
 * it was unplanned, whether it restarted the agent, and any recommended action.
 *
 * Pure over (type, meta) so the whole classification is testable without a database — and
 * so the message the owner reads is derived in ONE place rather than sprinkled through the
 * UI, the resume nudge, and the Telegram sender. The event row stays (type, meta); severity
 * and message are DERIVED here, not stored, so tuning the wording is a code change, not a
 * migration.
 */

export type Severity = "info" | "warn" | "critical";

export interface Incident {
  severity: Severity;
  /** One line, phrased as the fact/problem, for the owner. No check names. */
  title: string;
  /** An unplanned incident (vs normal/planned lifecycle) — drives whether it alerts. */
  unplanned: boolean;
  /** The event restarted the agent — these are delivered in-session on resume. */
  restartCausing: boolean;
  /** A recommended fix the UI/resume-nudge turns into a real link. */
  action?: { kind: "resize"; reason: string };
}

function str(meta: Record<string, unknown> | null | undefined, k: string): string {
  return meta && typeof meta[k] === "string" ? (meta[k] as string) : "";
}

const RESIZE = (reason: string) => ({ kind: "resize" as const, reason });

/**
 * The one map from event → incident. Unlisted types fall through to a quiet info row, so a
 * new event type never crashes a reader; it just isn't dressed up until added here.
 */
export function classifyEvent(type: PodEventType | string, meta?: Record<string, unknown> | null): Incident {
  const base = { unplanned: false, restartCausing: false };
  switch (type) {
    // ── Unplanned incidents ────────────────────────────────────────────────
    case "oom_killed": {
      // The agent (or its group) being the victim means the owner's work was interrupted.
      if (meta?.victimIsAgent === true) {
        return {
          severity: "critical",
          title: "This pod ran out of memory and your session was restarted",
          unplanned: true,
          restartCausing: true,
          action: RESIZE("out of memory during your work"),
        };
      }
      // A NON-agent process hit the cgroup memory cap and was killed; the agent and pod kept
      // running, so the owner lost nothing. Keep it a warn (the resize hint still helps if it
      // recurs) but word it calmly — and do NOT surface the raw cgroup name (session-*.scope /
      // *.slice), which is noise to an owner, not a process they'd recognize.
      return {
        severity: "warn",
        title: "A background process hit the memory limit and was stopped — your agent kept running",
        unplanned: true,
        restartCausing: false,
        action: RESIZE("a background process ran out of memory"),
      };
    }
    case "pod_repaired": {
      const cause = str(meta, "cause");
      // A supervised NON-agent process (dev server / `podbay startup` command) was
      // restarted — the agent kept running, so word it calmly and name the process
      // (the slug is the owner's own chosen name, unlike a raw cgroup path).
      const target = str(meta, "target");
      if (target.startsWith("startup:")) {
        const name = target.slice("startup:".length);
        const what = name === "dev-server" ? "Your dev server" : `Your background process '${name}'`;
        if (cause === "oom") {
          return {
            severity: "warn",
            title: `${what} ran out of memory and was restarted automatically`,
            unplanned: true,
            restartCausing: false,
            action: RESIZE(`'${name}' ran out of memory`),
          };
        }
        return {
          severity: "warn",
          title: `${what} stopped and was restarted automatically`,
          unplanned: true,
          restartCausing: false,
        };
      }
      if (cause === "oom") {
        return {
          severity: "critical",
          title: "This pod ran out of memory and your agent was restarted",
          unplanned: true,
          restartCausing: true,
          action: RESIZE("out of memory"),
        };
      }
      return {
        severity: "warn",
        title: "Your agent stopped unexpectedly and was restarted",
        unplanned: true,
        restartCausing: true,
      };
    }
    case "repair_gave_up":
      return {
        severity: "critical",
        title: "Your agent keeps failing to start — the pod needs attention",
        unplanned: true,
        restartCausing: true,
      };
    case "error":
      return {
        severity: "critical",
        title: "This pod failed to start",
        unplanned: true,
        restartCausing: false,
      };
    case "update_failed":
      return { severity: "critical", title: "A pod update failed", unplanned: true, restartCausing: false };
    case "resize_failed":
      return { severity: "critical", title: "A pod resize failed", unplanned: true, restartCausing: false };

    // ── Planned lifecycle (info; some restart the agent and must be explained) ──
    case "updated":
      return {
        severity: "info",
        // Today every update is owner-initiated, so attribute it to the owner. When
        // Podbay gains automatic updates, branch on meta.reason to say "Podbay updated…".
        title: "You updated this pod and it restarted",
        unplanned: false,
        restartCausing: true,
      };
    case "resized":
      return {
        severity: "info",
        title: `Your pod was resized${str(meta, "size") ? ` to ${str(meta, "size")}` : ""} and restarted`,
        unplanned: false,
        restartCausing: true,
      };
    case "created":
      return { severity: "info", title: "Pod created", ...base };
    case "running":
      return {
        severity: "info",
        title: str(meta, "reason") === "reconciled" ? "Back online after a restart" : "Pod is running",
        ...base,
      };
    case "sleeping": // legacy alias for "suspended" (pre-2026-08-02 rename)
    case "suspended": {
      // A `reconciled` sleep is the platform observing the pod restart (update,
      // reboot) — NOT the owner suspending, and NOT a crash. Only a manual/bare
      // sleep is a real owner suspend. Neither is unplanned trouble.
      const reason = str(meta, "reason");
      if (reason === "reconciled")
        return { severity: "info", title: "Restarted (update or reboot)", ...base, restartCausing: true };
      if (reason === "idle") return { severity: "info", title: "Pod is running", ...base };
      return { severity: "info", title: "You suspended this pod", ...base };
    }
    case "destroyed":
      return { severity: "info", title: "Pod destroyed", ...base };
    case "agent_added": {
      const a = str(meta, "agent");
      const who = a === "codex" ? "Codex" : a === "claude-code" ? "Claude" : "An agent";
      return { severity: "info", title: `${who} was added to this pod`, ...base };
    }
    case "codex_rc_toggled":
      return { severity: "info", title: `Codex remote control turned ${meta?.on ? "on" : "off"}`, ...base };
    case "admin_action":
      return { severity: "info", title: `Admin action${str(meta, "action") ? `: ${str(meta, "action")}` : ""}`, ...base };
    case "update_started":
    case "update_stage":
      return { severity: "info", title: "Updating this pod…", ...base };
    case "resize_started":
      return { severity: "info", title: "Resizing this pod…", ...base };
    case "secret_revealed":
      // "Viewed" (not "revealed the value of") — calmer and short enough for one mobile line.
      return {
        severity: "info",
        title: str(meta, "key") ? `Viewed ${str(meta, "key")}` : "Viewed a secret",
        ...base,
      };
    case "secrets_exported": {
      const n = str(meta, "count");
      return {
        severity: "info",
        title: n ? `You exported ${n} secret${n === "1" ? "" : "s"}` : "You exported this pod's secrets",
        ...base,
      };
    }

    default:
      // De-underscore + capitalize so a not-yet-dressed type reads as English
      // ("some_new_event" → "Some new event"), never a raw slug in the timeline.
      return {
        severity: "info",
        title: String(type)
          .replace(/_/g, " ")
          .replace(/^./, (c) => c.toUpperCase()),
        ...base,
      };
  }
}

/** Severity ordering, so a "worst first" sort is one comparator. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warn: 2, info: 1 };
