import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node-pty spawns a PTY and does not work inside worker threads — use forks.
    pool: "forks",
    // One fork PER FILE, run sequentially. `singleFork: true` put all 23 files in ONE
    // process, so a single NATIVE crash (node-pty, or a child that takes the process
    // down) killed the whole run: CI reported "Worker exited unexpectedly / 7 passed (8)"
    // with the remaining 15 files never executed and NOTHING naming the culprit — a red
    // required gate nobody could diagnose. Per-file forks contain the blast radius and
    // attribute the failure; `fileParallelism: false` keeps files SEQUENTIAL, which is the
    // property the PTY tests actually needed (not a shared process).
    poolOptions: { forks: { singleFork: false } },
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
