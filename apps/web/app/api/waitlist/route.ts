import { NextRequest, NextResponse } from "next/server";
import { addToWaitlist, isValidEmail } from "@/lib/waitlist";
import { getPostHogClient } from "@/lib/posthog-server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Blunt spam / DB abuse: cap sign-ups per source IP (best-effort, per-instance).
  if (!rateLimit(`waitlist:${clientIp(req.headers)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please try again in a minute." }, { status: 429 });
  }
  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof email !== "string" || !isValidEmail(email.trim())) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const ua = req.headers.get("user-agent") ?? undefined;
    const { added } = await addToWaitlist(email.trim(), ua ? { ua } : {});
    if (added) {
      const ph = getPostHogClient();
      if (ph) {
        // Not awaited: a rejected flush would be caught below and answer "Could not
        // save — try again" for an email that WAS saved, sending the prospect away
        // convinced it failed.
        //
        // `$process_person_profile: false` instead of a shared "anonymous" person:
        // one distinctId for every signup merges all of them into a single person,
        // and this event has no person to speak of anyway.
        ph.capture({
          distinctId: "waitlist",
          event: "waitlist_received",
          properties: { $process_person_profile: false },
        });
        void ph.flush().catch(() => undefined);
      }
    }
    return NextResponse.json({ ok: true, already: !added });
  } catch {
    return NextResponse.json({ error: "Could not save — try again." }, { status: 500 });
  }
}
