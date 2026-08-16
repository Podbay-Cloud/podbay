import { defineConfig } from "@playwright/test";

const PORT = 3111;

// The hermetic stack (ephemeral Postgres + the Next server pointed at it) is
// booted in global setup and torn down in global teardown — see e2e/global-*.ts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Cold-start pod creation (booting the in-process agent/gateway stack + compiling the
  // cockpit route) can exceed 30s on a constrained pod, where this suite actually runs
  // (no Docker → PODBAY_E2E_PG). Generous so first-pod tests aren't falsely flaky.
  timeout: 90_000,
  // One retry. This suite drives a REAL in-process gateway + pod-agent and a
  // shared fake-provider state file over a ~12-minute sequential run; late in the run
  // the single Next dev server can be slow enough that a cold `page.goto`/provision
  // times out once. That's environmental, not a product defect — a retry absorbs it
  // without masking a genuinely broken test (which fails both attempts).
  retries: 1,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
});
