/** Serialize a KEY→value map to `.env` text for the Secrets tab's "Export all". Values are quoted
 * only when they need it (whitespace, `#`, quotes, `=`, `$`, backtick, or backslash, or empty), and
 * backslashes/quotes/newlines are escaped inside quotes so the file round-trips. Keys are sorted so
 * repeated exports diff cleanly. */
export function toEnvFile(env: Record<string, string>): string {
  const needsQuote = (v: string) => v === "" || /[\s#"'`$\\=]/.test(v);
  const body = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) =>
      needsQuote(v) ? `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : `${k}=${v}`,
    )
    .join("\n");
  return body ? body + "\n" : "";
}
