import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/access";
import { getEnvironmentDetail } from "@/lib/environments";
import { getPodService, isProvisioningEnabled, hostCapacity } from "@/lib/pod-service";
import LaunchConfigure from "@/components/launch-configure";
import DashboardPage from "@/components/dashboard-page";
import { isAdmin } from "@/lib/access-rules";
import { editionOss } from "@/lib/session";
import { ACCOUNT_SLOT_CAP } from "@podbay/shared/tiers";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the launch flow: configure. On Create it navigates to the pod's
 * durable setup page (/dashboard/pods/<slug>), where every step is a reflection
 * of DB state (docs/runbooks/pod-launch-wizard-plan.md). Reached from a catalog tile with
 * ?env=<name>.
 */
export const metadata = { title: "New pod" };

export default async function NewPodPage({
  searchParams,
}: {
  searchParams: Promise<{ env?: string; step?: string }>;
}) {
  const user = await requireApprovedUser();
  const { env, step } = await searchParams;
  if (!env) redirect("/dashboard/environments");
  const detail = await getEnvironmentDetail(env);
  if (!detail) redirect("/dashboard/environments");
  // The account's slot budget, so the wizard can show the cost + free slots and block a
  // launch that won't fit BEFORE the user fills everything in. Admins are unbounded.
  const slots = await getPodService().accountSlotUsage(user.id, ACCOUNT_SLOT_CAP);
  // Self-host: the real Docker host's CPU/RAM + what running pods have reserved, so the
  // size step can show free capacity instead of cloud tiers. null in cloud (unused there).
  const oss = editionOss();
  const capacity = oss ? await hostCapacity() : null;

  return (
    <DashboardPage
      backHref="/dashboard/environments"
      backLabel="Environments"
      title={`New pod — ${detail.title}`}
    >
      <LaunchConfigure
        env={detail.name}
        secrets={detail.secrets}
        byoRepo={detail.byoRepo}
        agentIds={detail.agentIds}
        enabled={isProvisioningEnabled()}
        initialStep={step}
        slots={{ used: slots.used, cap: ACCOUNT_SLOT_CAP, unlimited: isAdmin(user.email) || oss }}
        oss={oss}
        capacity={capacity}
      />
    </DashboardPage>
  );
}
