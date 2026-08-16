import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createAppDb, pods as podsTable } from "@podbay/db";
import { editionOss } from "@/lib/session";
import { classifyTlsHost } from "@/lib/tls-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Caddy on-demand-TLS `ask` endpoint (self-host-public-previews). In `ip`/`domain` mode Caddy asks
 * here — `GET /api/selfhost/tls-check?domain=<host>` — before obtaining a Let's Encrypt cert for an
 * inbound hostname. We return 200 ONLY for the dashboard host or a hostname whose single leading
 * label is a CURRENT pod id, and 404 otherwise. This bounds issuance: with sslip.io any
 * `<anything>.<ip>.sslip.io` resolves to this host, so without this guard an attacker could spray
 * random hostnames and exhaust Let's Encrypt rate limits. Cloud edition never uses this path.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!editionOss()) return new NextResponse(null, { status: 404 });

  const host = new URL(req.url).searchParams.get("domain") ?? "";
  if (!host.trim()) return new NextResponse(null, { status: 400 });

  const verdict = classifyTlsHost(host, process.env.PODBAY_PUBLIC_BASE ?? "", process.env.PODBAY_DASHBOARD_HOST ?? "");
  if ("allow" in verdict) return new NextResponse(verdict.allow ? "ok" : null, { status: verdict.allow ? 200 : 404 });

  // A single-label host under the base — allow only if <id> is a real pod (single-tenant OSS:
  // any row with this id is the owner's).
  const rows = await createAppDb()
    .select({ id: podsTable.id })
    .from(podsTable)
    .where(eq(podsTable.id, verdict.lookupPodId))
    .limit(1);
  return rows.length ? new NextResponse("ok", { status: 200 }) : new NextResponse(null, { status: 404 });
}
