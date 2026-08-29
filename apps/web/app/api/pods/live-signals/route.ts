import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getPodService } from "@/lib/pod-service";

// Reads the session cookie → always dynamic, never cached.
export const dynamic = "force-dynamic";

/**
 * The owner's live pod signals (agent activity, :3000 liveness, live-critical trouble) — the 10s
 * cockpit/dashboard poll. A Route Handler, NOT a server action, so the poll runs on a parallel HTTP
 * lane and can never wedge the serialized server-action queue (which starved the cockpit's tab reads
 * — see apps/web/lib/api-fetch.ts). Owner-scoped; the service returns only this user's pods.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await getPodService()
    .ownerLiveSignals(user.id)
    .catch(() => []);
  return NextResponse.json(rows);
}
