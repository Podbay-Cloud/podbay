import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests spin up a real pod-agent (node-pty) — must run in forks, not threads.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
