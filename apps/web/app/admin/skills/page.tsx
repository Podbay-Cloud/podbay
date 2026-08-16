import { requireAdmin } from "@/lib/access";
import {
  searchSkills,
  skillsSummary,
  needsVetting,
  TIER_LABELS,
  AUDIT_LABELS,
  type SkillEntry,
  type SkillTier,
  type SkillAudit,
} from "@/lib/skills-registry";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Skills registry (docs/plans/skills-management.md) — READ-ONLY view over a JOIN of
 * the audit ledger (skills/registry.yaml: who approved what) and what actually ships
 * to pods. Approval is edited in the ledger via PR, never here. The panel's job is to
 * make two things obvious: which shipped skills nobody has vetted, and which ledger
 * entries have gone stale.
 */

const TIER_VARIANT: Record<SkillTier, "default" | "secondary" | "outline"> = {
  t0: "secondary",
  t1: "default",
  t2: "secondary",
  t3: "outline",
};

const AUDIT_VARIANT: Record<SkillAudit, "default" | "secondary" | "outline" | "destructive"> = {
  passed: "default",
  "needs-mitigation": "destructive",
  unvetted: "destructive",
  "not-selected": "outline",
  superseded: "outline",
  unknown: "outline",
};

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "";
}

export const metadata = { title: "Skills" };

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  await requireAdmin();
  const { q = "", filter } = await searchParams;
  const s = skillsSummary();

  let skills = searchSkills(q);
  if (filter === "unvetted") skills = skills.filter(needsVetting);
  else if (filter === "ledger") skills = skills.filter((k) => !k.shipped);
  else skills = skills.filter((k) => k.shipped); // default: what actually ships

  // Unvetted first — the work that needs attention surfaces at the top.
  skills = [...skills].sort(
    (a, b) => Number(needsVetting(b)) - Number(needsVetting(a)) || a.id.localeCompare(b.id),
  );

  const link = (f?: string) =>
    `?${[f ? `filter=${f}` : "", q ? `q=${encodeURIComponent(q)}` : ""].filter(Boolean).join("&") || ""}`;
  const chip = (active: boolean) =>
    `inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${
      active ? "border-[var(--accent-light)] bg-accent" : "border-border hover:bg-accent"
    }`;

  return (
    <DashboardPage
      title="Skills"
      wide
      intro={`${s.shipped} shipped across ${s.envs.length} environments · ${s.vetted} vetted · generated ${s.generatedAt}`}
    >
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 text-[13px]">
          {(Object.keys(TIER_LABELS) as SkillTier[])
            .filter((t) => s.byTier[t])
            .map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Badge variant={TIER_VARIANT[t]}>{TIER_LABELS[t]}</Badge>
                <span className="text-muted-foreground">{s.byTier[t]}</span>
              </span>
            ))}
          <span className="ml-auto text-muted-foreground">
            {s.unvetted} unvetted
            {s.needsMitigation > 0 && ` · ${s.needsMitigation} need mitigation`}
            {s.missingProvenance > 0 && ` · ${s.missingProvenance} missing provenance`}
            {s.staleLedger > 0 && ` · ⚠ ${s.staleLedger} stale ledger`}
          </span>
        </CardContent>
      </Card>

      {/* Approval lives in git — say so, so nobody hunts for an edit button. */}
      <p className="mb-4 text-[12px] text-muted-foreground">
        Read-only. Approval is recorded in <code>skills/registry.yaml</code> (the audit ledger) and
        provenance in each skill&apos;s <code>SOURCE.md</code> — both edited via PR, then{" "}
        <code>pnpm skills:registry</code>.
      </p>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search id, description, source, env, audit notes…"
          className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {filter && <input type="hidden" name="filter" value={filter} />}
        <button
          type="submit"
          className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          Search
        </button>
        <a href={link()} className={chip(!filter)}>
          Shipped ({s.shipped})
        </a>
        <a href={link("unvetted")} className={chip(filter === "unvetted")}>
          Unvetted ({s.unvetted})
        </a>
        <a href={link("ledger")} className={chip(filter === "ledger")}>
          Ledger-only ({s.ledgerOnly})
        </a>
      </form>

      {skills.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-[13px] text-muted-foreground">
            No skills match{q ? ` "${q}"` : ""}.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {skills.map((k: SkillEntry) => (
            <Card key={k.id} className={needsVetting(k) ? "border-[var(--accent-light)]" : ""}>
              <CardContent className="flex flex-col gap-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[13px] font-semibold">{k.id}</code>
                  {k.version && <span className="text-xs text-muted-foreground">v{k.version}</span>}
                  {k.tier && <Badge variant={TIER_VARIANT[k.tier]}>{TIER_LABELS[k.tier]}</Badge>}
                  <Badge variant={AUDIT_VARIANT[k.audit]}>{AUDIT_LABELS[k.audit]}</Badge>
                  {k.staleLedgerEntry && <Badge variant="destructive">stale ledger entry</Badge>}
                  {k.shipped && k.provenance === "missing" && (
                    <Badge variant="outline">no SOURCE.md</Badge>
                  )}
                  {k.guardrails.map((g) => (
                    <Badge key={g} variant="outline">
                      guardrail: {g}
                    </Badge>
                  ))}
                  <span className="ml-auto flex flex-wrap justify-end gap-1">
                    {k.usedBy.map((env) => (
                      <span
                        key={env}
                        className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {env}
                      </span>
                    ))}
                  </span>
                </div>

                {k.description && <p className="text-sm text-muted-foreground">{k.description}</p>}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {k.source ? (
                    <span>
                      <span className="text-foreground/70">{k.source}</span>
                      {k.commit
                        ? ` @ ${short(k.commit)}`
                        : k.hash
                          ? ` @ ${short(k.hash)} (hash)`
                          : ""}
                    </span>
                  ) : (
                    <span className="italic">provenance not recorded — needs a SOURCE.md</span>
                  )}
                  {k.license && <span>· {k.license}</span>}
                  {k.vendored && <span>· vendored {k.vendored}</span>}
                  {k.authored && <span>· authored {k.authored}</span>}
                  {k.auditBy && (
                    <span>
                      · reviewed by {k.auditBy} {k.auditDate}
                    </span>
                  )}
                </div>

                {k.auditNotes && (
                  <p className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    {k.auditNotes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
