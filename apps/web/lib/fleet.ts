import "server-only";
import { usageByPod, type PodUsage, type PodRecord, type PodEvent } from "@podbay/control-plane";
import { POD_TIERS, isPodSize } from "@podbay/shared";
import { getPodService, isProvisioningEnabled } from "./pod-service";
import { requireAdmin } from "./access";
import { sameDigest } from "./pod-image";

/** Billing slots for a pod (docs/strategy/pricing-model.md): 1 slot ≈ 4 GB RAM. S=1/M=2/L=4. */
function slotsFor(size: string): number {
  return isPodSize(size) ? POD_TIERS[size].memoryGb / 4 : 1;
}
/** Self-hosted cost basis (24/7 Incus box). Per-pod cost is its RAM-slot share of
 * the box's monthly price, NOT Fly's per-awake-hour rate. */
const BOX_USD_PER_MONTH = Number(process.env.PODBAY_BOX_USD_PER_MONTH ?? 160);
const BOX_PHYSICAL_SLOTS = Number(process.env.PODBAY_BOX_SLOTS ?? 40);
const USD_PER_SLOT = BOX_USD_PER_MONTH / BOX_PHYSICAL_SLOTS;

/**
 * Fleet view for the backoffice (docs/plans/observability-plan.md, pre-alpha P1).
 *
 * Everything here answers a question we had to answer BY HAND during the
 * 2026-07-17 dogfood — which is the whole argument for building it:
 *  - "has this pod ever slept?"  → REMOVED 2026-07-29. It detected a 5h compute
 *                                   leak back when pods idle-slept; the
 *                                   2026-07-20 pivot made Incus pods run 24/7
 *                                   (service.ts skips them in sleepIdlePods), so
 *                                   "never slept" became true of every healthy
 *                                   pod. A signal that fires on the whole fleet
 *                                   is a signal nobody reads. The real question
 *                                   now is "awake and doing nothing", which the
 *                                   agent-activity share answers.
 *  - "what version is each pod?"  → finding stale pods meant eyeballing digests.
 *  - "is anything duplicated/orphaned?" → one pod had 3 machines, all billing.
 */

export interface FleetPod {
  pod: PodRecord;
  usage: PodUsage | null;
  /** Machines Fly currently has for this pod id. >1 = the duplicate-provision bug. */
  machineCount: number;
  /** Running an image other than the one we pin now → an update is available. */
  stale: boolean;
  /** RAM-slots this pod occupies (its share of box capacity). */
  slots: number;
  /** Monthly $ = the pod's slot-share of the box's cost (self-hosted basis). */
  estUsd: number;
}

/** One image digest and how many pods run it (version-distribution rollup). */
export interface VersionBucket {
  digest: string | null;
  count: number;
  isCurrent: boolean;
}

/** A recorded image change, read from the `updated` event's from→to meta. */
export interface PodUpdate {
  podId: string;
  from: string | null;
  to: string | null;
  at: string;
}

/** Fleet cost/usage rolled up per owner ("who's running/spending what"). */
export interface OwnerUsage {
  ownerId: string;
  podCount: number;
  slots: number;
  runningMs: number;
  estUsd: number;
}

export interface Fleet {
  pods: FleetPod[];
  /** Pod ids Fly still has machines for but our DB doesn't know about. */
  orphans: string[];
  /** Pod ids with more than one machine (each one billing). */
  duplicates: string[];
  /** The mirror image of an orphan: we think it's alive, Fly has no machine for
   * it. The user sees a working pod that cannot exist — every action will fail
   * with a confusing error. Costs nothing; lies to somebody. */
  ghosts: FleetPod[];
  currentDigest: string | null;
  totalRunningMs: number;
  totalEstUsd: number;
  /** Box capacity view (docs/strategy/pricing-model.md overcommit): slots sold vs the
   * box's physical RAM-slots, and its monthly cost. */
  totalSlots: number;
  physicalSlots: number;
  boxCostUsd: number;
  /** Image distribution across the fleet — current bucket first. */
  versions: VersionBucket[];
  /** Pods running an image other than the pinned one (sibling of never-slept). */
  staleOffenders: FleetPod[];
  /** Most-recent image changes, newest first (folded from `updated` events). A
   * bad image STRANDS a pod, so we must see updates without waiting for a report. */
  recentUpdates: PodUpdate[];
  /** Usage/cost rolled up per owner, heaviest first. */
  byOwner: OwnerUsage[];
  /** True when we couldn't reach the provider — the fleet columns are then unknown
   * rather than zero, and the UI must say so instead of implying "all clear". */
  providerUnavailable: boolean;
}

/**
 * A DESIGNATED TEST POD: long-lived, kept signed-in, used to exercise running-pod behaviour
 * (agent messaging, relay, the update path) that a throwaway pod can't — you cannot sign in
 * to a fresh pod for every test. Marked by naming the pod `test:<whatever>`; the marker is the
 * owner's own display name, so it needs no schema change and the owner can retire a pod from
 * test duty by renaming it.
 *
 * These are infrastructure, not customers: they are excluded from the fleet's cost/version/stale
 * ROLLUPS (they'd otherwise inflate spend forever and permanently occupy the stale list, which is
 * how a drift signal becomes one nobody reads) while staying fully visible and operable as pods.
 *
 * They do NOT replace fresh pods for verification: an image update is not a launch, so first-boot
 * paths (seed, kickoff, greeter, clone, per-agent literacy) are never re-exercised on one — that
 * is precisely the class of bug they would hide.
 */
export function isTestPod(pod: Pick<PodRecord, "name">): boolean {
  return (pod.name ?? "").trim().toLowerCase().startsWith("test:");
}

/** The digest we pin today (PODBAY_BASE_IMAGE=…@sha256:…), or null if tag-pinned. */
export function pinnedDigest(): string | null {
  return process.env.PODBAY_BASE_IMAGE?.split("@")[1] ?? null;
}

/** The pinned image digest for a pod's PROVIDER — an Incus fingerprint and a Fly
 * OCI digest live in different namespaces, so a pod must be compared against its
 * own provider's pin (same logic as the pod detail page). Comparing every pod to
 * the Fly digest made Incus pods read "update ready" forever, even post-update. */
function pinnedDigestFor(provider: string | null | undefined): string | null {
  if (provider === "incus") return process.env.PODBAY_INCUS_IMAGE_DIGEST ?? null;
  return pinnedDigest();
}

export async function getFleet(now = Date.now()): Promise<Fleet> {
  // Defense-in-depth: this reads EVERY owner's pods, so it re-checks admin IN the loader — not
  // only via the /admin layout gate a refactor could bypass.
  await requireAdmin();
  const svc = getPodService();
  const [pods, events] = await Promise.all([svc.listAllPods(), svc.listAllEvents()]);
  // Each pod's live status reconciles usage's trailing interval with reality —
  // else a pod suspended since before the event log reads "awake / never slept".
  const statusByPod = new Map(pods.map((p) => [p.id, p.status]));
  const usage = new Map(usageByPod(events, now, statusByPod).map((u) => [u.podId, u]));
  const currentDigest = pinnedDigest();

  // Machine truth from the provider: how many machines exist per pod id. listPods
  // maps one PodInfo per MACHINE, so a duplicated pod appears more than once —
  // which is exactly how we detect it.
  let machineCounts = new Map<string, number>();
  let providerUnavailable = false;
  if (isProvisioningEnabled()) {
    try {
      for (const info of await svc.listProviderPods()) {
        machineCounts.set(info.id, (machineCounts.get(info.id) ?? 0) + 1);
      }
    } catch {
      providerUnavailable = true;
      machineCounts = new Map();
    }
  } else {
    providerUnavailable = true;
  }

  const fleetPods: FleetPod[] = pods.map((pod) => {
    const u = usage.get(pod.id) ?? null;
    const slots = slotsFor(pod.size);
    return {
      pod,
      usage: u,
      machineCount: machineCounts.get(pod.id) ?? 0,
      stale: (() => {
        const pin = pinnedDigestFor(pod.provider);
        return Boolean(pin && pod.imageDigest && !sameDigest(pod.imageDigest, pin));
      })(),
      slots,
      estUsd: slots * USD_PER_SLOT,
    };
  });

  // --- B2 stats views, all folded from data already fetched above ---
  // DESIGNATED TEST PODS are excluded from the stats views below. They are long-lived
  // pods we keep signed-in to exercise running-pod behaviour (agent messaging, relay,
  // the update path), so they sit in the fleet forever — and counted, they permanently
  // inflate owner spend and park themselves in the version distribution / stale list,
  // which is how a drift signal becomes one nobody reads. They still appear in `pods`
  // (they are real pods and must stay operable); only the ROLLUPS skip them.
  const realPods = fleetPods.filter((p) => !isTestPod(p.pod));

  // Version distribution: how many pods on each image, current bucket first.
  const versionCounts = new Map<string, number>();
  for (const p of realPods) {
    const d = p.pod.imageDigest ?? "";
    versionCounts.set(d, (versionCounts.get(d) ?? 0) + 1);
  }
  const versions: VersionBucket[] = [...versionCounts.entries()]
    .map(([digest, count]) => ({
      digest: digest || null,
      count,
      isCurrent: Boolean(currentDigest && sameDigest(digest, currentDigest)),
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.count - a.count);

  const staleOffenders = realPods.filter((p) => p.stale);

  // Image changes from the event log — `updatePodImage` records {from,to} in meta.
  const recentUpdates: PodUpdate[] = events
    .filter((e: PodEvent) => e.type === "updated")
    .map((e: PodEvent) => {
      const meta = (e.meta ?? {}) as { from?: unknown; to?: unknown };
      return {
        podId: e.podId,
        from: typeof meta.from === "string" ? meta.from : null,
        to: typeof meta.to === "string" ? meta.to : null,
        at: e.at,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  // Per-owner rollup, heaviest spend first (test pods excluded — see realPods).
  const owners = new Map<string, OwnerUsage>();
  for (const p of realPods) {
    const o = owners.get(p.pod.ownerId) ?? {
      ownerId: p.pod.ownerId,
      podCount: 0,
      slots: 0,
      runningMs: 0,
      estUsd: 0,
    };
    o.podCount += 1;
    o.slots += p.slots;
    o.runningMs += p.usage?.runningMs ?? 0;
    o.estUsd += p.estUsd;
    owners.set(p.pod.ownerId, o);
  }
  const byOwner = [...owners.values()].sort((a, b) => b.estUsd - a.estUsd);

  const known = new Set(pods.map((p) => p.id));
  const flyIds = new Set(pods.filter((p) => p.provider === "fly").map((p) => p.id));
  // Box instances that are INFRA, not pods — chiefly the transient image-build VM
  // (scripts/incus/build-image.sh: BUILDER="pod-base-builder"). They have no pod DB
  // row BY DESIGN, so they must not trip the orphan alert (which exists to catch a
  // LEAKED POD burning compute). Add future box tooling here if it ever appears.
  // Instances on the box that are deliberately NOT pods. Flagging them as drift
  // forever teaches operators to ignore the drift banner, which is the one thing it
  // must never become. `exp-*` is our own scratch/experiment convention and cannot
  // collide with a pod slug (adjective-noun-4hex).
  const NON_POD_INSTANCES = new Set(["pod-base-builder"]);
  const isScratchInstance = (id: string) => NON_POD_INSTANCES.has(id) || id.startsWith("exp-");
  // Ghost/duplicate/orphan are FLY-only: they come from Fly's eventually-consistent
  // listMachines races. Incus keys pods by instance name (machineId == pod id), so
  // it can't duplicate or ghost — scope these panels to fly pods so an Incus pod is
  // never flagged. Only meaningful when the provider answered.
  const ghosts = providerUnavailable
    ? []
    : fleetPods.filter(
        (p) =>
          p.pod.provider === "fly" &&
          p.machineCount === 0 &&
          (p.pod.status === "running" || p.pod.status === "suspended"),
      );
  return {
    pods: fleetPods,
    ghosts,
    orphans: providerUnavailable
      ? []
      : [...machineCounts.keys()].filter((id) => !known.has(id) && !isScratchInstance(id)),
    duplicates: [...machineCounts.entries()]
      .filter(([id, n]) => n > 1 && flyIds.has(id))
      .map(([id]) => id),
    currentDigest,
    // Totals bill REAL pods; designated test pods are infrastructure, not spend-to-explain.
    totalRunningMs: realPods.reduce((n, p) => n + (p.usage?.runningMs ?? 0), 0),
    totalEstUsd: realPods.reduce((n, p) => n + p.estUsd, 0),
    totalSlots: realPods.reduce((n, p) => n + p.slots, 0),
    physicalSlots: BOX_PHYSICAL_SLOTS,
    boxCostUsd: BOX_USD_PER_MONTH,
    versions,
    staleOffenders,
    recentUpdates,
    byOwner,
    providerUnavailable,
  };
}
