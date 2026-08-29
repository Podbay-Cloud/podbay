import { execFile } from "node:child_process";
import { existsSync, writeFileSync, appendFileSync } from "node:fs";
import { createLogger, type Logger } from "@podbay/shared/log";
import { sessionStateFromDisk } from "./signals.js";
import { resolveRcRename, DEFAULT_RC_SESSION_HASH_PATH } from "./rc-session-identity.js";
import type { AgentAuth } from "./boot.js";

/**
 * The greeter drives a freshly-started (authed) Claude session over tmux:
 * enable remote control (`/remote-control <title>`) and seed the kickoff
 * trigger so the agent speaks first — with VERIFICATION at every step.
 *
 * This replaces a backgrounded boot-shell script that proved unreliable in two
 * ways (both hit live): it typed before Claude's input existed, and a
 * `send-keys "text" Enter` burst left the text as an unsubmitted multi-line
 * draft (paste semantics — Enter became a newline). Here we:
 *  1. wait until the pane shows Claude's input prompt AND is stable,
 *  2. type literally (`send-keys -l`), pause, send Enter as its own keystroke,
 *  3. CONFIRM the draft left the input box — retry Enter if it's still there.
 *
 * Remote control is best-effort (it's Anthropic's feature and needs a Claude
 * subscription); the kickoff greeting always proceeds. A persistent marker on
 * the volume ensures the kickoff trigger is sent at most once per pod, so an
 * agent restart never re-greets into an ongoing conversation.
 */

export interface GreeterOptions {
  /** tmux session to drive (the pod's terminal session). */
  sessionName: string;
  /** Remote-control session title shown in the user's Claude apps. */
  rcTitle: string;
  /** The kickoff trigger to type after RC, or undefined when the env has none. */
  kickoffTrigger?: string;
  /** Sent INSTEAD of kickoffTrigger when the pod was already greeted (a cold
   * restart): gives the resumed agent a turn so it orients rather than sitting
   * silent in a session the user sees as empty. */
  resumeTrigger?: string;
  /** Run tmux as this uid/gid (the session owner). */
  uid?: number;
  gid?: number;
  /** Sent-at-most-once marker for the kickoff trigger (persistent volume). */
  greetedMarkerPath?: string;
  /** Mode-0600 state file holding a hash of the last RC session id we observed (see
   * rc-session-identity.ts). Defaults to a pod-wide path; an added agent on its own
   * tmux window/RC session should pass a per-agent path so the two don't cross-clobber
   * each other's identity comparison. Override in tests to avoid touching the real file. */
  rcSessionHashPath?: string;
  /** If set, write a timestamped trace (each step + a terminal-pane snapshot) here
   * so remote-control flakiness is diagnosable post-mortem (see server.ts). */
  traceFile?: string;
  logger?: Logger;
  /** Timing overrides (tests). */
  pollMs?: number;
  readyTimeoutMs?: number;
  submitConfirmMs?: number;
  rcConfirmMs?: number;
  /** How long to wait for Claude to report it will accept a typed turn before
   * sending one anyway (best-effort; older CLIs report no status). */
  inputReadyMs?: number;
  /** Shell command used to restart the agent in the pane if it is found dead
   * (typically `kickoffCommandForAgent(...)`). Omit to disable auto-recovery. */
  respawnCommand?: string;
  /** How the pod authenticates its agent. In "api-key" mode claude boots with a BYO
   * key set and shows "Detected a custom API key … use this key?" — the greeter must
   * ACCEPT it (pick Yes). Default "subscription": the key is stripped, so the prompt
   * never appears (and if it did, it's declined via the login menu). */
  agentAuth?: AgentAuth;
  /** Injectable tmux runner (tests). */
  tmux?: (args: string[]) => Promise<string>;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface GreeterResult {
  ready: boolean;
  rcActive: boolean;
  greeted: boolean;
}

const DEFAULT_MARKER = "/home/dev/.podbay-greeted";

/**
 * Detect a suspend/resume cycle from inside the pod. Fly "sleep" freezes the
 * whole process in RAM, so on resume this process simply CONTINUES — no signal,
 * no restart. The tell is a wall-clock jump: a steady heartbeat that suddenly
 * observes far more elapsed time than its interval means we were suspended.
 * Used to re-enable remote control, whose upstream connection dies across the
 * suspend (the Claude app can't reconnect until /remote-control runs again).
 * Returns a stop function.
 */
export function startResumeWatch(
  onResume: (gapMs: number) => void,
  opts: { intervalMs?: number; gapMs?: number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 5_000;
  const gapMs = opts.gapMs ?? 60_000;
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap > gapMs) onResume(gap);
  }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** The heading of Claude's `/login` method picker (capture-pane keeps spacing). */
const LOGIN_MENU_RE = /select login method/i;

/** Claude's "an ANTHROPIC_API_KEY is in your env — use it?" prompt. An env can
 * inject its app's key, which shouldn't hijack the agent's login. The launcher
 * strips the key from claude's env so this rarely shows; if it does, we accept
 * the highlighted "No (recommended)" default. */
const API_KEY_PROMPT_RE = /use this api key|custom api key in your environment/i;

/** Claude Code v2.1.x's FIRST-RUN onboarding shows a theme picker ("Choose the text style…", Dark
 * mode pre-highlighted) BEFORE the login menu. It blocks: `claude /login` never reaches "Select login
 * method" until the theme is accepted, so the login-drive waited forever and no sign-in URL ever
 * printed (velsa, 2026-08-25, on the image that bumped claude to v2.1.215). Accept the highlighted
 * default with Enter, exactly like the API-key prompt. */
const THEME_PROMPT_RE = /choose the text style|to change this later, run \/theme/i;

// Pane-safety predicates now live in @podbay/shared: the control plane types into a
// live pane too (pre-interrupt handoff), and two implementations of "is this pane
// ready" would drift — which is exactly the class of bug that caused the 2026-07-24
// outage. Re-exported here so existing importers and tests are unaffected.
import { agentGone, atBlockingGate, atBypassGate, paneAcceptsInput } from "@podbay/shared/pane";
export { agentGone, atBlockingGate, atBypassGate, paneAcceptsInput };


export interface LoginMenuOptions {
  /** tmux session running the pod's shell. */
  sessionName: string;
  uid?: number;
  gid?: number;
  logger?: Logger;
  pollMs?: number;
  /** How long to wait for the menu to appear before giving up. */
  waitTimeoutMs?: number;
  /** How long to keep re-pressing Enter until the menu is dismissed. */
  confirmMs?: number;
  tmux?: (args: string[]) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * On an unauthenticated first boot, `claude /login` shows a "Select login
 * method" menu with **Claude account with subscription** pre-highlighted, then
 * WAITS — the sign-in URL only prints after a selection. Nothing else drives it,
 * so both the web terminal and the launch wizard sat forever "waiting for the
 * sign-in link" (live bug). This presses Enter to accept the highlighted
 * subscription option (podbay pods run on the user's subscription; remote
 * control needs it anyway), then confirms the menu was dismissed — retrying
 * Enter a few times (the Enter-as-newline timing seen elsewhere).
 *
 * It touches ONLY the method menu: the user still completes OAuth in the browser
 * and the wizard/terminal feeds the code back. Returns true once the menu is
 * gone (sign-in proceeding), false if it never appeared or wouldn't advance.
 */
export async function driveLoginMenu(opts: LoginMenuOptions): Promise<boolean> {
  const log = opts.logger ?? createLogger("pod-agent");
  const pollMs = opts.pollMs ?? 1000;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 120_000;
  const confirmMs = opts.confirmMs ?? 8_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tmux =
    opts.tmux ??
    ((args: string[]) =>
      new Promise<string>((resolve) => {
        execFile(
          "tmux",
          args,
          { maxBuffer: 4 * 1024 * 1024, uid: opts.uid, gid: opts.gid },
          (err, stdout) => resolve(err ? "" : stdout),
        );
      }));
  const pane = () => tmux(["capture-pane", "-p", "-t", opts.sessionName]);

  // 1) Wait for the login menu to render — dismissing an API-key prompt first if
  // one appears (accept the highlighted "No (recommended)" with Enter).
  const deadline = Date.now() + waitTimeoutMs;
  let onMenu = false;
  let dismissedKeyPrompt = false;
  let dismissedTheme = false;
  while (Date.now() < deadline) {
    const p = await pane();
    if (LOGIN_MENU_RE.test(p)) {
      onMenu = true;
      break;
    }
    // v2.1.x shows a theme picker BEFORE the login menu — accept the highlighted default so claude
    // proceeds to "Select login method". Without this, `claude /login` never prints the sign-in URL.
    if (!dismissedTheme && THEME_PROMPT_RE.test(p)) {
      log.info("login_dismiss_theme_prompt", {});
      await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
      dismissedTheme = true;
      await sleep(pollMs);
      continue;
    }
    if (!dismissedKeyPrompt && API_KEY_PROMPT_RE.test(p)) {
      log.info("login_dismiss_api_key_prompt", {});
      await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
      dismissedKeyPrompt = true;
      await sleep(pollMs);
      continue;
    }
    await sleep(pollMs);
  }
  if (!onMenu) {
    log.info("login_menu_absent", { session: opts.sessionName });
    return false;
  }

  // 2) Accept the highlighted subscription option; confirm the menu goes away.
  const confirmDeadline = Date.now() + confirmMs;
  for (let attempt = 0; ; attempt++) {
    await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
    await sleep(1000);
    if (!LOGIN_MENU_RE.test(await pane())) {
      log.info("login_menu_advanced", { attempt });
      return true;
    }
    if (Date.now() >= confirmDeadline || attempt >= 4) {
      log.warn("login_menu_stuck", { session: opts.sessionName });
      return false;
    }
  }
}

/**
 * Wait until Claude will actually ACCEPT a typed turn — its own status says
 * `idle`/`waiting`, not `busy`/`shell`.
 *
 * This replaces a `sleep(1500)` guess. On a `--continue` restart Claude is still
 * restoring the transcript ~1.5s after remote control activates, and a line typed
 * into that window is silently swallowed: live 2026-07-17 the resume nudge logged
 * `sent: true` (the draft cleared) yet never appeared in the transcript and the
 * agent never answered. The same class of bug makes RC attempt #1 hang.
 *
 * Best-effort: if the CLI never reports a status (older versions write no session
 * file), proceed anyway after the timeout rather than block the greeting forever.
 */
async function waitAcceptingInput(
  timeoutMs: number,
  pollMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, waitingFor } = sessionStateFromDisk();
    // No status at all → this CLI doesn't report one (or hasn't registered the
    // session). Don't block on a signal that may never arrive: proceed, as we did
    // before. By this point waitReady has already seen a stable input prompt.
    if (status === undefined) return true;
    // A modal eats keystrokes, and the CLI reports `waiting` while one is up — so
    // `waiting` alone is NOT "ready". Typing into that window is silently
    // swallowed (the draft clears, nothing reaches the transcript), which is how
    // the resume nudge vanished.
    if (isDialogOpen(waitingFor)) {
      await sleep(pollMs);
      continue;
    }
    if (status === "idle" || status === "waiting") return true;
    // busy/shell → still working (or restoring a --continue'd transcript): wait.
    await sleep(pollMs);
  }
  return false;
}

/** The CLI's own "a modal is blocking me" flag (`waitingFor: "dialog open"`). */
function isDialogOpen(waitingFor: string | undefined): boolean {
  return typeof waitingFor === "string" && /dialog/i.test(waitingFor);
}

export async function runGreeter(opts: GreeterOptions): Promise<GreeterResult> {
  const log = opts.logger ?? createLogger("pod-agent");
  const pollMs = opts.pollMs ?? 1000;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 120_000;
  const submitConfirmMs = opts.submitConfirmMs ?? 6_000;
  const rcConfirmMs = opts.rcConfirmMs ?? 30_000;
  const inputReadyMs = opts.inputReadyMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const marker = opts.greetedMarkerPath ?? DEFAULT_MARKER;

  const tmux =
    opts.tmux ??
    ((args: string[]) =>
      new Promise<string>((resolve) => {
        execFile(
          "tmux",
          args,
          { maxBuffer: 4 * 1024 * 1024, uid: opts.uid, gid: opts.gid },
          (err, stdout) => resolve(err ? "" : stdout),
        );
      }));

  const pane = () => tmux(["capture-pane", "-p", "-t", opts.sessionName]);

  // Observability: every step logs an event AND (if traceFile is set) appends a
  // timestamped terminal-pane snapshot, so a failed /remote-control isn't a black
  // box — we can read exactly what the terminal showed and what we did.
  const trace = async (step: string, extra: Record<string, unknown> = {}): Promise<void> => {
    log.info("greeter_trace", { step, ...extra });
    if (!opts.traceFile) return;
    try {
      const snap = (await pane()).split("\n").slice(-45).join("\n");
      appendFileSync(
        opts.traceFile,
        `\n=== ${new Date().toISOString()} · ${step} · ${JSON.stringify(extra)} ===\n${snap}\n`,
      );
    } catch {
      /* trace is best-effort — never let it affect the greet */
    }
  };

  /** The draft region: whatever sits after the LAST input prompt (❯). */
  const draftAfterPrompt = (p: string): string => {
    const i = p.lastIndexOf("❯");
    return i === -1 ? "" : p.slice(i + 1);
  };

  /** Claude is ready when the input prompt is on screen and the pane has
   * stopped changing (two identical polls) — not merely "some output exists"
   * (the static promo screen fooled a naive stability check before). */
  // Cap bypass-gate answers per greet so a mis-detect can't loop. 3 covers the
  // realistic worst case (login→work launch, plus a respawn or two).
  const MAX_BYPASS_ACCEPTS = 3;
  let bypassAccepts = 0;
  // In api-key mode claude greets with "Detected a custom API key … use this key?"
  // (default highlight is "No (recommended)"), which BLOCKS the session until answered.
  // Accept it (pick "1. Yes"). Capped so a mis-detect can't loop.
  const MAX_API_KEY_ACCEPTS = 3;
  let apiKeyAccepts = 0;
  const waitReady = async (): Promise<boolean> => {
    let prev = "";
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      const p = await pane();
      // A dead agent or a blocking gate can both look "stable with a ❯ prompt".
      // Neither can accept a typed turn, so neither counts as ready.
      if (agentGone(p)) {
        // Recover here too, not just before typing: a pod whose agent died at boot
        // must be able to come back on its own rather than sit at a bash prompt.
        if (await tryRespawn()) {
          prev = "";
          await sleep(pollMs);
          continue;
        }
        log.error("greeter_not_ready_agent_exited", {});
        await trace("not_ready_agent_exited", {});
        return false;
      }
      // The --dangerously-skip-permissions acceptance gate has a KNOWN-safe answer
      // for a podbay pod (it asks about exactly the sandbox a pod IS), and NO config
      // key suppresses it in Claude 2.1.215 — verified on a live pod. So ANSWER it
      // rather than wait forever. This is THE fix for "stuck after signin on RC":
      // waitReady used to sit at this gate until timeout, so RC never happened.
      if (atBypassGate(p) && bypassAccepts < MAX_BYPASS_ACCEPTS) {
        bypassAccepts += 1;
        log.warn("greeter_bypass_gate_accept", { attempt: bypassAccepts });
        await trace("bypass_gate_accept", { attempt: bypassAccepts });
        // Select "2. Yes, I accept" by number (robust vs. arrow position), then Enter.
        await tmux(["send-keys", "-t", opts.sessionName, "2"]);
        await sleep(300);
        await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
        // Wait for the gate to actually clear before resuming, so we don't re-answer
        // the transitional screen and leak a stray "2" into the input.
        const clearBy = Date.now() + 5000;
        while (Date.now() < clearBy) {
          await sleep(pollMs);
          if (!atBypassGate(await pane())) break;
        }
        prev = "";
        continue;
      }
      // api-key mode: accept the "use this API key?" prompt (pick "1. Yes") so the
      // session isn't stuck on the default "No". Only in api-key mode — a subscription
      // pod strips the key, so this prompt shouldn't appear, and if it did we'd never
      // want to switch it onto an app key.
      if (
        opts.agentAuth === "api-key" &&
        API_KEY_PROMPT_RE.test(p) &&
        apiKeyAccepts < MAX_API_KEY_ACCEPTS
      ) {
        apiKeyAccepts += 1;
        log.warn("greeter_api_key_accept", { attempt: apiKeyAccepts });
        await trace("api_key_accept", { attempt: apiKeyAccepts });
        await tmux(["send-keys", "-t", opts.sessionName, "1"]); // "1. Yes"
        await sleep(300);
        await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
        const clearBy = Date.now() + 5000;
        while (Date.now() < clearBy) {
          await sleep(pollMs);
          if (!API_KEY_PROMPT_RE.test(await pane())) break;
        }
        prev = "";
        continue;
      }
      if (atBlockingGate(p)) {
        log.warn("greeter_blocking_gate", {});
        await trace("blocking_gate", {});
        prev = "";
        await sleep(pollMs);
        continue;
      }
      if (p.includes("❯") && p === prev) return true;
      prev = p;
      await sleep(pollMs);
    }
    return false;
  };

  /**
   * Recover a pane whose agent has died, once. Returns true if the agent is (or was
   * already) alive. Without this the greeter would keep typing into bash — see
   * AGENT_EXITED_MARKER in boot.ts for the outage this comes from.
   */
  let respawnAttempted = false;
  /** Restart a dead agent, at most once per greet. True if a respawn was issued. */
  const tryRespawn = async (): Promise<boolean> => {
    if (!opts.respawnCommand || respawnAttempted) return false;
    respawnAttempted = true;
    log.warn("greeter_agent_dead_respawning", {});
    await trace("agent_respawn", {});
    // -k kills the dead shell first, so the pane isn't left stacked.
    await tmux(["respawn-pane", "-k", "-t", opts.sessionName, opts.respawnCommand]);
    return true;
  };

  const ensureAgentAlive = async (): Promise<boolean> => {
    if (!agentGone(await pane())) return true;
    if (!(await tryRespawn())) {
      log.error("greeter_agent_dead", { respawned: respawnAttempted });
      await trace("agent_dead", { respawned: respawnAttempted });
      return false;
    }
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const p = await pane();
      if (!agentGone(p) && !atBlockingGate(p) && p.includes("❯")) return true;
    }
    await trace("agent_respawn_timeout", {});
    return false;
  };

  /** Type a line literally, submit with a separate Enter, and verify the text
   * actually left the input draft; re-press Enter while it's still sitting
   * there (the failure mode where Enter landed as a newline). */
  const submitLine = async (text: string): Promise<boolean> => {
    // NEVER type into a dead pane: a slash-command sent to bash becomes
    // `bash: /remote-control: No such file or directory`, and the kickoff becomes
    // `bash: Time: command not found` (outage 2026-07-24, pod prime-cat-8ba8).
    if (!(await ensureAgentAlive())) {
      log.error("greeter_send_aborted_agent_dead", { text: text.slice(0, 24) });
      return false;
    }
    // A distinctive fragment survives mid-draft wrapping (long lines wrap).
    const fragment = text.slice(0, 24);
    await trace("type", { text: fragment });
    await tmux(["send-keys", "-t", opts.sessionName, "-l", text]);
    await sleep(600);
    const deadline = Date.now() + submitConfirmMs;
    for (let attempt = 0; ; attempt++) {
      await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
      await sleep(800);
      const p = await pane();
      if (!draftAfterPrompt(p).includes(fragment)) return true; // submitted
      if (Date.now() >= deadline || attempt >= 4) {
        await trace("submit_gave_up", { text: fragment, attempt });
        return false;
      }
      log.warn("greeter_submit_retry", { text: fragment, attempt });
    }
  };

  const result: GreeterResult = { ready: false, rcActive: false, greeted: false };

  result.ready = await waitReady();
  await trace("ready", { ready: result.ready });
  if (!result.ready) {
    log.warn("greeter_never_ready", { session: opts.sessionName });
    return result;
  }

  // 1) Remote control (best-effort): enable + title the session. RETRY up to 3× —
  // one attempt is too fragile (fired on a transient-ready screen, an MCP prompt
  // swallowed it, or activation was slow). Detection is BROAD: the confirm line OR
  // the session URL OR "remote control enabled" — resilient to wording drift.
  const RC_ACTIVE_RE =
    /remote[- ]control is active|claude\.ai\/code\/session_[A-Za-z0-9]+|remote control (is )?enabled/i;
  //
  // `/remote-control` ALWAYS opens a modal, and which one depends on the pod:
  //
  //  - never consented (fresh volume): "Enable Remote Control" / "Never mind".
  //  - already active (every wake — the bridge id survives a suspend): a menu
  //    reading "Disconnect this session / Show QR code / ❯ Continue".
  //
  // Both park on their SAFE option (enable / continue), so ENTER takes the
  // default in either case. Esc must never be used: on the consent modal it
  // means "Never mind", which declines RC *and* sets remoteDialogSeen, so the
  // dialog never returns and RC can never enable itself again.
  //
  // We still send /remote-control on every wake (it's what re-establishes the
  // bridge when a suspend killed it), and we do NOT skip on a live bridge id —
  // that id persists across a suspend whether or not the connection survived,
  // so it can't tell us RC is healthy. Leaving the modal unanswered is what
  // stuck the session: it swallows keystrokes while the Claude app still shows
  // "connected" (live 2026-07-17), and it PRINTS the session URL, so
  // RC_ACTIVE_RE matched the menu text and we declared success and walked away.
  let rcSubmitted = false;
  for (let rcAttempt = 0; rcAttempt < 3 && !result.rcActive; rcAttempt++) {
    if (rcAttempt > 0) await trace("rc_retry", { attempt: rcAttempt });
    rcSubmitted = await submitLine(`/remote-control ${opts.rcTitle}`);
    if (!rcSubmitted) continue;
    const deadline = Date.now() + rcConfirmMs;
    while (Date.now() < deadline) {
      // Answer the modal the command just opened, taking its default.
      if (isDialogOpen(sessionStateFromDisk().waitingFor)) {
        await trace("rc_dialog_enter", { attempt: rcAttempt });
        await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
      }
      if (sessionStateFromDisk().url || RC_ACTIVE_RE.test(await pane())) {
        result.rcActive = true;
        break;
      }
      await sleep(pollMs);
    }
  }
  // Never hand back a session that can't take input: RC_ACTIVE_RE matching the
  // menu's own URL is exactly how we used to miss an open modal.
  if (!(await waitAcceptingInput(rcConfirmMs, pollMs, sleep))) {
    await trace("rc_input_blocked", { waitingFor: sessionStateFromDisk().waitingFor });
    await tmux(["send-keys", "-t", opts.sessionName, "Enter"]);
    if (!(await waitAcceptingInput(rcConfirmMs, pollMs, sleep))) {
      await trace("rc_still_blocked_after_enter", {});
    }
  }
  log.info("greeter_rc", { submitted: rcSubmitted, active: result.rcActive });
  // The key blind spot: capture the terminal whenever RC didn't confirm, so we
  // can see WHY (a different confirmation string, an MCP/permission prompt, the
  // draft never submitting, …).
  if (!result.rcActive) await trace("rc_not_active", { submitted: rcSubmitted });

  // 1b) Name the Claude-app session to match the pod. Current Claude Code (2.1.215) doesn't surface
  // the `/remote-control <title>` title in the app's session list — it shows `<hostname>-<auto-slug>` /
  // the conversation's auto-summary (a cold restart shows up as "Resume session context", which the
  // owner can't recognize). `/rename` IS honoured and propagates to every app view.
  //
  // Ownership is decided by RC SESSION IDENTITY, not by "did the pod-agent process restart"
  // (the old `coldStart` boolean). The tmux-hosted Claude process — and therefore the RC
  // session it owns — can survive a pod-agent-only restart, so a process-restart signal alone
  // can't tell "same session" from "fresh session" and would clobber an owner rename. Instead we
  // compare the CURRENTLY observed RC session id (Claude's own `bridgeSessionId`, surfaced as
  // `sessionStateFromDisk().url` — the same load-bearing signal the cockpit/auth flows already
  // depend on) against a hash of the last-observed one (rc-session-identity.ts):
  //  - same id            → same RC session survived → do NOT rename (preserves any rename,
  //                          Podbay's or the owner's own).
  //  - different id, or no prior hash → fresh/replacement session → RENAME, exactly like the
  //                          old coldStart:true path.
  //  - no observable id at all → no evidence either way → do NOT rename (the `/remote-control
  //                          <title>` call above is the documented best-effort) and leave the
  //                          persisted hash untouched.
  if (result.rcActive && opts.rcTitle) {
    await waitAcceptingInput(inputReadyMs, pollMs, sleep);
    const currentSessionId = sessionStateFromDisk().url;
    const renameDecision = resolveRcRename(
      currentSessionId,
      opts.rcSessionHashPath ?? DEFAULT_RC_SESSION_HASH_PATH,
    );
    if (renameDecision.shouldRename) {
      const renamed = await submitLine(`/rename ${opts.rcTitle}`);
      log.info("greeter_rename", { renamed, title: opts.rcTitle });
    } else {
      log.info("greeter_rename_skipped", {
        reason: currentSessionId === undefined ? "unobservable_session_id" : "same_session",
      });
    }
  }

  // 2) Kickoff trigger — at most once per pod (marker on the persistent volume),
  // so an agent restart never re-greets into an ongoing conversation. On a COLD
  // RESTART of an already-greeted pod we instead send the RESUME trigger: claude
  // relaunched (with --continue, so the history is back) but won't speak until it
  // gets a turn — which is why a restarted pod looked "empty and the agent didn't
  // lead". The nudge makes the kickoff's resume block fire (read PLAN.md, orient,
  // continue). Suspend/resume never lands here — it thaws the same process.
  if (existsSync(marker)) {
    // COLD RESTART of an ALREADY-greeted pod — kickoff or not. Claude relaunched with --continue (so
    // the history is back) but won't speak until it gets a turn, so nudge it to orient. This used to be
    // gated on `kickoffTrigger`, so a pod with NO kickoff resumed SILENTLY on every update — it got the
    // handoff note but never the "Resuming — where are we?" turn (owner: first10, 2026-08-26).
    if (opts.resumeTrigger) {
      // Claude is still restoring the --continue'd transcript right after RC; typing into that window
      // gets swallowed. Wait for it to say it's ready.
      await waitAcceptingInput(inputReadyMs, pollMs, sleep);
      const sent = await submitLine(opts.resumeTrigger);
      log.info("greeter_resume", { sent });
    } else {
      log.info("greeter_already_greeted", {});
    }
  } else if (opts.kickoffTrigger) {
    // FIRST greet with a kickoff configured — send it, and mark greeted only on success so a failed
    // send retries next time.
    await waitAcceptingInput(inputReadyMs, pollMs, sleep);
    result.greeted = await submitLine(opts.kickoffTrigger);
    if (result.greeted) {
      try {
        writeFileSync(marker, new Date().toISOString());
      } catch {
        /* marker is best-effort */
      }
    }
    log.info("greeter_kickoff", { sent: result.greeted });
  } else {
    // FIRST greet with NO kickoff: nothing to send, but MARK the pod greeted so its next restart takes
    // the resume-nudge branch above (the marker used to be written only when a kickoff was sent, so a
    // no-kickoff pod never counted as greeted and never got the resume nudge).
    try {
      writeFileSync(marker, new Date().toISOString());
    } catch {
      /* marker is best-effort */
    }
    log.info("greeter_marked_greeted_no_kickoff", {});
  }

  return result;
}
