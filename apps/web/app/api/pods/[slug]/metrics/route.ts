import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getPodService } from "@/lib/pod-service";

export const dynamic = "force-dynamic";

/**
 * The pod's resource metrics at a requested window (the stats tab, polled every 30s). Owner-scoped
 * Route Handler rather than a server action, so it runs on the parallel HTTP lane and can't be starved
 * by the live poll (see apps/web/lib/api-fetch.ts). `null` when the pod isn't running / has no data.
 * The ADMIN metrics variant stays on its server action — this is the owner path only.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  const raw = new URL(req.url).searchParams.get("window");
  const windowMs = raw ? Number(raw) : undefined;
  const snap = await getPodService()
    .podMetrics(user.id, slug, Number.isFinite(windowMs) ? windowMs : undefined)
    .catch(() => null);
  return NextResponse.json(snap);
}
