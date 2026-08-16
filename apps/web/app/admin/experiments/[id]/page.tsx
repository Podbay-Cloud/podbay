import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import DashboardPage from "@/components/dashboard-page";
import ExperimentControls from "@/components/experiment-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LANDING_FUNNEL_EVENTS,
  getExperimentDetail,
  wilsonInterval,
} from "@/lib/landing-experiment-store";
import type { LandingVariant } from "@/lib/landing-experiment-config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

function rate(value: number, denominator: number): string {
  if (!denominator) return "—";
  return `${((value / denominator) * 100).toFixed(1)}%`;
}

function interval(value: number, denominator: number): string {
  const bounds = wilsonInterval(value, denominator);
  return bounds
    ? `95% CI ${(bounds[0] * 100).toFixed(1)}–${(bounds[1] * 100).toFixed(1)}%`
    : "";
}

function allocation(value: Readonly<Partial<Record<LandingVariant, number>>>): string {
  return Object.entries(value)
    .filter((entry): entry is [LandingVariant, number] => typeof entry[1] === "number")
    .map(([variant, percent]) => `${variant} ${percent}%`)
    .join(" · ");
}

function date(value: Date | null): string {
  return value
    ? value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const experiment = await getExperimentDetail(id);
  if (!experiment) notFound();
  const variants = experiment.variantOrder;
  const lowData = experiment.sampleProgress.percent < 100;
  const interpretation = experiment.deliveryMode === "validation"
    ? "A/A/A validation: assignments are live, but every visitor sees the validation page. Use these data only to verify instrumentation."
    : experiment.deliveryMode === "historical"
      ? "Historical instrumentation run: preserved for audit and baseline context, not a measured winner read."
      : lowData
        ? "Insufficient measured sample: rates and intervals are operational diagnostics, not winner evidence."
        : "Exploratory measured read: compare activation and guardrails with intervals; do not declare a winner from CTA rate alone.";

  return (
    <DashboardPage
      title={experiment.label}
      intro={experiment.hypothesis}
      backHref="/admin/experiments"
      backLabel="Experiments"
      wide
      actions={
        <Badge variant={experiment.status === "active" ? "default" : "secondary"}>
          {experiment.activeDefinition ? experiment.status : "historical"}
        </Badge>
      }
    >
      <div className="grid gap-5">
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          {interpretation}
        </p>
        {experiment.assignmentBalance.status === "warning" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            Assignment-balance warning: observed allocation is {experiment.assignmentBalance.maxStandardDeviation.toFixed(1)} standard deviations from expectation. Check assignment and traffic instrumentation before reading outcomes.
          </p>
        )}

        <Card>
          <CardHeader><CardTitle>Runtime and controls</CardTitle></CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[1fr_auto]">
            <dl className="grid grid-cols-2 gap-x-7 gap-y-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Experiment ID</dt><dd className="mt-1 font-mono text-[11px]">{experiment.id}</dd></div>
              <div><dt className="text-muted-foreground">Delivery mode</dt><dd className="mt-1">{experiment.deliveryMode}</dd></div>
              <div><dt className="text-muted-foreground">Allocation</dt><dd className="mt-1">{allocation(experiment.allocation)}</dd></div>
              <div><dt className="text-muted-foreground">Primary metric</dt><dd className="mt-1">{label(experiment.primaryMetric)}</dd></div>
              <div><dt className="text-muted-foreground">Guardrail</dt><dd className="mt-1">{label(experiment.guardrailMetric)}</dd></div>
              <div><dt className="text-muted-foreground">Pinned variant</dt><dd className="mt-1">{experiment.pinnedVariant ?? "None"}</dd></div>
              <div><dt className="text-muted-foreground">Started</dt><dd className="mt-1">{date(experiment.startedAt)}</dd></div>
              <div><dt className="text-muted-foreground">Stopped</dt><dd className="mt-1">{date(experiment.stoppedAt)}</dd></div>
              <div><dt className="text-muted-foreground">Retention</dt><dd className="mt-1">{experiment.retentionDays} days</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Observation rule</dt><dd className="mt-1">{experiment.observationWindow}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Baseline rule</dt><dd className="mt-1">{experiment.baseline}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Narrative freeze</dt><dd className="mt-1">{experiment.narrativeFreeze}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Activation metrics</dt><dd className="mt-1">{experiment.activationMetrics.map(label).join(", ")}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Operational sample progress</dt><dd className="mt-1">{experiment.sampleProgress.minimumObserved} / {experiment.sampleProgress.targetPerVariant} minimum exposures per variant ({experiment.sampleProgress.percent}%)</dd></div>
            </dl>
            <ExperimentControls
              experimentId={experiment.id}
              status={experiment.status}
              pinnedVariant={experiment.pinnedVariant}
              variants={variants}
              mutable={experiment.activeDefinition}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Variant previews</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {experiment.previewLinks.map((preview) => (
              <Link
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                href={preview.href}
                key={preview.variant}
                target="_blank"
              >
                Preview {preview.variant} <ExternalLink className="size-3.5" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activation funnel</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Stage</th>
                  {variants.map((variant) => <th className="px-4 py-2 font-medium" key={variant}>{variant}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="py-3 pr-4 text-muted-foreground">Eligible assignments</td>
                  {variants.map((variant) => <td className="px-4 py-3" key={variant}>{experiment.variants[variant]!.assignments}</td>)}
                </tr>
                {LANDING_FUNNEL_EVENTS.map((event) => (
                  <tr className="border-b border-border/60" key={event}>
                    <td className="py-3 pr-4 text-muted-foreground">{label(event)}</td>
                    {variants.map((variant) => {
                      const report = experiment.variants[variant]!;
                      const value = report.funnel[event];
                      const denominator = report.exposureDenominator;
                      return (
                        <td className="px-4 py-3" key={variant}>
                          <strong>{value}</strong>
                          <span className="ml-2 text-[12px] text-muted-foreground">{event === "landing_exposure" ? "baseline" : rate(value, denominator)}</span>
                          {event !== "landing_exposure" && <small className="mt-1 block text-[10px] text-muted-foreground">{interval(value, denominator)}</small>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Acquisition by variant</CardTitle></CardHeader>
            <CardContent>
              {experiment.acquisition.length ? (
                <ul className="divide-y divide-border/60">
                  {experiment.acquisition.map((row) => (
                    <li className="grid grid-cols-[110px_1fr_1fr_auto] gap-3 py-2.5 text-sm" key={`${row.variant}-${row.source}-${row.campaign}`}>
                      <span className="font-mono text-[11px]">{row.variant}</span>
                      <span className="truncate">{row.source}</span>
                      <span className="truncate text-muted-foreground">{row.campaign}</span>
                      <strong>{row.visitors}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No eligible acquisition data yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Measurement health</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                {Object.entries(experiment.health).map(([key, value]) => (
                  <div className="rounded-md border border-border/60 px-3 py-2.5" key={key}>
                    <dt className="text-[11px] text-muted-foreground">{label(key)}</dt>
                    <dd className="mt-1 text-xl font-semibold">{value}</dd>
                  </div>
                ))}
                <div className="rounded-md border border-border/60 px-3 py-2.5">
                  <dt className="text-[11px] text-muted-foreground">Assignment balance</dt>
                  <dd className="mt-1 text-xl font-semibold">{experiment.assignmentBalance.status}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Recent sanitized events</CardTitle></CardHeader>
          <CardContent>
            {experiment.recentEvents.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[12.5px]">
                  <thead><tr className="border-b border-border"><th className="py-2">Time</th><th>Variant</th><th>Event</th><th>Item</th><th>Attributed</th></tr></thead>
                  <tbody>
                    {experiment.recentEvents.map((event, index) => (
                      <tr className="border-b border-border/60" key={`${event.at.toISOString()}-${index}`}>
                        <td className="py-2.5 pr-4 text-muted-foreground">{date(event.at)}</td>
                        <td className="pr-4">{event.variant}</td>
                        <td className="pr-4 font-mono text-[11px]">{event.type}</td>
                        <td className="pr-4">{event.item ?? "—"}</td>
                        <td>{event.attributed ? "User linked" : "Anonymous"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Admin audit</CardTitle></CardHeader>
          <CardContent>
            {experiment.audit.length ? (
              <ul className="divide-y divide-border/60">
                {experiment.audit.map((entry, index) => (
                  <li className="grid gap-1 py-3 text-sm sm:grid-cols-[150px_70px_1fr]" key={`${entry.at.toISOString()}-${index}`}>
                    <span className="text-muted-foreground">{date(entry.at)}</span>
                    <strong>{entry.action}</strong>
                    <span>
                      {entry.previousStatus}/{entry.previousPinnedVariant ?? "none"} → {entry.nextStatus}/{entry.nextPinnedVariant ?? "none"}
                      <small className="ml-2 text-muted-foreground">by {entry.actorUserId.slice(0, 8)}…</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No experiment controls have been used.</p>}
          </CardContent>
        </Card>
      </div>
    </DashboardPage>
  );
}
