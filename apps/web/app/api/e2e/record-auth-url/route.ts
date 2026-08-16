import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getPodService } from "@/lib/pod-service";

/**
 * E2E ONLY — simulate the greeter recording a pod's sign-in URL (Claude) or device code
 * (Codex), exactly the way the gateway does when it scrapes the agent's login output. There
 * is no real greeter behind a fake pod, so the onboarding sign-in step can't otherwise be
 * reached. Hard-gated on PODBAY_TEST_LOGIN (the same flag the e2e login uses); a 404 in any
 * environment where that isn't set, so it cannot exist in production.
 *
 * Owner-scoped: the pod is resolved through the signed-in user's own service, so a caller
 * can only ever touch their own pod.
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.PODBAY_TEST_LOGIN !== "1") return new NextResponse(null, { status: 404 });
  const { slug, url } = (await req.json().catch(() => ({}))) as { slug?: string; url?: string };
  if (!slug || !url) return NextResponse.json({ error: "slug and url required" }, { status: 400 });
  const user = await requireUser();
  const pod = await getPodService().getPod(user.id, slug);
  await getPodService().recordAuthUrl(user.id, pod.id, url);
  return NextResponse.json({ ok: true });
}
