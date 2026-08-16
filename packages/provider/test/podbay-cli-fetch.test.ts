import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "pod-base",
  "podbay",
);

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "podbay-fetch-"));
  env = {
    ...process.env,
    PODBAY_FETCH_PLAN: path.join(dir, "plan.json"),
    PODBAY_FETCH_REPORTS: path.join(dir, "reports.jsonl"),
  };
});

const run = (args: string[]) =>
  execFileSync("bash", [cli, ...args], { env, encoding: "utf8" }).trim();

const writePlan = (plan: unknown) =>
  fs.writeFile(env.PODBAY_FETCH_PLAN as string, JSON.stringify(plan));

/**
 * The pod never calls the control plane — the plan arrives as a pushed file and
 * reports accumulate in a buffer that gets drained. So these two commands are the
 * whole pod-side surface, and the parts worth testing are the edges: what happens
 * with no plan, and what happens to a URL that carries a credential.
 */
describe("podbay fetch plan", () => {
  it("returns what the fleet knows about a domain", async () => {
    await writePlan({
      domains: {
        "reddit.com": {
          good: ["relay"],
          bad: [{ rung: "direct", outcome: "blocked" }],
          lastVerified: "2026-07-30T00:00:00Z",
        },
      },
    });
    const out = JSON.parse(run(["fetch", "plan", "reddit.com"]));
    expect(out.good).toEqual(["relay"]);
    expect(out.bad[0]).toMatchObject({ rung: "direct", outcome: "blocked" });
  });

  it("says it has no plan rather than pretending a domain is fine", async () => {
    // No file at all — a fresh pod, or a control plane that has not pushed yet. The
    // agent must be able to tell "nothing known" from "known good".
    const out = JSON.parse(run(["fetch", "plan", "example.com"]));
    expect(out.good).toEqual([]);
    expect(out.lastVerified).toBeNull();
    expect(out.source).toBe("no-plan-yet");
  });

  it("survives an unreadable plan instead of failing the agent's task", async () => {
    await fs.writeFile(env.PODBAY_FETCH_PLAN as string, "{ this is not json");
    const out = JSON.parse(run(["fetch", "plan", "example.com"]));
    expect(out.source).toBe("unreadable");
    expect(out.good).toEqual([]);
  });

  it("reduces a URL to its host, discarding anything that could carry a secret", () => {
    const out = JSON.parse(
      run(["fetch", "plan", "https://user:pw@WWW.Reddit.com:443/r/x/?token=SECRET#frag"]),
    );
    expect(out.domain).toBe("reddit.com");
    expect(JSON.stringify(out)).not.toMatch(/SECRET|user|pw|frag/);
  });
});

describe("podbay fetch report", () => {
  it("appends an outcome for the control plane to drain", async () => {
    run(["fetch", "report", "reddit.com", "relay", "ok"]);
    const buf = await fs.readFile(env.PODBAY_FETCH_REPORTS as string, "utf8");
    expect(JSON.parse(buf.trim())).toMatchObject({
      domain: "reddit.com",
      rung: "relay",
      outcome: "ok",
    });
  });

  it("stores only the host, even when handed a URL with a query", async () => {
    run(["fetch", "report", "https://news.ycombinator.com/item?id=1&auth=abc", "api", "ok"]);
    const buf = await fs.readFile(env.PODBAY_FETCH_REPORTS as string, "utf8");
    expect(buf).toContain("news.ycombinator.com");
    expect(buf).not.toMatch(/auth|abc|item/);
  });

  it("refuses an outcome or rung it does not know", () => {
    // Typos must not become rows in a fleet-wide table.
    expect(() => run(["fetch", "report", "a.com", "direct", "kinda-worked"])).toThrow();
    expect(() => run(["fetch", "report", "a.com", "telepathy", "ok"])).toThrow();
  });

  it("bounds the buffer so an undrained pod cannot grow a file forever", async () => {
    const env2 = { ...env, PODBAY_FETCH_REPORTS_MAX: "5" };
    for (let i = 0; i < 12; i++) {
      execFileSync("bash", [cli, "fetch", "report", `d${i}.com`, "direct", "ok"], { env: env2 });
    }
    const lines = (await fs.readFile(env.PODBAY_FETCH_REPORTS as string, "utf8"))
      .trim()
      .split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    // …and it keeps the NEWEST, since a stale outcome is the less useful one.
    expect(lines.at(-1)).toContain("d11.com");
  });
});
