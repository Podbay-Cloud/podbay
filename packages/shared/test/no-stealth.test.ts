import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every file that instructs or performs a browser fetch. */
const TARGETS = [
  "environments/_shared/universal/.claude/skills/web-fetch/SKILL.md",
  "environments/_shared/universal/.claude/skills",
];

function files(rel: string): string[] {
  const abs = path.join(repo, rel);
  if (!statSync(abs).isDirectory()) return [abs];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|ts|js|py|sh)$/.test(e.name)) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/**
 * The browser rung renders; it does not disguise. This guards the boundary against
 * quiet erosion, because the pressure to cross it is constant and the justification
 * always sounds reasonable in the moment ("just the user-agent").
 *
 * It is also, for the motivating case, useless: measured 2026-07-30, a real Chromium
 * with an honest user-agent received a byte-identical 403 to curl from this pod. An
 * edge refusal lands before anything can read a fingerprint.
 */
describe("the browser rung never disguises itself", () => {
  // Techniques whose only purpose is to defeat bot detection.
  const FORBIDDEN = [
    /playwright-extra|puppeteer-extra|puppeteer-stealth|playwright-stealth/i,
    /navigator\.webdriver\s*=|delete\s+navigator\.webdriver|Object\.defineProperty\(\s*navigator\s*,\s*['"]webdriver/i,
    /--disable-blink-features=AutomationControlled/i,
    /canvas\s*(noise|spoof)|spoof(ed)?\s*(canvas|webgl|fingerprint)/i,
    /rotate\s+(user[- ]agents?|proxies|ip)|proxy\s*(pool|rotation)/i,
  ];

  const all = TARGETS.flatMap(files);

  it("finds no stealth technique in any skill that fetches", () => {
    const hits: string[] = [];
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) {
        const m = re.exec(src);
        // A line that FORBIDS the technique is the opposite of a violation, so allow
        // mentions that sit next to a negation.
        if (!m) continue;
        const line = src.slice(0, m.index).split("\n").length;
        const text = src.split("\n")[line - 1] ?? "";
        if (/\bno\b|never|not\b|forbid|don't|without|avoid/i.test(text)) continue;
        hits.push(`${path.relative(repo, f)}:${line} → ${m[0]}`);
      }
    }
    expect(hits, `stealth technique referenced without a prohibition:\n${hits.join("\n")}`).toEqual([]);
  });

  it("states the prohibition explicitly where the browser is described", () => {
    // Absence of stealth code is not enough — the instruction has to SAY so, because
    // the reader is an agent deciding what to do next.
    const skill = readFileSync(
      path.join(repo, "environments/_shared/universal/.claude/skills/web-fetch/SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/no user-agent override/i);
    expect(skill).toMatch(/stealth/i);
    // …and explains why it would not even work, which is the argument that survives
    // contact with someone who really wants the data.
    expect(skill).toMatch(/byte-identical|before anything .* fingerprint/i);
  });
});
