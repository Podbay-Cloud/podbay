import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getPodService } from "@/lib/pod-service";

export const dynamic = "force-dynamic";

/**
 * The pod's secrets + still-open agent secret-requests, in ONE owner-scoped read (the secrets tab).
 * A Route Handler rather than two server actions, so the tab load runs on the parallel HTTP lane and
 * can't be starved by the live poll (see apps/web/lib/api-fetch.ts). Returns only `set: boolean` per
 * secret, never a value. Requests already-declared by the env are dropped (declared ones render below).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  const svc = getPodService();
  try {
    const secrets = await svc.listSecrets(user.id, slug);
    const rawRequests = await svc.secretRequests(user.id, slug).catch(() => []);
    const declared = new Set(secrets.map((s) => s.key));
    const requests = rawRequests.filter((r) => !declared.has(r.key));
    return NextResponse.json({ secrets, requests });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
