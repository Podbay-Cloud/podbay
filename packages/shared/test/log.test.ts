import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log.js";

function capture() {
  const lines: string[] = [];
  return { lines, write: (l: string) => lines.push(l) };
}

describe("createLogger", () => {
  it("emits one JSON line with ts/level/svc/event and context", () => {
    const { lines, write } = capture();
    createLogger("gateway", write).info("ws_accepted", { podId: "p1", userId: "u1" });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: "info", svc: "gateway", event: "ws_accepted", podId: "p1", userId: "u1" });
    expect(typeof entry.ts).toBe("string");
  });

  it("serializes errors to message + code without stack", () => {
    const { lines, write } = capture();
    const err = Object.assign(new Error("boom"), { code: "conflict" });
    createLogger("provider", write).error("fly_failed", { err });
    const entry = JSON.parse(lines[0]);
    expect(entry.err).toEqual({ message: "boom", code: "conflict" });
    expect(lines[0]).not.toContain("at ");
  });

  it("redacts sensitive keys at any depth", () => {
    const { lines, write } = capture();
    createLogger("web", write).warn("action_failed", {
      apiToken: "FlyV1 super-secret",
      nested: { Authorization: "Bearer xyz", ok: 1 },
    });
    const entry = JSON.parse(lines[0]);
    expect(entry.apiToken).toBe("[redacted]");
    expect(entry.nested.Authorization).toBe("[redacted]");
    expect(entry.nested.ok).toBe(1);
    expect(lines[0]).not.toContain("super-secret");
    expect(lines[0]).not.toContain("Bearer xyz");
  });
});
