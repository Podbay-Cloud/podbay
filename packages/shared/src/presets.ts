/**
 * Permission presets applied to a pod's Claude Code config.
 * Mirrors docs/runbooks/claude-config.md ("open box, guarded exits").
 */

export interface PermissionRules {
  defaultMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  allow: string[];
  deny: string[];
  ask: string[];
}

/** The default posture for pods: near-zero prompts, guarded exits. */
export const GUARDED_OPEN: PermissionRules = {
  defaultMode: "acceptEdits",
  // Edit(~/**) covers ALL file-editing tools (Write, Edit, NotebookEdit). A
  // separate Write(~/**) rule is rejected by Claude Code ("only Edit(path) rules
  // are matched by file permission checks") and printed an error banner on boot.
  allow: ["Read(~/**)", "Edit(~/**)", "Bash(*)"],
  deny: [
    "Read(~/.claude/.credentials.json)",
    "Bash(rm -rf ~)",
    "Bash(rm -rf ~/*)",
    // Force-push stays a HARD block (it can destroy remote history) — this is a
    // deny, not a prompt, so it is not the per-push friction we removed below.
    "Bash(git push --force*)",
    "Bash(git push -f*)",
  ],
  // No prompt on a normal `git push` (removed 2026-08-01, owner's call): it rendered a
  // scary compound-command dialog on every commit and was pure friction. "Nothing
  // leaves the pod without a yes" now rests on the agent's own conversational rule
  // (CLAUDE.md), not a tool-level prompt; force-push stays denied above.
  ask: [],
};

export const PRESETS = {
  "guarded-open": GUARDED_OPEN,
} as const;

export type PresetName = keyof typeof PRESETS;
export const DEFAULT_PRESET: PresetName = "guarded-open";
