import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Supervision for the pod's long-running NON-agent processes: the dev server and the
 * agent-declared `podbay startup` commands. init.sh launches them at boot with a bare
 * `nohup` — which means an OOM kill (or any crash) mid-run left them dead until the next
 * reboot: the preview went dark, workers silently vanished, and the only "recovery" was
 * the owner noticing. The agent itself is already watchdog-supervised; this extends the
 * same repair-policy loop (capped, backed off, attributed to OOM when one was just seen)
 * to everything else the pod is supposed to keep running.
 *
 * Semantics: STRICTLY "restart what died", never "start what never started". A process is
 * only respawned when its pidfile EXISTS and the pid is dead — a missing pidfile means
 * boot hasn't launched it yet (or the entry is new and unstarted), and racing init.sh at
 * boot would double-start it. Entries removed or disabled in startup.json are never
 * resurrected: the supervisor re-reads the declaration each pass.
 *
 * Pure parsing/assessment here; the spawn glue takes injected deps so it's testable.
 */

export interface StartupProcess {
  /** The user-chosen slug (repair target becomes `startup:<slug>`). */
  slug: string;
  command: string;
  cwd: string;
  pidfile: string;
  logfile: string;
  /** When set, skip respawn while this local TCP port answers — the dev server may be
   * running by hand (a tmux `pnpm dev`) without our pidfile, and binding twice breaks
   * the working copy. */
  probePort?: number;
}

/** Durable opt-out for the auto dev server. A pod that serves its OWN `:3000` (a production
 * `next start` via `podbay startup`, say) must be able to stop podbay from also launching `pnpm dev`
 * on the same port — otherwise the two race and `next dev` clobbers the prod `.next` in place (the
 * makore.app outage, 2026-08-18). `podbay dev disable` writes this file; `enable` removes it. Under
 * `~/.podbay` so it survives every restart (home persists). */
export function devServerDisabledPath(home: string): string {
  return `${home}/.podbay/dev-server-disabled`;
}

/** The dev-server special case (same file layout init.sh uses). Present only when the
 * workspace declares a `dev` script AND the durable disable flag is absent — mirroring init.sh's
 * own guards, so the supervisor and boot agree on exactly one owner of `:3000`. */
export function devServerProcess(
  home: string,
  work: string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
  exists: (p: string) => boolean = existsSync,
): StartupProcess | null {
  // Durably disabled (the pod serves its own :3000) → not ours to run or supervise.
  if (exists(devServerDisabledPath(home))) return null;
  try {
    const pkg = JSON.parse(readFile(`${work}/package.json`)) as { scripts?: Record<string, unknown> };
    if (typeof pkg.scripts?.dev !== "string") return null;
  } catch {
    return null;
  }
  return {
    slug: "dev-server",
    command: "pnpm dev",
    cwd: work,
    pidfile: `${home}/.podbay-dev.pid`,
    logfile: `${home}/.podbay-dev.log`,
    probePort: 3000,
  };
}

/** Parse ~/.podbay/startup.json into supervised processes (enabled, non-empty only). */
export function declaredStartupProcesses(
  home: string,
  work: string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): StartupProcess[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(`${home}/.podbay/startup.json`));
  } catch {
    return [];
  }
  const commands = (parsed as { commands?: unknown })?.commands;
  if (!Array.isArray(commands)) return [];
  const out: StartupProcess[] = [];
  for (const c of commands) {
    const slug = typeof (c as { slug?: unknown })?.slug === "string" ? (c as { slug: string }).slug : "";
    const command =
      typeof (c as { command?: unknown })?.command === "string" ? (c as { command: string }).command : "";
    const enabled = (c as { enabled?: unknown })?.enabled !== false;
    if (!slug || !command || !enabled) continue;
    // Slug doubles as a filename + repair target; init.sh created it, but be defensive.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(slug)) continue;
    out.push({
      slug,
      command,
      cwd: work,
      pidfile: `${home}/.podbay/startup/${slug}.pid`,
      logfile: `${home}/.podbay/startup/${slug}.log`,
    });
  }
  return out;
}

/**
 * Intentional-stop truce. When the agent deliberately restarts the dev server (e.g.
 * `podbay dev restart`, to reload a secret), the supervisor must NOT race to respawn the
 * process it just killed — that fight is what confused the first10 pod into hard-kills that
 * corrupted `.next` (2026-08-11). A pause sentinel per target carries an epoch-ms EXPIRY, so
 * a crashed restart can never wedge supervision off forever: once the expiry passes, normal
 * crash-recovery resumes on its own.
 */
export const SUPERVISE_PAUSE_DIR = "/home/dev/.podbay/supervise-pause";
export function pausePath(slug: string): string {
  return `${SUPERVISE_PAUSE_DIR}/${slug}`;
}

/** True while an intentional op holds this target paused — the sentinel exists and its
 * epoch-ms expiry is still in the future. Absent/expired/garbled → not paused (fail safe:
 * an unreadable sentinel must never disable recovery permanently). */
export function isSupervisionPaused(
  pausefile: string,
  now: number,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): boolean {
  let raw: string;
  try {
    raw = readFile(pausefile);
  } catch {
    return false;
  }
  const expiry = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(expiry) && now < expiry;
}

/** The build cache a `pnpm dev` (Next.js) leaves in the workspace. Hard-killing a dev server
 * mid-build corrupts it, turning a benign restart into a crash-loop; recovery deletes it. */
export function nextCacheDir(work: string): string {
  return `${work}/.next`;
}

/**
 * Whether to wipe the build cache before the next respawn of a process that keeps failing to
 * serve. Only for the dev server (the one with a build cache), and only after at least one
 * respawn that came up but never served — the corrupted-`.next` signature. A first failure
 * doesn't trigger it (the cause is usually a code error, not the cache).
 */
export function shouldCleanNextCache(p: StartupProcess, consecutiveFailedServes: number): boolean {
  return p.slug === "dev-server" && consecutiveFailedServes >= 1;
}

/**
 * Whether the process a pidfile points at is alive. Three-valued on purpose:
 *  - "alive"       → leave it alone
 *  - "dead"        → it ran and died → respawn candidate
 *  - "never-ran"   → no pidfile → NOT ours to start (boot owns first launch)
 */
export function pidfileState(
  pidfile: string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
  signal0: (pid: number) => void = (pid) => process.kill(pid, 0),
): "alive" | "dead" | "never-ran" {
  let raw: string;
  try {
    raw = readFile(pidfile);
  } catch {
    return "never-ran";
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 1) return "dead"; // corrupt pidfile = not running
  try {
    signal0(pid);
    return "alive";
  } catch {
    return "dead";
  }
}

export interface RespawnDeps {
  uid?: number;
  gid?: number;
  home: string;
  spawnFn?: typeof spawn;
  openLog?: (logfile: string) => number;
  writePidfile?: (pidfile: string, pid: number) => void;
}

/**
 * Relaunch a dead process the way init.sh started it: `bash -lc <command>` as the dev
 * user, cwd the workspace, output appended to its logfile, new pid recorded so the next
 * pass sees it alive. Detached — it must outlive a pod-agent restart, exactly like nohup.
 */
export function respawnStartupProcess(p: StartupProcess, deps: RespawnDeps): number {
  const openLog = deps.openLog ?? ((f: string) => openSync(f, "a"));
  const writePid = deps.writePidfile ?? ((f: string, pid: number) => writeFileSync(f, `${pid}\n`));
  const doSpawn = deps.spawnFn ?? spawn;
  const fd = openLog(p.logfile);
  try {
    const child = doSpawn("bash", ["-lc", p.command], {
      cwd: p.cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      ...(deps.uid != null ? { uid: deps.uid } : {}),
      ...(deps.gid != null ? { gid: deps.gid } : {}),
      // `bash -l` re-derives the login environment (profile, /etc/profile.d — where the
      // pod's secrets and PATH live); HOME/USER must be seeded since spawn(uid) doesn't.
      env: { HOME: deps.home, USER: "dev", LOGNAME: "dev", PATH: process.env.PATH ?? "" },
    });
    child.unref();
    if (child.pid) writePid(p.pidfile, child.pid);
    return child.pid ?? 0;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* fd already inherited by the child */
    }
  }
}
