import { readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

const STATE = path.join(process.cwd(), ".e2e-state.json");

/** Kill the Next server (process group) and remove the Postgres container. */
export default async function globalTeardown(): Promise<void> {
  // Tests have already passed by now; removing the container force-closes any
  // pg pool we can't reach (e.g. better-auth's) → swallow that teardown churn
  // so it doesn't fail the run.
  process.on("unhandledRejection", () => {});

  let state: {
    containerId?: string;
    serverPid?: number;
    externalPg?: string;
    dbName?: string;
  } = {};
  try {
    state = JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return;
  }
  // Kill the web server first (its pg pool dies with the process), then the
  // in-process stack, THEN remove the container last.
  if (state.serverPid) {
    try {
      process.kill(-state.serverPid, "SIGTERM"); // detached → kill the group
    } catch {
      /* already gone */
    }
  }
  const stack = (globalThis as Record<string, unknown>).__e2eTerminalStack as
    | { close: () => Promise<void> }
    | undefined;
  if (stack) await stack.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300)); // let sockets settle

  // External Postgres: drop the throwaway database this run created.
  if (state.externalPg && state.dbName) {
    try {
      const { Client } = await import("pg");
      const c = new Client({ connectionString: state.externalPg });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${state.dbName} WITH (FORCE)`);
      await c.end();
    } catch {
      /* best-effort: a leftover e2e db is harmless and named obviously */
    }
  }

  if (state.containerId) {
    // Graceful stop (SIGTERM → clean Postgres shutdown) then remove, to minimise
    // connection-reset churn versus `rm -f` (SIGKILL).
    await new Promise<void>((r) => execFile("docker", ["stop", state.containerId!], () => r()));
    await new Promise<void>((r) => execFile("docker", ["rm", "-f", state.containerId!], () => r()));
  }
  rmSync(STATE, { force: true });
}
