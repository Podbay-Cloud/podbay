import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * agent-harness-toggle §3: every T3 ENABLE/connect server action must refuse when the T3 harness is
 * disabled — a hidden UI is not enough, these are directly-invocable POSTs. `disableT3Code` must NOT
 * be guarded (an already-T3 pod keeps its off-switch). Source-level check, mirroring the H2 gate test.
 */
const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "actions.ts"),
  "utf8",
);
const fnBody = (name: string): string => {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start);
  return rest.slice(0, rest.indexOf("\n}\n") + 2);
};

describe("T3 harness guard (agent-harness-toggle §3)", () => {
  for (const name of [
    "enableT3Code",
    "startT3Connect",
    "submitT3ConnectCode",
    "regenerateT3Pairing",
  ]) {
    it(`${name} refuses when the harness is disabled`, () => {
      expect(fnBody(name)).toMatch(/if \(!harnessEnabled\("t3"\)\) return T3_DISABLED;/);
    });
  }

  it("the completeSetupToken auto-enable is gated on harnessEnabled", () => {
    expect(fnBody("completeSetupToken")).toContain('harnessEnabled("t3")');
  });

  it("disableT3Code is NOT guarded — an already-T3 pod keeps its off-switch", () => {
    expect(fnBody("disableT3Code")).not.toContain("harnessEnabled");
  });
});
