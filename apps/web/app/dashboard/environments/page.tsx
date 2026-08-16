import EnvGallery from "@/components/env-gallery";
import DashboardPage from "@/components/dashboard-page";

export const dynamic = "force-dynamic";

/** The environment marketplace. The user-facing job is creating a pod; playbooks
 * and workspaces are the two ways to start one. */
export const metadata = { title: "Create a pod" };

export default function EnvironmentsPage() {
  return (
    <DashboardPage
      title="Create a pod"
      intro="Choose a guided playbook for a specific outcome, or an open-ended workspace for ongoing development."
    >
      <EnvGallery />
    </DashboardPage>
  );
}
