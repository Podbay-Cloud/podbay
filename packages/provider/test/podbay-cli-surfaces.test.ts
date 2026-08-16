import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pod-base", "podbay");

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-surf-"));
  env = {
    ...process.env,
    PODBAY_RELAY_STATE: path.join(dir, "relay.json"),
    PODBAY_SECRETS_ENV: path.join(dir, "secrets.env"),
    PODBAY_OPS_JOBS: path.join(dir, "ops-jobs.json"),
    PODBAY_OPS_RUNS: path.join(dir, "ops-runs.jsonl"),
  };
});

const run = (args: string[]) => execFileSync("bash", [cli, ...args], { env, encoding: "utf8" });

describe("podbay relay status", () => {
  it("says a relay is not configured, and what that means for a fetch", () => {
    // An agent needs to know BEFORE it tries, so it can report a source as pending
    // rather than discovering the gap mid-task.
    const out = run(["relay", "status"]);
    expect(out).toMatch(/not configured/);
    expect(out).toMatch(/pending, not fail silently/);
  });

  it("distinguishes configured-but-offline from connected", async () => {
    // The owner's machine sleeps; that is not the same as never having set one up,
    // and conflating them would send someone to the wrong fix.
    const p = env.PODBAY_RELAY_STATE as string;
    await fs.writeFile(p, JSON.stringify({ connected: false, domains: ["reddit.com"] }));
    expect(run(["relay", "status"])).toMatch(/configured but not connected/);

    await fs.writeFile(p, JSON.stringify({ connected: true, domains: ["reddit.com"], since: "10:02" }));
    const on = run(["relay", "status"]);
    expect(on).toMatch(/connected since 10:02/);
    expect(on).toMatch(/reddit\.com/);
    expect(on).toMatch(/relay check/); // points at the live exit-identity verification
  });

  it("`relay check` reports fail-closed (non-zero) when no relay is serving — never a false 'ok'", () => {
    // The whole point (afisha-crawler 2026-08-08): a workload must be able to VERIFY the live
    // exit identity, not trust "connected". With no proxy + an unreachable echo the probe can't
    // measure an exit, so it MUST say fail-closed and exit non-zero, never claim egress is fine.
    const checkEnv = { ...env, PODBAY_RELAY_ECHO: "http://127.0.0.1:1/x", PODBAY_RELAY_PROXY: "" };
    let out = "";
    let code = 0;
    try {
      out = execFileSync("bash", [cli, "relay", "check"], { env: checkEnv, encoding: "utf8" });
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer | string; status?: number };
      out = String(err.stdout ?? "");
      code = err.status ?? 1;
    }
    expect(out).toMatch(/fail-closed/);
    expect(code).not.toBe(0);
  });
});

describe("podbay secrets list", () => {
  it("prints NAMES and set-ness, never a value", async () => {
    // The whole point: an agent needs to know which keys exist to pick a rung or
    // explain what is missing, and never needs to read one — the value is already in
    // its environment when it actually uses it.
    await fs.writeFile(
      env.PODBAY_SECRETS_ENV as string,
      ["# comment", "export OPENAI_API_KEY=sk-super-secret-value-1234", "WEBFETCH_JINA_KEY=jina_abcdefgh", ""].join("\n"),
    );
    const out = run(["secrets", "list"]);
    expect(out).toMatch(/OPENAI_API_KEY\s+set/);
    expect(out).toMatch(/WEBFETCH_JINA_KEY\s+set/);
    expect(out).not.toMatch(/sk-super-secret-value-1234|jina_abcdefgh/);
  });

  it("marks a declared-but-empty secret so the gap is visible", async () => {
    await fs.writeFile(env.PODBAY_SECRETS_ENV as string, "REDDIT_CLIENT_ID=\n");
    expect(run(["secrets", "list"])).toMatch(/REDDIT_CLIENT_ID\s+EMPTY/);
  });

  it("says so plainly when there is nothing to list", async () => {
    await fs.writeFile(env.PODBAY_SECRETS_ENV as string, "# only a comment\n");
    expect(run(["secrets", "list"])).toMatch(/no secrets set/);
  });

  it("refuses any verb that could imply reading a value", () => {
    expect(() => run(["secrets", "get", "OPENAI_API_KEY"])).toThrow();
  });
});

describe("podbay secrets — self-correcting guidance (regression: agent tried a nonexistent 'set')", () => {
  // Capture stderr/stdout from a command that exits non-zero.
  const runFail = (args: string[]): string => {
    try {
      run(args);
      throw new Error("expected a non-zero exit");
    } catch (e: unknown) {
      const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
      return String(err.stderr ?? "") + String(err.stdout ?? "");
    }
  };

  it("tells the caller there is no 'set' and to use 'secrets request' instead", () => {
    // A pod cannot write its own secrets; the only path is asking the owner via the
    // dashboard. The error must name the RIGHT command, not just reject.
    const out = runFail(["secrets", "set", "OPENAI_API_KEY", "sk-x"]);
    expect(out).toMatch(/no 'podbay secrets set'/);
    expect(out).toMatch(/secrets request KEY/);
    expect(out).toMatch(/owner/);
  });

  it("points an unknown subcommand at 'secrets request' too", () => {
    expect(runFail(["secrets", "frobnicate"])).toMatch(/secrets request KEY/);
  });
});

describe("podbay link — hand the user a GitHub URL, not a dead pod path", () => {
  const runFail2 = (args: string[], cwd?: string): string => {
    try {
      execFileSync("bash", [cli, ...args], { env, encoding: "utf8", cwd });
      throw new Error("expected non-zero exit");
    } catch (e: unknown) {
      const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
      return String(err.stderr ?? "") + String(err.stdout ?? "");
    }
  };

  it("turns a committed file into its GitHub blob URL", async () => {
    const repo = path.join(dir, "repo");
    await fs.mkdir(repo);
    const git = (a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@t.t"]);
    git(["config", "user.name", "t"]);
    git(["remote", "add", "origin", "git@github.com:velsa/podbay.git"]);
    await fs.writeFile(path.join(repo, "doc.md"), "hi");
    git(["add", "doc.md"]);
    git(["commit", "-qm", "add"]);
    const out = execFileSync("bash", [cli, "link", "doc.md"], { env, encoding: "utf8", cwd: repo }).trim();
    // HEAD isn't on origin (no push), so it uses the branch ref, and normalizes the git@ remote to https
    expect(out).toMatch(/^https:\/\/github\.com\/velsa\/podbay\/blob\/.+\/doc\.md$/);
  });

  it("redirects a non-repo file to the file-send tool instead of a dead path", () => {
    expect(runFail2(["link", "/etc/hostname"])).toMatch(/file-send tool|paste it inline/);
  });
});

describe("podbay info — the owner's dashboard link is ALWAYS surfaced", () => {
  const withSpec = async (spec: object) => {
    const p = path.join(dir, "pod-spec.json");
    await fs.writeFile(p, JSON.stringify(spec));
    return { ...env, PODBAY_SPEC: p };
  };
  const infoWith = (e: NodeJS.ProcessEnv) => execFileSync("bash", [cli, "info"], { env: e, encoding: "utf8" });

  it("uses the spec's cockpitUrl when present", async () => {
    const e = await withSpec({
      slug: "pod-x",
      previewUrl: "https://pod-x.preview.podbay.cloud",
      cockpitUrl: "https://podbay.cloud/pods/pod-x",
    });
    expect(infoWith(e)).toMatch(/cockpit:\s+https:\/\/podbay\.cloud\/pods\/pod-x/);
  });

  it("DERIVES a dashboard link from previewUrl when an older spec has cockpitUrl null", async () => {
    // The bug this fixes: a stale spec (cockpitUrl null) silently dropped the link,
    // leaving a user with no idea where to enter a secret.
    const e = await withSpec({ slug: "pod-y", previewUrl: "https://pod-y.preview.podbay.cloud", cockpitUrl: null });
    expect(infoWith(e)).toMatch(/cockpit:\s+https:\/\/podbay\.cloud\/dashboard\/pods\/pod-y/);
  });
});

describe("podbay schedule", () => {
  const jobs = () => JSON.parse(readFileSync(env.PODBAY_OPS_JOBS as string, "utf8"));

  it("says so plainly when nothing is scheduled", () => {
    expect(run(["schedule", "list"])).toMatch(/no scheduled jobs/);
  });

  it("`schedule done` closes a run by appending the terminal event the scheduler reads", () => {
    // The fix for the dead-man false-alarm: a generic scheduled run had no way to write its
    // terminal event, so the scheduler never saw it finish. `done` is that universal close.
    run(["schedule", "done", "brief-run-123"]);
    const line = readFileSync(env.PODBAY_OPS_RUNS as string, "utf8").trim();
    const ev = JSON.parse(line);
    expect(ev).toMatchObject({ runId: "brief-run-123", event: "succeeded" });
    expect(typeof ev.at).toBe("string");
    // and a failure closes it as failed
    run(["schedule", "done", "brief-run-123", "fail"]);
    const last = JSON.parse(readFileSync(env.PODBAY_OPS_RUNS as string, "utf8").trim().split("\n").pop() as string);
    expect(last).toMatchObject({ runId: "brief-run-123", event: "failed" });
  });

  it("add writes a scheduler-valid job with times, timezone, and instructions", () => {
    // The whole point of the durable path: a well-formed OpsJob the pod-agent scheduler
    // (scheduler.ts) reads, so agents never hand-roll the JSON and misname a field.
    const out = run([
      "schedule", "add", "--name", "Weekly GSC",
      "--at", "08:23", "--tz", "Asia/Jerusalem",
      "--do", "pull GSC week-over-week and message me",
    ]);
    expect(out).toMatch(/survives restarts/);
    const j = jobs().jobs[0];
    expect(j).toMatchObject({
      name: "Weekly GSC",
      mode: "routine",
      enabled: true,
      schedule: { times: ["08:23"], timezone: "Asia/Jerusalem" },
      instructions: "pull GSC week-over-week and message me",
    });
    expect(typeof j.id).toBe("string");
    expect(j.id.length).toBeGreaterThan(0);
  });

  it("supports an everyMinutes interval job", () => {
    run(["schedule", "add", "--name", "Ping", "--every", "60", "--do", "health check"]);
    expect(jobs().jobs[0].schedule).toEqual({ everyMinutes: 60 });
  });

  it("restricts a daily time to weekdays via --days / --on", () => {
    run(["schedule", "add", "--name", "Weekly GSC", "--at", "08:23", "--tz", "Asia/Jerusalem", "--days", "mon", "--do", "x"]);
    expect(jobs().jobs[0].schedule).toEqual({ times: ["08:23"], timezone: "Asia/Jerusalem", days: [1] });
    run(["schedule", "add", "--name", "Standup", "--at", "09:00", "--on", "weekdays", "--do", "x"]);
    expect(jobs().jobs[1].schedule).toEqual({ times: ["09:00"], days: [1, 2, 3, 4, 5] });
  });

  it("rejects --days with an interval job and a bad day name", () => {
    expect(() => run(["schedule", "add", "--name", "a", "--every", "60", "--days", "mon", "--do", "x"])).toThrow();
    expect(() => run(["schedule", "add", "--name", "b", "--at", "09:00", "--days", "funday", "--do", "x"])).toThrow();
  });

  it("lists, disables, and removes by id", () => {
    run(["schedule", "add", "--name", "Job A", "--at", "09:07", "--do", "a"]);
    const id = jobs().jobs[0].id as string;
    expect(run(["schedule", "list"])).toMatch(new RegExp(`on\\s+${id}`));
    run(["schedule", "disable", id]);
    expect(jobs().jobs[0].enabled).toBe(false);
    run(["schedule", "remove", id]);
    expect(jobs().jobs).toHaveLength(0);
  });

  it("rejects a job with no schedule and a bad time", () => {
    expect(() => run(["schedule", "add", "--name", "x"])).toThrow();
    expect(() => run(["schedule", "add", "--name", "y", "--at", "99:99", "--do", "z"])).toThrow();
  });
});

describe("podbay msg (agent-to-agent, same owner)", () => {
  const fleet = (dir: string) =>
    JSON.stringify([
      { id: "afisha-crawler-6bc4", name: "afisha crawler", self: false },
      { id: "cheerful-donkey-9d41", name: null, self: false },
      { id: "web-scraper-1a2b", name: "Scraper", self: true }, // this pod
    ]);
  const msgEnv = () => ({
    ...env,
    PODBAY_MSG_OUTBOX: path.join(dir, "outbox.jsonl"),
    PODBAY_MSG_INBOX: path.join(dir, "inbox.jsonl"),
    PODBAY_MSG_FLEET: path.join(dir, "fleet.json"),
  });
  const runMsg = (args: string[]) => execFileSync("bash", [cli, ...args], { env: msgEnv(), encoding: "utf8" });
  const outbox = () =>
    readFileSync(path.join(dir, "outbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  beforeEach(async () => {
    await fs.writeFile(path.join(dir, "fleet.json"), fleet(dir));
  });

  it("lists the owner's fleet, marking this pod", () => {
    const out = runMsg(["msg", "pods"]);
    expect(out).toMatch(/afisha-crawler-6bc4\s+\(afisha crawler\)/);
    expect(out).toMatch(/web-scraper-1a2b.*← this pod/);
  });

  it("resolves a human reference (abbreviation, name, token) to the exact slug", () => {
    runMsg(["msg", "send", "cheerful donkey", "regenerate the sitemap"]); // abbreviation
    runMsg(["msg", "send", "afisha crawler", "hi by name"]); // display name
    runMsg(["msg", "send", "crawler", "hi by token"]); // unique substring
    const q = outbox();
    expect(q.map((m) => m.to)).toEqual(["cheerful-donkey-9d41", "afisha-crawler-6bc4", "afisha-crawler-6bc4"]);
    // Bodies survive verbatim; each message carries a distinct id.
    expect(q[0].body).toBe("regenerate the sitemap");
    expect(new Set(q.map((m) => m.id)).size).toBe(3);
  });

  it("REFUSES an ambiguous reference instead of guessing (exit non-zero)", async () => {
    await fs.writeFile(
      path.join(dir, "fleet.json"),
      JSON.stringify([
        { id: "afisha-crawler-6bc4", name: "afisha crawler", self: false },
        { id: "web-crawler-1a2b", name: "web crawler", self: false },
      ]),
    );
    expect(() => runMsg(["msg", "send", "crawler", "who?"])).toThrow(/ambiguous/);
  });

  it("REFUSES an unknown reference and lists the fleet", () => {
    expect(() => runMsg(["msg", "send", "ghost", "hello"])).toThrow(/No pod matches/);
  });

  it("never resolves a reference to THIS pod (no messaging yourself)", () => {
    expect(() => runMsg(["msg", "send", "scraper", "to myself?"])).toThrow(/No pod matches/);
  });

  it("encodes a body with quotes/newlines/shell metacharacters safely (jq-built JSON)", () => {
    const nasty = 'do `rm -rf /` $(whoami) "quoted" \\ end';
    runMsg(["msg", "send", "cheerful donkey", nasty]);
    expect(outbox()[0].body).toBe(nasty);
  });

  it("reads the inbox and replies back to the original sender", async () => {
    await fs.writeFile(
      path.join(dir, "inbox.jsonl"),
      JSON.stringify({ id: "abc123", from: "afisha-crawler-6bc4", body: "count is 412", at: "2026-08-06T10:00:00Z" }) + "\n",
    );
    expect(runMsg(["msg", "inbox"])).toMatch(/from afisha-crawler-6bc4[\s\S]*count is 412/);
    runMsg(["msg", "reply", "abc123", "thanks!"]);
    const last = outbox().at(-1)!;
    expect(last.to).toBe("afisha-crawler-6bc4");
    expect(last.body).toBe("thanks!");
  });

  it("errors on a reply to an unknown message id", async () => {
    await fs.writeFile(
      path.join(dir, "inbox.jsonl"),
      JSON.stringify({ id: "real1", from: "afisha-crawler-6bc4", body: "hi", at: "2026-08-06T10:00:00Z" }) + "\n",
    );
    expect(() => runMsg(["msg", "reply", "nope", "x"])).toThrow(/no message with id/);
  });
});
