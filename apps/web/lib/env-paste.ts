/**
 * Parse a pasted `.env` blob into individual `{ key, value }` pairs, so a single
 * paste can set many secrets at once. Deliberately forgiving about what people
 * actually copy out of a `.env`: blank lines, `# comments`, an `export ` prefix,
 * and quoted values are all handled; anything that isn't a valid `UPPER_SNAKE`
 * assignment is skipped rather than erroring.
 *
 * The key pattern mirrors the pod-agent's own env reader
 * (`packages/pod-agent/src/secret-requests.ts`) and the vault's `KEY_RE`, so what we
 * accept here is exactly what the pod will accept downstream.
 */

// export FOO=bar / FOO=bar — key must be UPPER_SNAKE starting with a letter.
const LINE_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

/** Strip surrounding quotes; for an UNquoted value, drop a trailing ` # comment`. Double-quoted
 * values are UN-escaped (`\\`→`\`, `\"`→`"`, `\n`→newline) in one pass so a `.env` exported by the
 * Secrets tab (lib/env-file.toEnvFile) round-trips exactly; single-quoted values stay literal. */
function cleanValue(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  // Unquoted: a ` #` begins an inline comment.
  const hash = v.indexOf(" #");
  if (hash >= 0) v = v.slice(0, hash).trim();
  return v;
}

export type EnvPair = { key: string; value: string };

/** Every valid `KEY=VALUE` assignment in the text, in order. Non-matching and
 * comment/blank lines are ignored. Duplicate keys keep the LAST value (a later line
 * overrides an earlier one, like a shell sourcing the file). */
export function parseEnvBlob(text: string): EnvPair[] {
  const byKey = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    byKey.set(m[1]!, cleanValue(m[2] ?? ""));
  }
  return [...byKey.entries()].map(([key, value]) => ({ key, value }));
}

/**
 * Is a pasted string a `.env` blob (worth splitting), rather than one secret value?
 * We only intercept a MULTI-LINE paste that contains at least one assignment — a
 * single-line paste is treated as an ordinary value, so pasting a lone secret (which
 * may itself contain `=`) into a field still just fills that field.
 */
export function looksLikeEnvBlob(text: string): boolean {
  return /[\r\n]/.test(text) && parseEnvBlob(text).length >= 1;
}
