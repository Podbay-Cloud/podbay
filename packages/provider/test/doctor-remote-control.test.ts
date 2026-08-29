import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http, { type Server } from "node:http";

const run = promisify(execFile);
const DOCTOR = new URL("../pod-base/podbay-doctor", import.meta.url).pathname;

/**
 * `check_remote_control` (task 3.4) reads the pod-agent's classified `rcState` (task 2.4/3.3) instead
 * of the old `authed && !rcActive` boolean, so doctor can tell a `login-required` case (only the
 * owner's `/login` can fix it — `--fix` must never call the restore endpoint) apart from a genuine
 * `down` (the one state `--fix` may repair) apart from `unknown` (insufficient evidence, not a
 * problem). See openspec/changes/rc-reconnect-hardening/specs/pod-agent/spec.md, "Requirement: Doctor
 * diagnoses RC state without competing logic".
 *
 * Follows doctor-report.test.ts's pattern: invoke the REAL bash script via execFile, but point
 * PODBAY_AGENT_URL at a tiny local http server that serves a scripted /healthz and records
 * /agent/rc-restore POSTs, so each scenario can assert both the reported issue AND (for --fix) whether
 * the restore endpoint was actually called.
 */

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

/**
 * A scripted /healthz + /agent/rc-restore mock. A single doctor invocation hits /healthz from
 * MULTIPLE call sites (import_agent_issues, then check_remote_control's pre- and post-fix reads), so
 * this can't be a simple "consume next response" queue — it models what the mock is actually
 * standing in for: the pod-agent's OWN state changes as a result of the restore call, not from an
 * arbitrary request counter. `before` is served until a POST to /agent/rc-restore lands, then every
 * subsequent GET serves `after` (defaults to `before` — i.e. the restore didn't help).
 */
async function startMock(before: unknown, after: unknown = before): Promise<{ url: string; restoreCalls: number }> {
  const state = { restoreCalls: 0, restored: false };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.restored ? after : before));
      return;
    }
    if (req.method === "POST" && req.url === "/agent/rc-restore") {
      state.restoreCalls += 1;
      state.restored = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rcState: "recovering" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    get restoreCalls() {
      return state.restoreCalls;
    },
  } as { url: string; restoreCalls: number };
}

/** A fresh PODBAY_HOME with claude-code declared as an agent and a valid (signed-in) credentials
 * file — the shared setup every scenario below needs before check_remote_control does anything. */
/**
 * Put the pod in "control yielded to an external harness" state.
 *
 * `registered` is the whole point: a REAL hand-over runs `podbay startup add --slug t3-code` BEFORE
 * it writes the marker (see startT3Enable), and that declaration is durable across restarts — so
 * "marker present, declaration absent" is not a legitimate yield, it is the wreckage of a failed
 * enable. Writing the marker alone (as this fixture used to) modelled a state the product never
 * actually produces.
 */
async function yieldToT3(home: string, opts: { registered: boolean }): Promise<void> {
  await fs.mkdir(path.join(home, ".podbay"), { recursive: true });
  await fs.writeFile(path.join(home, ".podbay", "claude-rc-off"), new Date().toISOString());
  await fs.writeFile(
    path.join(home, ".podbay", "startup.json"),
    JSON.stringify({
      commands: opts.registered ? [{ slug: "t3-code", command: "npx t3 serve", enabled: true }] : [],
    }),
  );
}

async function freshHome(): Promise<{ home: string; spec: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-rc-doctor-"));
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.writeFile(path.join(home, ".claude", ".credentials.json"), "{}");
  const spec = path.join(home, "pod-spec.json");
  await fs.writeFile(spec, JSON.stringify({ agents: ["claude-code"] }));
  return { home, spec };
}

async function runDoctor(
  home: string,
  spec: string,
  agentUrl: string,
  extraArgs: string[] = [],
): Promise<{ checked: number; issues: any[] }> {
  const { stdout } = await run(
    "bash",
    [DOCTOR, "--json", ...extraArgs],
    {
      env: {
        ...process.env,
        PODBAY_HOME: home,
        PODBAY_SPEC: spec,
        PODBAY_AGENT_URL: agentUrl,
        PODBAY_SESSION: `test-rc-${Math.random().toString(36).slice(2)}`,
      },
      maxBuffer: 4_000_000,
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout);
}

const rcHealthz = (rcState: string, authed = true) => ({
  agents: [{ id: "claude-code", authed, rcState, rcActive: rcState === "active" }],
});

describe("podbay doctor: remote-control lifecycle (rcState-aware)", () => {
  it("valid-login down → reports remote-control-down, and --fix succeeds when the restore actually helps", async () => {
    const { home, spec } = await freshHome();
    const mock = await startMock(rcHealthz("down"), rcHealthz("active"));

    const report = await runDoctor(home, spec, mock.url);
    const issue = report.issues.find((i: any) => i.id === "remote-control-down");
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe("warn");
    expect(issue.fixed).toBe(false);

    const fixed = await runDoctor(home, spec, mock.url, ["--fix"]);
    const fixedIssue = fixed.issues.find((i: any) => i.id === "remote-control-down");
    expect(fixedIssue).toBeTruthy();
    expect(fixedIssue.fixed).toBe(true);
    expect(mock.restoreCalls).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("valid-login down where --fix genuinely doesn't help → fixed stays false, never claimed true", async () => {
    const { home, spec } = await freshHome();
    // Every /healthz response (before AND after the restore attempt) still reports down.
    const mock = await startMock(rcHealthz("down"));

    const fixed = await runDoctor(home, spec, mock.url, ["--fix"]);
    const issue = fixed.issues.find((i: any) => i.id === "remote-control-down");
    expect(issue).toBeTruthy();
    expect(issue.fixed).toBe(false);
    expect(mock.restoreCalls).toBeGreaterThanOrEqual(1); // the attempt WAS made — it just didn't help
  }, 20_000);

  it("login-required → a distinct issue, and --fix does NOT call the restore endpoint at all", async () => {
    const { home, spec } = await freshHome();
    const mock = await startMock(rcHealthz("login-required"));

    const report = await runDoctor(home, spec, mock.url, ["--fix"]);
    const issue = report.issues.find((i: any) => i.id === "remote-control-login-required");
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe("warn");
    expect(issue.fixed).toBe(false);
    expect(report.issues.find((i: any) => i.id === "remote-control-down")).toBeFalsy();
    expect(mock.restoreCalls).toBe(0); // doctor cannot repair a login problem — must not even try
  }, 20_000);

  it("yielded to T3 → no remote-control issue at all (unchanged regression check)", async () => {
    const { home, spec } = await freshHome();
    await yieldToT3(home, { registered: true });
    // Even if the pod-agent reported "down", yielding short-circuits before it's ever read.
    const mock = await startMock(rcHealthz("down"));

    const report = await runDoctor(home, spec, mock.url, ["--fix"]);
    expect(report.issues.find((i: any) => String(i.id).startsWith("remote-control"))).toBeFalsy();
    expect(mock.restoreCalls).toBe(0);
  }, 20_000);

  it("an ORPHANED yield (marker with no harness registered) is reported and repaired", async () => {
    // A T3 enable that fails can leave the marker with nothing behind it. Every RC path returns early
    // on that marker, so the pod silently has no remote control and never greets again — and doctor
    // used to read it as intentional and report green. podbay `first10` sat like this for six days
    // (2026-08-23 → 2026-08-29). The witness is the DURABLE `t3-code` startup declaration, which a
    // real hand-over always writes BEFORE the marker.
    const { home, spec } = await freshHome();
    await yieldToT3(home, { registered: false });
    // Down while the stale marker is blocking every RC path; active once the repair clears it and
    // the restore it had been gating actually runs — the real sequence on a stranded pod.
    const mock = await startMock(rcHealthz("down"), rcHealthz("active"));

    const report = await runDoctor(home, spec, mock.url, ["--fix"]);
    const issue = report.issues.find((i: any) => i.id === "remote-control-yield-orphan");
    expect(issue).toBeTruthy();
    expect(issue.fixed).toBe(true);
    // The stale marker is GONE, so the greeter and the RC paths stop short-circuiting on it.
    await expect(fs.access(path.join(home, ".podbay", "claude-rc-off"))).rejects.toThrow();
    // …and the repair goes on to restore RC, which the marker had been blocking.
    expect(mock.restoreCalls).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("does NOT report an orphan when no marker is present at all", async () => {
    const { home, spec } = await freshHome();
    await fs.mkdir(path.join(home, ".podbay"), { recursive: true });
    await fs.writeFile(path.join(home, ".podbay", "startup.json"), JSON.stringify({ commands: [] }));
    const mock = await startMock(rcHealthz("active"));

    const report = await runDoctor(home, spec, mock.url, []);
    expect(report.issues.find((i: any) => i.id === "remote-control-yield-orphan")).toBeFalsy();
  }, 20_000);

  it("an older pod image with no rcState field at all → falls back sanely, never claims active", async () => {
    const { home, spec } = await freshHome();
    const mock = await startMock(
      { agents: [{ id: "claude-code", authed: true, rcActive: false }] }, // no rcState key
    );

    const report = await runDoctor(home, spec, mock.url, ["--fix"]);
    // Absent rcState is treated as unknown (never guessed down or active) — this repo's chosen
    // idiom for "unknown" in doctor's plain-text output is silence (see check_remote_control's
    // comment), so there should be no remote-control-* issue and no crash.
    expect(report.issues.find((i: any) => String(i.id).startsWith("remote-control"))).toBeFalsy();
    expect(mock.restoreCalls).toBe(0);
  }, 20_000);
});
