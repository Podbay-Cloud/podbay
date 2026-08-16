import Link from "next/link";
import Image from "next/image";
import { Code2, FolderGit2 } from "lucide-react";
import { listEnvironments, type CatalogEntry } from "@/lib/environments";
import { LANDING_PLAYBOOKS } from "@/lib/landing-playbooks";
import { isProvisioningEnabled } from "@/lib/pod-service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The environments marketplace, split into two labelled sections:
 * - Playbooks (kind: playbook) — guided, outcome-driven engagements.
 * - Dev workspaces (kind: engine) — open-ended coding environments (bring your
 *   own repo, or start from a prepped stack). Visually distinct "tool" cards so
 *   they don't read like consumer playbooks. (docs/strategy/marketplace-playbooks.md)
 */
// Curated lead order within a section; anything unlisted falls back to A–Z
// (listEnvironments already sorts by name). Presentation-layer curation — when
// this grows beyond a couple of pins, promote it to a declarative
// `metadata.order` field on the env.
const FEATURED_FIRST: Record<string, number> = { "byo-project": 0 };
const featureRank = (name: string) => FEATURED_FIRST[name] ?? 99;
const curate = (envs: CatalogEntry[]) =>
  [...envs].sort((a, b) => featureRank(a.name) - featureRank(b.name) || a.name.localeCompare(b.name));

type CardMedia = { image: string; imageAlt: string };

export const DASHBOARD_PROOF_POINTS: Record<string, readonly string[]> = {
  "byo-project": ["Repo orientation", "Verified commands", "Testing and review skills"],
  "doc-qa": ["Public assistant", "Owner console", "Grounded citations"],
  "first-10-customers": ["Campaign page", "Private CRM", "Growth workflow"],
  "morning-ops-robot": ["Scheduled jobs", "Alerts", "Daily digest"],
};

const WORKSPACE_TAG_LABELS: Record<string, string> = {
  nextjs: "Next.js",
  typescript: "TypeScript",
  web: "Web app",
};

export default async function EnvGallery() {
  const all = await listEnvironments();
  const playbooks = curate(all.filter((e) => e.kind === "playbook"));
  const engines = curate(all.filter((e) => e.kind === "engine"));
  const enabled = isProvisioningEnabled();

  return (
    <div data-testid="env-gallery" className="flex flex-col gap-9">
      <EnvSection
        title="Playbooks"
        subtitle="Choose a goal. Your agent leads the work step by step."
        envs={playbooks}
        variant="playbook"
        enabled={enabled}
        emptyText="No playbooks available yet."
      />
      {engines.length > 0 && (
        <EnvSection
          title="Workspaces"
          subtitle="Bring an existing repo, or start from a ready-made development stack."
          envs={engines}
          variant="engine"
          enabled={enabled}
          divider={playbooks.length > 0}
        />
      )}
    </div>
  );
}

function EnvSection({
  title,
  subtitle,
  envs,
  variant,
  enabled,
  emptyText,
  divider,
}: {
  title: string;
  subtitle: string;
  envs: CatalogEntry[];
  variant: "playbook" | "engine";
  enabled: boolean;
  emptyText?: string;
  divider?: boolean;
}) {
  return (
    <section className={divider ? "border-t border-border pt-8" : undefined}>
      <div className="mb-3.5">
        <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {envs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? "Nothing here yet."}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {envs.map((e) => (
            <li key={e.name}>
              <EnvCard env={e} variant={variant} enabled={enabled} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnvCard({
  env: e,
  variant,
  enabled,
}: {
  env: CatalogEntry;
  variant: "playbook" | "engine";
  enabled: boolean;
}) {
  const isEngine = variant === "engine";
  // Same concept art the landing shows for each playbook, keyed by env name.
  // Only playbooks are illustrated; engines (workspaces) render without media.
  const media = (LANDING_PLAYBOOKS as Record<string, CardMedia>)[e.name];
  const proofPoints = DASHBOARD_PROOF_POINTS[e.name] ??
    e.tags.slice(0, 3).map((tag) => WORKSPACE_TAG_LABELS[tag] ?? tag);
  const primaryLabel = isEngine ? "Launch workspace" : "Start playbook";
  const WorkspaceIcon = e.name === "byo-project" ? FolderGit2 : Code2;
  return (
    <Card
      className={
        isEngine
          ? "h-full gap-3 overflow-hidden bg-[var(--navy)]/30 py-5"
          : "h-full gap-3 overflow-hidden py-5"
      }
    >
      <CardContent className="flex h-full flex-col gap-3">
        {media && !isEngine && (
          // Bleed to the card edges (counter CardContent px-6 + Card top py-5); the
          // Card's overflow-hidden clips the top corners to its rounded-xl.
          <div className="relative -mx-6 -mt-5 mb-1 aspect-[16/9] overflow-hidden bg-[var(--navy)]/40">
            <Image
              src={media.image}
              alt={media.imageAlt}
              fill
              sizes="(max-width: 640px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        )}
        {isEngine && (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-light)]">
            Workspace
          </span>
        )}
        <div className="flex items-center gap-2.5">
          {isEngine && (
            <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent-light)] text-[var(--navy)]" aria-hidden>
              <WorkspaceIcon className="size-4" />
            </span>
          )}
          <span className="text-[15px] font-semibold">{e.title}</span>
        </div>
        {e.description && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{e.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[
            e.capability.agents.join(" + "),
            // `base` is deliberately NOT here: every environment we ship is a
            // devcontainer, so the word appeared on every card and could not help
            // anyone choose. It is a real portability fact — it stays on the detail
            // page, where a facts table is the right place for it — but on a card
            // whose job is "which of these do I want", a constant is noise.
            e.capability.requiredSecretCount > 0
              ? `Requires ${e.capability.requiredSecretCount} API key${e.capability.requiredSecretCount > 1 ? "s" : ""}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {proofPoints.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {proofPoints.map((point) => (
              <Badge key={point} variant="outline" className="font-normal text-muted-foreground">
                {point}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Button asChild variant="ghost" size="sm" className="h-10 sm:h-8">
            <Link href={`/dashboard/environments/${e.name}`}>View details</Link>
          </Button>
          {enabled ? (
            <Button asChild size="sm" className="h-10 sm:h-8">
              <Link href={`/dashboard/pods/new?env=${encodeURIComponent(e.name)}`}>{primaryLabel}</Link>
            </Button>
          ) : (
            <Button size="sm" className="h-10 sm:h-8" disabled>
              {primaryLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
