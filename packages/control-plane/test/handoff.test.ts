import { describe, it, expect, vi } from "vitest";
import { requestHandoff, HANDOFF_DIR } from "../src/handoff.js";
import type { SandboxProvider } from "@podbay/provider";

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

/** A provider whose exec is scripted by matching on the command string. */
function providerWith(handler: (script: string) => string): {
  provider: SandboxProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const provider = {
    async exec(_id: string, cmd: string[]) {
      const script = cmd[cmd.length - 1] ?? "";
      calls.push(script);
      return { stdout: handler(script), stderr: "", exitCode: 0 };
    },
  } as unknown as SandboxProvider;
  return { provider, calls };
}

const READY_PANE = "❯ ready for input";
const noSleep = async (): Promise<void> => undefined;

describe("requestHandoff", () => {
  it("asks a live window and reports the note once its mtime changes", async () => {
    let mtime = "1000";
    const { provider, calls } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n";
      if (s.includes("capture-pane")) return READY_PANE;
      if (s.includes("stat -c %Y")) return mtime;
      if (s.includes("send-keys")) {
        mtime = "2000"; // the agent writes the note
        return "";
      }
      return "";
    });
    const written = await requestHandoff({ provider, podId: "p1", log, sleep: noSleep });
    expect(written).toEqual(["0"]);
    expect(calls.some((c) => c.includes("send-keys") && c.includes("/handoff"))).toBe(true);
    expect(calls.some((c) => c.includes(HANDOFF_DIR))).toBe(true);
  });

  it("does NOT type into a pane showing a blocking gate (the 2026-07-24 failure mode)", async () => {
    const { provider, calls } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n";
      if (s.includes("capture-pane")) return "❯ 1. No, exit\nBypass Permissions mode";
      return "";
    });
    const written = await requestHandoff({ provider, podId: "p1", log, sleep: noSleep });
    expect(written).toEqual([]);
    expect(calls.some((c) => c.includes("send-keys"))).toBe(false);
  });

  it("does NOT type into a pane whose agent has exited", async () => {
    const { provider, calls } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n";
      if (s.includes("capture-pane")) return "PODBAY-AGENT-EXITED - the agent is NOT running.";
      return "";
    });
    expect(await requestHandoff({ provider, podId: "p1", log, sleep: noSleep })).toEqual([]);
    expect(calls.some((c) => c.includes("send-keys"))).toBe(false);
  });

  it("gives up at the deadline when the agent never writes, and still returns", async () => {
    let t = 0;
    const { provider } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n";
      if (s.includes("capture-pane")) return READY_PANE;
      if (s.includes("stat -c %Y")) return "1000"; // never changes
      return "";
    });
    const written = await requestHandoff({
      provider,
      podId: "p1",
      log,
      timeoutMs: 5_000,
      now: () => (t += 1_000),
      sleep: noSleep,
    });
    expect(written).toEqual([]);
  });

  it("never throws when exec fails outright", async () => {
    const provider = {
      async exec() {
        throw new Error("pod unreachable");
      },
    } as unknown as SandboxProvider;
    await expect(requestHandoff({ provider, podId: "p1", log, sleep: noSleep })).resolves.toEqual(
      [],
    );
  });

  it("skips a pod with no tmux windows", async () => {
    const { provider, calls } = providerWith((s) => (s.includes("list-windows") ? "" : ""));
    expect(await requestHandoff({ provider, podId: "p1", log, sleep: noSleep })).toEqual([]);
    expect(calls.some((c) => c.includes("send-keys"))).toBe(false);
  });

  it("writes one note per window INDEX and never crosses windows", async () => {
    const mtimes: Record<string, string> = { "0": "1", "1": "1" };
    const { provider, calls } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n1\n";
      if (s.includes("capture-pane")) return READY_PANE;
      const stat = s.match(/stat -c %Y '([^']+)'/);
      if (stat) {
        const w = stat[1].split("/").pop()!.replace(".md", "");
        return mtimes[w] ?? "";
      }
      const send = s.match(/send-keys -t main:(\S+)/);
      if (send && s.includes("/handoff")) mtimes[send[1]] = "9";
      return "";
    });
    const written = await requestHandoff({ provider, podId: "p1", log, sleep: noSleep });
    expect(written.sort()).toEqual(["0", "1"]);
    // each window's note path is its own — no shared file to clobber
    expect(calls.some((c) => c.includes(`${HANDOFF_DIR}/0.md`))).toBe(true);
    expect(calls.some((c) => c.includes(`${HANDOFF_DIR}/1.md`))).toBe(true);
  });

  it("keeps the note on the PERSISTENT home volume", () => {
    // A note under /tmp or the rootfs would vanish on exactly the event it exists for.
    expect(HANDOFF_DIR.startsWith("/home/dev/")).toBe(true);
  });

  it("does not count a STALE note as a fresh handoff", async () => {
    const { provider } = providerWith((s) => {
      if (s.includes("list-windows")) return "0\n";
      if (s.includes("capture-pane")) return READY_PANE;
      if (s.includes("stat -c %Y")) return "777"; // pre-existing note, never updated
      return "";
    });
    let t = 0;
    const written = await requestHandoff({
      provider,
      podId: "p1",
      log,
      timeoutMs: 3_000,
      now: () => (t += 1_000),
      sleep: noSleep,
    });
    expect(written).toEqual([]);
  });
});
