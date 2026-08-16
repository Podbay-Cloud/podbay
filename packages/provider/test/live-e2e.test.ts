import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWithConfig } from "@podbay/shared";
import { FlyHttpClient } from "../src/fly/http-client.js";
import { FlyProvider } from "../src/fly/provider.js";
import { loadFlyConfig } from "../src/config.js";

/**
 * Gated real-Fly end-to-end: create → exec → sleep → wake → destroy.
 * Runs only with PODBAY_LIVE_FLY=1 and a valid FLY_API_TOKEN + PODBAY_PODS_APP,
 * so normal/CI runs stay free and fast.
 */
const live = process.env.PODBAY_LIVE_FLY === "1";
const exampleDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "environments",
  "nextjs-starter",
);

describe.skipIf(!live)("live Fly e2e", () => {
  it("create → exec → sleep → wake → destroy", async () => {
    const config = loadFlyConfig();
    const client = new FlyHttpClient({
      apiToken: config.apiToken,
      appName: config.appName,
      apiBaseUrl: config.apiBaseUrl,
    });
    const provider = new FlyProvider(client, config);
    const resolved = await resolveWithConfig(exampleDir);
    const id = `e2e-${Date.now()}`;

    try {
      const created = await provider.createPod({ id, owner: "e2e", resolved, envDir: exampleDir });
      expect(created.id).toBe(id);

      const r = await provider.exec(id, ["echo", "podbay"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("podbay");

      expect((await provider.sleep(id)).status).toBe("suspended");
      expect((await provider.wake(id)).status).toBe("running");
    } finally {
      await provider.destroy(id);
      expect((await provider.getPod(id)).status).toBe("gone");
    }
  }, 120_000);
});
