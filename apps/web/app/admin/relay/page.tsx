import { requireAdmin, listUsersDetailed } from "@/lib/access";
import { getRelayAdmin, getRelayLiveState } from "@/lib/relay-actions";
import { getPodService } from "@/lib/pod-service";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const TONE: Record<string, string> = {
  ok: "text-success",
  blocked: "text-destructive",
  challenged: "text-warning",
  login: "text-warning",
  timeout: "text-warning", // transient — slow/hung, not a refusal
  empty: "text-muted-foreground",
};

/** A big summary number with a label — the fleet state at a glance, above the tables. */
/** Bytes for humans — the tunnel moves real volume, and a raw byte count is unreadable. */
function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border/60 bg-white/[0.02] px-4 py-3">
      <span className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</span>
      <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    </div>
  );
}

/** Live dot — a small pulsing green dot next to sections backed by the gateway's live
 * state, so an operator knows those numbers are real-time (vs the persisted tables). */
function LiveDot({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.06em] text-success">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> live
    </span>
  ) : (
    <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">gateway unreachable</span>
  );
}

/** ok/fail split as a thin bar — the ratio reads faster than two numbers. */
function RatioBar({ ok, fail }: { ok: number; fail: number }) {
  const total = ok + fail;
  const okPct = total > 0 ? (ok / total) * 100 : 0;
  return (
    <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-destructive/40">
      <div className="h-full bg-success" style={{ width: `${okPct}%` }} />
    </div>
  );
}

/**
 * Relay oversight for admins (web-fetch-v2 §6.2): fleet summary, connected relays, per-domain
 * traffic, and the policy guardrails. Live queue/rate come from the gateway's in-memory
 * RelayRegistry (getRelayLiveState); traffic + connections from the DB. Domain/outcome only —
 * never a URL, never page content, never who asked. The relay's detailed log stays on the
 * owner's machine (`relay dashboard`).
 */
export const metadata = { title: "Relays" };

export default async function RelayAdminPage() {
  await requireAdmin();
  const [{ connections, traffic }, live, users, pods] = await Promise.all([
    getRelayAdmin(),
    getRelayLiveState(),
    listUsersDetailed(),
    getPodService().listAllPods(),
  ]);

  // A relay belongs to a USER (their machine), not one pod — so resolve the owner id to
  // a name/email an operator recognizes, and list which of their pods can route through it.
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const podById = new Map(pods.map((p) => [p.id, p] as const));
  const podsByOwner = new Map<string, string[]>();
  for (const p of pods) {
    const name = p.name?.trim() || p.id;
    podsByOwner.set(p.ownerId, [...(podsByOwner.get(p.ownerId) ?? []), name]);
  }

  const queuedByOwner = new Map(live?.owners.map((o) => [o.ownerId, o.queued] as const) ?? []);
  const reqByOwner = new Map(live?.owners.map((o) => [o.ownerId, o.reqLastMin] as const) ?? []);
  const reqByDomain = new Map(live?.perDomain.map((d) => [d.domain, d.reqLastMin] as const) ?? []);
  const tunnelByDomain = new Map(live?.tunnel?.domains.map((d) => [d.domain, d] as const) ?? []);
  const tunnelBytes = (live?.tunnel?.domains ?? []).reduce((n, d) => n + d.bytesUp + d.bytesDown, 0);
  const tunnelByOwner = new Map(live?.tunnel?.owners?.map((o) => [o.ownerId, o] as const) ?? []);
  const tunnelByPod = new Map(live?.tunnel?.pods?.map((p) => [p.podId, p] as const) ?? []);

  // The per-pod table is driven by live FETCH traffic; a pod that only tunnels would
  // otherwise be invisible. Union the two so "traffic by pod" means all of it.
  const podRows = [
    ...new Set([...(live?.perPod ?? []).map((p) => p.podId), ...tunnelByPod.keys()]),
  ].map((podId) => {
    const fetches = live?.perPod.find((p) => p.podId === podId);
    const tun = tunnelByPod.get(podId);
    return {
      podId,
      reqLastMin: fetches?.reqLastMin ?? 0,
      domains: [...new Set([...(fetches?.domains ?? []), ...(tun?.domains ?? [])])],
      open: tun?.open ?? 0,
      bytes: tun ? tun.bytesUp + tun.bytesDown : 0,
    };
  });

  const totalOk = traffic.reduce((n, r) => n + r.okCount, 0);
  const totalFail = traffic.reduce((n, r) => n + r.failCount, 0);
  const okRate = totalOk + totalFail > 0 ? Math.round((100 * totalOk) / (totalOk + totalFail)) : null;

  return (
    <DashboardPage title="Relays">
      <div className="space-y-6">
        {/* Summary strip — the fleet at a glance, before any table. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <Stat label="Connected" value={connections.length} tone={connections.length ? "text-success" : undefined} />
          <Stat label="In queue" value={live?.totals.queued ?? "—"} tone={live && live.totals.queued > 0 ? "text-warning" : undefined} />
          <Stat label="Req / min" value={live?.totals.reqLastMin ?? "—"} />
          <Stat label="Domains" value={traffic.length} />
          <Stat label="Success" value={okRate != null ? `${okRate}%` : "—"} tone={okRate != null && okRate < 80 ? "text-warning" : undefined} />
          {/* Egress tunnel — connections a pod carried through its owner's machine, and
              the data moved. Domain-level only, like everything else here. */}
          <Stat label="Tunnels open" value={live?.tunnel?.open ?? "—"} tone={live?.tunnel?.open ? "text-success" : undefined} />
          <Stat label="Tunnel data" value={fmtBytes(tunnelBytes)} />
        </div>

        {/* Connected relays — DB (owner/since/last-seen) + live (queued/req-min). */}
        <Card className="gap-1 py-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Connected now ({connections.length})
            </CardTitle>
            <LiveDot on={live !== null} />
          </CardHeader>
          <CardContent className="py-0">
            {connections.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">No relays connected.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Owner</th>
                      <th className="py-2 pr-4 font-medium">Their pods</th>
                      <th className="py-2 pr-4 font-medium">Signed in for</th>
                      <th className="py-2 pr-4 text-right font-medium">Queued</th>
                      <th className="py-2 pr-4 text-right font-medium">Req/min</th>
                      <th className="py-2 pr-4 text-right font-medium">Tunnels</th>
                      <th className="py-2 pr-4 text-right font-medium">Data</th>
                      <th className="py-2 pr-4 font-medium">Tunnel</th>
                      <th className="py-2 pr-4 font-medium">Since</th>
                      <th className="py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => {
                      const q = queuedByOwner.get(c.ownerId) ?? 0;
                      const u = userById.get(c.ownerId);
                      const ownerPods = podsByOwner.get(c.ownerId) ?? [];
                      return (
                        <tr key={c.ownerId} className="border-b border-border/40">
                          <td className="py-2 pr-4">
                            <span className="flex items-start gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                              <span className="flex flex-col">
                                <span className="font-medium">{u?.name?.trim() || u?.email || "Unknown user"}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {u?.email ?? <span className="font-mono">{c.ownerId}</span>}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-[12px] text-muted-foreground">
                            {ownerPods.length === 0 ? (
                              "—"
                            ) : ownerPods.length <= 2 ? (
                              ownerPods.join(", ")
                            ) : (
                              <span title={ownerPods.join(", ")}>
                                {ownerPods.slice(0, 2).join(", ")} +{ownerPods.length - 2}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {c.loginDomains.length ? c.loginDomains.join(", ") : "—"}
                          </td>
                          <td className={`py-2 pr-4 text-right tabular-nums ${q > 0 ? "text-warning" : "text-muted-foreground"}`}>
                            {live ? q : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                            {live ? (reqByOwner.get(c.ownerId) ?? 0) : "—"}
                          </td>
                          {/* Tunnel side of the SAME relay: open now / total since the
                              gateway started, the data moved, and whether a CONNECT
                              through it has actually been proven to work. */}
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                            {(() => {
                              const t = tunnelByOwner.get(c.ownerId);
                              if (!t) return "—";
                              return t.open > 0 ? (
                                <span className="text-success">
                                  {t.open}
                                  <span className="text-muted-foreground"> / {t.connections}</span>
                                </span>
                              ) : (
                                t.connections || "—"
                              );
                            })()}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                            {(() => {
                              const t = tunnelByOwner.get(c.ownerId);
                              return t ? fmtBytes(t.bytesUp + t.bytesDown) : "—";
                            })()}
                          </td>
                          <td className="py-2 pr-4 text-[12px]">
                            {(() => {
                              const h = tunnelByOwner.get(c.ownerId)?.health;
                              if (!h) return <span className="text-muted-foreground">unchecked</span>;
                              if (h.state === "ok") return <span className="text-success">working</span>;
                              if (h.state === "failed")
                                return (
                                  <span className="text-destructive" title={h.reason ?? ""}>
                                    failing
                                  </span>
                                );
                              return <span className="text-muted-foreground">unknown</span>;
                            })()}
                          </td>
                          <td className="py-2 pr-4 text-[12px] tabular-nums text-muted-foreground">{when(c.connectedAt)}</td>
                          <td className="py-2 text-[12px] tabular-nums text-muted-foreground">{when(c.lastSeenAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Traffic by domain — DB counts + a ratio bar + live req/min. */}
        <Card className="gap-1 py-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Traffic by domain
            </CardTitle>
            <span className="text-[11px] text-muted-foreground">domain + outcome only — never URLs or who asked</span>
          </CardHeader>
          <CardContent className="py-0">
            {traffic.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">Nothing fetched through a relay yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Domain</th>
                      <th className="py-2 pr-4 font-medium">Latest</th>
                      <th className="py-2 pr-4 font-medium">ok / fail</th>
                      <th className="py-2 pr-4 text-right font-medium">Req/min</th>
                      <th className="py-2 pr-4 text-right font-medium">Tunnelled</th>
                      <th className="py-2 pr-4 text-right font-medium">Data</th>
                      <th className="py-2 font-medium">Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traffic.map((r) => (
                      <tr key={r.domain} className="border-b border-border/40">
                        <td className="py-2 pr-4 font-medium">{r.domain}</td>
                        <td className={`py-2 pr-4 ${TONE[r.lastOutcome] ?? ""}`}>{r.lastOutcome}</td>
                        <td className="py-2 pr-4">
                          <span className="flex items-center gap-2">
                            <RatioBar ok={r.okCount} fail={r.failCount} />
                            <span className="tabular-nums text-muted-foreground">
                              <span className="text-success">{r.okCount}</span>/
                              <span className={r.failCount ? "text-destructive" : ""}>{r.failCount}</span>
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {live ? (reqByDomain.get(r.domain) ?? 0) : "—"}
                        </td>
                        {/* Tunnel columns: connections carried for this domain and the data
                            moved. Blank when a domain was only ever fetched, so the two
                            consumers stay legible rather than blurring into one number. */}
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {tunnelByDomain.get(r.domain)?.connections || ""}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {(() => {
                            const t = tunnelByDomain.get(r.domain);
                            return t ? fmtBytes(t.bytesUp + t.bytesDown) : "";
                          })()}
                        </td>
                        <td className="py-2 text-[12px] tabular-nums text-muted-foreground">{when(r.lastVerified)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Traffic by pod — live only, for BOTH consumers: fetch req/min plus tunnel
            connections open right now. Per-pod attribution is deliberately never
            accumulated or persisted, so this table empties when the traffic stops. */}
        <Card className="gap-1 py-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Traffic by pod
            </CardTitle>
            <LiveDot on={live !== null} />
          </CardHeader>
          <CardContent className="py-0">
            {!live || podRows.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">
                {live
                  ? "No pods are fetching or tunnelling through a relay right now — this populates live while traffic flows (fetches: last 60s; tunnels: open connections)."
                  : "Gateway unreachable — live per-pod traffic unavailable."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Pod</th>
                      <th className="py-2 pr-4 font-medium">Owner</th>
                      <th className="py-2 pr-4 text-right font-medium">Req/min</th>
                      <th className="py-2 pr-4 text-right font-medium">Tunnels open</th>
                      <th className="py-2 pr-4 text-right font-medium">Data</th>
                      <th className="py-2 font-medium">Domains</th>
                    </tr>
                  </thead>
                  <tbody>
                    {podRows.map((pp) => {
                      const pod = podById.get(pp.podId);
                      const owner = pod ? userById.get(pod.ownerId) : undefined;
                      return (
                        <tr key={pp.podId} className="border-b border-border/40">
                          <td className="py-2 pr-4 font-medium">{pod?.name?.trim() || pp.podId}</td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {owner?.name?.trim() || owner?.email || "—"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{pp.reqLastMin || "—"}</td>
                          <td className={`py-2 pr-4 text-right tabular-nums ${pp.open ? "text-success" : "text-muted-foreground"}`}>
                            {pp.open || "—"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                            {pp.bytes ? fmtBytes(pp.bytes) : "—"}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {pp.domains.length ? pp.domains.join(", ") : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Policy — the guardrails, so the caps are legible rather than buried in code. */}
        <Card className="gap-1 py-4">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Policy plan
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              {[
                ["Queue cap (fleet)", live ? `${live.policy.queueMax}` : "50"],
                ["Queue cap (per pod)", live ? `${live.policy.queueMaxPerPod}` : "20"],
                ["Rate cap", `${live?.policy.ratePerDomain ?? 10}/domain/min`],
                ["On overload", "fail-closed"],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border/60 px-3 py-2">
                  <span className="font-medium tabular-nums">{value}</span>
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardPage>
  );
}
