import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDisallowedTarget } from "../src/net-guard.js";

/**
 * `pb` ships standalone to npm and carries NO workspace dependency (that would put an
 * unpublished `workspace:*` into the published manifest), so its SSRF guard is a VENDORED
 * copy of `packages/shared/src/net-guard.ts`. A security control with two copies is a hole
 * waiting to open — so this compares the two SOURCES and fails the build on any drift,
 * which catches more than a behaviour table could (an unreached branch still counts).
 *
 * If this fails: re-copy `packages/shared/src/net-guard.ts` over `packages/relay/src/
 * net-guard.ts` (keeping pb's "VENDORED" header). Do not "fix" one side to match.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(path.join(here, p), "utf8");

/** The implementation, minus each file's own header comment — that part legitimately
 * differs (one explains it is the source, the other that it is a copy). */
function implementationOf(src: string): string {
  const at = src.indexOf("export function isDisallowedTarget");
  return src.slice(at).replace(/\r\n/g, "\n").trim();
}

describe("pb's vendored SSRF guard is identical to the shared one", () => {
  it("has not drifted from packages/shared/src/net-guard.ts", () => {
    const vendored = implementationOf(read("../src/net-guard.ts"));
    const canonical = implementationOf(read("../../shared/src/net-guard.ts"));
    expect(vendored.length, "vendored guard is empty — did the copy break?").toBeGreaterThan(200);
    expect(vendored).toBe(canonical);
  });

  it("still refuses the LAN and allows the public web", () => {
    for (const h of ["127.0.0.1", "192.168.1.1", "169.254.169.254", "localhost", "::1", "10.0.0.1"]) {
      expect(isDisallowedTarget(h), `${h} must be refused`).toBe(true);
    }
    for (const h of ["example.com", "93.184.216.34", "1.1.1.1", "reddit.com"]) {
      expect(isDisallowedTarget(h), `${h} must be allowed`).toBe(false);
    }
  });
});
