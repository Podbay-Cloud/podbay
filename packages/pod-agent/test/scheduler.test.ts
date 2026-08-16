import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runSchedulerTick,
  localParts,
  dueJobs,
  reduceRuns,
  type SchedulerOptions,
  type OpsJob,
} from "../src/scheduler.js";

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), "sched-"));
  return {
    dir,
    jobsPath: path.join(dir, "ops-jobs.json"),
    statePath: path.join(dir, "ops-state.json"),
    runsLogPath: path.join(dir, "ops-runs.jsonl"),
  };
}

function opts(
  p: ReturnType<typeof tmp>,
  now: Date,
  extra: Partial<SchedulerOptions> = {},
): { o: SchedulerOptions; injected: string[] } {
  const injected: string[] = [];
  const o: SchedulerOptions = {
    sessionName: "main",
    jobsPath: p.jobsPath,
    statePath: p.statePath,
    runsLogPath: p.runsLogPath,
    now: () => now,
    inject: async (text) => {
      injected.push(text);
      return true;
    },
    status: () => ({ status: "idle" }),
    makeRunId: (jobId) => `${jobId}-run`,
    // Default: boot at epoch 0, so every run counts as "this boot" (i.e. restart-awareness
    // is off unless a test opts in). Restart tests override this.
    bootTimeMs: 0,
    ...extra,
  };
  return { o, injected };
}

function writeJobs(p: ReturnType<typeof tmp>, jobs: OpsJob[]) {
  writeFileSync(p.jobsPath, JSON.stringify({ jobs }));
}

const brief: OpsJob = {
  id: "brief",
  name: "Morning brief",
  mode: "brief",
  schedule: { times: ["08:00"], timezone: "UTC" },
  enabled: true,
};
const watch: OpsJob = {
  id: "uptime",
  name: "Uptime",
  mode: "watch",
  schedule: { everyMinutes: 30, timezone: "UTC" },
  enabled: true,
};

describe("localParts", () => {
  it("formats date + HH:MM in the given timezone; falls back to UTC on a bad zone", () => {
    const inst = new Date("2026-07-22T06:30:00Z");
    expect(localParts(inst, "Europe/Berlin")).toEqual({ date: "2026-07-22", hhmm: "08:30", weekday: 3 });
    expect(localParts(inst, "Not/AZone")).toEqual({ date: "2026-07-22", hhmm: "06:30", weekday: 3 });
  });
  it("computes the weekday in the given timezone (0=Sun..6=Sat)", () => {
    expect(localParts(new Date("2026-08-03T12:00:00Z"), "UTC").weekday).toBe(1); // Monday
    // Sunday in UTC, but Monday in Asia/Jerusalem (UTC+3) — the LOCAL weekday wins.
    expect(localParts(new Date("2026-08-02T22:00:00Z"), "Asia/Jerusalem").weekday).toBe(1);
  });
});

describe("dueJobs", () => {
  it("daily-time job is due once the time passes, not before", () => {
    expect(dueJobs([brief], { jobs: {} }, new Date("2026-07-22T07:59:00Z"))).toHaveLength(0);
    expect(dueJobs([brief], { jobs: {} }, new Date("2026-07-22T08:01:00Z"))).toHaveLength(1);
  });
  it("interval job is due when everyMinutes elapsed since lastRunAt", () => {
    const state = { jobs: { uptime: { lastRunAt: "2026-07-22T08:00:00Z" } } };
    expect(dueJobs([watch], state, new Date("2026-07-22T08:20:00Z"))).toHaveLength(0);
    expect(dueJobs([watch], state, new Date("2026-07-22T08:31:00Z"))).toHaveLength(1);
  });
  it("disabled jobs never fire", () => {
    expect(dueJobs([{ ...brief, enabled: false }], { jobs: {} }, new Date("2026-07-22T09:00:00Z"))).toHaveLength(0);
  });
  it("a times job restricted to weekdays fires only on those days", () => {
    const mon = { ...brief, schedule: { times: ["08:00"], timezone: "UTC", days: [1] } };
    expect(dueJobs([mon], { jobs: {} }, new Date("2026-08-03T08:01:00Z"))).toHaveLength(1); // Monday
    expect(dueJobs([mon], { jobs: {} }, new Date("2026-08-04T08:01:00Z"))).toHaveLength(0); // Tuesday
    const wd = { ...brief, schedule: { times: ["08:00"], timezone: "UTC", days: [1, 2, 3, 4, 5] } };
    expect(dueJobs([wd], { jobs: {} }, new Date("2026-08-04T08:01:00Z"))).toHaveLength(1); // Tue (weekday)
    expect(dueJobs([wd], { jobs: {} }, new Date("2026-08-08T08:01:00Z"))).toHaveLength(0); // Sat (weekend)
  });
  it("no days restriction = every day (back-compat)", () => {
    expect(dueJobs([brief], { jobs: {} }, new Date("2026-08-08T08:01:00Z"))).toHaveLength(1); // Sat, still fires
  });
});

describe("reduceRuns", () => {
  it("marks a run terminal once a succeeded/failed event arrives", () => {
    const runs = reduceRuns([
      { runId: "r1", jobId: "brief", event: "started", at: "2026-07-22T08:00:00Z" },
      { runId: "r2", jobId: "uptime", event: "started", at: "2026-07-22T08:00:00Z" },
      { runId: "r1", jobId: "brief", event: "succeeded", at: "2026-07-22T08:05:00Z" },
    ]);
    expect(runs.get("r1")?.terminal).toBe(true);
    expect(runs.get("r2")?.terminal).toBeUndefined();
  });
});

describe("runSchedulerTick", () => {
  it("no-ops with no config / no jobs", async () => {
    const p = tmp();
    const { o } = opts(p, new Date("2026-07-22T08:00:00Z"));
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "no-config" });
    writeJobs(p, []);
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "no-jobs" });
  });

  it("fires a due job once, logs a started event, and doesn't re-fire it", async () => {
    const p = tmp();
    writeJobs(p, [brief]);
    const { o, injected } = opts(p, new Date("2026-07-22T08:00:30Z"));

    const r1 = await runSchedulerTick(o);
    expect(r1).toEqual({ fired: true, kind: "run", jobId: "brief", runId: "brief-run" });
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("brief-run");
    expect(injected[0]).toContain("Morning brief");
    expect(injected[0]).not.toContain("/api/runs"); // env-neutral: no hardcoded dashboard path
    // The turn MUST tell the agent to close the run — else a cleanly-finished generic job
    // (no playbook report rules) never gets a terminal event and the dead-man false-fires.
    expect(injected[0]).toContain("podbay schedule done brief-run");

    const r2 = await runSchedulerTick(o);
    expect(r2).toEqual({ fired: false, reason: "none-due" });
    expect(injected).toHaveLength(1);

    const events = readFileSync(p.runsLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events).toEqual([
      expect.objectContaining({ runId: "brief-run", jobId: "brief", event: "started" }),
    ]);
  });

  it("carries the job's instructions into the injected turn (env-neutral)", async () => {
    const p = tmp();
    writeJobs(p, [{ ...brief, instructions: "pull GSC week-over-week and message me" }]);
    const { o, injected } = opts(p, new Date("2026-07-22T08:00:30Z"));
    expect((await runSchedulerTick(o)).fired).toBe(true);
    expect(injected[0]).toContain("pull GSC week-over-week and message me");
    expect(injected[0]).not.toContain("/api/runs");
  });

  it("re-fires an interval job after the interval elapses", async () => {
    const p = tmp();
    writeJobs(p, [watch]);
    let now = new Date("2026-07-22T08:00:00Z");
    const { o, injected } = opts(p, now, { now: () => now });
    expect((await runSchedulerTick(o)).fired).toBe(true); // first run
    now = new Date("2026-07-22T08:20:00Z");
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "none-due" }); // too soon
    now = new Date("2026-07-22T08:31:00Z");
    expect((await runSchedulerTick(o)).fired).toBe(true); // interval elapsed
    expect(injected).toHaveLength(2);
  });

  it("defers when the agent is busy or a dialog is open", async () => {
    const p = tmp();
    writeJobs(p, [brief]);
    const { o } = opts(p, new Date("2026-07-22T08:00:30Z"), { status: () => ({ status: "busy" }) });
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "deferred" });
  });

  it("dead-man: alerts once for a run that started but never reported back", async () => {
    const p = tmp();
    writeJobs(p, [{ ...brief, enabled: false }]); // no job due
    // A run started 40 min ago, no terminal event.
    appendFileSync(
      p.runsLogPath,
      JSON.stringify({ runId: "stuck", jobId: "brief", event: "started", at: "2026-07-22T08:00:00Z" }) + "\n",
    );
    const { o, injected } = opts(p, new Date("2026-07-22T08:40:00Z"));
    const r = await runSchedulerTick(o);
    expect(r).toEqual({ fired: true, kind: "stall", runId: "stuck" });
    expect(injected[0]).toContain("Dead-man");
    // Fires once — a second tick doesn't re-alert.
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "none-due" });
    expect(injected).toHaveLength(1);
  });

  it("dead-man does NOT fire while within the grace window or after a terminal event", async () => {
    const p = tmp();
    writeJobs(p, [{ ...brief, enabled: false }]);
    appendFileSync(
      p.runsLogPath,
      JSON.stringify({ runId: "ok", jobId: "brief", event: "started", at: "2026-07-22T08:00:00Z" }) + "\n" +
        JSON.stringify({ runId: "ok", jobId: "brief", event: "succeeded", at: "2026-07-22T08:05:00Z" }) + "\n",
    );
    const { o } = opts(p, new Date("2026-07-22T09:00:00Z"));
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "none-due" });
  });

  it("does NOT dead-man a run interrupted by a pod RESTART (started before this boot)", async () => {
    const p = tmp();
    writeJobs(p, [{ ...brief, enabled: false }]); // no job due
    // A run started 40 min ago and never reported back — but the pod BOOTED after it
    // started (a restart killed the agent before it could report). This is not a stall.
    appendFileSync(
      p.runsLogPath,
      JSON.stringify({ runId: "interrupted", jobId: "brief", event: "started", at: "2026-07-22T08:00:00Z" }) + "\n",
    );
    const { o, injected } = opts(p, new Date("2026-07-22T08:40:00Z"), {
      bootTimeMs: Date.parse("2026-07-22T08:20:00Z"), // boot AFTER the run started
    });
    // No dead-man injected — closed out silently.
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "none-due" });
    expect(injected).toHaveLength(0);
    // And it's marked handled so a later tick never revisits it.
    const state = JSON.parse(readFileSync(p.statePath, "utf8")) as { stallAlerted?: string[] };
    expect(state.stallAlerted).toContain("interrupted");
    expect(await runSchedulerTick(o)).toEqual({ fired: false, reason: "none-due" });
    expect(injected).toHaveLength(0);
  });

  it("STILL dead-mans a run that genuinely hung THIS boot (started after boot)", async () => {
    const p = tmp();
    writeJobs(p, [{ ...brief, enabled: false }]);
    appendFileSync(
      p.runsLogPath,
      JSON.stringify({ runId: "hung", jobId: "brief", event: "started", at: "2026-07-22T08:00:00Z" }) + "\n",
    );
    const { o, injected } = opts(p, new Date("2026-07-22T08:40:00Z"), {
      bootTimeMs: Date.parse("2026-07-22T07:00:00Z"), // boot BEFORE the run started
    });
    expect(await runSchedulerTick(o)).toEqual({ fired: true, kind: "stall", runId: "hung" });
    expect(injected[0]).toContain("Dead-man");
  });
});
