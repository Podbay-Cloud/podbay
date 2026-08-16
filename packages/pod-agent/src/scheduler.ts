import { execFile } from "node:child_process";
import { appendFileSync, chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, type Logger } from "@podbay/shared/log";
import { sessionStateFromDisk, agentWindowTarget } from "./signals.js";

/**
 * In-pod scheduler for the operations-bot playbook (morning-ops-robot).
 *
 * The bot runs multiple named JOBS (a morning brief, a watch, a routine), each on
 * its own schedule — daily times OR a repeating interval. In the 24/7 model a
 * "run" is a turn INJECTED into the live agent session (not a headless `claude -p`
 * — that would spawn competing `--continue` transcripts in ~/work), gated on the
 * agent being idle. Reuses the greeter's type-then-Enter path.
 *
 * Run lifecycle is tracked in an append-only event log (ops-runs.jsonl): the
 * scheduler appends `started`; the agent appends `succeeded`/`failed` (via the
 * dashboard's /api/runs) once the routine finishes. A DEAD-MAN check surfaces a
 * run that started but never reported back — because a job that silently dies is
 * worse than one that fails loudly. (The EXTERNAL dead-man — a whole pod dying —
 * is a platform concern; a pod can't alert about its own death.)
 *
 * All durable state is on the persistent volume (~/.podbay, outside the git tree): the user-owned
 * jobs config, our scheduling bookkeeping, and the run log.
 */

const DEFAULT_INTERVAL_MS = 30_000;
/** A run that started but hasn't reported a terminal event in this long is
 * presumed stalled (dead-man). Generous — real routines can be slow. */
const DEFAULT_STALL_GRACE_MS = 30 * 60_000;

export type JobMode = "brief" | "watch" | "routine";

export interface JobSchedule {
  /** Daily local times ("HH:MM"). */
  times?: string[];
  /** OR a repeating interval in minutes (watch jobs). */
  everyMinutes?: number;
  /** IANA timezone for `times` (defaults UTC). */
  timezone?: string;
  /** Restrict `times` to these weekdays (0=Sun..6=Sat, in `timezone`). Absent = every
   * day. Lets a daily-time job be weekly (e.g. `[1]` = Mondays only). */
  days?: number[];
}

export interface OpsJob {
  id: string;
  name: string;
  mode: JobMode;
  schedule: JobSchedule;
  enabled: boolean;
  /** Free-text description of what to do when the job runs. Carried verbatim into the
   * injected turn so a generic pod's agent knows the task without a dashboard. Optional
   * for back-compat (the operations-bot playbook keeps its behavior via its rules). */
  instructions?: string;
}

interface JobsConfig {
  jobs: OpsJob[];
}

/** Per-job scheduling bookkeeping + which stalls we've already alerted (so a
 * dead-man fires once, not every tick). Separate from the user's jobs config. */
interface SchedulerState {
  jobs: Record<string, { ranDates?: Record<string, string[]>; lastRunAt?: string }>;
  stallAlerted?: string[];
}

interface RunEvent {
  runId: string;
  jobId: string;
  jobName?: string;
  event: "started" | "succeeded" | "failed";
  at: string;
  summary?: string;
}

export interface SchedulerOptions {
  /** tmux session to inject the run turn into (the pod's main session). */
  sessionName: string;
  /** User-authored jobs (JSON: JobsConfig). */
  jobsPath: string;
  /** Our scheduling bookkeeping (JSON: SchedulerState). */
  statePath: string;
  /** Append-only run event log (JSONL: RunEvent). */
  runsLogPath: string;
  uid?: number;
  gid?: number;
  logger?: Logger;
  intervalMs?: number;
  stallGraceMs?: number;
  /** Epoch ms of the current pod boot. A run that started before this was interrupted by
   * a restart, not stalled — so it must not trip the dead-man. Defaults to the real boot
   * time from os.uptime(); injectable for tests. */
  bootTimeMs?: number;
  // --- injection points (tests) ---
  now?: () => Date;
  inject?: (text: string) => Promise<boolean>;
  status?: () => { status?: string; waitingFor?: string };
  /** Build the turn that starts a job run (override in tests). */
  runTrigger?: (job: OpsJob, runId: string) => string;
  /** Build the turn that flags a stalled run. */
  stallTrigger?: (run: { jobId: string; runId: string; startedAt: string }) => string;
  /** Generate a run id (override in tests for determinism). */
  makeRunId?: (jobId: string) => string;
}

function defaultRunTrigger(job: OpsJob, runId: string): string {
  const what = job.instructions?.trim()
    ? `\n\nWhat to do:\n${job.instructions.trim()}`
    : ` Run it per its definition in ~/.podbay/ops-jobs.json.`;
  return (
    `Scheduled job "${job.name}" (id ${job.id}, run ${runId}).${what}\n\n` +
    `This is a scheduled run — do the job, don't re-onboard. When you finish, CLOSE THE RUN so it ` +
    `isn't flagged as stalled: run  \`podbay schedule done ${runId}\`  (or  \`podbay schedule done ` +
    `${runId} fail\`  if it failed). Then report the result per any scheduled-run rules in your ` +
    `environment. Closing the run is required on EVERY pod — without it the dead-man fires hours later.`
  );
}

function defaultStallTrigger(run: { jobId: string; runId: string; startedAt: string }): string {
  return (
    `Dead-man: job "${run.jobId}" (run ${run.runId}) started at ${run.startedAt} but never ` +
    `reported back. If it already finished, just close it: \`podbay schedule done ${run.runId}\`. ` +
    `If it's stuck, finish or abandon it, then \`podbay schedule done ${run.runId} fail\` and report ` +
    `the failure per your environment's scheduled-run rules.`
  );
}

/** Local "YYYY-MM-DD" and "HH:MM" for a moment in an IANA timezone. Falls back to
 * UTC on an invalid zone (never throw the scheduler down over a typo). */
export function localParts(
  now: Date,
  timezone?: string,
): { date: string; hhmm: string; weekday: number } {
  const tz = timezone || "UTC";
  const fmt = (opts: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }).format(now);
    } catch {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...opts }).format(now);
    }
  };
  const date = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
  const hhmm = fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24:/, "00:");
  // Weekday (0=Sun..6=Sat) of the LOCAL calendar date: getUTCDay of that date at UTC
  // midnight is stable regardless of time-of-day, so it needs no locale-name mapping.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, hhmm, weekday };
}

function isTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown, uid?: number, gid?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
  chownBestEffort(file, uid, gid);
}

function chownBestEffort(file: string, uid?: number, gid?: number): void {
  if (uid === undefined) return;
  try {
    chownSync(file, uid, gid ?? uid);
  } catch {
    /* best-effort */
  }
}

function readRunEvents(file: string): RunEvent[] {
  try {
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as RunEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is RunEvent => e !== null);
  } catch {
    return [];
  }
}

/** Reduce the event log to per-run state (last write wins for the terminal event). */
export function reduceRuns(events: RunEvent[]): Map<string, { jobId: string; startedAt?: string; terminal?: boolean }> {
  const runs = new Map<string, { jobId: string; startedAt?: string; terminal?: boolean }>();
  for (const e of events) {
    const cur = runs.get(e.runId) ?? { jobId: e.jobId };
    if (e.event === "started") cur.startedAt = e.at;
    else cur.terminal = true;
    runs.set(e.runId, cur);
  }
  return runs;
}

/** Jobs due to run now, given the schedule + what's already run. */
export function dueJobs(
  jobs: OpsJob[],
  state: SchedulerState,
  now: Date,
): Array<{ job: OpsJob; markTime?: string }> {
  const out: Array<{ job: OpsJob; markTime?: string }> = [];
  for (const job of jobs) {
    if (!job.enabled) continue;
    const js = state.jobs[job.id] ?? {};
    const { times, everyMinutes, timezone, days } = job.schedule ?? {};
    if (Array.isArray(times) && times.length > 0) {
      const { date, hhmm, weekday } = localParts(now, timezone);
      // Weekday restriction (absent = every day): skip on days not listed.
      if (Array.isArray(days) && days.length > 0 && !days.includes(weekday)) continue;
      const ranToday = new Set(js.ranDates?.[date] ?? []);
      const due = times.filter(isTime).filter((t) => t <= hhmm && !ranToday.has(t)).sort();
      if (due.length > 0) out.push({ job, markTime: due[0] });
    } else if (typeof everyMinutes === "number" && everyMinutes > 0) {
      const last = js.lastRunAt ? Date.parse(js.lastRunAt) : NaN;
      if (Number.isNaN(last) || now.getTime() - last >= everyMinutes * 60_000) out.push({ job });
    }
  }
  return out;
}

/** Record that a job just ran (per-day time, or interval timestamp). */
function markRan(state: SchedulerState, job: OpsJob, markTime: string | undefined, now: Date): void {
  const js = state.jobs[job.id] ?? {};
  if (markTime) {
    const { date } = localParts(now, job.schedule.timezone);
    const ranDates = js.ranDates ?? {};
    ranDates[date] = [...new Set([...(ranDates[date] ?? []), markTime])];
    js.ranDates = ranDates;
  } else {
    js.lastRunAt = now.toISOString();
  }
  state.jobs[job.id] = js;
}

export type TickResult =
  | { fired: false; reason: "no-config" | "no-jobs" | "none-due" | "deferred" }
  | { fired: true; kind: "run"; jobId: string; runId: string }
  | { fired: true; kind: "stall"; runId: string };

/**
 * One scheduler check. Fires at most one turn per tick (a job run, or — if none is
 * due — a dead-man stall alert), keeping the transcript clean. Pure w.r.t. its
 * injected now/inject/status; all durable state is on disk.
 */
export async function runSchedulerTick(opts: SchedulerOptions): Promise<TickResult> {
  const log = opts.logger ?? createLogger("pod-agent");
  const now = opts.now ?? (() => new Date());
  const inject = opts.inject ?? defaultInject(opts.sessionName, opts.uid, opts.gid);
  const status = opts.status ?? (() => sessionStateFromDisk());
  const runTrigger = opts.runTrigger ?? defaultRunTrigger;
  const stallTrigger = opts.stallTrigger ?? defaultStallTrigger;
  const graceMs = opts.stallGraceMs ?? DEFAULT_STALL_GRACE_MS;
  const makeRunId = opts.makeRunId ?? ((jobId: string) => `${jobId}-${now().getTime()}`);

  if (!existsSync(opts.jobsPath)) return { fired: false, reason: "no-config" };
  const cfg = readJson<JobsConfig>(opts.jobsPath, { jobs: [] });
  const jobs = Array.isArray(cfg.jobs) ? cfg.jobs : [];
  if (jobs.length === 0) return { fired: false, reason: "no-jobs" };

  const state = readJson<SchedulerState>(opts.statePath, { jobs: {} });
  const due = dueJobs(jobs, state, now());

  // Only inject when the agent can take a turn. busy/shell = working; a dialog eats
  // keystrokes. Defer to a later tick rather than interleave.
  const s = status();
  const canInject = !(s.status === "busy" || s.status === "shell") &&
    !(typeof s.waitingFor === "string" && /dialog/i.test(s.waitingFor));

  // 1) Fire the earliest-due job (one per tick).
  if (due.length > 0) {
    if (!canInject) {
      log.info("ops_run_deferred", { due: due.map((d) => d.job.id), status: s.status });
      return { fired: false, reason: "deferred" };
    }
    const { job, markTime } = due[0];
    const runId = makeRunId(job.id);
    await inject(runTrigger(job, runId));
    markRan(state, job, markTime, now());
    writeJson(opts.statePath, state, opts.uid, opts.gid);
    appendEvent(opts, { runId, jobId: job.id, jobName: job.name, event: "started", at: now().toISOString() });
    log.info("ops_run_injected", { jobId: job.id, runId, mode: job.mode });
    return { fired: true, kind: "run", jobId: job.id, runId };
  }

  // 2) No job due → dead-man: a run that started but never reported back.
  const runs = reduceRuns(readRunEvents(opts.runsLogPath));
  const alerted = new Set(state.stallAlerted ?? []);
  // A run that started BEFORE the current boot was interrupted by a pod restart, not
  // silently hung — the agent was killed mid-run and never got to append its terminal
  // event. That is an expected lifecycle event (and an idempotent job's next scheduled
  // run catches up), so it must NOT trip the dead-man. Close it out silently — mark it
  // handled so we stop re-checking it, but inject nothing. Without this, EVERY in-flight
  // run trips a false "never reported back" alarm 30 min after any restart.
  const bootTimeMs = opts.bootTimeMs ?? Date.now() - Math.floor(os.uptime() * 1000);
  for (const [runId, r] of runs) {
    if (r.terminal || alerted.has(runId) || !r.startedAt) continue;
    if (Date.parse(r.startedAt) < bootTimeMs) {
      alerted.add(runId);
      state.stallAlerted = [...alerted];
      writeJson(opts.statePath, state, opts.uid, opts.gid);
      log.info("ops_run_interrupted", { jobId: r.jobId, runId, startedAt: r.startedAt });
      continue;
    }
    if (now().getTime() - Date.parse(r.startedAt) < graceMs) continue;
    if (!canInject) return { fired: false, reason: "deferred" };
    await inject(stallTrigger({ jobId: r.jobId, runId, startedAt: r.startedAt }));
    state.stallAlerted = [...alerted, runId];
    writeJson(opts.statePath, state, opts.uid, opts.gid);
    log.info("ops_run_stalled", { jobId: r.jobId, runId });
    return { fired: true, kind: "stall", runId };
  }

  return { fired: false, reason: "none-due" };
}

function appendEvent(opts: SchedulerOptions, event: RunEvent): void {
  try {
    mkdirSync(path.dirname(opts.runsLogPath), { recursive: true });
    appendFileSync(opts.runsLogPath, JSON.stringify(event) + "\n");
    chownBestEffort(opts.runsLogPath, opts.uid, opts.gid);
  } catch {
    /* observability only */
  }
}

function defaultInject(sessionName: string, uid?: number, gid?: number) {
  const tmux = (args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFile("tmux", args, { maxBuffer: 1024 * 1024, uid, gid }, (err, stdout) =>
        resolve(err ? "" : stdout),
      );
    });
  return async (text: string): Promise<boolean> => {
    // Inject into the AGENT's window, not the active one — a scheduled job must
    // reach the agent even if the user has switched to a shell tab (cheap-tabs).
    const target = await agentWindowTarget(sessionName, { uid, gid });
    await tmux(["send-keys", "-t", target, "-l", text]);
    await new Promise((r) => setTimeout(r, 400));
    await tmux(["send-keys", "-t", target, "Enter"]);
    return true;
  };
}

/**
 * Start the scheduler loop. Returns a stop function. Safe to start unconditionally:
 * with no jobs config each tick no-ops, so only the ops-bot playbook — which writes
 * one — actually schedules runs.
 */
export function startScheduler(opts: SchedulerOptions): () => void {
  const log = opts.logger ?? createLogger("pod-agent");
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick(opts);
    } catch (e) {
      log.warn("ops_scheduler_tick_failed", { err: e });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
