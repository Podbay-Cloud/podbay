/** The pure decision for the Caddy on-demand-TLS `ask` guard (self-host-public-previews): is `host`
 * allowed a cert? The dashboard host always; otherwise it must be exactly ONE label under the preview
 * base (`<id>.<base>`) whose `<id>` is a known pod (the caller does the pod lookup). Kept OUT of the
 * route file because Next.js route modules may only export route handlers — exporting a helper there
 * breaks `next build`. */
export function classifyTlsHost(
  host: string,
  base: string,
  dashboard: string,
): { allow: true } | { allow: false } | { lookupPodId: string } {
  const h = host.toLowerCase().trim();
  if (!h) return { allow: false };
  if (dashboard && h === dashboard.toLowerCase()) return { allow: true };
  const b = base.toLowerCase();
  if (!b || !h.endsWith("." + b)) return { allow: false };
  const id = h.slice(0, h.length - b.length - 1);
  if (!id || id.includes(".")) return { allow: false };
  return { lookupPodId: id };
}
