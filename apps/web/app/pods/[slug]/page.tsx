import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApprovedUser } from "@/lib/access";
import { getPodService } from "@/lib/pod-service";
import { ControlError } from "@podbay/control-plane";
import PodTerminalLoader from "@/components/pod-terminal-loader";
import HideSupportChat from "@/components/hide-support-chat";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const user = await requireApprovedUser();
    const pod = await getPodService().getPod(user.id, slug);
    return { title: `$ ${pod.name?.trim() || slug}` };
  } catch {
    return { title: `$ ${slug}` };
  }
}

export default async function PodPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireApprovedUser();
  const { slug } = await params;
  let pod;
  try {
    pod = await getPodService().getPod(user.id, slug);
  } catch (e) {
    if (e instanceof ControlError && e.code === "not_found") notFound();
    throw e;
  }
  // Explicit suspend/resume: a suspended pod isn't auto-woken by opening its
  // terminal (the gateway now rejects that with 409). Show a Resume prompt
  // instead of a raw connection error; Resume lives on the pod's dashboard.
  if (pod.status === "suspended") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{pod.name?.trim() || slug} is suspended</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resume it to open the terminal — nothing wakes a suspended pod automatically.
          </p>
        </div>
        <Link
          href={`/dashboard/pods/${slug}`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to pod → Resume
        </Link>
      </div>
    );
  }
  // "auto" = same-origin (self-host compose: a reverse proxy routes /pods/* to the gateway and the
  // client derives ws(s):// from the page location). Matches the cockpit; without it the raw
  // terminal opened with no gateway and couldn't connect in OSS.
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ??
    (process.env.PODBAY_GATEWAY_SAMEORIGIN === "1" ? "auto" : "");
  return (
    <>
      <HideSupportChat />
      <PodTerminalLoader
        podId={slug}
        podName={pod.name?.trim() || null}
        gatewayUrl={gatewayUrl}
        bootedBefore={Boolean(pod.authedAt || pod.sessionUrl)}
        machineUp={pod.status === "running"}
      />
    </>
  );
}
