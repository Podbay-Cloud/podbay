/**
 * Commands run in the pod's persistent tmux session.
 *
 * First boot without credentials runs the CLI login; once the pod-agent sees
 * the authenticated transition it RESPAWNS the window into the kickoff session
 * (login is a separate process that dies — nothing is typed into a live REPL).
 * Already-authenticated pods boot straight into the agent.
 *
 * The kickoff travels as a FILE and is passed via --append-system-prompt-file,
 * so the onboarding instructions drive the agent WITHOUT appearing in the
 * transcript. Claude launches PROMPT-FREE: enabling remote control and typing
 * the visible kickoff trigger are done by the pod-agent's GREETER (greeter.ts),
 * which waits for real readiness and verifies every submit — a backgrounded
 * boot-shell script proved unreliable at both. (A positional launch prompt also
 * suppresses remote control, verified on claude 2.1.209.) codex's kickoff stays a
 * positional argument (no hidden-prompt flag exists); its remote control is a
 * SEPARATE daemon (`codex remote-control start`) the pod-agent runs out-of-band
 * (server.ts ensureCodexDaemon), not a TUI slash-command, so it doesn't affect the
 * launch line here.
 *
 * The permission mode is passed explicitly (Claude Code v2 does not reliably
 * honor a settings.json defaultMode); it comes from the env's `permissions.mode`
 * so a trusted first-party env can go fully open while the default stays guarded.
 */

export const KICKOFF_PATH = "/home/dev/.podbay-kickoff";
/** The one short user turn shown in the transcript to start the kickoff (typed
 * by the greeter once remote control is up). */
export const KICKOFF_TRIGGER = "Time to get started.";
/** The equivalent for a COLD RESTART of an already-greeted pod (image update,
 * crash, machine restart): claude relaunches into a resumed conversation, but it
 * won't speak until it gets a turn — so the pod looked "empty and the agent
 * didn't lead" (seen live 2026-07-17). This nudge makes the kickoff's resume
 * block fire: read PLAN.md, orient in one line, continue. */
export const RESUME_TRIGGER = "Resuming — where are we?";
export const DEFAULT_PERMISSION_MODE = "acceptEdits";

/** Sanitize a remote-control session title: strip quotes/newlines, collapse
 * whitespace, cap length. Empty → a stable fallback. (Typed via tmux send-keys
 * -l, so this is belt-and-suspenders rather than shell-quoting safety.) */
export function sanitizeSessionName(raw: string | undefined): string {
  const clean = (raw ?? "").replace(/['\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || "podbay pod";
}

export function credentialsPathForAgent(agent: string): string {
  return agent === "codex" ? "/home/dev/.codex/auth.json" : "/home/dev/.claude/.credentials.json";
}

/** Block until first-boot env setup finishes, so the agent never opens a
 * half-copied ~/work. init.sh writes ~/.podbay-setup-running synchronously when a
 * background copy/clone/install starts, and ~/.podbay-setup-done when it ends
 * (even on failure). We wait ONLY while running-but-not-done — no sentinel (bare
 * pod) or both-present (wake) means no wait. Bounded so a hung setup can't trap
 * the user. No apostrophes: the whole boot command is wrapped in bash -lc '...'. */
const WAIT_FOR_SETUP =
  `if [ -f ~/.podbay-setup-running ] && [ ! -f ~/.podbay-setup-done ]; then ` +
  `echo "Setting up your workspace..."; ` +
  `n=0; while [ ! -f ~/.podbay-setup-done ] && [ $n -lt 600 ]; do n=$((n+1)); sleep 1; done; ` +
  `fi`;

/**
 * Launch claude with the APP's API key stripped from its own environment. An env
 * (like doc-qa) injects ANTHROPIC_API_KEY as the built app's runtime key — but
 * Claude Code sees it too and interrupts the login flow with "Detected a custom
 * API key … use this key?", which derails onboarding (podbay agents authenticate
 * via /login on the user's subscription, not an app key). `env -u` hides it from
 * the claude process only; the app's `pnpm dev`, run via the agent's bash tool,
 * re-sources /etc/podbay/secrets.env through BASH_ENV and still gets the key.
 */
const CLAUDE = "env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude";
// Codex, with the app's OPENAI_API_KEY stripped from its own env — otherwise codex
// offers usage-based billing on that key instead of the user's ChatGPT subscription
// (device login). The app's `pnpm dev` still re-sources the key via BASH_ENV. Same
// pattern + rationale as CLAUDE above.
const CODEX = "env -u OPENAI_API_KEY -u OPENAI_BASE_URL codex";

/** How a pod authenticates its agent: the user's subscription /login (default), or a
 * BYO API key (the ToS-clean path for unattended / agent-to-agent automation — see
 * docs/plans/api-key-pod-mode.md). */
export type AgentAuth = "subscription" | "api-key";

// Reserved secret names that carry the BYO API key past the ToS env denylist (which
// forbids a user-declared ANTHROPIC_API_KEY/OPENAI_API_KEY). The control plane stores
// the key under these names and injects them like any secret; boot maps them onto the
// REAL key var for the agent PROCESS ONLY (so the general env never carries it, leaving
// app code and other agents unaffected — the inverse of the subscription strip above).
export const RESERVED_ANTHROPIC_KEY = "PODBAY_AGENT_ANTHROPIC_KEY";
export const RESERVED_OPENAI_KEY = "PODBAY_AGENT_OPENAI_KEY";
const CLAUDE_APIKEY = `env ANTHROPIC_API_KEY="$${RESERVED_ANTHROPIC_KEY}" claude`;
const CODEX_APIKEY = `env OPENAI_API_KEY="$${RESERVED_OPENAI_KEY}" codex`;

/** Codex's approval + sandbox flags — now `--dangerously-bypass-approvals-and-sandbox`,
 * claude's bypassPermissions analog, so both agents behave the same on a pod.
 *
 * This was deliberately held at `on-request` until "AGENTS.md literacy is verified to
 * load in an authed session", because bypass without the confirm-before-outbound rule in
 * context would be genuinely ungated. VERIFIED 2026-08-09 on a real authed codex pod: asked
 * from memory only (no file reads, no commands), it recited the rule — "stop, state exactly
 * what will happen and where it will appear, then wait for the user's explicit 'yes' in
 * chat". Conclusive because that text exists ONLY in the 356-line ~/.codex/AGENTS.md we
 * assemble every boot, NOT in that pod's 9-line ~/work/AGENTS.md. (It misattributed the
 * path to ~/work — provenance confusion, not a loading failure.)
 *
 * Why bypass rather than `--ask-for-approval never --sandbox workspace-write`: `never`
 * removes the prompt but ALSO removes escalation, so legitimate work outside ~/work (the
 * agent's own ~/.podbay state, installing a tool) would silently fail instead of asking.
 * And an in-pod sandbox buys little here — podbay's security model is CONTAINMENT: the
 * disposable pod IS the blast radius (docs/strategy/security-model.md).
 *
 * The concrete failure this fixes: an unattended codex pod could not answer an agent
 * message. It woke, composed the reply, then sat forever on "Would you like to run
 * `podbay msg reply …`? 1. Yes" with nobody at the keyboard to press 1 (watched live). */
function codexPermFlags(): string {
  // check_for_update_on_startup=false: codex otherwise opens with an interactive
  // "Update available! … Press enter to continue" gate and WAITS. On a pod nobody
  // is at the keyboard, so the agent never starts, remote control never comes up,
  // and the cockpit shows a pod that looks alive and does nothing (found live on
  // cheerful-donkey-6bc4, 2026-07-29 — its codex sat on that prompt after an
  // update). Verified on the pod: with the flag, codex boots straight into its
  // session. Updating the CLI is ours to do in the image, not the user's to
  // confirm in a window they never look at.
  return "-c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox";
}

/** The agent CLI invocation for an authenticated session (kickoff if present). In
 * api-key mode the CLI runs ON the BYO key (set for this process only) instead of the
 * subscription login, and the app-key strip is deliberately NOT applied. */
function agentInvocation(cli: string, mode: string, agentAuth: AgentAuth = "subscription"): string {
  const apiKey = agentAuth === "api-key";
  if (cli !== "claude") {
    // codex: launch with the safe approval/sandbox flags. No hidden-system-prompt flag
    // exists, so the kickoff travels as a positional (kept short by the env; the
    // substance + runtime rules belong in AGENTS.md, which codex reads).
    const codex = `${apiKey ? CODEX_APIKEY : CODEX} ${codexPermFlags()}`;
    // RESUME the prior conversation on a restart, exactly as claude does below.
    // Without this, every boot started a BRAND-NEW codex session and re-ran the
    // kickoff — so the pod came back with no memory of its work, and the user's
    // Codex app filled with identical sessions titled by the kickoff prompt (12 of
    // them on one pod, one per restart; owner report + verified in the pod's
    // state DB, 2026-07-29). `codex resume --last` continues the most recent
    // recorded session; it fails when there is none, so fall back to a fresh
    // start — which is also the genuine first boot, where the kickoff belongs.
    // Decide BEFORE launching, the way claude's --continue guard does. Branching on
    // the resume command's EXIT CODE was guesswork: a resume that failed for any
    // reason fell through and started a FRESH session with the kickoff — which is
    // how a pod accumulated 14 identical sessions titled by the kickoff prompt.
    // Sessions live on the volume, so "has one" is a file test.
    const hasSession = `[ -n "$(ls -A ~/.codex/sessions 2>/dev/null)" ]`;
    return (
      `${WAIT_FOR_SETUP}; if ${hasSession}; then ${codex} resume --last; ` +
      `elif [ -s ${KICKOFF_PATH} ]; then ${codex} "$(cat ${KICKOFF_PATH})"; else ${codex}; fi`
    );
  }
  // claude: prompt-free launch; the pod-agent greeter types /remote-control and
  // the kickoff trigger once the session is verifiably ready.
  //
  // RESUME the prior conversation on a cold restart (image update, crash, machine
  // restart) so the pod comes back with its history instead of an empty session
  // (seen live 2026-07-17: "session started empty"). Claude stores per-directory
  // transcripts under ~/.claude/projects/<cwd-with-slashes-as-dashes>/*.jsonl —
  // derive that from pwd rather than hardcoding, and only pass --continue when one
  // exists (it errors with no prior conversation, which would break boot).
  // Suspend/resume doesn't come through here: that thaws the SAME process.
  const resume =
    `D="$HOME/.claude/projects/$(pwd | sed "s|/|-|g")"; ` +
    `if ls "$D"/*.jsonl >/dev/null 2>&1; then C=--continue; else C=; fi; `;
  // bypassPermissions via `--permission-mode bypassPermissions` shows an INTERACTIVE
  // "Bypass Permissions mode" accept gate on every launch — and seeding
  // `bypassPermissionsModeAccepted` in ~/.claude.json does NOT suppress it (verified
  // live on wasteful-lamprey-d109, 2026-07-25: key was true, gate still appeared).
  // The greeter then refuses to type into the gate and respawns → the pod sits stuck
  // at the gate. `--dangerously-skip-permissions` is claude's NON-INTERACTIVE bypass:
  // it enters the same mode with NO gate (verified — straight to the prompt in an
  // already-trusted ~/work). Any other mode keeps the normal --permission-mode flag.
  const permFlag =
    mode === "bypassPermissions"
      ? "--dangerously-skip-permissions"
      : `--permission-mode ${mode}`;
  const launch = `${apiKey ? CLAUDE_APIKEY : CLAUDE} $C ${permFlag}`;
  return (
    `${WAIT_FOR_SETUP}; ${resume} if [ -s ${KICKOFF_PATH} ]; then ` +
    `${launch} --append-system-prompt-file ${KICKOFF_PATH}; else ${launch}; fi`
  );
}

/**
 * Sentinel printed to the pane when the agent process is gone. The greeter watches for
 * it so it never types a slash-command into what is actually a bash prompt.
 *
 * Why this exists (outage 2026-07-24, pod prime-cat-8ba8): the launcher ended in a bare
 * `exec bash`. Claude hit the "Bypass Permissions mode" accept screen — whose DEFAULT
 * option is "No, exit" — exited, and bash took the pane. The pane still read "Connected",
 * so the greeter kept typing: `/remote-control ...` and the kickoff both ran as shell
 * commands (`bash: /remote-control: No such file or directory`). One missing config key
 * became a wall of errors purely because a dead agent was indistinguishable from a live one.
 */
export const AGENT_EXITED_MARKER = "PODBAY-AGENT-EXITED";
const AGENT_EXIT_LOG = "/home/dev/.podbay-agent-exits.log";

/**
 * Wrap an agent invocation so it is self-recovering and never fails silently:
 *  - a FAST exit (<60s) is a startup failure — a gate we could not answer, a crash — so
 *    retry once; that alone recovers the class of failure above.
 *  - a LONG session that ends is the user quitting: don't fight them, drop to a shell.
 *  - either way print the sentinel and append to a log, so the pane state is machine
 *    readable and the failure is diagnosable after the fact.
 * Single-quote free: the result is embedded inside `bash -lc '...'`.
 */
function superviseAgent(inner: string): string {
  return (
    `for __a in 1 2; do ` +
    `__s=$(date +%s); ${inner}; __rc=$?; __d=$(( $(date +%s) - __s )); ` +
    `echo "${AGENT_EXITED_MARKER} rc=$__rc after=${"$"}__d""s attempt=$__a $(date -Is)" >> ${AGENT_EXIT_LOG} 2>/dev/null; ` +
    `if [ "$__d" -ge 60 ] || [ "$__a" = 2 ]; then break; fi; ` +
    `echo "podbay: agent exited after ${"$"}__d""s (rc=$__rc) - restarting once"; sleep 1; ` +
    `done; ` +
    `echo "${AGENT_EXITED_MARKER} - the agent is NOT running. This is a plain shell; ` +
    `commands typed here will not reach the agent. Run: podbay-agent-restart"; ` +
    `exec bash`
  );
}

/** Command for a session known to be authenticated (used by the respawn). */
export function kickoffCommandForAgent(
  agent: string,
  mode = DEFAULT_PERMISSION_MODE,
  agentAuth: AgentAuth = "subscription",
): string {
  const cli = agent === "codex" ? "codex" : "claude";
  return `bash -lc 'cd ~/work 2>/dev/null || cd ~; ${superviseAgent(agentInvocation(cli, mode, agentAuth))}'`;
}

/** First-created-session command: login when unauthenticated, agent otherwise. In
 * api-key mode there is no login — the agent runs on the BYO key, so it always
 * launches (the key arrives as the reserved secret; a missing key surfaces as the
 * agent's own auth error, which is the honest signal). */
export function bootCommandForAgent(
  agent: string,
  mode = DEFAULT_PERMISSION_MODE,
  agentAuth: AgentAuth = "subscription",
): string {
  const cli = agent === "codex" ? "codex" : "claude";
  if (agentAuth === "api-key") {
    return `bash -lc 'cd ~/work 2>/dev/null || cd ~; ${superviseAgent(agentInvocation(cli, mode, "api-key"))}'`;
  }
  // Strip the app's API key from /login too, so it isn't hijacked by the "use this
  // API key?" prompt (see CLAUDE/CODEX above). Codex: `--device-auth` is REQUIRED on a
  // headless pod — bare `codex login` starts a localhost:1455 browser OAuth flow that
  // can't complete without a browser on the machine; `--device-auth` prints a URL +
  // one-time code the user enters from their phone/laptop instead (verified 2026-07-24).
  const login = cli === "claude" ? `${CLAUDE} /login` : `${CODEX} login --device-auth`;
  const creds = credentialsPathForAgent(agent);
  return (
    `bash -lc 'cd ~/work 2>/dev/null || cd ~; ` +
    `${superviseAgent(`if [ -f ${creds} ]; then ${agentInvocation(cli, mode)}; else ${login}; fi`)}'`
  );
}
