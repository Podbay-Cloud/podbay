import { describe, expect, it } from "vitest";
import { createLogger } from "@podbay/shared/log";
import { FlyHttpClient } from "../src/fly/http-client.js";

const TOKEN = "FlyV1 fm2_totally-secret-token";

function clientWith(fetchImpl: typeof fetch, lines: string[]) {
  return new FlyHttpClient({
    apiToken: TOKEN,
    appName: "test-app",
    apiBaseUrl: "https://api.test",
    fetchImpl,
    maxRetries: 1,
    logger: createLogger("provider", (l) => lines.push(l)),
  });
}

describe("FlyHttpClient logging", () => {
  it("logs retries and terminal failures without any token material", async () => {
    const lines: string[] = [];
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(clientWith(failing, lines).listMachines()).rejects.toThrow("Fly request failed");
    expect(lines.length).toBeGreaterThanOrEqual(2); // retry + terminal failure
    const events = lines.map((l) => JSON.parse(l).event);
    expect(events).toContain("fly_retry");
    expect(events).toContain("fly_failed");
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("fm2_");
    }
  });

  it("logs 5xx retries with status and no token", async () => {
    const lines: string[] = [];
    const server500 = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;

    await expect(clientWith(server500, lines).listMachines()).rejects.toThrow("Fly 500");
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ event: "fly_retry", status: 500, path: "/apps/test-app/machines" });
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });
});
