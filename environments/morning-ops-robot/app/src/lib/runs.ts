import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Run, RunEvent } from "./types";

// The append-only run event log the scheduler + agent both write (ops-runs.jsonl).
const FILE = path.join(process.cwd(), ".podbay", "ops-runs.jsonl");
// A run still `running` past this long with no terminal event is presumed stalled
// (matches the scheduler's dead-man grace).
const STALL_GRACE_MS = 30 * 60_000;

async function readEvents(): Promise<RunEvent[]> {
  try {
    return (await fs.readFile(FILE, "utf8"))
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

/** Reduce events to per-run state; `stalled` is derived from the grace window. */
export function reduceRuns(events: RunEvent[], now = Date.now(), graceMs = STALL_GRACE_MS): Run[] {
  const map = new Map<string, Run>();
  for (const e of events) {
    const cur: Run = map.get(e.runId) ?? { runId: e.runId, jobId: e.jobId, status: "running" };
    if (e.jobName) cur.jobName = e.jobName;
    if (e.event === "started") {
      cur.startedAt = e.at;
    } else {
      cur.finishedAt = e.at;
      cur.status = e.event === "succeeded" ? "succeeded" : "failed";
      if (e.summary) cur.summary = e.summary;
    }
    map.set(e.runId, cur);
  }
  return [...map.values()]
    .map((r) => {
      if (r.status === "running" && r.startedAt && now - Date.parse(r.startedAt) > graceMs) {
        r.status = "stalled";
      }
      return r;
    })
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export async function listRuns(limit = 40): Promise<Run[]> {
  return reduceRuns(await readEvents()).slice(0, limit);
}

/** Append a terminal event (the agent reports a run succeeded/failed). */
export async function appendRunEvent(event: {
  runId: string;
  status: "succeeded" | "failed";
  summary?: string;
  jobId?: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const line: RunEvent = {
    runId: event.runId,
    jobId: event.jobId ?? "",
    event: event.status,
    at: new Date().toISOString(),
    summary: event.summary,
  };
  await fs.appendFile(FILE, JSON.stringify(line) + "\n");
}
