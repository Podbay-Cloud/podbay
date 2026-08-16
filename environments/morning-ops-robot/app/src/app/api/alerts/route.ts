import { NextResponse } from "next/server";
import { listAlerts, createAlert, setAlertState } from "@/lib/alerts";
import { notifyAlert } from "@/lib/notify";

// GET   → alerts (firing first).
// POST  → the agent raises an alert: { severity?, title, detail?, jobId?, dedupeKey? }
//         A genuinely new (non-deduped) alert is delivered outbound (Slack/Telegram).
// PATCH → acknowledge/resolve: { id, state }
export async function GET() {
  return NextResponse.json(await listAlerts());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body?.title) return NextResponse.json({ ok: false }, { status: 400 });
  const { alert, created } = await createAlert(body);
  if (created) await notifyAlert(alert); // outbound only on a new alert (dedup upstream)
  return NextResponse.json(alert, { status: 201 });
}

export async function PATCH(req: Request) {
  const { id, state } = (await req.json().catch(() => ({}))) as {
    id?: string;
    state?: "firing" | "acknowledged" | "resolved";
  };
  if (!id || !state) return NextResponse.json({ ok: false }, { status: 400 });
  const updated = await setAlertState(id, state);
  return updated ? NextResponse.json(updated) : NextResponse.json({ ok: false }, { status: 404 });
}
