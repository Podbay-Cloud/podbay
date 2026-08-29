import { notFound } from "next/navigation";
import { requireApprovedUser } from "@/lib/access";
import { getPodService, localPreviewUrl, hostCapacity, latestPodImageDigest } from "@/lib/pod-service";
import { myRelayLive } from "@/lib/relay-actions";
import { imageState, sameDigest } from "@/lib/pod-image";
import { fetchSelfHostRelease } from "@/lib/self-host-releases";
import { getEnvironmentDetail } from "@/lib/environments";
import { imageByDigest, listImages, currentImage } from "@/lib/image-manifest";
import { ControlError } from "@podbay/control-plane";
import PodCockpit from "@/components/pod-cockpit";
import PodErrorActions from "@/components/pod-error-actions";
import IncidentBanner from "@/components/incident-banner";
import { getPodActivity } from "@/lib/pod-activity";
import { hasSeenWalkthrough } from "@/lib/walkthrough";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveSetupStep } from "@/lib/pod-onboarding";
import { recordAttributedUserEvent } from "@/lib/landing-experiment-store";
import { editionOss } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Tab title = the pod's display name (or slug) so each cockpit tab is distinct. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const user = await requireApprovedUser();
    const pod = await getPodService().getPod(user.id, slug);
    return { title: pod.name?.trim() || slug };
  } catch {
    return { title: slug };
  }
}

/** Manifest row → a client-safe shape (Dates as ISO strings) for the cockpit. */
type SerializedImage = {
  digest: string | null;
  alias: string | null;
  notes: string | null;
  summary: string | null;
  version: string | null;
  sizeBytes: number | null;
  builtAt: string | null;
};

function serializeImage(
  img: Awaited<ReturnType<typeof imageByDigest>>,
): SerializedImage | null {
  if (!img) return null;
  return {
    digest: img.digest,
    alias: img.alias,
    notes: img.notes,
    summary: img.summary,
    version: img.version,
    sizeBytes: img.sizeBytes,
    builtAt: img.builtAt ? img.builtAt.toISOString() : null,
  };
}

/**
 * A pod's cockpit — the durable, DB-reflected control room. The step is derived
 * server-side from the pod's state (status + onboarding milestones), so a
 * refresh / close+reopen resumes exactly where it was; the client advances it
 * live and exposes every control.
 */
export default async function PodCockpitPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireApprovedUser();
  const { slug } = await params;
  const svc = getPodService();
  let pod;
  try {
    pod = await svc.getPod(user.id, slug);
  } catch (e) {
    if (e instanceof ControlError && e.code === "not_found") notFound();
    throw e;
  }

  if (pod.status === "error") {
    // If the pod's environment no longer resolves (renamed/removed), retrying
    // can't help — rebuilding needs the template. Say so and offer only Delete.
    const envGone = !(await getEnvironmentDetail(pod.environmentName).catch(() => null));
    return (
      <DashboardPage backHref="/dashboard" backLabel="Dashboard">
        <Card>
          <CardHeader>
            <CardTitle>{envGone ? "This pod can’t be rebuilt" : "This pod didn’t start"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {envGone ? (
                <>
                  Its environment <strong>{pod.environmentName}</strong> no longer exists — it was
                  renamed or removed, so there’s nothing to rebuild from. Delete this pod and launch a
                  new one from the current catalog.
                </>
              ) : (
                <>
                  Something went wrong building the machine. Your name and secrets are saved on this
                  pod — <strong>Try again</strong> to rebuild it, or delete it and start fresh.
                </>
              )}
            </p>
            {pod.provisionError && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                {pod.provisionError}
              </pre>
            )}
            <PodErrorActions slug={slug} canRetry={!envGone} />
          </CardContent>
        </Card>
      </DashboardPage>
    );
  }

  const previewBase = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "") || null;
  // Cloud derives the preview from PODBAY_PREVIEW_BASE; self-host has none, so fall back to the
  // container's published :3000 (http://127.0.0.1:<port>) so the running dev server is openable.
  const previewUrl = previewBase ? `https://${pod.id}.${previewBase}` : await localPreviewUrl(pod.id);
  const [envDetail, usage, adminActions, relay] = await Promise.all([
    getEnvironmentDetail(pod.environmentName),
    // Usage is derived from this pod's event log (Stats tab). Null until the log
    // has anything — events only exist from their deploy forward, no backfill.
    svc.podUsage(user.id, pod.id).catch(() => null),
    // What Podbay did to this pod. Shown to the owner because we can suspend,
    // update, roll back and repair their pod — and they had no way to know it was
    // us. Comfortable doing it ⇒ comfortable saying it.
    svc.podAdminActions(user.id, pod.id).catch(() => []),
    // The owner's relay (their machine) — connected?, signed-in sites, tunnel health,
    // usage — in one shape the cockpit then POLLS to stay near-realtime.
    myRelayLive().catch(() => ({
      connected: false,
      loginDomains: [] as string[],
      dropCount: 0,
      lastDroppedAt: null,
      health: null,
      usage: null,
    })),
  ]);
  // "Update available" without a live provider call: compare the digest recorded
  // on the row against the image we pin NOW — per provider, since a Fly OCI digest
  // and an Incus image fingerprint live in different namespaces and would never
  // match (which made every Incus pod falsely show an update).
  // Offer the update when the pod is behind the pin — OR keep the update row
  // visible while an update is in flight (updatingSince), so the progress shows.
  // Shared with the admin drill-in so the two surfaces cannot disagree.
  const { pinned, showUpdate: cloudUpdateAvailable } = imageState(pod);
  // Self-host has no image manifest: an update is available when the pod's recorded digest differs
  // from the pod-base tag currently pulled on the host (the owner refreshes it with a compose pull).
  const ossLatestDigest = editionOss() ? await latestPodImageDigest() : null;
  const updateAvailable = editionOss()
    ? Boolean(pod.imageDigest && ossLatestDigest && !sameDigest(pod.imageDigest, ossLatestDigest))
    : cloudUpdateAvailable;

  // Self-host: what the pending update CONTAINS, from the public release manifest (release-versioning
  // §4). Never throws — offline/air-gapped falls back to the from→to digest line. Only when an update
  // is actually offered, so a quiet cockpit does no network.
  const ossRelease =
    editionOss() && updateAvailable ? await fetchSelfHostRelease(ossLatestDigest) : null;

  // A recent unplanned incident (OOM, crash, wedged) to surface at the top of the pod's
  // dashboard. Best-effort — never block the cockpit if activity can't be read.
  const activity = await getPodActivity(pod.id).catch(() => null);
  const incidentBanner = activity && !("error" in activity) ? activity.banner : null;
  const activityEvents = activity && !("error" in activity) ? activity.events : [];
  // Per-USER walkthrough gate: once seen on any pod it never re-runs on a new one.
  const walkthroughSeen = await hasSeenWalkthrough(user.id);

  // Release notes for the update modal: the manifest rows for what the pod runs
  // NOW and what it would update TO. Either may be null (an image built before the
  // manifest, or not yet recorded) — the modal degrades gracefully. Only fetched
  // when an update is actually offered.
  // Fetch the WHOLE manifest (newest-build first) when an update is offered, so the
  // modal can show every image BETWEEN the pod's current build and the target — not
  // just the target's own notes. A multi-build-behind pod then sees the full ladder
  // of what it's catching up on, one changelog per intermediate build.
  const allImages = updateAvailable
    ? await listImages().catch(() => [] as Awaited<ReturnType<typeof listImages>>)
    : [];
  // Match on the CANONICAL short form: the pin + some pod rows are 12-char fingerprints while the
  // manifest stores the full 64-char digest, so a raw `i.digest === pinned` never matched — the range
  // came back empty and the modal wrongly said "nothing changed" for a real build (2026-08-18).
  const targetImage = pinned ? (allImages.find((i) => sameDigest(i.digest, pinned)) ?? null) : null;
  const currentImageRow = pod.imageDigest
    ? (allImages.find((i) => sameDigest(i.digest, pod.imageDigest)) ?? null)
    : null;
  // The range: builds newer than the pod's current one, up to and including target.
  // listImages is newest-first, so that's slice(target .. current). If the current
  // build isn't in the manifest (pre-manifest), fall back to just the target.
  const targetIdx = pinned ? allImages.findIndex((i) => sameDigest(i.digest, pinned)) : -1;
  const currentIdx = pod.imageDigest
    ? allImages.findIndex((i) => sameDigest(i.digest, pod.imageDigest))
    : -1;
  const rangeRows =
    targetIdx >= 0 && currentIdx > targetIdx
      ? allImages.slice(targetIdx, currentIdx)
      : targetImage
        ? [targetImage]
        : [];
  const updateInfo =
    updateAvailable && pinned
      ? {
          targetDigest: pinned,
          currentDigest: pod.imageDigest,
          target: serializeImage(targetImage),
          current: serializeImage(currentImageRow),
          images: rangeRows.map(serializeImage).filter((x): x is SerializedImage => x !== null),
        }
      : null;

  // The release version of the image this pod is RUNNING, for the cockpit's "Up to date" line.
  // When an update is pending, the pod's current row is already in the fetched manifest range; when
  // up to date, the pod IS on the current image, so currentImage() names it (one indexed lookup on a
  // tiny table). Null until a release is cut — then the digest shows alone, exactly as today.
  const currentVersion = editionOss()
    ? null
    : updateAvailable
      ? (currentImageRow?.version ?? null)
      : ((await currentImage("pod-base").catch(() => null))?.version ?? null);

  // The active agent drives both onboarding copy AND the "ready" derivation —
  // Codex has no RC session URL, so its ready signal differs (see deriveSetupStep).
  const agent = pod.agents?.[0] ?? envDetail?.agentIds?.[0] ?? "claude-code";
  // Multi-agent (slice 3): everything the pod RUNS, and what the env would still
  // allow it to gain. The cockpit needs both — one to render connection state for
  // each, one to decide whether "Add agent" has anything to offer.
  const podAgents: string[] = pod.agents?.length ? pod.agents : [agent];
  const addableAgents: string[] = (envDetail?.agentIds ?? []).filter((a) => !podAgents.includes(a));

  // Landing-experiment attribution (idempotent): the owner opening their cockpit is
  // `first_project_opened`, and a durable authedAt milestone is `agent_connected`.
  // Skipped in self-host — it's cloud marketing/experiment tracking with no place in a
  // single-tenant OSS install (and its tables/config aren't part of the OSS surface).
  if (!editionOss()) {
    await Promise.all([
      recordAttributedUserEvent(user.id, "first_project_opened", pod.id),
      pod.authedAt
        ? recordAttributedUserEvent(user.id, "agent_connected", pod.id)
        : Promise.resolve(),
    ]);
  }

  // Self-host: the Docker host's capacity for the resize chooser (null in cloud / docker down).
  const capacity = editionOss() ? await hostCapacity() : null;

  return (
    <DashboardPage backHref="/dashboard" backLabel="Dashboard">
      {incidentBanner && (
        <div className="mb-4">
          <IncidentBanner slug={pod.id} incident={incidentBanner} />
        </div>
      )}
      <PodCockpit
        slug={pod.id}
        name={pod.name}
        environmentName={pod.environmentName}
        skills={envDetail?.skills ?? []}
        rules={envDetail?.rules ?? []}
        usage={usage ? { runningMs: usage.runningMs, suspendedMs: usage.suspendedMs, suspends: usage.suspends, currentRunningMs: usage.currentRunningMs, currentSuspendedMs: usage.currentSuspendedMs, intervals: usage.intervals, since: usage.since } : null}
        crashes={[]}
        maintenance={
          activity && !("error" in activity)
            ? activity.events
                // Momentary events the pod ran THROUGH: updates/restarts/resizes, plus
                // OOMs it survived — all orange marks, not downtime. The severity of a
                // crash lives in the incident banner, not as a red alarm here.
                .filter(
                  (e) =>
                    ["updated", "resized", "pod_repaired", "repair_gave_up"].includes(e.type) ||
                    (e.unplanned && e.severity === "critical"),
                )
                .map((e) => ({ at: new Date(e.at).getTime(), title: e.title }))
            : []
        }
        imageDigest={pod.imageDigest}
        currentVersion={currentVersion}
        updateAvailable={updateAvailable}
        newImageDigest={ossLatestDigest}
        ossReleaseVersion={ossRelease?.version ?? null}
        ossReleaseSummary={ossRelease?.summary ?? null}
        updateInfo={updateInfo}
        agent={agent}
        adminActions={adminActions}
        podAgents={podAgents}
        addableAgents={addableAgents}
        updatingSince={pod.updatingSince}
        updateStageInitial={pod.updateStage}
        maintenanceKindInitial={pod.maintenanceKind}
        t3Control={pod.t3Control}
        t3Connected={pod.t3Connected}
        t3Since={pod.t3Since}
        agentAuth={pod.agentAuth ?? null}
        t3StageInitial={pod.t3Stage}
        status={pod.status}
        size={pod.size}
        diskGb={pod.diskGb}
        lifecycle={pod.lifecycle}
        lifecycleLocked={envDetail?.lifecycle.locked ?? false}
        previewUrl={previewUrl}
        previewPublic={pod.previewPublic}
        autoUpdate={pod.autoUpdate}
        sessionUrl={pod.sessionUrl}
        authUrl={pod.authUrl}
        authedAt={pod.authedAt}
        createdAt={pod.createdAt}
        lastActiveAt={pod.lastActiveAt}
        walkthroughSeen={walkthroughSeen}
        activityEvents={activityEvents}
        relay={relay}
        oss={editionOss()}
        cpus={pod.cpus}
        memoryMb={pod.memoryMb}
        hostCapacity={capacity}
        gatewayUrl={
          // Read SERVER-side at request time (dynamic page), so none of these need a rebuild.
          // "auto" = same-origin: a reverse proxy in front routes /pods/* to the gateway (the
          // self-host compose install) and the client derives ws(s):// from the page location.
          process.env.NEXT_PUBLIC_GATEWAY_URL ??
          (process.env.PODBAY_GATEWAY_SAMEORIGIN === "1" ? "auto" : "")
        }
        initialStep={deriveSetupStep({ ...pod, agent })}
      />
    </DashboardPage>
  );
}
