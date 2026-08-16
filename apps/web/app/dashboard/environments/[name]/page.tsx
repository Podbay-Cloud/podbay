import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnvironmentDetail } from "@/lib/environments";
import { isProvisioningEnabled } from "@/lib/pod-service";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const env = await getEnvironmentDetail(name).catch(() => null);
  return { title: env?.title || name };
}

/** A detail row whose value is a set of items — rendered as wrapping chips so the
 * full list is always visible (skills/rules would otherwise truncate to one line). */
function DetailChips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/60 py-3.5 text-sm first:border-t-0">
      <span className="shrink-0 font-medium">{label}</span>
      <div className="flex flex-wrap justify-end gap-1.5">
        {items.map((i) => (
          <Badge key={i} variant="secondary" className="font-normal">
            {i}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default async function EnvironmentDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const env = await getEnvironmentDetail(name);
  if (!env) notFound();
  const enabled = isProvisioningEnabled();

  return (
    <DashboardPage
      backHref="/dashboard/environments"
      backLabel="Environments"
      actions={
        enabled ? (
          <Button asChild>
            <Link href={`/dashboard/pods/new?env=${encodeURIComponent(env.name)}`}>Launch</Link>
          </Button>
        ) : (
          <Button disabled>Launch</Button>
        )
      }
    >
      <header className="flex items-center gap-3">
        <span
          className="grid size-10 place-items-center rounded-xl bg-[var(--navy)] font-mono text-lg font-bold text-[var(--accent-light)]"
          aria-hidden
        >
          {env.title.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">{env.title}</h1>
          <p className="font-mono text-xs text-muted-foreground">{env.name}</p>
          {env.author && <p className="text-sm text-muted-foreground">by {env.author}</p>}
        </div>
      </header>

      {env.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{env.description}</p>
      )}

      {env.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {env.tags.map((t) => (
            <Badge key={t} variant="outline" className="font-normal text-muted-foreground">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <Card className="gap-1 py-4">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            What&rsquo;s prepared
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {(
            [
              ["Agent", env.capability.agents.join(", ") || "—"],
              ["Base", env.capability.base],
              ["Web fetch", env.capability.webFetch ? "Enabled" : "Not included"],
              ["Network", env.network],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 border-t border-border/60 py-3.5 text-sm first:border-t-0"
            >
              <span className="font-medium">{label}</span>
              <span className="min-w-0 truncate text-right text-muted-foreground">{value}</span>
            </div>
          ))}
          {env.skills.length > 0 && <DetailChips label="Skills" items={env.skills} />}
          {env.rules.length > 0 && <DetailChips label="Rules" items={env.rules} />}
        </CardContent>
      </Card>

      {env.secrets.length > 0 && (
        <Card className="gap-1 py-4">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Keys you provide
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 py-0 pb-2">
            <ul className="flex flex-col gap-1.5">
              {env.secrets.map((s) => (
                <li key={s.key} className="text-sm">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{s.key}</code>
                  {s.required && <span className="text-destructive"> *</span>}
                  {s.description && (
                    <span className="text-muted-foreground"> — {s.description}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">
              Provided at launch, stored encrypted per pod, available to the app from first boot.
            </p>
          </CardContent>
        </Card>
      )}
    </DashboardPage>
  );
}
