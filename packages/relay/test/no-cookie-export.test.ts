import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * Credentials do not move machines. The relay returns page CONTENT to a pod, never the
 * session that fetched it — exporting storageState/cookies to a pod would put a live
 * credential on a volume an agent controls, and undo the whole reason the relay exists.
 * This guards the boundary against a well-meaning future "optimisation".
 */
describe("the relay never exports its session to a pod", () => {
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(path.join(srcDir, f), "utf8"));

  it("uses no storageState / cookie export API", () => {
    for (const src of files) {
      expect(src).not.toMatch(/storageState|context\.cookies\(\)|exportCookies/);
    }
  });

  it("no source path EXPORTS cookies or storage state", () => {
    // The `session: boolean` flag on a result is metadata (was this fetched as the
    // owner?), not a credential. The boundary is that no cookie/storageState is ever
    // read out and SENT — that is what these APIs would be.
    for (const src of files) {
      expect(src).not.toMatch(/storageState|exportCookies|context\.cookies/);
    }
  });

  it("reads cookies ONLY to check a session exists — never to move one", () => {
    // A blanket ban on `.cookies(` was a false positive: `relay login` reads them to
    // answer "did the sign-in actually take?" and only ever looks at the COUNT. That is
    // not an export. So allow exactly that shape and fail any other use — a new call
    // site, or this one starting to touch a cookie's value, breaks the build.
    const VETTED = /const cookies = await ctx\.cookies\(/;
    for (const src of files) {
      for (const line of src.split("\n")) {
        if (!line.includes(".cookies(")) continue;
        expect(line, `unvetted cookie read: ${line.trim()}`).toMatch(VETTED);
      }
      // …and whatever it read is only ever counted, never serialised or sent.
      const uses = src.match(/cookies[^\n]*/g) ?? [];
      for (const u of uses) {
        expect(u, `cookies must not be sent/serialised: ${u.trim()}`).not.toMatch(
          /JSON\.stringify\(\s*cookies|send\(\s*cookies|body:\s*cookies|return\s+cookies/,
        );
      }
    }
  });
});
