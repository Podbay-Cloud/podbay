import { NextResponse } from "next/server";
import { listRuns, appendRunEvent } from "@/lib/runs";

// GET  → runs reduced from the event log (status incl. `stalled`).
// POST → the agent reports a run finished: { runId, status: "succeeded"|"failed", summary?, jobId? }
export async function GET() {
  return NextResponse.json(await listRuns());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    runId?: string;
    status?: "succeeded" | "failed";
    summary?: string;
    jobId?: string;
  };
  if (!body.runId || (body.status !== "succeeded" && body.status !== "failed")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await appendRunEvent({ runId: body.runId, status: body.status, summary: body.summary, jobId: body.jobId });
  return NextResponse.json({ ok: true }, { status: 201 });
}
