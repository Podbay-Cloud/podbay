import { listDigests } from "@/lib/store";
import { listJobs } from "@/lib/jobs";
import { listRuns } from "@/lib/runs";
import { listAlerts } from "@/lib/alerts";
import { computeStreak, runSuccess } from "@/lib/metrics";
import { JobsPanel } from "@/components/jobs-panel";
import { AlertActions } from "@/components/alert-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RunStatus, Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

const RUN_TONE: Record<RunStatus, string> = {
  succeeded: "text-emerald-600",
  failed: "text-red-600",
  stalled: "text-red-600",
  running: "text-muted-foreground",
};
const SEV_TONE: Record<Severity, string> = {
  critical: "text-red-600",
  warning: "text-amber-600",
  info: "text-muted-foreground",
};

export default async function Dashboard() {
  const [digests, jobs, runs, alerts] = await Promise.all([
    listDigests(),
    listJobs(),
    listRuns(),
    listAlerts(),
  ]);
  const streak = computeStreak(digests.map((d) => d.date));
  const { succeeded, total } = runSuccess(runs);
  const open = alerts.filter((a) => a.state !== "resolved");
  const latest = digests[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ops Robot</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {latest ? `Last digest: ${latest.date}` : "No digests yet — your first run will appear here."}
          </p>
        </div>
        <div className="flex gap-2">
          <Kpi value={total ? `${succeeded}/${total}` : "—"} label="runs ok" />
          <Kpi value={open.length} label="open alerts" tone={open.length ? "text-amber-600" : undefined} />
          <Kpi value={streak} label="day streak" />
        </div>
      </header>

      {/* Alerts — most urgent, full width */}
      {open.length > 0 && (
        <Card className="mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {open.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold uppercase ${SEV_TONE[a.severity]}`}>{a.severity}</span>
                      <span className="text-sm font-medium">{a.title}</span>
                      {a.state === "acknowledged" && <Badge variant="secondary">acked</Badge>}
                    </div>
                    {a.detail && <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>}
                  </div>
                  <AlertActions id={a.id} state={a.state} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        {/* Digests timeline */}
        <section className="flex flex-col gap-4">
          {digests.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nothing here yet. Once your jobs run, each morning&apos;s digest lands here — what
                changed, what needs you, and what to do next.
              </CardContent>
            </Card>
          ) : (
            digests.map((d) => (
              <Card key={d.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{d.summary}</CardTitle>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{d.date}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  <Section label="Needs you" items={d.needsAttention} badge />
                  <Section label="What changed" items={d.changed} />
                  <Section label="Recommended" items={d.actions} />
                </CardContent>
              </Card>
            ))
          )}
        </section>

        {/* Jobs + Runs */}
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <JobsPanel jobs={jobs} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {runs.length === 0 ? (
                <p className="text-muted-foreground">No runs yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {runs.slice(0, 12).map((r) => (
                    <li key={r.runId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {r.jobName ?? r.jobId}
                      </span>
                      <span className={`shrink-0 ${RUN_TONE[r.status]}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Kpi({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="rounded-lg border px-4 py-2 text-right">
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ label, items, badge }: { label: string; items: string[]; badge?: boolean }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1.5">
        {badge ? (
          <Badge>{label}</Badge>
        ) : (
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        )}
      </div>
      <ul className="ml-4 list-disc space-y-1">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
