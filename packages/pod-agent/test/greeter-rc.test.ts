import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
function fakeTmux(
  opts: { rcActivates?: boolean; sessionUrl?: string; activateViaTextOnly?: boolean } = {},
) {
  const calls: string[][] = [];
  const activatedUrl = opts.sessionUrl ?? "https://claude.ai/code/session_x";
  let draft = "";
  let modalOpen = false;
  let rcUrl: string | null = null;
  let textOnlyActive = false; // RC confirmed via pane text, but no bridge id ever hit disk

  const screen = () =>
    modalOpen
      ? `Remote Control\n This session is available at https://claude.ai/code/session_x\n  Disconnect this session\n  Show QR code\n❯ Continue\n Enter to select · Esc to continue`
      : `${rcUrl ? `/remote-control is active · ${rcUrl}\n` : textOnlyActive ? "remote control enabled\n" : ""}❯ ${draft}\n  ⏵⏵ bypass permissions on`;

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
          if (opts.activateViaTextOnly) {
            textOnlyActive = true; // active per the pane text, but NO observable session id
          } else if (opts.rcActivates !== false) {
            rcUrl = activatedUrl;
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

/** Fresh tmp path per call so tests don't read/write the real pod's default
 * rc-session-hash file (that file is a real Podbay state file on this dev pod's
 * own home volume, and would otherwise leak state between test runs). */
const tmpHashPath = () => path.join(mkdtempSync(path.join(tmpdir(), "rc-hash-")), "rc-session-hash");

const opts = (tmux: (a: string[]) => Promise<string>, extra: Record<string, unknown> = {}) => ({
  sessionName: "pod",
  rcTitle: "Podbay GTM",
  tmux,
  sleep: noSleep,
  ...fast,
  ...extra,
});

const renamedTo = (calls: string[][]) =>
  calls
    .filter((c) => c[0] === "send-keys" && c.includes("-l"))
    .map((c) => c[c.length - 1])
    .filter((s) => s.startsWith("/rename"));

describe("greeter remote control", () => {
  beforeEach(() => {
    diskState = { status: "idle" };
  });

  it("answers the modal with Enter and ends up with remote control active", async () => {
    const t = fakeTmux();

    const result = await runGreeter(opts(t.tmux, { rcSessionHashPath: tmpHashPath() }));

    expect(t.keys()).toContain("Enter");
    expect(result.rcActive).toBe(true);
  });

  it("never sends Escape (that would decline remote control for good)", async () => {
    const t = fakeTmux();

    await runGreeter(opts(t.tmux, { rcSessionHashPath: tmpHashPath() }));

    expect(t.keys()).not.toContain("Escape");
  });

  it("does not hand back a session still blocked on a modal", async () => {
    const t = fakeTmux();

    await runGreeter(opts(t.tmux, { rcSessionHashPath: tmpHashPath() }));

    expect(diskState.waitingFor).toBeUndefined();
  });

  it("still re-sends /remote-control when a bridge id is already on disk", async () => {
    // The id survives a suspend whether or not the connection did, so it must not
    // be treated as proof RC is healthy — re-sending is what rebuilds the bridge.
    diskState.url = "https://claude.ai/code/session_old";
    const t = fakeTmux();

    await runGreeter(opts(t.tmux, { rcSessionHashPath: tmpHashPath() }));

    const typed = t.calls
      .filter((c) => c[0] === "send-keys" && c.includes("-l"))
      .map((c) => c[c.length - 1]);
    expect(typed.some((s) => s.includes("/remote-control"))).toBe(true);
  });
});

/**
 * Title ownership: `/rename` runs only for an observed fresh/replacement RC
 * session identity (rc-session-identity.ts), never merely because the pod-agent
 * PROCESS restarted. Each scenario drives `runGreeter` twice against the SAME
 * `rcSessionHashPath`, modelling two greets in sequence (e.g. a pod-agent-only
 * restart while the tmux-hosted Claude process stays alive) — exactly the
 * production sequence the old `coldStart: true` boolean got wrong.
 */
describe("greeter remote control: title ownership by RC session identity", () => {
  beforeEach(() => {
    diskState = { status: "idle" };
  });

  it("first-ever observed session → renames", async () => {
    const hashPath = tmpHashPath();
    const t = fakeTmux({ sessionUrl: "https://claude.ai/code/session_first" });

    await runGreeter(opts(t.tmux, { rcSessionHashPath: hashPath }));

    expect(renamedTo(t.calls)).toEqual(["/rename Podbay GTM"]);
  });

  it("same observed session id on a second greet (pod-agent-only restart) → does NOT re-rename", async () => {
    // This is the exact bug: the tmux-hosted Claude process (and its RC session)
    // survives while pod-agent itself restarts. The OLD coldStart:true logic
    // would have sent /rename again here and could have clobbered an owner rename.
    const hashPath = tmpHashPath();
    const sessionUrl = "https://claude.ai/code/session_same";

    diskState = { status: "idle" };
    const t1 = fakeTmux({ sessionUrl });
    await runGreeter(opts(t1.tmux, { rcSessionHashPath: hashPath }));
    expect(renamedTo(t1.calls)).toEqual(["/rename Podbay GTM"]); // first greet: fresh, renames

    diskState = { status: "idle" }; // simulate the pod-agent process restarting
    const t2 = fakeTmux({ sessionUrl }); // same RC session identity as before
    await runGreeter(opts(t2.tmux, { rcSessionHashPath: hashPath }));
    expect(renamedTo(t2.calls)).toEqual([]); // NOT renamed again — preserves any owner rename
  });

  it("a REPLACEMENT session id on a second greet (e.g. cold image-update boot) → renames again", async () => {
    const hashPath = tmpHashPath();

    diskState = { status: "idle" };
    const t1 = fakeTmux({ sessionUrl: "https://claude.ai/code/session_before" });
    await runGreeter(opts(t1.tmux, { rcSessionHashPath: hashPath }));
    expect(renamedTo(t1.calls)).toEqual(["/rename Podbay GTM"]);

    diskState = { status: "idle" }; // a genuinely fresh RC session — new id
    const t2 = fakeTmux({ sessionUrl: "https://claude.ai/code/session_after" });
    await runGreeter(opts(t2.tmux, { rcSessionHashPath: hashPath }));
    expect(renamedTo(t2.calls)).toEqual(["/rename Podbay GTM"]); // renamed again — a real replacement
  });

  // REGRESSION (caught by CI's real-tmux greeter.test.ts, 2026-08-27 — this sandbox can't run it):
  // RC-active is accepted from the PANE as well as the session file, so the greeter legitimately
  // reaches the rename step with nothing for sessionStateFromDisk() to read. This case previously
  // asserted "no id ⇒ never rename", which silently dropped the whole cold-restart naming fix in
  // that window. The rule is narrower: skip only when there IS a prior hash (something to clobber).
  it("RC active, no observable session id, and NO prior hash → still renames (nothing to clobber)", async () => {
    const hashPath = tmpHashPath();
    const t = fakeTmux({ activateViaTextOnly: true });

    const result = await runGreeter(opts(t.tmux, { rcSessionHashPath: hashPath }));

    expect(result.rcActive).toBe(true);
    expect(renamedTo(t.calls)).toEqual(["/rename Podbay GTM"]);
    const typed = t.calls
      .filter((c) => c[0] === "send-keys" && c.includes("-l"))
      .map((c) => c[c.length - 1]);
    expect(typed.some((s) => s.startsWith("/remote-control"))).toBe(true); // still attempted, best-effort
  });

  it("RC active, no observable session id, but a PRIOR hash exists → does NOT rename", async () => {
    // We've recorded a session for this pod before and can't prove this one differs, so a rename
    // could clobber a title the owner set in the Claude app. /remote-control <title> already went
    // out earlier in the same greet — that's the best-effort path here.
    const hashPath = tmpHashPath();
    // First greet with a real, observable id → records a hash.
    const t1 = fakeTmux({ sessionUrl: "https://claude.ai/code/session_prior" });
    await runGreeter(opts(t1.tmux, { rcSessionHashPath: hashPath }));
    expect(renamedTo(t1.calls)).toEqual(["/rename Podbay GTM"]);

    // Second greet: RC confirms via pane text only, no id to compare against the recorded hash.
    const t2 = fakeTmux({ activateViaTextOnly: true });
    const result = await runGreeter(opts(t2.tmux, { rcSessionHashPath: hashPath }));

    expect(result.rcActive).toBe(true);
    expect(renamedTo(t2.calls)).toEqual([]);
  });
});
