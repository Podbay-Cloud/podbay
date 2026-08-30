import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import DashboardPage from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listExperimentSummaries } from "@/lib/landing-experiment-store";

export const dynamic = "force-dynamic";

function date(value: Date | null): string {
  return value
    ? value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

function allocation(value: Readonly<Record<string, number | undefined>>): string {
  return Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([variant, percent]) => `${variant} ${percent}%`)
    .join(" · ");
}

export const metadata = { title: "Experiments" };

export default async function ExperimentsPage() {
  const experiments = await listExperimentSummaries();
  return (
    <DashboardPage
      title="Experiments"
      intro="Landing visibility, positioning tests, assignment health, and activation outcomes."
    >
      <div className="grid gap-4">
        {experiments.map((experiment) => (
          <Card key={experiment.id}>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{experiment.label}</CardTitle>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{experiment.id}</p>
              </div>
              <Badge variant={experiment.status === "active" ? "default" : "secondary"}>
                {experiment.controlType === "homepage-promotion"
                  ? experiment.pinnedVariant === "selfhost"
                    ? "on homepage"
                    : "/selfhost only"
                  : experiment.activeDefinition
                    ? experiment.status
                    : "historical"}
              </Badge>
            </CardHeader>
            <CardContent>
              <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {experiment.hypothesis}
              </p>
              {experiment.controlType === "homepage-promotion" ? (
                <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border/60 py-4 sm:grid-cols-3">
                  <div><dt className="text-[11px] text-muted-foreground">Permanent URL</dt><dd className="mt-1 text-[12px]">/selfhost</dd></div>
                  <div><dt className="text-[11px] text-muted-foreground">Homepage</dt><dd className="mt-1 text-[12px]">{experiment.pinnedVariant === "selfhost" ? "Self-host landing" : "Current acquisition landing"}</dd></div>
                  <div><dt className="text-[11px] text-muted-foreground">Last changed</dt><dd className="mt-1 text-[12px]">{date(experiment.stoppedAt ?? experiment.startedAt)}</dd></div>
                </dl>
              ) : <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border/60 py-4 sm:grid-cols-3 lg:grid-cols-6">
                <div><dt className="text-[11px] text-muted-foreground">Eligible</dt><dd className="mt-1 text-xl font-semibold">{experiment.eligibleVisitors}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Exposures</dt><dd className="mt-1 text-xl font-semibold">{experiment.exposures}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Sign-ins</dt><dd className="mt-1 text-xl font-semibold">{experiment.primaryConversions}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Started</dt><dd className="mt-1 text-[12px]">{date(experiment.startedAt)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Pinned</dt><dd className="mt-1 text-[12px]">{experiment.pinnedVariant ?? "Not pinned"}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Delivery</dt><dd className="mt-1 text-[12px]">{experiment.deliveryMode}</dd></div>
              </dl>}
              {experiment.controlType !== "homepage-promotion" && <p className="mt-3 font-mono text-[11px] text-muted-foreground">{allocation(experiment.allocation)}</p>}
              <Link
                href={`/admin/experiments/${experiment.id}`}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {experiment.controlType === "homepage-promotion" ? "Manage visibility" : "Open experiment"} <ArrowUpRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardPage>
  );
}
