/**
 * Agent HARNESSES are external apps that take control of a pod's CLIs over their own relay — T3 Code
 * today, and later grok/opencode/cursor. Each is gated by this per-harness flag so we can turn one off
 * (hidden from every enable surface) without deleting its code, and turn it back on by flipping the
 * env. Shaped per-harness from day one so a new CLI is an additive `AgentHarness` value, not a rewrite.
 *
 * `PODBAY_AGENT_HARNESS` semantics:
 *   - UNSET  → every known harness ON (the default; shipping this gate changes nothing).
 *   - a comma list ("t3", "t3,grok", …) → ONLY those on (case/space tolerant).
 *   - "" or "none" → all off.
 * To DISABLE T3, set it to a list that omits `t3` (or "" / "none").
 *
 * Pure (reads only process.env) so it unit-tests without a server context — unlike `editionOss` in the
 * server-only session module, whose result is threaded the same way.
 */
export type AgentHarness = "t3";

const KNOWN: AgentHarness[] = ["t3"];

export function harnessEnabled(harness: AgentHarness): boolean {
  const raw = process.env.PODBAY_AGENT_HARNESS;
  if (raw === undefined) return true; // default: all known harnesses on
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== "none"),
  );
  return allow.has(harness);
}

/** The full enabled map, for threading to the client as one prop (mirrors the `oss` boolean). */
export function enabledHarnesses(): Record<AgentHarness, boolean> {
  return Object.fromEntries(KNOWN.map((h) => [h, harnessEnabled(h)])) as Record<AgentHarness, boolean>;
}
