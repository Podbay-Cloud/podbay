import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRequests, addRequest, removeRequest } from "../src/secret-requests.js";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-secreq-"));
  path = join(dir, "secret-requests.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("secret requests", () => {
  it("an absent file reads as no requests, not an error", () => {
    expect(readRequests(path)).toEqual([]);
  });

  it("records a request with its reason", () => {
    addRequest(path, "OPENAI_API_KEY", "for the summariser", "2026-07-31T00:00:00Z");
    expect(readRequests(path)).toEqual([
      { key: "OPENAI_API_KEY", description: "for the summariser", at: "2026-07-31T00:00:00Z" },
    ]);
  });

  it("dedups by key — a repeated ask updates rather than stacks", () => {
    addRequest(path, "API_KEY", "first", "2026-07-31T00:00:00Z");
    addRequest(path, "API_KEY", "clearer reason", "2026-07-31T01:00:00Z");
    const rows = readRequests(path);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ description: "clearer reason", at: "2026-07-31T01:00:00Z" });
  });

  it("refuses a key the vault could never accept", () => {
    expect(() => addRequest(path, "lower_case", "", "t")).toThrow(/UPPER_SNAKE_CASE/);
    expect(() => addRequest(path, "9LEADING", "", "t")).toThrow();
    expect(() => addRequest(path, "HAS-DASH", "", "t")).toThrow();
  });

  it("drops a satisfied request", () => {
    addRequest(path, "A_KEY", "", "t");
    addRequest(path, "B_KEY", "", "t");
    removeRequest(path, "A_KEY");
    expect(readRequests(path).map((r) => r.key)).toEqual(["B_KEY"]);
  });

  it("ignores corrupt or non-array file contents", () => {
    addRequest(path, "OK_KEY", "", "t");
    // Corrupt it by writing a valid request then a bad one via addRequest's dedup path
    // is not possible; simulate a hand-mangled file:
    const { writeFileSync } = require("node:fs");
    writeFileSync(path, "{ not json");
    expect(readRequests(path)).toEqual([]);
  });
});
