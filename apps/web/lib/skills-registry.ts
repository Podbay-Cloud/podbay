import "server-only";
import { SKILLS, SKILLS_STATS, SKILLS_GENERATED_AT } from "./skills-registry.generated";

/**
 * Read side of the skills registry (docs/plans/skills-management.md).
 *
 * The data is a JOIN of two git-truth sources, neither of which is complete alone:
 *  - `skills/registry.yaml` — the hand-maintained AUDIT LEDGER (policy: tier, audit
 *    status/by/date/notes, guardrails). vels approves skills by editing it in a PR.
 *  - `environments/**\/.claude/skills/` — what actually SHIPS (SKILL.md + SOURCE.md).
 *
 * The join is what makes the panel useful: it shows which shipped skills have no
 * approval yet (the real vetting queue) and which ledger entries have gone stale.
 * This module only READS — approval is edited in the ledger, never here. No DB.
 */

/** Ledger taxonomy: t0 first-party · t1 official · t2 community · t3 user-supplied. */
export type SkillTier = "t0" | "t1" | "t2" | "t3";
/** Ledger audit states, plus `unvetted` for a shipped skill with no ledger entry. */
export type SkillAudit =
  | "passed"
  | "needs-mitigation"
  | "not-selected"
  | "superseded"
  | "unvetted"
  | "unknown";

export interface SkillEntry {
  id: string;
  /** Does this skill actually ship to pods (files present)? */
  shipped: boolean;
  /** Does the audit ledger have an entry for it? */
  inLedger: boolean;
  version: string | null;
  description: string | null;
  source: string | null;
  /** Upstream pin: git SHA (SOURCE.md commit or ledger pin) when recorded. */
  commit: string | null;
  /** Content-hash pin, when the vendoring commit was never recorded. */
  hash: string | null;
  license: string | null;
  vendored: string | null;
  /** In-house skills are authored, not vendored. */
  authored: string | null;
  tier: SkillTier | null;
  audit: SkillAudit;
  auditBy: string | null;
  auditDate: string | null;
  auditNotes: string | null;
  guardrails: string[];
  provenance: "recorded" | "missing" | "n/a";
  usedBy: string[];
  /** Ledger claims a .claude/skills location, but no such skill ships. */
  staleLedgerEntry: boolean;
}

export interface SkillsStats {
  shipped: number;
  vetted: number;
  needsMitigation: number;
  unvetted: number;
  missingProvenance: number;
  ledgerOnly: number;
  staleLedger: number;
}

export const TIER_LABELS: Record<SkillTier, string> = {
  t0: "First-party",
  t1: "Official",
  t2: "Community",
  t3: "User-supplied",
};

export const AUDIT_LABELS: Record<SkillAudit, string> = {
  passed: "vetted",
  "needs-mitigation": "needs mitigation",
  "not-selected": "not selected",
  superseded: "superseded",
  unvetted: "unvetted",
  unknown: "unknown",
};

/** The real vetting queue: it ships to pods but has no `passed` audit in the ledger. */
export function needsVetting(s: SkillEntry): boolean {
  return s.shipped && s.audit !== "passed";
}

export function listSkills(): SkillEntry[] {
  return SKILLS;
}

export function searchSkills(query: string): SkillEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SKILLS;
  return SKILLS.filter((s) =>
    [s.id, s.description, s.source, s.auditNotes, ...s.usedBy].some((f) =>
      f?.toLowerCase().includes(q),
    ),
  );
}

export function skillsSummary() {
  const envs = new Set<string>();
  const byTier: Record<string, number> = {};
  for (const s of SKILLS) {
    if (!s.shipped) continue;
    s.usedBy.forEach((e) => envs.add(e));
    const t = s.tier ?? "untiered";
    byTier[t] = (byTier[t] ?? 0) + 1;
  }
  return {
    ...SKILLS_STATS,
    generatedAt: SKILLS_GENERATED_AT,
    byTier,
    envs: [...envs].sort(),
  };
}
