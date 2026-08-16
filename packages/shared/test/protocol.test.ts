import { describe, it, expect } from "vitest";
import { isClientMessage, isAgentMessage, parseClientMessage } from "../src/index.js";

describe("protocol type guards", () => {
  it("accepts valid client messages", () => {
    expect(isClientMessage({ type: "input", data: "ls\n" })).toBe(true);
    expect(isClientMessage({ type: "resize", cols: 80, rows: 24 })).toBe(true);
    expect(isClientMessage({ type: "ping" })).toBe(true);
  });

  it("rejects invalid client messages", () => {
    expect(isClientMessage({ type: "input" })).toBe(false);
    expect(isClientMessage({ type: "resize", cols: "80", rows: 24 })).toBe(false);
    expect(isClientMessage({ type: "nope" })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage("input")).toBe(false);
  });

  it("accepts/rejects select-window (cheap-tabs)", () => {
    expect(isClientMessage({ type: "select-window", index: 2 })).toBe(true);
    expect(isClientMessage({ type: "select-window" })).toBe(false);
    expect(isClientMessage({ type: "select-window", index: "2" })).toBe(false);
  });

  it("accepts valid agent messages", () => {
    expect(isAgentMessage({ type: "output", data: "x" })).toBe(true);
    expect(isAgentMessage({ type: "links", urls: ["https://a"] })).toBe(true);
    expect(isAgentMessage({ type: "status", idleMs: 0, idle: false, ready: true })).toBe(true);
    expect(isAgentMessage({ type: "exit", code: 0 })).toBe(true);
  });

  it("accepts/rejects the windows frame (cheap-tabs)", () => {
    expect(
      isAgentMessage({
        type: "windows",
        windows: [
          { index: 0, name: "claude", active: true, agent: "claude-code" },
          { index: 1, name: "shell", active: false },
        ],
      }),
    ).toBe(true);
    expect(isAgentMessage({ type: "windows", windows: [{ index: 0, name: "x" }] })).toBe(false); // no active
    expect(isAgentMessage({ type: "windows", windows: [{ name: "x", active: true }] })).toBe(false); // no index
    expect(isAgentMessage({ type: "windows" })).toBe(false);
  });

  it("rejects invalid agent messages", () => {
    expect(isAgentMessage({ type: "links", urls: [1] })).toBe(false);
    expect(isAgentMessage({ type: "status", idleMs: 0 })).toBe(false);
  });

  it("parseClientMessage handles bad JSON and bad shape", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "bad" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "ping" }))).toEqual({ type: "ping" });
  });
});
