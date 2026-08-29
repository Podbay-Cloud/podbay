import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, getUserById } from "@/lib/access";
import { getPodService } from "@/lib/pod-service";
import { ControlError } from "@podbay/control-plane";
import { POD_TIERS, isPodSize } from "@podbay/shared";
import type { ReactNode } from "react";
import DashboardPage from "@/components/dashboard-page";
import EventTimeline from "@/components/event-timeline";
import PodStats from "@/components/pod-stats";
import HealthPanel from "@/components/health-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/pod-status";
import { StatusAction, ImageActions, DangerZone, ResizeAction } from "@/components/admin-pod-controls";
import { listImages } from "@/lib/image-manifest";
import { imageState, shortDigest, imageVersionLabel } from "@/lib/pod-image";
import AutoRefresh from "@/components/auto-refresh";
import Elapsed from "@/components/elapsed";
import LifecycleTimeline from "@/components/lifecycle-timeline";
import DiagnosticsPanel from "@/components/diagnostics-panel";

export const dynamic = "force-dynamic";

/**
 * Backoffice per-pod drill-in (Backoffice v2 · B1 fixes the broken fleet link;
 * B2 starts here with the event timeline). Admin-scoped: reads ANY pod, unlike
 * the owner-scoped /dashboard/pods/[id] cockpit.
 */

function dur(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.round(ms / 60_000)}m` : `${h.toFixed(1)}h`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

export default async function AdminPodPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const svc = getPodService();

  // Re-sync THIS pod with the provider on load, so the drill-in always reflects
  // real state — no manual "Reconcile"/"Refresh" button needed. Wake-safe: it
  // reads instance metadata and only dials the pod-agent for a pod already
  // running (service.reconcile), so a suspended pod stays suspended. Best-effort:
  // a provider hiccup must never 500 the page.
  await svc.reconcile(id).catch(() => {});

  let pod;
  try {
    pod = await svc.adminGetPod(id);
  } catch (e) {
    if (e instanceof ControlError && e.code === "not_found") notFound();
    throw e;
  }
  // No metrics fetch here on purpose: <PodStats admin /> loads them client-side and
  // keeps polling, so fetching a snapshot server-side would block first paint on a
  // round-trip to the pod only to be replaced a second later.
  const [usage, events, secrets, owner, github, health] = await Promise.all([
    svc.adminPodUsage(id),
    svc.adminPodEvents(id),
    svc.adminListSecrets(id).catch(() => []),
    getUserById(pod.ownerId).catch(() => null),
    // The operator's FIRST question is "what's wrong with it", so read the pod's own
    // report up front rather than making them infer it from the rows below.
    // Does the pod have a working GitHub login? A read-only support fact (connected
    // + as whom) — never the token.
    svc.githubStatus(pod.ownerId, id).catch(() => ({ connected: false, login: null })),
    svc.podHealth(pod.ownerId, id).catch(() => ({
      agents: [],
      issues: [],
      repairs: [],
      repairGaveUp: [],
    })),
  ]);
  const digest = pod.imageDigest;
  // Free from the samples we already collect: uptime says a pod was AWAKE, this
  // says whether it was working. A pod can be up for hours having done nothing.

  // Preview URL (same construction as the owner cockpit). previewPublic tells the
  // admin whether the link is reachable by anyone or gated to the owner.
  const previewBase = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "") || null;
  const previewUrl = previewBase ? `https://${pod.id}.${previewBase}` : null;

  const size = isPodSize(pod.size) ? pod.size : "s";
  const tier = size === "l" ? "Large" : size === "m" ? "Medium" : "Small";
  const slots = POD_TIERS[size].memoryGb / 4;

  // Image manifest (release notes + build date) for the current + rollback-target
  // digests, so the Image row's info modal can show what each brings.
  const images = await listImages().catch(() => []);
  const byDigest = new Map(images.map((i) => [i.digest, i]));
  const fmtBuilt = (d: Date | null | undefined) =>
    d ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const toMeta = (dg: string | null | undefined) =>
    dg
      ? {
          digest: dg,
          notes: byDigest.get(dg)?.notes ?? null,
          builtAt: fmtBuilt(byDigest.get(dg)?.builtAt ?? byDigest.get(dg)?.recordedAt),
        }
      : null;

  // Totals moved ONTO the timeline (it states them with the window they cover).
  // What stays as a row is the one fact a bar cannot show: how long the CURRENT
  // stretch has been going, which is what an operator reads first.
  const stats: [string, string][] = usage
    ? [
        usage.currentRunningMs !== null
          ? ["Running now", dur(usage.currentRunningMs)]
          : usage.currentSuspendedMs !== null
            ? ["Suspended now", dur(usage.currentSuspendedMs)]
            : ["Now", "—"],
      ]
    : [];

  // One shared predicate with the owner cockpit — see lib/pod-image.ts for why
  // this must not be a second copy.
  const img = imageState(pod);
  const stale = img.showUpdate;
  const leaseHeld = Boolean(
    pod.provisionLeaseUntil && new Date(pod.provisionLeaseUntil).getTime() > Date.now(),
  );
  // Refresh only while something is MOVING. This page reconciles against the
  // provider on every load, so an unconditional poll would be a provider call per
  // tab per interval, forever.
  const transient =
    Boolean(pod.updatingSince) || ["provisioning", "starting", "stopping"].includes(pod.status);

  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const canRollback = events.some((e) => e.type === "updated" && (e.meta as { from?: unknown })?.from);
  const currentMeta = toMeta(digest);
  const currentImgVersion = digest ? (byDigest.get(digest)?.version ?? null) : null;
  const lastUpdate = sorted.find((e) => e.type === "updated" && (e.meta as { from?: unknown })?.from);
  const rollbackMeta = canRollback ? toMeta((lastUpdate?.meta as { from?: string })?.from) : null;

  // Login / remote-control status — durable onboarding signals (never terminal
  // content). Good support triage: "did they sign in? is RC connected?".
  const loginStatus = pod.authedAt
    ? `Signed in · ${when(pod.authedAt)}`
    : pod.authUrl
      ? "Sign-in link issued, not yet signed in"
      : "Not signed in";
  const rcStatus = pod.sessionUrl ? "Connected" : "None";
  const lifecycleLabel = `${pod.lifecycle}${pod.keepAwake ? " · keep-awake" : ""}`;

  // Detail rows. Status + Image carry inline, contextual actions; the rest are read-only.
  const detailRows: { label: string; value: ReactNode; action?: ReactNode }[] = [
    {
      label: "Owner",
      value: (
        <Link href={`/admin/users`} className="underline underline-offset-2">
          {owner ? `${owner.email}${owner.name ? ` (${owner.name})` : ""}` : pod.ownerId}
        </Link>
      ),
    },
    {
      label: "GitHub",
      value: github.connected
        ? `Connected${github.login ? ` as ${github.login}` : ""}`
        : "Not connected",
    },
    ...(pod.githubRepo
      ? [
          {
            label: "Repository",
            // The pod's cloned repo, linked out. A read-only fact we already store —
            // never the token.
            value: (
              <a
                href={`https://github.com/${pod.githubRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {pod.githubRepo}
              </a>
            ),
          },
        ]
      : []),
    { label: "Environment", value: pod.environmentName },
    {
      label: "Status",
      value: <StatusBadge status={pod.status} />,
      action: <StatusAction id={pod.id} status={pod.status} />,
    },
    ...(pod.status === "error" && pod.provisionError
      ? [{ label: "Error", value: pod.provisionError }]
      : []),
    ...(pod.updatingSince
      ? [
          {
            label: pod.maintenanceKind === "resize" ? "Resizing" : "Updating",
            // Elapsed ticks on the client so the number moves between server
            // refreshes — a frozen counter is how an operator concludes a page is
            // dead when the update is merely slow.
            value: (
              <span>
                {pod.updateStage ?? "starting"} · <Elapsed since={pod.updatingSince} /> · started{" "}
                {when(pod.updatingSince)}
              </span>
            ),
          },
        ]
      : []),
    { label: "Sign-in", value: loginStatus },
    { label: "Remote control", value: rcStatus },
    { label: "Lifecycle", value: lifecycleLabel },
    {
      label: "Preview",
      value: previewUrl ? (
        <span className="flex items-center gap-2">
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[12px] text-[var(--accent-light)] hover:underline"
          >
            {pod.id}.{previewBase} ↗
          </a>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
              pod.previewPublic
                ? "bg-warning/15 text-warning"
                : "bg-white/[0.06] text-muted-foreground"
            }`}
          >
            {pod.previewPublic ? "public" : "owner-only"}
          </span>
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Provider", value: pod.provider },
    {
      label: "Size",
      value: `${tier} · ${slots} slot${slots === 1 ? "" : "s"} · ${pod.diskGb} GB disk`,
      action: <ResizeAction id={pod.id} size={pod.size} />,
    },
    { label: "Machine", value: pod.machineId ?? "— (no machine id)" },
    // Build attempts and the worker's claim lease. Both are stored and were shown
    // NOWHERE, so a pod stuck behind a held lease could not be diagnosed from any
    // screen — the operator saw "provisioning" and no reason. Hidden on the happy
    // path (one attempt, no lease) so it stays a signal rather than another row.
    ...(pod.provisionAttempts > 1 || pod.provisionLeaseUntil
      ? [
          {
            label: "Provisioning",
            value: (
              <span className={leaseHeld ? "text-warning" : undefined}>
                {pod.provisionAttempts} attempt{pod.provisionAttempts === 1 ? "" : "s"}
                {pod.provisionLeaseUntil
                  ? leaseHeld
                    ? ` · a worker holds the build lease until ${when(pod.provisionLeaseUntil)}`
                    : ` · lease EXPIRED ${when(pod.provisionLeaseUntil)} — no worker is building this`
                  : " · no lease held"}
              </span>
            ),
          },
        ]
      : []),
    {
      label: "Image",
      value: (
        <code className="font-mono text-[12px] text-muted-foreground">
          {digest ? imageVersionLabel(currentImgVersion, digest) : "— (unknown)"}
        </code>
      ),
      action: <ImageActions id={pod.id} stale={stale} updating={img.updating} current={currentMeta} rollbackTo={rollbackMeta} />,
    },
    { label: "Created", value: when(pod.createdAt) },
    { label: "Last active", value: when(pod.lastActiveAt) },
  ];

  return (
    <DashboardPage backHref="/admin/pods" backLabel="Pods" title={pod.name?.trim() || pod.id}>
      <AutoRefresh fast={transient} idleMs={0} />
      {/* The owner cockpit is owner-scoped (web + terminal proxy both refuse a
          non-owner) — so this shortcut only shows when YOU own the pod, instead of
          dead-ending in a 404. Cross-user oversight lives on THIS admin page (no
          impersonation of the user's live session). */}
      {admin.id === pod.ownerId && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/pods/${pod.id}`}
            className="text-[12px] text-muted-foreground hover:underline"
          >
            owner cockpit ↗
          </Link>
        </div>
      )}

      {/* Operator-ordered: what is WRONG comes before what it IS. The owner's
          cockpit answers "is my pod working?"; this answers "why is this user's pod
          broken, and what changed?" — same data, different spine.

          Single-sourced on DOCTOR, exactly like the cockpit. The passive /healthz
          list and doctor's list are filtered differently, so rendering the passive
          one here meant the same pod could show the owner nothing and the operator
          four problems — and the operator, seeing findings, had no button to fix
          any of them. */}
      <Card className="gap-1 border-warning/40 py-4">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-warning">
            Health
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 py-0 pb-1">
          <HealthPanel slug={pod.id} running={pod.status === "running"} admin />
          {/* When doctor has no answer, this is the escalation — not a terminal.
              See DiagnosticsPanel for the boundary and why. */}
          <div className="border-t border-border/60 pt-2.5">
            <DiagnosticsPanel id={pod.id} running={pod.status === "running"} />
          </div>
          {health.repairGaveUp.length > 0 && (
            <p className="text-[12.5px] text-destructive">
              Self-repair gave up on: {health.repairGaveUp.join(", ")} — this pod cannot fix
              itself; an update or restart usually clears it.
            </p>
          )}
          {/* Successful self-repairs. They were fetched and thrown away before — the
              operator saw the give-ups but not the "it has quietly restarted Codex
              nine times today", which is the more useful signal. */}
          {health.repairs.length > 0 && (
            <p className="text-[12.5px] text-muted-foreground">
              Self-repaired {health.repairs.length}× recently:{" "}
              {[...new Set(health.repairs.map((r) => r.target))].join(", ")} — last{" "}
              {/* `at` is an ISO string, which sorts lexicographically — no parse needed. */}
              {when(health.repairs.map((r) => r.at).sort().at(-1)!)}.
            </p>
          )}
        </CardContent>
      </Card>

      {health.agents.length > 0 && (
        <Card className="gap-1 py-4">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Agents (live)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 py-0">
            {health.agents.map((a) => (
              <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                <span className="font-medium">{a.id}</span>
                <span className="text-muted-foreground">
                  window {a.window ?? "—"} · {a.authed ? "signed in" : "NOT signed in"} ·{" "}
                  {a.rcActive ? "remote control on" : "remote control off"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="gap-1 py-4">
        <CardContent className="py-0">
          {detailRows.map(({ label, value, action }) => (
            <div
              key={label}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border/60 py-2.5 text-sm first:border-t-0"
            >
              <span className="font-medium">{label}</span>
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                {typeof value === "string" ? (
                  <span className="truncate font-mono text-[12px] text-muted-foreground">{value}</span>
                ) : (
                  value
                )}
                {action}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {stats.length > 0 && (
        <Card className="gap-1 py-4">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 py-0">
            {usage && (
              <LifecycleTimeline
                intervals={usage.intervals}
                suspends={usage.suspends}
              />
            )}
            {stats.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 border-t border-border/60 py-2.5 text-sm first:border-t-0"
              >
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* The SAME component the owner sees — zoom, charts, activity strip, disk
          breakdown, app port. Not a parallel admin rendering: two renderings of one
          pod drift, and then an operator and an owner describe it differently. */}
      <Card className="gap-1 py-4">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Resources
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <PodStats slug={pod.id} admin />
        </CardContent>
      </Card>

      {secrets.length > 0 && (
        <Card className="gap-1 py-4">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Secrets
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {secrets.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-4 border-t border-border/60 py-2.5 text-sm first:border-t-0"
              >
                <span className="font-mono text-[12px]">
                  {s.key}
                  {s.required && <span className="ml-1 text-[10px] text-muted-foreground">required</span>}
                </span>
                <span
                  className={`text-[12px] ${s.set ? "text-success" : s.required ? "text-warning" : "text-muted-foreground"}`}
                >
                  {s.set ? "set" : "not set"}
                </span>
              </div>
            ))}
            <p className="border-t border-border/60 py-2 text-[11px] text-muted-foreground">
              Whether each secret is set — values are never shown.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="gap-1 py-4">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Event timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <EventTimeline events={sorted} />
        </CardContent>
      </Card>

      <DangerZone id={pod.id} />
    </DashboardPage>
  );
}
