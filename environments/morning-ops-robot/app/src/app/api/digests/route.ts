import { NextResponse } from "next/server";
import { listDigests, createDigest } from "@/lib/store";
import { notifyDigest } from "@/lib/notify";

// GET  → the digest history (newest first).
// POST → the agent writes one digest per run:
//   { date?, summary, changed[], needsAttention[], actions[] }
//   The brief is also delivered outbound (Slack/Telegram) if a channel is set.
export async function GET() {
  return NextResponse.json(await listDigests());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const digest = await createDigest(body);
  await notifyDigest(digest); // deliver the brief where you'll actually see it
  return NextResponse.json(digest, { status: 201 });
}
