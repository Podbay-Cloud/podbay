import { paneAcceptsInput } from "@podbay/shared/pane";
import type { Logger } from "@podbay/shared/log";
import type { SandboxProvider } from "@podbay/provider";

/** Where the agent writes its note. On the PERSISTENT home volume — a note on the
 * ephemeral rootfs would vanish on exactly the event it exists for. */
export const HANDOFF_DIR = "/home/dev/.podbay/handoff";

/** Typed into the live agent pane. Phrased as a request to the agent, not a shell
 * command: it is delivered by `tmux send-keys` into whatever the agent is showing. */
const HANDOFF_REQUEST =
  "/handoff — this pod is about to restart (update, resize, or suspend). Write your handoff note now, then stop.";

/** Same `/handoff` mechanism, different trigger: control of this pod is being handed to T3 Code, which
 * will start its OWN fresh session. The note is how that session picks up where you left off. */
export const T3_HANDOFF_REQUEST =
  "/handoff — control of this pod is being handed to T3 Code, which will start a FRESH session. Write your handoff note now (what you were doing, current state, next steps) so it can continue where you left off, then stop.";

/** Default budget for the whole best-effort attempt. 60s (owner decision,
 * 2026-07-28: "update can take its time") — the timeout only ever costs anything
 * when a pane LOOKS ready but its agent doesn't finish writing (a dead or gated
 * pane is skipped instantly; a responsive agent returns early), and the first
 * live exit-gate run showed a real agent losing the race at 20s: it was killed
 * between writing its note and renaming it into place. An update is already a
 * user-acknowledged interruption with visible progress; a completed note is
 * worth more than 40 saved seconds. */
export const HANDOFF_TIMEOUT_MS = 60_000;

const POLL_MS = 1_000;

export interface RequestHandoffOptions {
  provider: SandboxProvider;
  podId: string;
  log: Logger;
  timeoutMs?: number;
  /** The line typed into each live pane. Defaults to the restart-interrupt phrasing; callers on a
   * different trigger (e.g. yielding control to T3 Code) pass their own so the note's framing is
   * honest about WHY the handoff is being written. */
  request?: string;
  /** Injectable clock for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run a command in the pod as the session owner, returning stdout ("" on any failure). */
async function exec(provider: SandboxProvider, id: string, script: string): Promise<string> {
  try {
    const r = await provider.exec(id, ["su", "-", "dev", "-c", script]);
    return r?.stdout ?? "";
  } catch {
    return "";
  }
}

/** tmux window INDEXES for the session. Indexes, not names: tmux auto-renames a
 * window to whatever command is running in it (a pane briefly running bash reports
 * "bash"), so names are not stable identity. pod-agent's agentTarget() targets
 * `main:<index>` for the same reason — match it. Empty when tmux is absent. */
async function listWindows(provider: SandboxProvider, id: string): Promise<string[]> {
  const out = await exec(provider, id, "tmux list-windows -t main -F '#{window_index}' 2>/dev/null");
  return out
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Best-effort: ask every live agent window to write a handoff note before the pod is
 * interrupted.
 *
 * Contract, in priority order:
 *  1. NEVER throw. Every failure mode — no tmux, dead pane, blocking gate, exec error,
 *     timeout — is logged and swallowed. The caller's lifecycle action must be
 *     indistinguishable from one where this feature does not exist.
 *  2. NEVER exceed `timeoutMs`. An unresponsive agent must not hold an update open.
 *  3. Never type into a pane that cannot accept input (see @podbay/shared/pane) —
 *     typing into a shell or a modal is the 2026-07-24 failure mode.
 *
 * Returns the windows that produced a note. Callers may log it; nothing branches on it.
 */
export async function requestHandoff(opts: RequestHandoffOptions): Promise<string[]> {
  const { provider, podId, log } = opts;
  const request = opts.request ?? HANDOFF_REQUEST;
  const timeoutMs = opts.timeoutMs ?? HANDOFF_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = now() + timeoutMs;
  const written: string[] = [];

  try {
    if (typeof provider.exec !== "function") return written;

    const windows = await listWindows(provider, podId);
    if (windows.length === 0) {
      log.info("handoff_skipped", { podId, reason: "no_tmux_windows" });
      return written;
    }

    // Snapshot each window's note mtime BEFORE asking, so "a note appeared" means a
    // NEW note — a stale one from a previous interrupt must not count as success.
    const before = new Map<string, string>();
    const asked: string[] = [];

    for (const w of windows) {
      const pane = await exec(provider, podId, `tmux capture-pane -p -t main:${w} 2>/dev/null`);
      if (!pane) continue; // window vanished mid-loop
      if (!paneAcceptsInput(pane)) {
        log.info("handoff_skipped_window", { podId, window: w, reason: "pane_not_accepting" });
        continue;
      }
      before.set(w, await exec(provider, podId, `stat -c %Y '${HANDOFF_DIR}/${w}.md' 2>/dev/null`));
      // send-keys in two steps: the request, then Enter — matching how the greeter
      // submits, so a UI that swallows a trailing newline still gets the turn.
      await exec(
        provider,
        podId,
        `tmux send-keys -t main:${w} ${JSON.stringify(request)} 2>/dev/null && ` +
          `sleep 0.3 && tmux send-keys -t main:${w} Enter 2>/dev/null`,
      );
      asked.push(w);
    }

    if (asked.length === 0) return written;

    // Poll for a NEWER note per asked window until the shared deadline.
    while (now() < deadline && written.length < asked.length) {
      await sleep(POLL_MS);
      for (const w of asked) {
        if (written.includes(w)) continue;
        const after = await exec(
          provider,
          podId,
          `stat -c %Y '${HANDOFF_DIR}/${w}.md' 2>/dev/null`,
        );
        if (after && after.trim() && after.trim() !== (before.get(w) ?? "").trim()) written.push(w);
      }
    }

    if (written.length < asked.length) {
      log.info("handoff_timeout", { podId, asked: asked.length, written: written.length });
    } else {
      log.info("handoff_written", { podId, windows: written });
    }
  } catch (e) {
    // Belt and braces: the helpers above already swallow, but this function is called
    // on a path where an escaping error would fail an owner-initiated action.
    log.warn("handoff_failed", { podId, err: e });
  }
  return written;
}

export interface ResizeNoteOptions {
  provider: SandboxProvider;
  podId: string;
  /** Tier label + the pod's ACTUAL resources after the resize. Disk is the pod's real
   * diskGb (grow-only high-water mark), NOT the tier default — a resize-down keeps it. */
  label: string;
  cpus: number;
  memoryGb: number;
  diskGb: number;
  at: string;
  log: Logger;
}

/**
 * Leave a one-time note about the pod's NEW resources where the resumed agent will read
 * it — the same `~/.podbay/handoff/` dir the resume-from-handoff rule already tells agents
 * to check on restart. A resize just restarts the pod; without this the agent resumes with
 * no idea it's now bigger (the reason a resize-UP exists) or smaller.
 *
 * Best-effort, never throws — a failed note must never fail the resize. Written to a fixed
 * filename so each resize overwrites the last (it always reflects the current tier), and
 * marked one-time so the agent knows to disregard it on unrelated later restarts.
 */
export async function writeResizeNote(o: ResizeNoteOptions): Promise<void> {
  try {
    if (typeof o.provider.exec !== "function") return;
    const body = [
      "# Your pod was resized",
      "",
      `At ${o.at}, the owner resized this pod to **${o.label}** — you now have:`,
      `- ${o.cpus} vCPU`,
      `- ${o.memoryGb} GB RAM`,
      `- ${o.diskGb} GB disk (disk only GROWS — a resize-down keeps the larger disk)`,
      "",
      "If you were constrained before (e.g. an OOM), you have this headroom now. If CPU/RAM",
      "went DOWN, keep your usage within the new limits — disk is unchanged.",
      "",
      "This is a one-time notice; disregard it on later restarts.",
      "",
    ].join("\n");
    // Quoted heredoc delimiter → no shell expansion of the note body.
    const script = `mkdir -p '${HANDOFF_DIR}' && cat > '${HANDOFF_DIR}/pod-resized.md' <<'PBRESIZENOTE'\n${body}PBRESIZENOTE\n`;
    await o.provider.exec(o.podId, ["su", "-", "dev", "-c", script]);
    o.log.info("resize_note_written", { podId: o.podId, label: o.label });
  } catch (e) {
    o.log.warn("resize_note_failed", { podId: o.podId, err: e });
  }
}

export interface T3HandoffNoteOptions {
  provider: SandboxProvider;
  podId: string;
  /** `to-t3`: control just passed TO T3 (read by T3's fresh session). `to-podbay`: control just
   * returned FROM T3 (read by the resumed Podbay agent). */
  direction: "to-t3" | "to-podbay";
  at: string;
  log: Logger;
}

/**
 * A self-describing pointer note for the T3 control hand-off, written to a fixed filename in the same
 * `~/.podbay/handoff/` dir the resume-from-handoff rule already tells every fresh agent to read.
 *
 * Two directions, two very different guarantees — and the note is honest about which:
 *  - `to-t3`: Podbay's live agents just wrote their own per-window notes (via `requestHandoff`), so
 *    this note points T3's fresh session at them — a real context handoff.
 *  - `to-podbay`: T3 drove the pod from its OWN sessions, which are NOT in Podbay's tmux and cannot be
 *    asked for a note. There is no transcript to move — so this note points the resumed Podbay agent
 *    at the real evidence instead: the working tree (`git diff`) T3 edited, and T3's history under `~/.t3`.
 *
 * Best-effort, never throws — a failed note must never fail the enable/disable. Overwrites a fixed
 * filename and is marked one-time so an unrelated later restart disregards it.
 */
export async function writeT3HandoffNote(o: T3HandoffNoteOptions): Promise<void> {
  try {
    if (typeof o.provider.exec !== "function") return;
    const body =
      o.direction === "to-t3"
        ? [
            "# Control handed to T3 Code",
            "",
            `At ${o.at}, the owner switched this pod to T3 Code control, and you are a fresh session started by T3.`,
            "",
            "The Podbay session(s) that were driving this pod just left handoff notes in this directory",
            "(the per-window `*.md` files next to this one). Read them and continue that work where it left off.",
            "",
            "This is a one-time notice; disregard it on later restarts.",
            "",
          ].join("\n")
        : [
            "# Control returned to Podbay from T3 Code",
            "",
            `At ${o.at}, the owner turned off T3 Code control and Podbay is driving this pod again.`,
            "",
            "While T3 was in control it ran its OWN agent sessions (not in this tmux), so there is no transcript",
            "to resume — but its file edits are in your working tree. Run `git status` and `git diff` to see what",
            "changed and continue from there. T3's own session history, if you need it, is under `~/.t3`.",
            "",
            "This is a one-time notice; disregard it on later restarts.",
            "",
          ].join("\n");
    // Quoted heredoc delimiter → no shell expansion of the note body.
    const script = `mkdir -p '${HANDOFF_DIR}' && cat > '${HANDOFF_DIR}/t3-control.md' <<'PBT3NOTE'\n${body}PBT3NOTE\n`;
    await o.provider.exec(o.podId, ["su", "-", "dev", "-c", script]);
    o.log.info("t3_handoff_note_written", { podId: o.podId, direction: o.direction });
  } catch (e) {
    o.log.warn("t3_handoff_note_failed", { podId: o.podId, err: e });
  }
}
