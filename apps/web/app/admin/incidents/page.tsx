import { requireAdmin } from "@/lib/access";
import { getFleetIncidents } from "@/lib/admin-incidents";

export const dynamic = "force-dynamic";

const SEV_DOT: Record<string, string> = {
  critical: "bg-destructive",
  warn: "bg-warning",
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Backoffice fleet incidents (pod-observability §6): every recent unplanned
 * warn/critical across all pods, worst-first, each drilling into the pod's admin page.
 */
export const metadata = { title: "Incidents" };

export default async function IncidentsPage() {
  await requireAdmin();
  const incidents = await getFleetIncidents();
  const criticals = incidents.filter((i) => i.severity === "critical").length;
  const warns = incidents.length - criticals;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          Unplanned warn/critical events across the fleet, last 7 days — worst first.{" "}
          <span className="tabular-nums">
            {criticals} critical · {warns} warn
          </span>
        </p>
      </div>

      {incidents.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">
          No incidents in the last 7 days — the fleet is quiet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Incident</th>
                <th className="px-3 py-2 font-medium">Pod</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i, n) => (
                <tr key={`${i.podId}-${i.at}-${n}`} className="border-b border-border/40 last:border-b-0 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${SEV_DOT[i.severity] ?? "bg-border"}`} />
                      <span className={i.severity === "critical" ? "text-destructive" : "text-warning"}>
                        {i.severity}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span>{i.title}</span>
                      {i.doctor && (
                        <span className="text-[11px] text-muted-foreground">
                          🩺 doctor: {i.doctor.checked} checked
                          {i.doctor.issues.length > 0
                            ? ` · ${i.doctor.issues.length} issue${i.doctor.issues.length > 1 ? "s" : ""} — ${i.doctor.issues
                                .slice(0, 3)
                                .map((x) => x.title)
                                .join(", ")}`
                            : " · clean"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/pods/${i.podId}`}
                      className="text-[var(--accent-light)] hover:underline"
                    >
                      {i.podName?.trim() || i.podId}
                    </a>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" title={new Date(i.at).toLocaleString()}>
                    {ago(i.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
