import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import {
  ACTIVE_LANDING_EXPERIMENT,
  isLandingEvent,
  isLandingVisitorId,
  isVariantForExperiment,
} from "@/lib/landing-experiment-config";
import {
  recordLandingEvent,
  recordRejectedLandingEvent,
} from "@/lib/landing-experiment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BROWSER_EVENTS = new Set([
  "landing_exposure",
  "landing_primary_cta",
  "landing_example_select",
  "landing_starter_select",
  "landing_playbook_select",
]);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await recordRejectedLandingEvent();
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const event = body.event;
  if (!isLandingEvent(event) || !BROWSER_EVENTS.has(event)) {
    await recordRejectedLandingEvent();
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }

  const jar = await cookies();
  const visitorId = jar.get(ACTIVE_LANDING_EXPERIMENT.cookie.visitor)?.value;
  const variant = jar.get(ACTIVE_LANDING_EXPERIMENT.cookie.variant)?.value;
  if (
    !isLandingVisitorId(visitorId) ||
    !isVariantForExperiment(ACTIVE_LANDING_EXPERIMENT, variant)
  ) {
    await recordRejectedLandingEvent();
    return NextResponse.json({ error: "No experiment assignment" }, { status: 400 });
  }

  const user = await getCurrentUser();
  try {
    const result = await recordLandingEvent({
      visitorId,
      variant,
      type: event,
      eligible: !user,
      userId: user?.id ?? null,
      item: typeof body.item === "string" ? body.item : null,
      referrer: typeof body.referrer === "string" ? body.referrer : null,
      utmSource: typeof body.utmSource === "string" ? body.utmSource : null,
      utmMedium: typeof body.utmMedium === "string" ? body.utmMedium : null,
      utmCampaign: typeof body.utmCampaign === "string" ? body.utmCampaign : null,
    });
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false }, { status: 202 });
  }
}
