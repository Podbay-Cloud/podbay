import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { ADMIN_EMAILS, PREAPPROVE_EMAILS } from "./users";

const STATE = path.join(process.cwd(), ".e2e-state.json");
const PORT = 3111;
const AGENT_PORT = 8790;
const GATEWAY_PORT = 8791;
const SECRET = "e2e-test-secret-not-a-real-secret";

/**
 * Boot the whole hermetic stack: ephemeral Postgres → migrate → live-terminal
 * stack (real pod-agent + gateway, in-process) → the Next server pointed at the
 * gateway. Teardown reverses it.
 */
export default async function globalSetup(): Promise<void> {
  // The in-process stack (below) holds pg pools whose sockets error when the
  // container goes away at teardown. Those are EventEmitter 'error' events that
  // crash the main process if unhandled. Swallow ONLY pg connection churn here
  // (test assertions run in worker processes, so this can't mask a failure).
  const isPgChurn = (e: unknown) =>
    /postmaster|terminating connection|ECONNRESET|Connection terminated|read ECONN/i.test(
      String((e as Error)?.message ?? e),
    );
  process.on("uncaughtException", (e) => {
    if (!isPgChurn(e)) throw e;
  });
  process.on("unhandledRejection", (e) => {
    if (!isPgChurn(e)) throw e;
  });

  // Postgres for the hermetic stack. testcontainers needs a container runtime, which
  // a Podbay POD does not have — so the whole e2e suite was unrunnable exactly where
  // we develop (and CI skips e2e by design, so nothing ran it at all). PODBAY_E2E_PG
  // points at an already-running Postgres instead; we create a throwaway database on
  // it per run and drop it at teardown, so it stays as isolated as a container.
  const fakeStateFile = path.join(os.tmpdir(), `podbay-e2e-fake-${process.pid}.json`);
  writeFileSync(fakeStateFile, "{}");
  process.env.PODBAY_FAKE_STATE_FILE = fakeStateFile; // the in-process stack reads it too
  // Keep fake Codex RC live so pairing/navigation regressions exercise the same ready state as a real
  // signed-in Codex pod. Individual health outcomes become per-pod scripted in the RC lifecycle suite.
  process.env.PODBAY_FAKE_CODEX_RC = "1";
  // The suite launches many pods as one non-admin user across a run; a real 4-slot cap
  // would block them. Lift it (the cap logic is unit-covered in control-plane).
  process.env.PODBAY_ACCOUNT_SLOT_CAP = process.env.PODBAY_ACCOUNT_SLOT_CAP ?? "1000";
  // A resize must APPEAR to take time, or the transient progress it drives ("stopping · Ns",
  // read-only settings) collapses before it can be observed — the fake box resizes instantly.
  process.env.PODBAY_FAKE_RESIZE_MS = process.env.PODBAY_FAKE_RESIZE_MS ?? "5000";

  const externalPg = process.env.PODBAY_E2E_PG;
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | null = null;
  let url: string;
  let dropDb: (() => Promise<void>) | null = null;
  if (externalPg) {
    const { Client } = await import("pg");
    const dbName = `podbay_e2e_${Date.now().toString(36)}`;
    const admin = new Client({ connectionString: externalPg });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    url = new URL(externalPg).origin
      ? externalPg.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`)
      : externalPg;
    dropDb = async () => {
      const a = new Client({ connectionString: externalPg });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    };
    console.log(`[e2e] using external Postgres → ${dbName}`);
  } else {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    url = container.getConnectionUri();
  }

  const { migratePgUrl } = await import("@podbay/db");
  await migratePgUrl(url);

  // Real pod-agent + gateway (kept on globalThis for teardown; same process).
  const { startTerminalStack } = await import("./stack");
  const stack = await startTerminalStack({
    dbUrl: url,
    secret: SECRET,
    agentPort: AGENT_PORT,
    gatewayPort: GATEWAY_PORT,
    environmentsRoot: path.join(process.cwd(), "..", "..", "environments"),
  });
  (globalThis as Record<string, unknown>).__e2eTerminalStack = stack;

  const server = spawn("pnpm", ["dev", "--port", String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PODBAY_DB: "pg",
      DATABASE_URL: url,
      PODBAY_TEST_LOGIN: "1",
      PODBAY_FAKE_PROVIDER: "1",
      // Render the preview card, so the cockpit e2e sees the REAL layout (it is a
      // big part of the page's height, and scroll behaviour depends on it).
      PODBAY_PREVIEW_BASE: "preview.e2e.test",
      // Shared fake-provider state: the Next server and this stack are separate
      // processes and BOTH sweep for pending pods (see FakeProvider.stateFile).
      PODBAY_FAKE_STATE_FILE: fakeStateFile,
      PODBAY_FAKE_CODEX_RC: process.env.PODBAY_FAKE_CODEX_RC,
      PODBAY_FAKE_RESIZE_MS: process.env.PODBAY_FAKE_RESIZE_MS!,
      PODBAY_ACCOUNT_SLOT_CAP: process.env.PODBAY_ACCOUNT_SLOT_CAP!,
      // Hand fake pods an RC link so the wizard reaches READY at once instead of
      // waiting out the 90s remote-control grace (see FakeProvider.sessionUrl).
      PODBAY_FAKE_SESSION_URL: "https://claude.ai/code/session_e2efake",
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      // Enable the pod-secrets vault in the hermetic stack (32 zero bytes, base64) so
      // secret set/paste flows are testable — real deploys use a random key from Fly.
      PODBAY_CRED_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      // A dummy GitHub OAuth client id so the add-GitHub wizard PAGE renders (its
      // device flow won't actually authorize — that's fine for layout checks).
      PODBAY_GITHUB_OAUTH_CLIENT_ID: "e2e-github-client",
      NEXT_PUBLIC_GATEWAY_URL: stack.gatewayUrl,
      ADMIN_EMAILS,
      PREAPPROVE_EMAILS,
    },
  });

  await waitForServer(`http://localhost:${PORT}`, 120_000);
  await warmRoutes(`http://localhost:${PORT}`);
  writeFileSync(
    STATE,
    JSON.stringify({
      containerId: container?.getId(),
      serverPid: server.pid,
      // The REAL database URL this run is using. Tests that need their own connection (e.g.
      // resetWalkthroughSeen) must read it from here: with an ephemeral container the host port is
      // assigned at random by testcontainers, so no constant can name it. A hardcoded guess was
      // exactly the bug — see the note on users.ts's DB.
      dbUrl: url,
      // Tests script per-pod health through this (see FakeProvider.scripted).
      fakeStateFile,
      // Teardown runs in its OWN process, so it can't reuse dropDb — it re-derives
      // the drop from these two values.
      externalPg: externalPg ?? undefined,
      dbName: externalPg ? url.split("/").pop()?.split("?")[0] : undefined,
    }),
  );
  void dropDb; // used by teardown via externalPg/dbName
}

/**
 * Compile the heavy routes ONCE, before any test can be charged for it.
 *
 * This suite runs `next dev`, which compiles a route on its first request. The cockpit
 * (`/dashboard/pods/[slug]`) is the biggest route in the app, and `launch-configure`
 * calls `router.push` INSIDE a transition — so the URL does not change until that first
 * compile finishes. Every pod-launching test therefore paid the whole cold compile
 * inside its own `waitForURL` budget, and on a constrained pod (no Docker, so this is
 * where the suite actually runs) it lost: 6 of 7 cockpit tests failed, with the failing
 * SET drifting run to run, which reads as flakiness rather than a fixed cost.
 *
 * Warming here is honest about what it is — a compile, not a test — and it fixes the
 * whole class: any route added to this list stops being a first-test tax.
 *
 * Auth does not matter. A redirect still compiles the route, which is the point; so
 * every response (302, 404, even 500) is fine and the status is deliberately ignored.
 */
async function warmRoutes(base: string): Promise<void> {
  const routes = [
    "/",
    "/dashboard",
    "/dashboard/pods/new?env=nextjs-starter",
    // The expensive one. Any slug compiles the [slug] route; this pod need not exist.
    "/dashboard/pods/e2e-warmup",
    "/dashboard/settings",
    "/dashboard/environments",
    "/admin/relay",
    "/admin/pods",
  ];
  const started = Date.now();
  for (const r of routes) {
    // Sequential on purpose: parallel cold compiles thrash a small box, which is the
    // very condition this is meant to relieve.
    await fetch(`${base}${r}`, { redirect: "manual" }).catch(() => undefined);
  }
  console.log(`[e2e] warmed ${routes.length} routes in ${Math.round((Date.now() - started) / 1000)}s`);
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`e2e web server did not start at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
