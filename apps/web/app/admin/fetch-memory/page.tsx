import { requireAdmin } from "@/lib/access";
import { getFetchMemory } from "@/lib/admin-pod-actions";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ReverifyButton from "@/components/reverify-button";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const TONE: Record<string, string> = {
  ok: "text-success",
  blocked: "text-destructive",
  challenged: "text-warning",
  login: "text-warning",
  empty: "text-muted-foreground",
};

/**
 * What the fleet has learned about fetching, and the ability to disbelieve it.
 *
 * Ordered worst-first: a domain that keeps refusing is the one worth looking at, and
 * a table sorted by name buries it. Every row carries WHEN it was verified, because a
 * verdict without a date invites trusting a stale one.
 */
export const metadata = { title: "Fetch memory" };

export default async function FetchMemoryPage() {
  await requireAdmin();
  const rows = await getFetchMemory();

  return (
    <DashboardPage title="Fetch memory">
      <Card className="gap-1 py-4">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            What the fleet knows
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <p className="pb-3 text-[12.5px] text-muted-foreground">
            One row per domain and rung. Pods consult this before climbing the ladder, so a refusal is
            learned once for everyone rather than rediscovered per task. Verdicts expire after 7 days;
            a stale one is shown but not acted on. Domains and outcomes only — never URLs, never page
            content, never who asked.
          </p>

          {rows.length === 0 ? (
            <p className="py-4 text-[13px] text-muted-foreground">
              Nothing learned yet. Rows appear as pods fetch — or after the next reconcile pass drains
              a pod that already has.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Domain</th>
                    <th className="py-2 pr-4 font-medium">Rung</th>
                    <th className="py-2 pr-4 font-medium">Latest</th>
                    <th className="py-2 pr-4 font-medium">Worked</th>
                    <th className="py-2 pr-4 font-medium">Failed</th>
                    <th className="py-2 pr-4 font-medium">Verified</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.domain}:${r.rung}`} className="border-b border-border/40">
                      <td className="py-2 pr-4 font-medium">{r.domain}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.rung}</td>
                      <td className={`py-2 pr-4 ${TONE[r.lastOutcome] ?? ""}`}>{r.lastOutcome}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{r.okCount}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{r.failCount}</td>
                      <td className="py-2 pr-4 text-[12px] tabular-nums text-muted-foreground">
                        {when(r.lastVerified)}
                        {r.stale && <span className="ml-2 text-warning">stale</span>}
                      </td>
                      <td className="py-2">
                        <ReverifyButton domain={r.domain} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardPage>
  );
}
