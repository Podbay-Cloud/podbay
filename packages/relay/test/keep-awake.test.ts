import { describe, it, expect, vi, afterEach } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), kill: vi.fn() })),
}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { keepAwake } from "../src/keep-awake.js";

function setPlatform(p: string) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("keep-awake (opt-in idle-sleep prevention)", () => {
  const orig = process.platform;
  afterEach(() => {
    setPlatform(orig);
    spawnMock.mockClear();
  });

  it("on macOS spawns caffeinate with idle+AC-system-sleep prevention, tied to our pid", () => {
    setPlatform("darwin");
    const logs: string[] = [];
    const release = keepAwake((m) => logs.push(m));
    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("caffeinate");
    // -i prevent idle sleep, -s prevent system sleep on AC, -w <pid> auto-release when WE exit.
    expect(args).toEqual(["-is", "-w", String(process.pid)]);
    expect(logs.join(" ")).toMatch(/ON/);
    expect(() => release()).not.toThrow();
  });

  it("is a NO-OP on non-macOS (never spawns caffeinate) with a helpful note", () => {
    setPlatform("linux");
    const logs: string[] = [];
    const release = keepAwake((m) => logs.push(m));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(logs.join(" ")).toMatch(/macOS only/);
    expect(() => release()).not.toThrow();
  });
});
