/**
 * Reduce whatever a caller passed to a bare host.
 *
 * The relay is clean-by-default — it fetches any public domain cookielessly, so there
 * is no allowlist to police. What survives is this one guard: the SSRF checks and the
 * fetch audit key off a HOST, never a raw URL, so a token in a query string cannot
 * reach a log line and a lookalike cannot masquerade as a real host.
 */
export function normalizeDomain(input: string): string {
  const h = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0]!
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!h || !h.includes(".") || !/^[a-z0-9.-]+$/.test(h)) throw new Error(`not a domain: ${input}`);
  return h;
}
