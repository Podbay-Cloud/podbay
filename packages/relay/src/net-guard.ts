/**
 * VENDORED from `@podbay/shared/src/net-guard.ts` — keep the two IDENTICAL in behaviour.
 *
 * Why a copy: `pb` is published standalone to npm and builds with plain tsc, so it can
 * carry no workspace dependency. Why it is safe: `test/net-guard-parity.test.ts` runs
 * BOTH implementations over the same table and fails if they ever disagree, so a drift
 * in this security control breaks the build rather than opening a quiet hole.
 */
export function isDisallowedTarget(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv4 literal
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true; // malformed → refuse
    const [a, b] = o as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return true; // loopback / private / this-host
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6 literal: refuse loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7)
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"))
      return true;
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("::ffff:")) return isDisallowedTarget(h.slice(7)); // v4-mapped
    return false;
  }
  return false; // a domain name — allowed here; owner re-checks post-DNS
}
