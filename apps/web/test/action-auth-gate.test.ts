import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for pre-Alpha security H2: a Server Action is a directly-invocable POST,
 * so the /pending page-gate does NOT protect it. The one mutating action that CREATES/spends
 * — launchPod — MUST gate on requireApprovedUser (not bare requireUser), or an authenticated-
 * but-unapproved user can provision pods straight past the invite gate.
 */
const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "actions.ts"),
  "utf8",
);

describe("server-action approval gate (H2)", () => {
  it("launchPod gates on requireApprovedUser, not bare requireUser", () => {
    const body = src.slice(src.indexOf("export async function launchPod"));
    const fn = body.slice(0, body.indexOf("\n}\n") + 2);
    expect(fn).toContain("requireApprovedUser()");
    expect(fn).not.toMatch(/const user = await requireUser\(\)/);
  });
});
