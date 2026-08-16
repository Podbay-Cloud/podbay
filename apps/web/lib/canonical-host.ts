/**
 * Canonical-host policy for the web app. We serve a single canonical origin
 * (the apex, matching BETTER_AUTH_URL) so better-auth's origin/cookie checks and
 * the `.podbay.cloud` session cookie are never split across `www` and apex —
 * landing on `www` with an apex-scoped cookie is what triggered `INVALID_ORIGIN`
 * on GitHub sign-in.
 *
 * Returns the apex host to redirect to, or null when the host is already
 * canonical (or is a non-www host we shouldn't touch, e.g. *.fly.dev, localhost).
 */
export function canonicalRedirectHost(host: string | null | undefined): string | null {
  if (!host) return null;
  // Strip any port for the comparison but preserve it on the rewrite.
  const [name, port] = host.split(":");
  if (!name.startsWith("www.")) return null;
  const apex = name.slice(4);
  return port ? `${apex}:${port}` : apex;
}
