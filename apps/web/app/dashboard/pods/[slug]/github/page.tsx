import { notFound } from "next/navigation";
import { requireApprovedUser } from "@/lib/access";
import { getPodService } from "@/lib/pod-service";
import { githubConnectConfigured } from "@/lib/github-device";
import { editionOss } from "@/lib/session";
import { ControlError } from "@podbay/control-plane";
import DashboardPage from "@/components/dashboard-page";
import GithubWizard from "@/components/github-wizard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `Connect GitHub — ${slug}` };
}

export default async function GithubConnectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireApprovedUser();
  const { slug } = await params;
  const oss = editionOss();
  // Self-host connects via an in-pod `gh` device login — no OAuth app to configure, so don't 404.
  if (!githubConnectConfigured() && !oss) notFound();

  let pod;
  try {
    pod = await getPodService().getPod(user.id, slug);
  } catch (e) {
    if (e instanceof ControlError && e.code === "not_found") notFound();
    throw e;
  }
  const name = pod.name?.trim() || slug;

  return (
    <DashboardPage backHref={`/dashboard/pods/${slug}`} backLabel={name} title="Connect GitHub">
      <GithubWizard slug={slug} podName={name} oss={oss} />
    </DashboardPage>
  );
}
