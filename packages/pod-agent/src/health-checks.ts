/**
 * What is wrong with this pod, in the owner's terms.
 *
 * Pure so the RULES can be unit-tested without a live pod — the failure mode that
 * matters here is a check that stays quiet while the pod is broken (a false green
 * is worse than no check at all), and that is exactly what tests can pin.
 *
 * Two deliberate constraints:
 *  - **Green is empty.** No issue is emitted for a passing check; a healthy pod
 *    returns `[]` so surfaces can render nothing rather than a wall of green rows.
 *  - **Severity means treatment**, not drama: `critical` = the pod is unusable or
 *    about to be, `warn` = degraded and worth acting on, `info` = worth knowing in
 *    a report but not worth interrupting anyone.
 */

export type IssueSeverity = "critical" | "warn" | "info";

export interface PodIssue {
  /** Stable id so surfaces can dedupe/route without matching on prose. */
  id: string;
  severity: IssueSeverity;
  /** One line, phrased as the problem — not the check's name. */
  title: string;
  /** What it means / what to do. */
  detail: string;
  /** Whether a repair exists for it (doctor, or a cockpit action). */
  fixable: boolean;
  /** Set when the issue belongs to one agent, so its card can own it. */
  agent?: string;
}

export interface HealthInput {
  sessionAlive: boolean;
  agents: { id: string; window: number | null; authed: boolean }[];
  /** Targets the watchdog stopped trying to repair. */
  repairGaveUp: string[];
  /** Home volume. totalMb 0 = unknown (don't invent a disk problem). */
  disk: { usedMb: number; totalMb: number };
  /** RAM. availableMb from /proc/meminfo MemAvailable. Optional/absent → no memory
   * check (older callers, or unknown) — the OOM detector is the definitive signal;
   * this is only the early warning BEFORE a kill. */
  memory?: { availableMb: number; totalMb: number };
  /** The app port and whether anything listens, or null when not applicable.
   * Kept in the input (doctor and future surfaces may want it) but deliberately
   * NOT turned into an issue — see the note in computeIssues. */
  app: { port: number; listening: boolean } | null;
  /** Only meaningful when this pod declares scheduled jobs. */
  scheduler?: { expected: boolean; alive: boolean };
  /** Codex is on this pod and signed in, but its RC daemon binary is missing —
   * the pod CANNOT start remote control, however many times you ask it to. */
  codexRuntimeMissing?: boolean;
}

/** Below this share of free disk the pod is in trouble; most repairs need space. */
export const DISK_CRITICAL_FREE = 0.05;
export const DISK_WARN_FREE = 0.15;

/** Available-memory shares. Lower than disk because memory is dynamic — a build
 * legitimately runs hot — so we only warn when it is persistently tight, and never
 * call it "critical" on a single sample (the OOM kill is the critical signal). */
export const MEM_CRITICAL_FREE = 0.05;
export const MEM_WARN_FREE = 0.12;

const label = (agent: string): string =>
  agent === "codex" ? "Codex" : agent === "claude-code" ? "Claude" : agent;

export function computeIssues(input: HealthInput): PodIssue[] {
  const issues: PodIssue[] = [];

  // Disk first — it breaks the other repairs, so it must be fixed first and is
  // worth saying first.
  if (input.disk.totalMb > 0) {
    const free = (input.disk.totalMb - input.disk.usedMb) / input.disk.totalMb;
    if (free < DISK_CRITICAL_FREE) {
      issues.push({
        id: "disk-critical",
        severity: "critical",
        title: "This pod is almost out of disk",
        detail:
          "Under 5% free on the pod's home volume. Installs, builds and even repairs will start failing — clear caches or resize the pod.",
        fixable: true,
      });
    } else if (free < DISK_WARN_FREE) {
      issues.push({
        id: "disk-low",
        severity: "warn",
        title: "Disk is running low",
        detail: "Under 15% free on the pod's home volume.",
        fixable: true,
      });
    }
  }

  // Memory — the early warning before an OOM kill. Warn only (a build runs hot on
  // purpose); the actual kill is reported separately as a critical incident.
  if (input.memory && input.memory.totalMb > 0) {
    const free = input.memory.availableMb / input.memory.totalMb;
    if (free < MEM_CRITICAL_FREE) {
      issues.push({
        id: "memory-critical",
        severity: "warn",
        title: "This pod is nearly out of memory",
        detail:
          "Under 5% of RAM available. A build or a headless browser can push it over and the kernel will kill a process — consider resizing the pod.",
        fixable: false,
      });
    } else if (free < MEM_WARN_FREE) {
      issues.push({
        id: "memory-low",
        severity: "warn",
        title: "Memory is running low",
        detail: "Under 12% of RAM available; heavy builds may run out.",
        fixable: false,
      });
    }
  }

  if (!input.sessionAlive) {
    issues.push({
      id: "session-dead",
      severity: "critical",
      title: "The pod's terminal session died",
      detail:
        "Nothing is running on this pod. Podbay restarts it automatically; if it persists, suspend and resume the pod from the dashboard.",
      fixable: true,
    });
  }

  // A target the watchdog GAVE UP on outranks "not running": it says the pod
  // cannot fix itself, which is the thing the owner must know.
  for (const target of input.repairGaveUp) {
    // `startup:<slug>` = a supervised non-agent process (dev server / `podbay startup`
    // command) that kept dying — name it by the owner's own slug, and do NOT tag it as
    // an agent (that would make the cockpit render a phantom agent card).
    const startupSlug = target.startsWith("startup:") ? target.slice("startup:".length) : null;
    issues.push({
      id: `repair-gave-up:${target}`,
      severity: "critical",
      title:
        target === "session"
          ? "Podbay couldn't restart this pod's session"
          : startupSlug
            ? `${startupSlug === "dev-server" ? "The dev server" : `'${startupSlug}'`} keeps failing to start`
            : `Podbay couldn't restart ${label(target)}`,
      // Backing off ≠ given up: podbay retries on a spaced schedule, and the owner (or `doctor --fix`)
      // can recover it immediately. Point at real actions — NOT "restart the pod" (there is no such
      // button; the cockpit has Suspend/Resume).
      detail: startupSlug
        ? startupSlug === "dev-server"
          ? "It kept failing, so podbay backed off — it retries automatically. Recover it now with 'podbay dev restart' (or 'podbay doctor --fix')."
          : `It kept failing, so podbay backed off — it retries automatically. Recover it now with 'podbay startup restart ${startupSlug}' (or 'podbay doctor --fix').`
        : "It was restarted several times and kept failing, so Podbay backed off. Run 'podbay doctor --fix', or suspend and resume the pod from the dashboard.",
      // The startup/dev cases are recoverable now (doctor --fix restarts them); only the session case
      // isn't self-fixable from here.
      fixable: Boolean(startupSlug),
      ...(target === "session" || startupSlug ? {} : { agent: target }),
    });
  }

  for (const a of input.agents) {
    if (a.window !== null) continue;
    if (input.repairGaveUp.includes(a.id)) continue; // already reported, louder
    issues.push({
      id: `agent-not-running:${a.id}`,
      severity: "warn",
      title: `${label(a.id)} isn't running`,
      detail: "Its terminal window is gone. Podbay is restarting it.",
      fixable: true,
      agent: a.id,
    });
  }

  if (input.codexRuntimeMissing) {
    issues.push({
      id: "codex-runtime-missing",
      severity: "warn",
      title: "Codex remote control can’t start on this pod",
      detail:
        "The daemon Codex pairing needs was never installed here — pods that gained Codex after launch missed it. Update this pod (Settings → Update) and it will install.",
      fixable: false,
      agent: "codex",
    });
  }

  if (input.scheduler?.expected && !input.scheduler.alive) {
    issues.push({
      id: "scheduler-dead",
      severity: "warn",
      title: "Scheduled jobs aren't running",
      detail: "This pod has jobs configured, but the scheduler isn't alive to run them.",
      fixable: true,
    });
  }

  // NOTE: "nothing is serving the preview" is deliberately NOT an issue. The
  // preview card states it inline, immediately above, and reporting it here too
  // put the same sentence twice on one page (owner, 2026-07-29). A health report
  // that repeats what the page already says trains people to skim it.

  return issues;
}

/** The worst severity present, or null when the pod is healthy. */
export function worstSeverity(issues: PodIssue[]): IssueSeverity | null {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warn")) return "warn";
  if (issues.some((i) => i.severity === "info")) return "info";
  return null;
}
