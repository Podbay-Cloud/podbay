#!/usr/bin/env node
// Build the derived skills index the /admin/skills panel renders
// (docs/plans/skills-management.md).
//
// TWO sources, joined — neither alone is the truth:
//   1. skills/registry.yaml — the hand-maintained AUDIT LEDGER (policy): tier,
//      audit {status, by, date, notes}, guardrails. Approval lives here; vels
//      edits it in PRs. THIS SCRIPT NEVER WRITES IT.
//   2. environments/**/.claude/skills/<id>/ — what actually SHIPS to pods:
//      SKILL.md (version/description) + SOURCE.md (provenance pin/license/date).
//
// The join is the point: it surfaces drift both ways — skills shipping without a
// ledger entry (unvetted), and ledger entries that claim a location but no longer
// ship (stale). Output: apps/web/lib/skills-registry.generated.ts (the deployed
// web app is bundled and can't fs-read repo files at runtime).
//
//   node scripts/skills/build-registry.mjs           # write the generated index
//   node scripts/skills/build-registry.mjs --check   # fail if out of date (CI/pre-push)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// `yaml` is a workspace dep (packages/shared), not hoisted to root — resolve it there.
const require = createRequire(join(ROOT, "packages", "shared", "package.json"));
const { parse: parseYaml } = require("yaml");

const ENVS = join(ROOT, "environments");
const LEDGER = join(ROOT, "skills", "registry.yaml");

// ---------------------------------------------------------------- file scan --
function findSkillDirs(base) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (existsSync(join(p, "SKILL.md")) && dir.endsWith(join(".claude", "skills"))) out.push(p);
      else walk(p);
    }
  };
  walk(base);
  return out;
}

// "environments/first-10-customers/.claude/skills/cold-email" → { id, owner }
function locationOf(dir) {
  const parts = dir.slice(ENVS.length + 1).split("/");
  const idx = parts.indexOf(".claude");
  const owner = parts.slice(0, idx).join("/");
  return {
    id: parts[parts.length - 1],
    owner: owner.startsWith("_shared/") ? `${owner.slice(8)} (shared)` : owner,
  };
}

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    return parseYaml(m[1]) ?? {};
  } catch {
    return {};
  }
}

// SOURCE.md is a flat "key: value" block (plus a free-form notes block we skip).
function parseSource(txt) {
  const o = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (m) o[m[1]] = m[2].replace(/\s+#.*$/, "").trim(); // drop trailing "# comment"
  }
  return o;
}

// Ledger taxonomy: t0 first-party · t1 official · t2 community · t3 user-supplied.
function inferTier(source) {
  if (!source) return null;
  if (/^podbay\b/.test(source)) return "t0";
  if (/^(anthropics|vercel-labs|shadcn)\//.test(source)) return "t1";
  return "t2";
}

const shipped = new Map();
for (const dir of findSkillDirs(ENVS)) {
  const { id, owner } = locationOf(dir);
  const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
  const src = existsSync(join(dir, "SOURCE.md"))
    ? parseSource(readFileSync(join(dir, "SOURCE.md"), "utf8"))
    : null;
  const prev = shipped.get(id);
  const entry = prev ?? {
    id,
    version: fm?.metadata?.version ?? fm?.version ?? null,
    description: (fm?.description ?? "").split(". ")[0].slice(0, 140) || null,
    source: src?.source ?? null,
    commit: src?.commit ?? null,
    hash: src?.hash ?? null,
    license: src?.license ?? null,
    vendored: src?.vendored ?? null,
    authored: src?.authored ?? null,
    usedBy: [],
  };
  if (!entry.usedBy.includes(owner)) entry.usedBy.push(owner);
  if (!entry.source && src?.source) {
    Object.assign(entry, {
      source: src.source,
      commit: src.commit ?? null,
      hash: src.hash ?? null,
      license: src.license ?? null,
      vendored: src.vendored ?? null,
      authored: src.authored ?? null,
    });
  }
  shipped.set(id, entry);
}

// ------------------------------------------------------------------ ledger ---
const ledgerDoc = parseYaml(readFileSync(LEDGER, "utf8")) ?? {};
const ledgerById = new Map((ledgerDoc.skills ?? []).map((e) => [e.id, e]));

// ------------------------------------------------------------------- join ----
const ids = [...new Set([...shipped.keys(), ...ledgerById.keys()])].sort();
const skills = ids.map((id) => {
  const s = shipped.get(id) ?? null;
  const l = ledgerById.get(id) ?? null;
  const source = s?.source ?? l?.source ?? null;
  // A ledger entry whose location is under .claude/skills/ claims to ship as a skill.
  // (null location = surveyed only; a .claude/rules/ location = a RULE tracked in the
  // ledger for the record, e.g. shadcn-discovery — not a missing skill.)
  const claimsLocation = Boolean(l?.location?.includes("/.claude/skills/"));
  return {
    id,
    shipped: Boolean(s),
    inLedger: Boolean(l),
    version: s?.version ?? null,
    description: s?.description ?? null,
    source,
    // Pin: SOURCE.md's commit/hash wins; fall back to the ledger's pin.
    commit: s?.commit ?? (l?.pin ?? null),
    hash: s?.hash ?? null,
    license: s?.license ?? l?.license ?? null,
    vendored: s?.vendored ?? null,
    authored: s?.authored ?? null,
    // Policy comes from the ledger; tier is inferred only when unledgered.
    tier: l?.tier ?? inferTier(source),
    audit: l?.audit?.status ?? (s ? "unvetted" : "unknown"),
    auditBy: l?.audit?.by ?? null,
    auditDate: l?.audit?.date ? String(l.audit.date).slice(0, 10) : null,
    auditNotes: l?.audit?.notes ?? null,
    guardrails: l?.guardrails ?? [],
    provenance: s ? (s.source ? "recorded" : "missing") : "n/a",
    usedBy: (s?.usedBy ?? l?.usedBy ?? []).slice().sort(),
    // Drift: the ledger says it lives somewhere, but no such skill ships.
    staleLedgerEntry: claimsLocation && !s,
  };
});

const shippedSkills = skills.filter((k) => k.shipped);
const stats = {
  shipped: shippedSkills.length,
  vetted: shippedSkills.filter((k) => k.audit === "passed").length,
  // Reviewed and shipping, but with a specific known gap recorded in the ledger.
  needsMitigation: shippedSkills.filter((k) => k.audit === "needs-mitigation").length,
  // Anything not yet stamped `passed` still needs action.
  unvetted: shippedSkills.filter((k) => k.audit !== "passed").length,
  missingProvenance: shippedSkills.filter((k) => k.provenance === "missing").length,
  ledgerOnly: skills.filter((k) => !k.shipped).length,
  staleLedger: skills.filter((k) => k.staleLedgerEntry).length,
};

const ts =
  "// GENERATED by scripts/skills/build-registry.mjs — do not hand-edit.\n" +
  "// A JOIN of the audit ledger (skills/registry.yaml — policy: tier/audit/guardrails)\n" +
  "// with what actually ships (environments/**/.claude/skills SKILL.md + SOURCE.md).\n" +
  "// Approval is edited in skills/registry.yaml, never here.\n" +
  "// Regenerate: pnpm skills:registry\n" +
  'import type { SkillEntry, SkillsStats } from "./skills-registry";\n\n' +
  `export const SKILLS_GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};\n` +
  `export const SKILLS_STATS: SkillsStats = ${JSON.stringify(stats, null, 2)};\n` +
  `export const SKILLS: SkillEntry[] = ${JSON.stringify(skills, null, 2)};\n`;

const OUT = join(ROOT, "apps", "web", "lib", "skills-registry.generated.ts");
const norm = (t) => t.replace(/^export const SKILLS_GENERATED_AT = .*$/m, "").trim();

if (process.argv.includes("--check")) {
  if (norm(existsSync(OUT) ? readFileSync(OUT, "utf8") : "") !== norm(ts)) {
    console.error(
      "apps/web/lib/skills-registry.generated.ts is out of date — run: pnpm skills:registry",
    );
    process.exit(1);
  }
  console.log(`skills index up to date (${stats.shipped} shipped)`);
} else {
  writeFileSync(OUT, ts);
  console.log(
    `wrote skills index — ${stats.shipped} shipped · ${stats.vetted} vetted · ${stats.unvetted} unvetted · ` +
      `${stats.ledgerOnly} ledger-only · ${stats.staleLedger} stale ledger entries`,
  );
}
