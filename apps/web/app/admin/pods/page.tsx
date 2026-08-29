import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/access";
import { getFleet } from "@/lib/fleet";
import { getPodService } from "@/lib/pod-service";
import DashboardPage from "@/components/dashboard-page";

export const dynamic = "force-dynamic";

/**
 * Backoffice pods table. One scannable row per pod with the facts that matter;
 * all controls (Suspend/Update/Reconcile/Destroy) live on the drill-in
 * (/admin/pods/[id]) so this stays clean and non-destructive. Cost is
 * backoffice-only (users never see dollars). Box capacity/economics live on
 * /admin/boxes.
 */

function hours(ms: number): string {
  if (ms < 60_000) return "0h";
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.round(ms / 60_000)}m` : `${h.toFixed(1)}h`;
}
function tierLabel(size: string): string {
  return size === "l" ? "Large" : size === "m" ? "Medium" : "Small";
}
function statusTone(s: string): string {
  if (s === "running") return "text-success";
  if (s === "suspended") return "text-muted-foreground";
  if (s === "error" || s === "destroying") return "text-destructive";
  return "text-warning";
}

type SortKey = "pod" | "environment" | "provider" | "size" | "status" | "uptime" | "version" | "cost";

export const metadata = { title: "Pods" };

export default async function PodsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const sort = (["pod", "environment", "provider", "size", "status", "uptime", "version", "cost"] as const).includes(
    sp.sort as SortKey,
  )
    ? (sp.sort as SortKey)
    : "pod";
  const dir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const fleet = await getFleet();
  // Which pods need looking at — the question the per-pod drill-in can't answer,
  // because you have to already know which pod to open. Cached briefly (it reads
  // every running pod), and non-fatal: a sweep failure must not take out the table.
  const attention = await getPodService()
    .adminFleetHealth()
    .catch(() => []);

  const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
  const td = "px-3 py-2.5 align-middle whitespace-nowrap";

  // Sorted server-side via ?sort=&dir= — no client state, and a sorted view is a
  // shareable URL. Numeric columns compare as numbers; the rest as text.
  const key = (p: (typeof fleet.pods)[number]): string | number => {
    switch (sort) {
      case "environment": return p.pod.environmentName;
      case "provider": return p.pod.provider ?? "";
      case "size": return p.slots;
      case "status": return p.pod.status;
      case "uptime": return p.usage?.runningMs ?? 0;
      case "version": return p.machineCount > 1 ? 2 : p.stale ? 1 : 0;
      case "cost": return p.estUsd;
      default: return (p.pod.name?.trim() || p.pod.id).toLowerCase();
    }
  };
  const sorted = [...fleet.pods].sort((a, b) => {
    const ka = key(a), kb = key(b);
    const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return dir === "asc" ? cmp : -cmp;
  });
  /**
   * Every cell links to the pod, filling its own cell — so tapping anywhere in the
   * row navigates.
   *
   * NOT a stretched overlay on the <tr>: `position: relative` on a table row is not
   * a reliable containing block, so the overlay resolved against an outer element
   * and ONE row's link covered the entire table (every tap opened the same pod).
   * It also sat on top of the horizontally-scrolling container and ate touch
   * scrolling on a phone. Both reported live, 2026-07-29.
   *
   * Only the first cell's link is reachable by keyboard — the rest are skipped, so
   * a screen reader/tab user gets ONE target per row instead of eight identical ones.
   */
  const CellLink = ({
    id,
    children,
    first,
    className = "",
  }: {
    id: string;
    children: ReactNode;
    first?: boolean;
    className?: string;
  }) => (
    <Link
      href={`/admin/pods/${id}`}
      tabIndex={first ? undefined : -1}
      aria-hidden={first ? undefined : true}
      className={`-mx-3 -my-2.5 block px-3 py-2.5 ${className}`}
    >
      {children}
    </Link>
  );

  /** A sortable header: clicking the active column flips direction. */
  const SortTh = ({ col, label, right }: { col: SortKey; label: string; right?: boolean }) => (
    <th className={right ? `${th} text-right` : th}>
      <Link
        href={`/admin/pods?sort=${col}&dir=${sort === col && dir === "asc" ? "desc" : "asc"}`}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-sort={sort === col ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span className={sort === col ? "text-foreground" : "opacity-0"}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </Link>
    </th>
  );

  return (
    <DashboardPage title="Pods" intro={`${fleet.pods.length} pods`} wide>
      {attention.length > 0 && (
        <section className="mb-4 flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">
            Needs attention · {attention.length} pod{attention.length === 1 ? "" : "s"}
          </h2>
          {attention.map((row) => (
            <Link
              key={row.id}
              href={`/admin/pods/${row.id}`}
              className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/50 ${
                row.worst === "critical"
                  ? "border-destructive/45 bg-destructive/[0.06]"
                  : "border-warning/45 bg-warning/[0.06]"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium">{row.name?.trim() || row.id}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{row.id}</span>
                <span className="text-[12px] text-muted-foreground">· {row.environmentName}</span>
              </div>
              {row.issues.map((i) => (
                <span key={i.id} className="text-[12.5px] text-muted-foreground">
                  <span
                    className={
                      i.severity === "critical" ? "text-destructive" : "text-warning"
                    }
                  >
                    {i.severity}
                  </span>{" "}
                  — {i.title}
                </span>
              ))}
            </Link>
          ))}
        </section>
      )}

      {/* Three DIFFERENT conditions with three different remedies. Lumping them into
          one line meant the advice ("open the pod to re-sync") was wrong for an
          orphan — there is no pod page to open, because there is no pod. */}
      {fleet.ghosts.length > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          <strong>
            {fleet.ghosts.length} ghost pod{fleet.ghosts.length === 1 ? "" : "s"}
          </strong>{" "}
          — we think they exist, the provider has no machine. The owner sees a working pod that
          can&rsquo;t act. Open each to re-sync (the drill-in reconciles on load):{" "}
          {fleet.ghosts.map((g) => g.pod.id).join(", ")}.
        </p>
      )}

      {fleet.duplicates.length > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          <strong>
            {fleet.duplicates.length} duplicated pod{fleet.duplicates.length === 1 ? "" : "s"}
          </strong>{" "}
          — more than one machine, each one billing. Open each to reconcile:{" "}
          {fleet.duplicates.join(", ")}.
        </p>
      )}

      {fleet.orphans.length > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          <strong>
            {fleet.orphans.length} orphaned instance{fleet.orphans.length === 1 ? "" : "s"}
          </strong>{" "}
          — running on the box with no pod record. Nothing to open: they are leftover
          infrastructure, removed on the box once you have confirmed they hold nothing:{" "}
          {fleet.orphans.join(", ")}.
        </p>
      )}

      {fleet.providerUnavailable && (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          Provider unreachable — status and version may be stale.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full border-collapse text-[13px]">
          <thead className="border-b border-border/60 bg-white/[0.02]">
            <tr>
              <SortTh col="pod" label="Pod" />
              <SortTh col="environment" label="Environment" />
              <SortTh col="provider" label="Provider" />
              <SortTh col="size" label="Size" />
              <SortTh col="status" label="Status" />
              <SortTh col="uptime" label="Uptime" right />
              <SortTh col="version" label="Version" />
              <SortTh col="cost" label="Cost" right />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.pod.id} className="border-t border-border/60 hover:bg-white/[0.06]">
                <td className={td}>
                  <CellLink id={p.pod.id} first className="font-medium hover:underline">
                    {p.pod.name?.trim() || p.pod.id}
                    {p.pod.name?.trim() && (
                      <span className="block font-mono text-[11px] font-normal text-muted-foreground">
                        {p.pod.id}
                      </span>
                    )}
                  </CellLink>
                </td>
                <td className={`${td} text-muted-foreground`}>
                  <CellLink id={p.pod.id}>{p.pod.environmentName}</CellLink>
                </td>
                <td className={`${td} text-muted-foreground`}>
                  <CellLink id={p.pod.id}>{p.pod.provider ?? "—"}</CellLink>
                </td>
                <td className={`${td} text-muted-foreground`}>
                  <CellLink id={p.pod.id}>
                    {tierLabel(p.pod.size)} <span className="text-[11px]">· {p.slots} sl</span>
                  </CellLink>
                </td>
                <td className={`${td} ${statusTone(p.pod.status)}`}>
                  <CellLink id={p.pod.id}>{p.pod.status}</CellLink>
                </td>
                <td className={`${td} text-right tabular-nums text-muted-foreground`}>
                  <CellLink id={p.pod.id}>{hours(p.usage?.runningMs ?? 0)}</CellLink>
                </td>
                <td className={td}>
                  <CellLink id={p.pod.id}>
                    {p.machineCount > 1 ? (
                      <span className="text-destructive">{p.machineCount} machines</span>
                    ) : p.stale ? (
                      <span className="text-warning">update ready</span>
                    ) : (
                      <span className="text-muted-foreground">current</span>
                    )}
                  </CellLink>
                </td>
                <td className={`${td} text-right tabular-nums text-muted-foreground`}>
                  <CellLink id={p.pod.id}>${p.estUsd.toFixed(2)}/mo</CellLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Click a pod for details + controls (Suspend, Update, Reconcile, Destroy). Uptime is from the
        event log; cost is each pod&rsquo;s RAM-slot share of the box (backoffice-only — users never
        see dollars). Box capacity + economics live on <a className="underline" href="/admin/boxes">Boxes</a>.
      </p>
    </DashboardPage>
  );
}
