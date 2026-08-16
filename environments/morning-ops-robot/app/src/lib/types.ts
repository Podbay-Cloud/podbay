// The operations-bot data model. Jobs live in the scheduler's config
// (~/.podbay/ops-jobs.json); runs are reduced from its append-only event log
// (ops-runs.jsonl); alerts + digests are JSON stores under ./data. The agent
// writes runs/alerts/digests via the API during each job run.

export type JobMode = "brief" | "watch" | "routine";

export interface JobSchedule {
  times?: string[]; // daily "HH:MM" local
  everyMinutes?: number; // OR a repeating interval
  timezone?: string; // IANA
}

export interface Job {
  id: string;
  name: string;
  mode: JobMode;
  schedule: JobSchedule;
  enabled: boolean;
  /** What the job does (the agent authors this; shown for context). */
  instructions?: string;
}

/** A line in ops-runs.jsonl. Scheduler appends `started`; agent appends terminal. */
export interface RunEvent {
  runId: string;
  jobId: string;
  jobName?: string;
  event: "started" | "succeeded" | "failed";
  at: string; // ISO
  summary?: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "stalled";

/** A run reduced from its events (status incl. `stalled` computed at read time). */
export interface Run {
  runId: string;
  jobId: string;
  jobName?: string;
  startedAt?: string;
  finishedAt?: string;
  status: RunStatus;
  summary?: string;
}

export type Severity = "info" | "warning" | "critical";
export type AlertState = "firing" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  at: string; // ISO
  severity: Severity;
  title: string;
  detail?: string;
  state: AlertState;
  jobId?: string;
  /** Stable key so one ongoing problem is one alert (watch-and-alert dedupe). */
  dedupeKey?: string;
}

/** A daily operations digest — the aggregated morning brief. */
export interface Digest {
  id: string;
  date: string; // local "YYYY-MM-DD"
  summary: string;
  changed: string[];
  needsAttention: string[];
  actions: string[];
  createdAt: string; // ISO
}
