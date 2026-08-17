/**
 * The narrow slice of Claude Code's `~/.claude/settings.json` that the pod cockpit lets an owner
 * edit — deliberately SMALL and pod-shaped. We expose only what is (a) meaningful for an agent
 * running headless/remote-controlled and often UNATTENDED on a 24/7 pod, and (b) not already owned
 * by podbay or the Claude client:
 *   · unattended behaviour — the pod's owner is usually away, so the agent must not hang forever on
 *     a question (`askUserQuestionTimeout`) or a forwarded permission dialog (`dialogExpiry`), and
 *     the owner wants to be pinged / recapped (`agentPushNotifEnabled`, `awaySummaryEnabled`).
 *   · git identity — the attribution trailers on commits/PRs, including the Remote-Control session
 *     link that pods add BY DEFAULT (`attribution.sessionUrl`).
 *   · long-session health — `autoCompactEnabled` keeps a 24/7 session from dying at the context limit.
 *
 * We deliberately DON'T expose: `model` (the Claude mobile/desktop client's `/model` owns it, and it
 * needs a restart), `env` (podbay already injects env/secrets), `autoUpdatesChannel` (podbay pins
 * this in the image so the CLI can't self-restart mid-task), and podbay-managed keys (permissions,
 * hooks, auth). The write path (see PodService.saveClaudeSettings) MERGES this slice into the file,
 * so podbay's managed keys — refreshed every boot by pod-base/init.sh — are always preserved.
 *
 * `includeCoAuthoredBy` is intentionally absent: it is DEPRECATED upstream and superseded by the
 * `attribution` object (verified against code.claude.com/docs/en/settings, 2026-08-17).
 */

import { ControlError } from "./types.js";

export interface ClaudeAttribution {
  /** Git commit attribution/trailers. Empty string HIDES commit attribution. */
  commit?: string;
  /** Pull-request description attribution. Empty string HIDES it. */
  pr?: string;
  /** Append the claude.ai session link (Claude-Session trailer) on commits/PRs when running from a
   * cloud / Remote-Control session. Defaults to true upstream — pods run via RC, so it appears
   * unless the owner turns it off here. */
  sessionUrl?: boolean;
}

export interface ClaudeSettings {
  attribution?: ClaudeAttribution;
  autoCompactEnabled?: boolean;
  /** Idle time before an unanswered AskUserQuestion times out. "never" (default) = wait forever —
   * a hang for an unattended pod; e.g. "30m" lets the agent move on. */
  askUserQuestionTimeout?: string;
  /** Deadline for a permission dialog Claude forwards to a Remote-Control device (default "5m"). */
  dialogExpiry?: string;
  agentPushNotifEnabled?: boolean;
  awaySummaryEnabled?: boolean;
}

/** The only keys the cockpit may read or write. Anything else in settings.json is podbay's or the
 * user's own and is left untouched. Kept in sync with CLAUDE_SETTINGS_MERGE_PY's ALLOWED set. */
export const CLAUDE_SETTINGS_KEYS = [
  "attribution",
  "autoCompactEnabled",
  "askUserQuestionTimeout",
  "dialogExpiry",
  "agentPushNotifEnabled",
  "awaySummaryEnabled",
] as const;

const DURATION = /^\d{1,4}(s|m|h)$/;
const STR_MAX = 4000;

function asBool(v: unknown, key: string): boolean {
  if (typeof v !== "boolean") throw new ControlError(`${key} must be true or false`, "invalid");
  return v;
}

/** Read side: pull only the exposed keys out of a parsed settings.json, dropping anything malformed
 * so the UI shows a clean current-state. Never throws — a garbled file just yields {}. */
export function pickClaudeSettings(parsed: unknown): ClaudeSettings {
  if (!parsed || typeof parsed !== "object") return {};
  const src = parsed as Record<string, unknown>;
  const out: ClaudeSettings = {};
  if (typeof src.autoCompactEnabled === "boolean") out.autoCompactEnabled = src.autoCompactEnabled;
  if (typeof src.agentPushNotifEnabled === "boolean")
    out.agentPushNotifEnabled = src.agentPushNotifEnabled;
  if (typeof src.awaySummaryEnabled === "boolean") out.awaySummaryEnabled = src.awaySummaryEnabled;
  if (typeof src.askUserQuestionTimeout === "string")
    out.askUserQuestionTimeout = src.askUserQuestionTimeout;
  if (typeof src.dialogExpiry === "string") out.dialogExpiry = src.dialogExpiry;
  if (src.attribution && typeof src.attribution === "object") {
    const a = src.attribution as Record<string, unknown>;
    const attr: ClaudeAttribution = {};
    if (typeof a.commit === "string") attr.commit = a.commit;
    if (typeof a.pr === "string") attr.pr = a.pr;
    if (typeof a.sessionUrl === "boolean") attr.sessionUrl = a.sessionUrl;
    out.attribution = attr;
  }
  return out;
}

/** Write side: validate + sanitize a patch from the browser into exactly the allowed shape. A value
 * of `null` for a key means "reset to Claude's default" (the merge removes the key). Throws
 * ControlError("invalid") on any malformed input — never trust the client. */
export function validateClaudeSettings(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== "object")
    throw new ControlError("no settings to save", "invalid");
  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(src)) {
    if (!(CLAUDE_SETTINGS_KEYS as readonly string[]).includes(key))
      throw new ControlError(`unknown Claude setting: ${key}`, "invalid");
    if (v === null) {
      out[key] = null; // reset to default
      continue;
    }
    switch (key) {
      case "autoCompactEnabled":
      case "agentPushNotifEnabled":
      case "awaySummaryEnabled":
        out[key] = asBool(v, key);
        break;
      case "askUserQuestionTimeout":
        if (v !== "never" && !(typeof v === "string" && DURATION.test(v)))
          throw new ControlError(`${key} must be "never" or a duration like "30m"`, "invalid");
        out[key] = v;
        break;
      case "dialogExpiry":
        if (!(typeof v === "string" && DURATION.test(v)))
          throw new ControlError(`${key} must be a duration like "5m"`, "invalid");
        out[key] = v;
        break;
      case "attribution": {
        if (typeof v !== "object")
          throw new ControlError("attribution must be an object", "invalid");
        const a = v as Record<string, unknown>;
        const attr: Record<string, unknown> = {};
        for (const [ak, av] of Object.entries(a)) {
          if (ak === "commit" || ak === "pr") {
            if (typeof av !== "string") throw new ControlError(`attribution.${ak} must be text`, "invalid");
            if (av.length > STR_MAX)
              throw new ControlError(`attribution.${ak} is too long`, "invalid");
            attr[ak] = av;
          } else if (ak === "sessionUrl") {
            attr[ak] = asBool(av, "attribution.sessionUrl");
          } else {
            throw new ControlError(`unknown attribution field: ${ak}`, "invalid");
          }
        }
        out[key] = attr;
        break;
      }
    }
  }
  if (Object.keys(out).length === 0) throw new ControlError("no settings to save", "invalid");
  return out;
}

/** Runs INSIDE the pod (as an argv element to provider.exec — no shell, so no quoting hazard). Reads
 * a base64 JSON patch from argv[1], merges it into ~/.claude/settings.json PRESERVING every key
 * podbay manages, writes atomically, and keeps the file owned by `dev`. Mirrors the every-boot merge
 * in pod-base/init.sh; ALLOWED here must match CLAUDE_SETTINGS_KEYS above. Prints "OK" on success. */
export const CLAUDE_SETTINGS_MERGE_PY = String.raw`
import json, sys, base64, os, pwd
PATH = "/home/dev/.claude/settings.json"
ALLOWED = {"attribution","autoCompactEnabled","askUserQuestionTimeout","dialogExpiry","agentPushNotifEnabled","awaySummaryEnabled"}
patch = json.loads(base64.b64decode(sys.argv[1]))
try:
    cur = json.load(open(PATH))
    if not isinstance(cur, dict): cur = {}
except Exception:
    cur = {}
for k, v in patch.items():
    if k not in ALLOWED: continue
    if v is None: cur.pop(k, None)
    else: cur[k] = v
os.makedirs(os.path.dirname(PATH), exist_ok=True)
tmp = PATH + ".tmp"
with open(tmp, "w") as f: json.dump(cur, f, indent=2)
os.replace(tmp, PATH)
try:
    d = pwd.getpwnam("dev"); os.chown(PATH, d.pw_uid, d.pw_gid)
except Exception: pass
print("OK")
`;
