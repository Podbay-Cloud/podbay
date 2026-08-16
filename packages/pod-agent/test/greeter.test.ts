import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGreeter, driveLoginMenu, startResumeWatch } from "../src/greeter.js";

/**
 * A scripted fake tmux: capture-pane returns the current screen; send-keys
 * mutates it per the scenario. Models Claude's input box as "❯ <draft>" and
 * reproduces the two live failure modes (typed-too-early, Enter-as-newline).
 */
function fakeTmux(opts: {
  /** Screens returned before Claude's input appears (booting/promo). */
  bootScreens?: string[];
  /** How many Enters a submit takes before the draft actually clears (models
   * the Enter-as-newline paste bug; 1 = normal). */
  entersToSubmit?: number;
  /** Whether /remote-control activates once submitted. */
  rcActivates?: boolean;
}) {
  const bootScreens = opts.bootScreens ?? [];
  let boots = 0;
  let draft = "";
  let transcript = "";
  let rcActive = false;
  let entersSeen = 0;
  const calls: string[][] = [];

  const screen = () => {
    if (boots < bootScreens.length) return bootScreens[boots++];
    return `${transcript}\n${rcActive ? "/remote-control is active · https://claude.ai/code/session_x\n" : ""}❯ ${draft}\n  ⏵⏵ bypass permissions on`;
  };

  const tmux = async (args: string[]): Promise<string> => {
    calls.push(args);
    if (args[0] === "capture-pane") return screen();
    if (args[0] === "send-keys") {
      if (args.includes("-l")) {
        draft += args[args.length - 1];
        entersSeen = 0;
      } else if (args[args.length - 1] === "Enter") {
        entersSeen++;
        if (entersSeen >= (opts.entersToSubmit ?? 1)) {
          transcript += `> ${draft}\n`;
          if (draft.startsWith("/remote-control") && opts.rcActivates !== false) rcActive = true;
          draft = "";
          entersSeen = 0;
        } else {
          draft += "\n"; // the paste bug: Enter lands as a newline in the draft
        }
      }
      return "";
    }
    return "";
  };
  return { tmux, calls, get draft() { return draft; }, get transcript() { return transcript; } };
}

const fast = { pollMs: 1, readyTimeoutMs: 300, submitConfirmMs: 250, rcConfirmMs: 100 };
const noSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 1)));
const tmpMarker = () => path.join(mkdtempSync(path.join(tmpdir(), "greet-")), "greeted");

describe("greeter", () => {
  it("waits for the input prompt (a static promo screen is NOT readiness), then greets", async () => {
    // Two identical promo screens without ❯ — the old shell greeter fired here.
    const t = fakeTmux({ bootScreens: ["Welcome to Claude\npromo", "Welcome to Claude\npromo"] });
    const r = await runGreeter({
      sessionName: "main", rcTitle: "Test 3", kickoffTrigger: "Time to get started.",
      greetedMarkerPath: tmpMarker(), tmux: t.tmux, sleep: noSleep, ...fast,
    });
    expect(r).toEqual({ ready: true, rcActive: true, greeted: true });
    // types literally (-l) and submits Enter as a SEPARATE keystroke. On a first
    // greet the session is also /rename'd (RC's title doesn't reach the app's
    // session list), between RC and the kickoff.
    const typed = t.calls.filter((c) => c[0] === "send-keys" && c.includes("-l")).map((c) => c[c.length - 1]);
    expect(typed).toEqual(["/remote-control Test 3", "/rename Test 3", "Time to get started."]);
    expect(t.transcript).toContain("> /remote-control Test 3");
    expect(t.transcript).toContain("> /rename Test 3");
    expect(t.transcript).toContain("> Time to get started.");
    expect(t.draft).toBe(""); // nothing left stuck in the input
  });

  it("re-presses Enter when the draft doesn't clear (the Enter-as-newline bug)", async () => {
    const t = fakeTmux({ entersToSubmit: 3 }); // needs 3 Enters per submit
    const r = await runGreeter({
      sessionName: "main", rcTitle: "T", kickoffTrigger: "Time to get started.",
      greetedMarkerPath: tmpMarker(), tmux: t.tmux, sleep: noSleep, ...fast,
    });
    expect(r.greeted).toBe(true);
    expect(t.draft).toBe(""); // retries until it actually submitted
  });

  it("gives up gracefully when Claude never becomes ready", async () => {
    // endless changing boot screens, never an input prompt
    const t = fakeTmux({ bootScreens: Array.from({ length: 1000 }, (_, i) => `boot ${i}`) });
    const r = await runGreeter({
      sessionName: "main", rcTitle: "T", kickoffTrigger: "x",
      greetedMarkerPath: tmpMarker(), tmux: t.tmux, sleep: noSleep, ...fast,
    });
    expect(r).toEqual({ ready: false, rcActive: false, greeted: false });
    expect(t.calls.some((c) => c[0] === "send-keys")).toBe(false); // never typed blind
  });

  it("RC failure doesn't block the greeting (best-effort remote control)", async () => {
    const t = fakeTmux({ rcActivates: false });
    const r = await runGreeter({
      sessionName: "main", rcTitle: "T", kickoffTrigger: "Time to get started.",
      greetedMarkerPath: tmpMarker(), tmux: t.tmux, sleep: noSleep, ...fast,
    });
    expect(r.rcActive).toBe(false);
    expect(r.greeted).toBe(true); // agent still speaks first
  });

  it("greets at most once per pod (marker) — a restart re-enables RC but never re-greets", async () => {
    const marker = tmpMarker();
    const t1 = fakeTmux({});
    const r1 = await runGreeter({
      sessionName: "main", rcTitle: "T", kickoffTrigger: "go",
      greetedMarkerPath: marker, tmux: t1.tmux, sleep: noSleep, ...fast,
    });
    expect(r1.greeted).toBe(true);
    expect(existsSync(marker)).toBe(true);

    const t2 = fakeTmux({});
    const r2 = await runGreeter({
      sessionName: "main", rcTitle: "T", kickoffTrigger: "go",
      greetedMarkerPath: marker, tmux: t2.tmux, sleep: noSleep, ...fast,
    });
    expect(r2.rcActive).toBe(true); // RC re-enabled after restart
    expect(r2.greeted).toBe(false); // but no duplicate greeting
    expect(t2.transcript).not.toContain("> go");
  });

  it("driveLoginMenu presses Enter on the /login method picker until it clears", async () => {
    // The menu shows for two polls, then a send-keys Enter dismisses it (URL prints).
    let entersSeen = 0;
    const menu = "Login\nSelect login method:\n❯ 1. Claude account with subscription";
    const afterSelect = "Opening browser…\nPaste code here: ❯";
    const calls: string[][] = [];
    const tmux = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === "capture-pane") return entersSeen > 0 ? afterSelect : menu;
      if (args[0] === "send-keys" && args[args.length - 1] === "Enter") entersSeen++;
      return "";
    };
    const ok = await driveLoginMenu({
      sessionName: "main", tmux, sleep: () => Promise.resolve(),
      pollMs: 1, waitTimeoutMs: 300, confirmMs: 250,
    });
    expect(ok).toBe(true);
    expect(calls.some((c) => c[0] === "send-keys" && c.includes("Enter"))).toBe(true);
  });

  it("driveLoginMenu dismisses an API-key prompt (accept 'No'), then advances the login menu", async () => {
    // Screens: the API-key prompt shows first (env injected an app key), then the
    // login-method menu after we press Enter to decline it.
    const screens = [
      "Detected a custom API key in your environment\nUse this API key? ❯ 2. No (recommended)",
      "Select login method:\n❯ 1. Claude account with subscription",
      "Opening browser…\nPaste code here: ❯",
    ];
    let idx = 0;
    let enters = 0;
    const calls: string[][] = [];
    const tmux = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === "capture-pane") return screens[Math.min(idx, screens.length - 1)];
      if (args[0] === "send-keys" && args[args.length - 1] === "Enter") {
        enters++;
        idx++; // each Enter advances to the next screen
      }
      return "";
    };
    const ok = await driveLoginMenu({
      sessionName: "main", tmux, sleep: () => Promise.resolve(),
      pollMs: 1, waitTimeoutMs: 300, confirmMs: 250,
    });
    expect(ok).toBe(true);
    expect(enters).toBeGreaterThanOrEqual(2); // one to decline the key, one to pick subscription
  });

  it("driveLoginMenu returns false (no blind keys) when the menu never appears", async () => {
    const calls: string[][] = [];
    const tmux = async (args: string[]): Promise<string> => {
      calls.push(args);
      return "some other screen, already authed";
    };
    const ok = await driveLoginMenu({
      sessionName: "main", tmux, sleep: () => Promise.resolve(),
      pollMs: 1, waitTimeoutMs: 30, confirmMs: 30,
    });
    expect(ok).toBe(false);
    expect(calls.every((c) => c[0] !== "send-keys")).toBe(true);
  });

  it("no kickoff declared → RC + rename, but no kickoff trigger typed", async () => {
    const t = fakeTmux({});
    const r = await runGreeter({
      sessionName: "main", rcTitle: "T",
      greetedMarkerPath: tmpMarker(), tmux: t.tmux, sleep: noSleep, ...fast,
    });
    expect(r.rcActive).toBe(true);
    expect(r.greeted).toBe(false);
    // The session is still named on a first greet; only the KICKOFF trigger is
    // absent (no kickoffTrigger declared → greeted stays false).
    const typed = t.calls.filter((c) => c[0] === "send-keys" && c.includes("-l")).map((c) => c[c.length - 1]);
    expect(typed).toEqual(["/remote-control T", "/rename T"]);
  });
});

describe("startResumeWatch", () => {
  it("fires on a wall-clock jump (suspend/resume), not on normal ticks", () => {
    vi.useFakeTimers();
    try {
      const resumes: number[] = [];
      const stop = startResumeWatch((gap) => resumes.push(gap), { intervalMs: 1000, gapMs: 60_000 });

      // Normal operation: ticks see ~interval-sized gaps — no resume events.
      vi.advanceTimersByTime(5_000);
      expect(resumes).toHaveLength(0);

      // Suspend: the process freezes, then the next tick observes a huge gap.
      vi.setSystemTime(Date.now() + 10 * 60_000); // 10 minutes pass "instantly"
      vi.advanceTimersByTime(1000);
      expect(resumes).toHaveLength(1);
      expect(resumes[0]).toBeGreaterThan(60_000);

      // Back to normal after — no repeat fires.
      vi.advanceTimersByTime(5_000);
      expect(resumes).toHaveLength(1);

      stop();
      vi.setSystemTime(Date.now() + 10 * 60_000);
      vi.advanceTimersByTime(2_000);
      expect(resumes).toHaveLength(1); // stopped — no more events
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Regression guards for the 2026-07-24 outage (pod prime-cat-8ba8). Claude hit the
 * "Bypass Permissions mode" accept screen, whose default is "No, exit", exited, and the
 * launcher's `exec bash` left a shell in the pane. Readiness keyed only on the "❯"
 * marker — which that menu also renders — so the greeter declared success and typed
 * `/remote-control ...` and the kickoff straight into bash.
 */
describe("greeter safety: dead agents and blocking gates", () => {
  const DEAD_PANE =
    "dev@prime-cat-8ba8 ~/work\n$ \nPODBAY-AGENT-EXITED - the agent is NOT running. This is a plain shell;";
  const GATE_PANE =
    "WARNING: Claude Code running in Bypass Permissions mode\n\n❯ 1. No, exit\n  2. Yes, I accept\n";
  const LIVE_PANE = "❯ \n  ⏵⏵ bypass permissions on";

  const typedText = (calls: string[][]) =>
    calls.filter((c) => c[0] === "send-keys" && c.includes("-l")).map((c) => c[c.length - 1]);

  const greet = (tmux: (a: string[]) => Promise<string>, extra: Record<string, unknown> = {}) =>
    runGreeter({
      sessionName: "main",
      rcTitle: "pod",
      kickoffTrigger: "Time to get started.",
      greetedMarkerPath: tmpMarker(),
      tmux,
      sleep: noSleep,
      ...fast,
      ...extra,
    });

  it("never types into a pane whose agent has exited", async () => {
    const calls: string[][] = [];
    const res = await greet(async (args) => {
      calls.push(args);
      return args[0] === "capture-pane" ? DEAD_PANE : "";
    });
    expect(res.ready).toBe(false);
    // the whole point: no /remote-control, no kickoff, nothing typed at bash
    expect(typedText(calls)).toEqual([]);
  });

  it("does not mistake a blocking gate for a ready prompt (it also renders ❯)", async () => {
    const calls: string[][] = [];
    const res = await greet(async (args) => {
      calls.push(args);
      return args[0] === "capture-pane" ? GATE_PANE : "";
    });
    expect(res.ready).toBe(false);
    expect(typedText(calls)).toEqual([]);
  });

  it("answers the bypass-permissions gate, then proceeds to RC (the 'stuck after signin' fix)", async () => {
    // No config key suppresses this gate in Claude 2.1.215 (verified on a live pod
    // 2026-07-28), so the greeter must ANSWER it. Before: waitReady sat here until
    // timeout and RC never happened — the recurring "stuck after signin on RC" bug.
    const calls: string[][] = [];
    let accepted = false;
    const res = await greet(async (args) => {
      calls.push(args);
      // the accept is send-keys "2" (menu selection, NOT -l text); once seen, clears
      if (args[0] === "send-keys" && args[args.length - 1] === "2") accepted = true;
      if (args[0] === "capture-pane") return accepted ? LIVE_PANE : GATE_PANE;
      return "";
    });
    // it selected "2. Yes, I accept", the gate cleared, and it went on to RC
    expect(calls.some((c) => c[0] === "send-keys" && c[c.length - 1] === "2")).toBe(true);
    expect(res.ready).toBe(true);
    expect(typedText(calls).some((t) => t.startsWith("/remote-control"))).toBe(true);
  });

  it("gives up gracefully if the bypass gate never clears (bounded, no infinite answer loop)", async () => {
    const calls: string[][] = [];
    // gate NEVER clears — the answer cap must stop it, not spin forever
    const res = await greet(async (args) => {
      calls.push(args);
      return args[0] === "capture-pane" ? GATE_PANE : "";
    });
    expect(res.ready).toBe(false);
    const accepts = calls.filter((c) => c[0] === "send-keys" && c[c.length - 1] === "2").length;
    expect(accepts).toBeLessThanOrEqual(3); // MAX_BYPASS_ACCEPTS
    expect(typedText(calls)).toEqual([]); // never typed the kickoff into the gate
  });

  const API_KEY_PANE =
    "Detected a custom API key in your environment\nDo you want to use this API key?\n  1. Yes\n❯ 2. No (recommended)\n";

  it("api-key mode: ACCEPTS the 'use this API key?' prompt (picks 1. Yes), then proceeds to RC", async () => {
    const calls: string[][] = [];
    let accepted = false;
    const res = await greet(
      async (args) => {
        calls.push(args);
        if (args[0] === "send-keys" && args[args.length - 1] === "1") accepted = true;
        if (args[0] === "capture-pane") return accepted ? LIVE_PANE : API_KEY_PANE;
        return "";
      },
      { agentAuth: "api-key" },
    );
    // Selected "1. Yes" (by number, not -l text), the prompt cleared, RC proceeded.
    expect(calls.some((c) => c[0] === "send-keys" && c[c.length - 1] === "1")).toBe(true);
    expect(res.ready).toBe(true);
    expect(typedText(calls).some((t) => t.startsWith("/remote-control"))).toBe(true);
  });

  it("subscription mode: NEVER switches onto an app key (treats the prompt as a gate)", async () => {
    const calls: string[][] = [];
    const res = await greet(async (args) => {
      calls.push(args);
      return args[0] === "capture-pane" ? API_KEY_PANE : "";
    }); // default agentAuth = subscription
    expect(calls.some((c) => c[0] === "send-keys" && c[c.length - 1] === "1")).toBe(false);
    expect(res.ready).toBe(false);
    expect(typedText(calls)).toEqual([]);
  });

  it("restarts a dead agent when a respawn command is available, then proceeds", async () => {
    const calls: string[][] = [];
    let respawned = false;
    const res = await greet(
      async (args) => {
        calls.push(args);
        if (args[0] === "respawn-pane") {
          respawned = true;
          return "";
        }
        if (args[0] === "capture-pane") return respawned ? LIVE_PANE : DEAD_PANE;
        return "";
      },
      { respawnCommand: "bash -lc 'claude'" },
    );
    expect(respawned).toBe(true);
    expect(calls.some((c) => c[0] === "respawn-pane" && c.includes("-k"))).toBe(true);
    // recovered: the pod came back on its own instead of stranding at a bash prompt
    expect(res.ready).toBe(true);
    expect(typedText(calls).some((t) => t.startsWith("/remote-control"))).toBe(true);
  });
});
