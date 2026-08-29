import "server-only";
import { getCurrentUser } from "@/lib/session";
import { getPodService } from "@/lib/pod-service";

export const dynamic = "force-dynamic";

/**
 * A PNG thumbnail of the pod's own preview app, captured pod-side by the pod-agent (self-screenshot).
 * Owner-scoped. 204 when nothing is serving the port / no thumbnail is available yet — the cockpit
 * treats that as "no image" and shows its status line instead. Never cached (the pod-agent manages
 * freshness; the cockpit cache-busts with a timestamp).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { slug } = await params;
  const buf = await getPodService()
    .podPreviewShot(user.id, slug)
    .catch(() => null);
  if (!buf) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
