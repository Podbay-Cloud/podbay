import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  bootCommandForAgent,
  kickoffCommandForAgent,
  credentialsPathForAgent,
  sanitizeSessionName,
  KICKOFF_PATH,
  DEFAULT_PERMISSION_MODE,
  RESERVED_ANTHROPIC_KEY,
  RESERVED_OPENAI_KEY,
} from "../src/boot.js";

/** The commands run inside tmux via bash — they must PARSE, not just contain
 * the right substrings (an apostrophe in the kickoff trigger once broke the
 * single-quote wrapper and every pod booted straight to "[exited]"). */
function expectValidShell(cmd: string): void {
  expect(() => execFileSync("bash", ["-nc", cmd])).not.toThrow();
}

describe("boot commands", () => {
  it("every generated command is valid shell (regression: quoting)", () => {
    for (const agent of ["claude-code", "codex"]) {
      expectValidShell(bootCommandForAgent(agent));
      expectValidShell(kickoffCommandForAgent(agent));
      expectValidShell(bootCommandForAgent(agent, "bypassPermissions"));
      expectValidShell(kickoffCommandForAgent(agent, "bypassPermissions"));
    }
  });

  it("claude launches prompt-free — the GREETER owns remote control + the trigger", () => {
    const claude = bootCommandForAgent("claude-code");
    // No launch flag, no shell send-keys, no positional prompt: remote control
    // + the kickoff trigger moved to the pod-agent greeter (greeter.ts), which
    // waits for real readiness and verifies every submit.
    expect(claude).not.toContain("--remote-control");
    expect(claude).not.toContain("send-keys");
    expect(claude).not.toContain(`"Time to get started."`);
    expect(claude).toContain(`--append-system-prompt-file ${KICKOFF_PATH}`);
    expect(claude).not.toContain(`claude "$(cat ${KICKOFF_PATH})"`); // that's codex's form
    // codex still carries the kickoff as a positional (no hidden-prompt flag exists);
    // the substance lives in AGENTS.md.
    expect(kickoffCommandForAgent("codex")).toContain(`"$(cat ${KICKOFF_PATH})"`);
  });

  it("sanitizeSessionName strips single quotes/newlines and caps length", () => {
    expect(sanitizeSessionName("bob's pod\nline")).toBe("bob s pod line");
    expect(sanitizeSessionName("")).toBe("podbay pod");
    expect(sanitizeSessionName(undefined)).toBe("podbay pod");
    expect(sanitizeSessionName("x".repeat(100)).length).toBe(60);
  });

  it("boot: unauthenticated claude runs the login flow", () => {
    const cmd = bootCommandForAgent("claude-code");
    expect(cmd).toContain("claude /login");
    expect(cmd).toContain(credentialsPathForAgent("claude-code"));
  });

  it("claude launches with the app's ANTHROPIC_API_KEY stripped from its env", () => {
    // An env (e.g. doc-qa) injects ANTHROPIC_API_KEY for the built app; it must
    // not hijack the agent with the "use this API key?" prompt. Both /login and
    // the authed launch run under `env -u`.
    const boot = bootCommandForAgent("claude-code");
    expect(boot).toContain("env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude /login");
    // The authed launch carries $C (the --continue switch, resolved at boot).
    expect(boot).toContain("env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude $C --permission-mode");
    // codex strips its OWN app key (OPENAI_*), not the anthropic vars.
    const codexBoot = bootCommandForAgent("codex");
    expect(codexBoot).not.toContain("env -u ANTHROPIC_API_KEY");
    expect(codexBoot).toContain("env -u OPENAI_API_KEY");
  });

  // A cold restart (image update, crash) must come back with the conversation,
  // not an empty session — seen live 2026-07-17. `claude --continue` resumes the
  // most recent conversation for the cwd, but ERRORS when there is none, so it is
  // only passed when a transcript exists.
  it("resumes the prior conversation on a cold restart, and only when one exists", () => {
    for (const cmd of [bootCommandForAgent("claude-code"), kickoffCommandForAgent("claude-code")]) {
      // Derived from pwd (not hardcoded) — Claude stores transcripts per directory.
      expect(cmd).toContain('D="$HOME/.claude/projects/$(pwd | sed "s|/|-|g")"');
      expect(cmd).toContain('if ls "$D"/*.jsonl >/dev/null 2>&1; then C=--continue; else C=; fi');
      expect(cmd).toContain("claude $C --permission-mode");
      // The whole command rides inside bash -lc '...' — expectValidShell (above)
      // already guards the quoting for every agent.
      expectValidShell(cmd);
    }
  });

  it("boot: authenticated branch drives the kickoff via system prompt (not a visible turn)", () => {
    const cmd = bootCommandForAgent("claude-code");
    expect(cmd).toContain(`--append-system-prompt-file ${KICKOFF_PATH}`);
    expect(cmd).toContain(`--permission-mode ${DEFAULT_PERMISSION_MODE}`);
    expect(cmd).toContain(`[ -s ${KICKOFF_PATH} ]`);
    // the kickoff file content must NOT be inlined as the user message
    expect(cmd).not.toContain(`claude "$(cat ${KICKOFF_PATH})"`);
  });

  it("kickoff command always runs the agent (used post-login by the respawn)", () => {
    const cmd = kickoffCommandForAgent("claude-code");
    expect(cmd).not.toContain("/login");
    expect(cmd).toContain(`--append-system-prompt-file ${KICKOFF_PATH}`);
    expect(cmd).toContain("exec bash");
  });

  it("claude bypassPermissions uses --dangerously-skip-permissions, NOT the gated --permission-mode", () => {
    // `--permission-mode bypassPermissions` shows an interactive accept gate on every
    // launch that seeding bypassPermissionsModeAccepted does NOT suppress — the pod
    // got stuck at it (wasteful-lamprey-d109, 2026-07-25). The flag enters the same
    // mode with no gate.
    for (const cmd of [
      kickoffCommandForAgent("claude-code", "bypassPermissions"),
      bootCommandForAgent("claude-code", "bypassPermissions"),
    ]) {
      expect(cmd).toContain("--dangerously-skip-permissions");
      expect(cmd).not.toContain("--permission-mode bypassPermissions");
    }
    // A non-bypass mode still uses the normal flag (no accidental over-bypass).
    expect(kickoffCommandForAgent("claude-code", "acceptEdits")).toContain(
      "--permission-mode acceptEdits",
    );
  });

  it("codex agents get codex commands and codex credentials", () => {
    // Headless login MUST use --device-auth (bare `codex login` = a localhost browser
    // flow that can't complete on a pod).
    expect(bootCommandForAgent("codex")).toContain("codex login --device-auth");
    expect(credentialsPathForAgent("codex")).toContain(".codex/auth.json");
    expect(kickoffCommandForAgent("codex")).toContain(`"$(cat ${KICKOFF_PATH})"`);
  });

  it("codex never opens an interactive UPDATE gate on a pod", () => {
    // codex greets with "Update available! … Press enter to continue" and WAITS.
    // Nobody is at the keyboard on a pod, so the agent never starts and remote
    // control never comes up — the pod looks alive and does nothing (live find,
    // cheerful-donkey-6bc4, 2026-07-29).
    for (const cmd of [bootCommandForAgent("codex"), kickoffCommandForAgent("codex")]) {
      expect(cmd).toContain("check_for_update_on_startup=false");
    }
  });

  it("codex RESUMES its prior session on restart, and only starts fresh when there is none", () => {
    // Every restart used to start a brand-new codex session and re-run the kickoff:
    // the pod came back with no memory of its work, and the owner's Codex app filled
    // with identical sessions — one per restart (12 on one pod, verified in its
    // state DB, 2026-07-29). Claude already resumed; codex now does too.
    const boot = bootCommandForAgent("codex");
    expect(boot).toContain("resume --last");
    // The choice is made by TESTING FOR A SESSION, not by running resume and
    // reading its exit code: that guesswork meant any resume failure fell through
    // to a FRESH session + kickoff, which is how one pod reached 14 identical
    // sessions titled by the kickoff prompt.
    expect(boot).toContain(".codex/sessions");
    expect(boot.indexOf("resume --last")).toBeLessThan(boot.indexOf(KICKOFF_PATH));
    // and the fresh-start fallback survives
    expect(boot).toContain(`"$(cat ${KICKOFF_PATH})"`);
  });

  it("codex runs unattended — no approval prompt can strand it", () => {
    // A pod has NOBODY at the keyboard, so any interactive approval is a permanent stall,
    // not a safety net: watched live 2026-08-09, a codex pod woke on an agent message,
    // composed the reply, then sat forever on "Would you like to run `podbay msg reply`?
    // 1. Yes". Held at `on-request` until AGENTS.md literacy was VERIFIED to load in an
    // authed session (it now is — the agent recites the confirm-before-outbound rule from
    // memory), so the rule that actually governs outbound actions is in context.
    for (const mode of ["bypassPermissions", "acceptEdits"]) {
      const cmd = kickoffCommandForAgent("codex", mode);
      expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
      // `never` would remove the prompt but ALSO escalation, so legitimate work outside
      // ~/work would silently fail instead of asking — a different way to strand a pod.
      expect(cmd).not.toContain("--ask-for-approval on-request");
      expect(cmd).not.toContain("--sandbox workspace-write");
    }
  });

  describe("api-key mode (BYO key, no /login)", () => {
    it("every api-key command is valid shell", () => {
      for (const agent of ["claude-code", "codex"]) {
        expectValidShell(bootCommandForAgent(agent, DEFAULT_PERMISSION_MODE, "api-key"));
        expectValidShell(kickoffCommandForAgent(agent, DEFAULT_PERMISSION_MODE, "api-key"));
      }
    });

    it("claude runs ON the BYO key (set for the process) and NEVER logs in", () => {
      const boot = bootCommandForAgent("claude-code", DEFAULT_PERMISSION_MODE, "api-key");
      // Sets the real key from the reserved secret, for this process only…
      expect(boot).toContain(`env ANTHROPIC_API_KEY="$${RESERVED_ANTHROPIC_KEY}" claude`);
      // …and does NOT strip it (the subscription behavior) or run /login.
      expect(boot).not.toContain("env -u ANTHROPIC_API_KEY");
      expect(boot).not.toContain("/login");
      expect(boot).not.toContain(credentialsPathForAgent("claude-code"));
      // Still resumes + carries the kickoff.
      expect(boot).toContain("C=--continue");
      expect(boot).toContain(`--append-system-prompt-file ${KICKOFF_PATH}`);
    });

    it("codex runs on the BYO OPENAI key and never device-logs-in", () => {
      const boot = bootCommandForAgent("codex", DEFAULT_PERMISSION_MODE, "api-key");
      expect(boot).toContain(`env OPENAI_API_KEY="$${RESERVED_OPENAI_KEY}" codex`);
      expect(boot).not.toContain("env -u OPENAI_API_KEY");
      expect(boot).not.toContain("login --device-auth");
      expect(boot).toContain("resume --last"); // resume still works
    });

    it("subscription mode is unchanged (the default)", () => {
      const boot = bootCommandForAgent("claude-code");
      expect(boot).toContain("env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude");
      expect(boot).toContain("claude /login");
      expect(boot).not.toContain(RESERVED_ANTHROPIC_KEY);
    });
  });

  it("agent launch waits for env setup to finish (never opens a half-copied ~/work)", () => {
    // Both the pre-authed boot and the post-login respawn gate on the marker so
    // the agent can't start while init.sh is still copying the prebuilt template.
    for (const cmd of [bootCommandForAgent("claude-code"), kickoffCommandForAgent("claude-code")]) {
      expect(cmd).toContain("~/.podbay-setup-running");
      expect(cmd).toContain("~/.podbay-setup-done");
    }
    // The login flow itself must NOT block on setup — setup runs in parallel with
    // the user typing credentials; the post-login respawn is what waits.
    const boot = bootCommandForAgent("claude-code");
    const loginIdx = boot.indexOf("claude /login");
    const waitIdx = boot.indexOf("~/.podbay-setup-running");
    expect(loginIdx).toBeGreaterThan(waitIdx); // wait is in the authed branch, before login branch
  });
});
