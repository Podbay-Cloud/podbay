import { requireAdmin } from "@/lib/access";
import { getPodService } from "@/lib/pod-service";
import type { BoxStats, BoxPod } from "@podbay/shared";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Backoffice box console (docs/plans/box-observability-plan.md v1). Host vitals, the
 * overcommit tuner (actual RAM used vs slots sold — turns the 1.5× guess into a
 * measured dial), a pod-fit visual, and the protect-the-box alerts. Data from the
 * Incus API over WireGuard. Cost/margin lives in the fleet; capacity lives here.
 */

const MB_PER_GB = 1024;
// Box economics (backoffice-only — users never see dollars). Mirrors fleet.ts.
const BOX_USD_PER_MONTH = Number(process.env.PODBAY_BOX_USD_PER_MONTH ?? 160);
function gb(mb: number): string {
  return `${(mb / MB_PER_GB).toFixed(mb < 10 * MB_PER_GB ? 1 : 0)} GB`;
}
function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}
/** tier → block color for the fit visual. */
function tierColor(size: string): string {
  return size === "l" ? "var(--warning, #e0af68)" : size === "m" ? "var(--success, #34d399)" : "var(--accent-light, #7aa2f7)";
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="py-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/** A used/total bar with an optional "sold" marker line (for overcommit). */
function Bar({ pctUsed, tone }: { pctUsed: number; tone: "primary" | "warn" | "bad" }) {
  const w = Math.min(100, Math.max(0, pctUsed));
  const cls = tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/** The pod-fit visual: the box's RAM as a strip; each pod a block sized by its
 * ACTUAL RAM, the remainder is free host RAM. Overcommit shows as reserved > physical. */
function BoxFit({ box }: { box: BoxStats }) {
  const withRam = box.pods.filter((p) => (p.ramUsedMb ?? 0) > 0);
  const usedMb = withRam.reduce((n, p) => n + (p.ramUsedMb ?? 0), 0);
  const otherMb = Math.max(0, box.ramUsedMb - usedMb); // host + pods we couldn't read
  const freeMb = Math.max(0, box.ramTotalMb - box.ramUsedMb);
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-lg border border-border/60">
        {withRam.map((p) => (
          <div
            key={p.id}
            title={`${p.name ?? p.id} · ${gb(p.ramUsedMb ?? 0)}`}
            className="h-full min-w-[3px] border-r border-black/30"
            style={{ width: `${pct(p.ramUsedMb ?? 0, box.ramTotalMb)}%`, background: tierColor(p.size) }}
          />
        ))}
        {otherMb > 0 && (
          <div
            title={`host + cache (ZFS ARC) · ${gb(otherMb)}`}
            className="h-full min-w-[3px] bg-[#3a4152]"
            style={{ width: `${pct(otherMb, box.ramTotalMb)}%` }}
          />
        )}
        <div title={`free · ${gb(freeMb)}`} className="h-full flex-1 bg-white/[0.03]" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: tierColor("s") }} /> Small
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: tierColor("m") }} /> Medium
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: tierColor("l") }} /> Large
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#3a4152]" /> host + cache
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-white/[0.06]" /> free {gb(freeMb)}
        </span>
      </div>
    </div>
  );
}

function BoxCard({ box }: { box: BoxStats }) {
  const soldSlots = box.pods.reduce((n, p) => n + p.slots, 0);
  const physicalSlots = Math.max(1, Math.round(box.ramTotalMb / (4 * MB_PER_GB)));
  const reservedMb = soldSlots * 4 * MB_PER_GB;
  const overcommit = reservedMb / box.ramTotalMb;
  const ramPct = pct(box.ramUsedMb, box.ramTotalMb);
  const diskPct = pct(box.diskUsedMb, box.diskTotalMb);
  // What PODS actually consume (per-instance guest usage) vs the host's total
  // "used" — on a ZFS box the latter is inflated by ARC / page cache (reclaimable),
  // so it's much larger than the sum of pods. The overcommit story is about pod
  // memory; the difference is host + cache, not pod consumption.
  const podUsedMb = box.pods.reduce((n, p) => n + (p.ramUsedMb ?? 0), 0);
  const hostCacheMb = Math.max(0, box.ramUsedMb - podUsedMb);

  const alerts: string[] = [];
  if (diskPct > 85) alerts.push(`Disk ${diskPct.toFixed(0)}% full — nearing the quota ceiling.`);
  if (ramPct > 90) alerts.push(`RAM ${ramPct.toFixed(0)}% used — OOM risk; suspend or migrate a pod.`);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm">{box.name}</CardTitle>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {box.region} · {box.pods.length} pod{box.pods.length === 1 ? "" : "s"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-0">
        {alerts.map((a) => (
          <p
            key={a}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
          >
            {a}
          </p>
        ))}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="CPU" value={`${box.cpuCores} threads`} />
          <Stat label="RAM" value={`${gb(box.ramUsedMb)} / ${gb(box.ramTotalMb)}`} tone={ramPct > 90 ? "bad" : ramPct > 75 ? "warn" : undefined} />
          <Stat label="Disk" value={`${gb(box.diskUsedMb)} / ${gb(box.diskTotalMb)}`} tone={diskPct > 85 ? "bad" : diskPct > 70 ? "warn" : undefined} />
          <Stat
            label="Slots sold / box"
            value={`${soldSlots} / ${physicalSlots}`}
            tone={soldSlots > physicalSlots * 1.5 ? "bad" : soldSlots > physicalSlots ? "warn" : undefined}
          />
        </div>

        <p className="-mt-1 text-[11.5px] text-muted-foreground">
          ${BOX_USD_PER_MONTH}/mo box · ~${(BOX_USD_PER_MONTH / physicalSlots).toFixed(0)}/slot ·{" "}
          {soldSlots} sold ≈ ${((soldSlots * BOX_USD_PER_MONTH) / physicalSlots).toFixed(0)}/mo
          allocated (backoffice-only — users never see dollars).
        </p>

        {/* Overcommit tuner — the measured dial. */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
          <div className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
            <span>Overcommit — actual vs sold</span>
            <span className="tabular-nums">{overcommit.toFixed(2)}× reserved</span>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Reserved (sold)</span>
              <span className="tabular-nums">
                {gb(reservedMb)} of {gb(box.ramTotalMb)}
              </span>
            </div>
            <Bar pctUsed={pct(reservedMb, box.ramTotalMb)} tone={overcommit > 1.5 ? "bad" : overcommit > 1 ? "warn" : "primary"} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Actual pod RAM</span>
              <span className="tabular-nums">
                {gb(podUsedMb)} of {gb(reservedMb)} sold
              </span>
            </div>
            <Bar pctUsed={pct(podUsedMb, box.ramTotalMb)} tone="primary" />
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Pods actually use <span className="tabular-nums">{gb(podUsedMb)}</span> of the{" "}
            {gb(reservedMb)} sold — idle pods sit well under their 4&nbsp;GB ceiling. The host reports{" "}
            {gb(box.ramUsedMb)} used, but ~{gb(hostCacheMb)} of that is ZFS&nbsp;ARC / page cache
            (reclaimable), not pod memory. Lots of headroom to sell more.
          </p>
        </div>

        {/* Fit visual. */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/[0.02] px-3.5 py-3">
          <span className="text-[12px] font-medium text-muted-foreground">How pods fit</span>
          <BoxFit box={box} />
        </div>

        {/* Pod list on this box. */}
        <div className="flex flex-col">
          {[...box.pods]
            .sort((a: BoxPod, b: BoxPod) => (b.ramUsedMb ?? 0) - (a.ramUsedMb ?? 0))
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-t border-border/60 py-2 text-[13px] first:border-t-0"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: tierColor(p.size) }}
                  />
                  <span className="truncate">{p.name?.trim() || p.id}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-[12px] text-muted-foreground">
                  <span>{p.slots} sl</span>
                  <span>{p.status}</span>
                  <span className="w-14 text-right tabular-nums">
                    {p.ramUsedMb != null ? gb(p.ramUsedMb) : "—"}
                  </span>
                </span>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

export const metadata = { title: "Boxes" };

export default async function BoxesPage() {
  await requireAdmin();
  const boxes = await getPodService().getBoxStats();

  return (
    <DashboardPage title="Boxes">
      {boxes.length === 0 ? (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          No self-hosted boxes reporting. (Fly has no box concept; only Incus boxes appear here.)
        </p>
      ) : (
        boxes.map((box) =>
          box.reachable ? (
            <BoxCard key={box.name} box={box} />
          ) : (
            <Card key={box.name} className="border-destructive/40 py-4">
              <CardContent className="py-0 text-sm text-destructive">
                <strong>{box.name}</strong> is unreachable — host vitals unknown. The box may be down
                or the WireGuard tunnel is broken.
              </CardContent>
            </Card>
          ),
        )
      )}
      <p className="text-[12px] text-muted-foreground">
        Host vitals from the Incus API over WireGuard; refresh to update. Swap, KSM savings and
        load-average need a host agent (v2). 1 slot ≈ 4 GB RAM (docs/strategy/pricing-model.md).
      </p>
    </DashboardPage>
  );
}
