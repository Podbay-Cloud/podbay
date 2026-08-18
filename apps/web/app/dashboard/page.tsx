import Link from "next/link";
import { requireApprovedUser } from "@/lib/access";
import { getPodService, isProvisioningEnabled } from "@/lib/pod-service";
import PodCardList from "@/components/pod-card-list";
import type { PodCardProps } from "@/components/pod-card";
import AutoRefresh from "@/components/auto-refresh";
import DashboardPage from "@/components/dashboard-page";
import SlotMeter from "@/components/slot-meter";
import { editionOss } from "@/lib/session";
import { sameDigest } from "@/lib/pod-image";
import { Button } from "@/components/ui/button";
import { getEnvironmentDetail } from "@/lib/environments";
import { isAdmin } from "@/lib/access-rules";
import { ACCOUNT_SLOT_CAP } from "@podbay/shared/tiers";
import { Plus } from "lucide-react";

/** Statuses that resolve on their own soon — poll fast while any are present. */
const TRANSITIONAL = new Set(["destroying", "provisioning", "waking"]);

export const dynamic = "force-dynamic";

function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const metadata = { title: "Pods" };

export default async function Dashboard() {
  const user = await requireApprovedUser();
  const svc = getPodService();
  const pods = await svc.listPods(user.id);
  const slots = await svc.accountSlotUsage(user.id, ACCOUNT_SLOT_CAP);
  // Live signals (agent activity, :3000 liveness, live-critical trouble) are fetched
  // CLIENT-side in PodCardList — NOT here — so a dashboard navigation renders instantly
  // from lifecycle state instead of blocking on an N-pod /healthz sweep first.
  const previewBase = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "") || null;

  // "update ready" per pod — compared to ITS provider's pinned image (Incus
  // fingerprint vs Fly OCI digest live in different namespaces), same as the
  // cockpit + admin. Surfaced as an amber badge on the card.
  const incusPin = process.env.PODBAY_INCUS_IMAGE_DIGEST ?? null;
  const flyPin = process.env.PODBAY_BASE_IMAGE?.split("@")[1] ?? null;
  // An in-flight update is durable on the row (updatingSince) — it wins over
  // "update ready", so a pod mid-update shows progress, not the stale offer.
  const isUpdating = (p: (typeof pods)[number]): boolean => Boolean(p.updatingSince);
  const updateReady = (p: (typeof pods)[number]): boolean => {
    if (isUpdating(p)) return false;
    const pin = p.provider === "incus" ? incusPin : flyPin;
    return Boolean(pin && p.imageDigest && !sameDigest(p.imageDigest, pin));
  };

  // Which of the on-screen envs declare secrets — resolve each distinct env once
  // so cards can offer a Secrets panel only where it's meaningful.
  const envNames = [...new Set(pods.map((p) => p.environmentName))];
  const declaresSecrets = new Map<string, boolean>();
  const lifecycleLocked = new Map<string, boolean>();
  const environmentTitles = new Map<string, string>();
  const envAgents = new Map<string, string[]>();
  // An env that no longer resolves (renamed/removed) means an errored pod on it
  // can't be rebuilt — the card hides "Try again", matching the cockpit.
  const envMissing = new Map<string, boolean>();
  await Promise.all(
    envNames.map(async (n) => {
      declaresSecrets.set(n, await svc.environmentDeclaresSecrets(n));
      const detail = await getEnvironmentDetail(n).catch(() => null);
      environmentTitles.set(n, detail?.title ?? n);
      lifecycleLocked.set(n, detail?.lifecycle.locked ?? false);
      envAgents.set(n, detail?.agentIds ?? []);
      envMissing.set(n, !detail);
    }),
  );

  return (
    <DashboardPage
      title="Your pods"
      actions={
        <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
          <Link href="/dashboard/environments"><Plus className="size-4" />New pod</Link>
        </Button>
      }
    >
      <AutoRefresh fast={pods.some((p) => TRANSITIONAL.has(p.status) || isUpdating(p))} />

      {/* Slots are a cloud account-budget concept — self-host runs on your own machine, so there's
          no slot cap to show (resource limits belong on the machine, not an account). */}
      {pods.length > 0 && !editionOss() && (
        <SlotMeter used={slots.used} cap={ACCOUNT_SLOT_CAP} unlimited={isAdmin(user.email)} />
      )}

      {!isProvisioningEnabled() && (
        <div className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
          Pod provisioning isn&apos;t enabled yet — launching is coming soon.
        </div>
      )}

      {pods.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
          <h2 className="text-lg font-semibold tracking-tight">No pods yet</h2>
          <p className="text-sm text-muted-foreground">
            Choose a playbook or workspace to create your first pod.
          </p>
          <Button asChild>
            <Link href="/dashboard/environments">Create your first pod</Link>
          </Button>
        </div>
      ) : (
        <section>
          <PodCardList
            bulkUpdate={!editionOss()}
            cards={pods.map((p): PodCardProps => ({
              slug: p.id,
              name: p.name,
              environmentTitle: environmentTitles.get(p.environmentName) ?? p.environmentName,
              status: p.status,
              agoLabel: ago(p.lastActiveAt),
              previewPublic: p.previewPublic,
              previewUrl: previewBase ? `https://${p.id}.${previewBase}` : null,
              hasSecrets: declaresSecrets.get(p.environmentName) ?? false,
              lifecycle: p.lifecycle,
              lifecycleLocked: lifecycleLocked.get(p.environmentName) ?? false,
              authedAt: p.authedAt,
              sessionUrl: p.sessionUrl,
              updateReady: updateReady(p),
              updating: isUpdating(p),
              autoUpdate: p.autoUpdate,
              lastActiveAtIso: p.lastActiveAt,
              canRetry: !envMissing.get(p.environmentName),
              podAgents: p.agents ?? envAgents.get(p.environmentName) ?? [],
              codexDevices: p.codexDevices ?? [],
              // live signals arrive client-side (PodCardList) — cards start on lifecycle.
              live: null,
            }))}
          />
        </section>
      )}
    </DashboardPage>
  );
}
