import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `/remote-control` always opens a modal, and an unanswered modal is what stuck
 * the session: it swallows keystrokes while the Claude app still shows the
 * session as connected (live 2026-07-17 — the pod reported
 * `status: waiting`, `waitingFor: "dialog open"` for hours).
 *
 * Which modal depends on the pod, and both park on their safe option, so ENTER
 * takes the default in either case:
 *   - fresh volume  → "Enable Remote Control" / "Never mind"
 *   - already active → "Disconnect this session / Show QR code / ❯ Continue"
 * Esc must never be used — on the consent modal it means "Never mind", which
 * declines RC and sets remoteDialogSeen so the modal never returns.
 */

let diskState: { url?: string; status?: string; waitingFor?: string } = {};
vi.mock("../src/signals.js", () => ({
  sessionStateFromDisk: () => ({ ...diskState }),
}));

const { runGreeter } = await import("../src/greeter.js");

const fast = { pollMs: 1, readyTimeoutMs: 300, submitConfirmMs: 250, rcConfirmMs: 80 };
const noSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 1)));

/**
 * tmux fake modelling the real thing: submitting /remote-control opens a modal
 * that blocks input until Enter, and the modal PRINTS the session URL (which is
 * how RC_ACTIVE_RE used to report success over an open modal).
 */
function fakeTmux(opts: { rcActivates?: boolean } = {}) {
  const calls: string[][] = [];
  let draft = "";
  let modalOpen = false;
  let rcUrl: string | null = null;

  const screen = () =>
    modalOpen
      ? `Remote Control\n This session is available at https://claude.ai/code/session_x\n  Disconnect this session\n  Show QR code\n❯ Continue\n Enter to select · Esc to continue`
      : `${rcUrl ? `/remote-control is active · ${rcUrl}\n` : ""}❯ ${draft}\n  ⏵⏵ bypass permissions on`;

  const tmux = async (args: string[]): Promise<string> => {
    calls.push(args);
    if (args[0] === "capture-pane") return screen();
    if (args[0] === "send-keys") {
      const last = args[args.length - 1];
      if (args.includes("-l")) {
        // A modal ignores typed text — exactly why the old retry did nothing.
        if (!modalOpen) draft += last;
      } else if (last === "Enter") {
        if (modalOpen) {
          modalOpen = false; // default option: enable / continue
          diskState.waitingFor = undefined;
          if (opts.rcActivates !== false) {
            rcUrl = "https://claude.ai/code/session_x";
            diskState.url = rcUrl;
          }
          diskState.status = "idle";
        } else if (draft.startsWith("/remote-control")) {
          draft = "";
          modalOpen = true;
          diskState.waitingFor = "dialog open";
          diskState.status = "waiting";
        } else {
          draft = "";
        }
      } else if (last === "Escape") {
        modalOpen = false; // "Never mind" — RC declined, and never offered again
        diskState.waitingFor = undefined;
      }
      return "";
    }
    return "";
  };
  const keys = () =>
    calls.filter((c) => c[0] === "send-keys" && !c.includes("-l")).map((c) => c[c.length - 1]);
  return { tmux, calls, keys };
}

const opts = (tmux: (a: string[]) => Promise<string>) => ({
  sessionName: "pod",
  rcTitle: "Podbay GTM",
  tmux,
  sleep: noSleep,
  ...fast,
});

describe("greeter remote control", () => {
  beforeEach(() => {
    diskState = { status: "idle" };
  });

  it("answers the modal with Enter and ends up with remote control active", async () => {
    const t = fakeTmux();

    const result = await runGreeter(opts(t.tmux));

    expect(t.keys()).toContain("Enter");
    expect(result.rcActive).toBe(true);
  });

  it("never sends Escape (that would decline remote control for good)", async () => {
    const t = fakeTmux();

    await runGreeter(opts(t.tmux));

    expect(t.keys()).not.toContain("Escape");
  });

  it("does not hand back a session still blocked on a modal", async () => {
    const t = fakeTmux();

    await runGreeter(opts(t.tmux));

    expect(diskState.waitingFor).toBeUndefined();
  });

  it("still re-sends /remote-control when a bridge id is already on disk", async () => {
    // The id survives a suspend whether or not the connection did, so it must not
    // be treated as proof RC is healthy — re-sending is what rebuilds the bridge.
    diskState.url = "https://claude.ai/code/session_old";
    const t = fakeTmux();

    await runGreeter(opts(t.tmux));

    const typed = t.calls
      .filter((c) => c[0] === "send-keys" && c.includes("-l"))
      .map((c) => c[c.length - 1]);
    expect(typed.some((s) => s.includes("/remote-control"))).toBe(true);
  });
});
