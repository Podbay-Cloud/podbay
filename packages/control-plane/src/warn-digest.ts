/**
 * The daily WARNINGS digest (pod-observability §7). Criticals page ops immediately
 * (alertIfCritical → onIncident); warnings would be noise one-by-one, so they batch
 * into one daily summary. Pure formatter so the wording is unit-tested without a DB —
 * the service feeds it classified warn items, the gateway sends the result to ops.
 */
export interface DigestItem {
  podId: string;
  podName: string | null;
  title: string;
}

export function formatWarnDigest(items: DigestItem[], sinceLabel = "24h"): string | null {
  if (items.length === 0) return null; // nothing to say → send nothing (no empty digests)
  const byPod = new Map<string, { name: string; titles: Map<string, number> }>();
  for (const it of items) {
    let g = byPod.get(it.podId);
    if (!g) {
      g = { name: it.podName?.trim() || it.podId, titles: new Map() };
      byPod.set(it.podId, g);
    }
    g.titles.set(it.title, (g.titles.get(it.title) ?? 0) + 1);
  }
  const lines = [...byPod.values()].map((g) => {
    const parts = [...g.titles.entries()].map(([t, n]) => (n > 1 ? `${n}× ${t}` : t)).join(", ");
    return `• ${g.name}: ${parts}`;
  });
  const pods = byPod.size;
  return `📋 podbay warnings — ${items.length} in the last ${sinceLabel} across ${pods} pod${pods > 1 ? "s" : ""}\n${lines.join("\n")}`;
}
