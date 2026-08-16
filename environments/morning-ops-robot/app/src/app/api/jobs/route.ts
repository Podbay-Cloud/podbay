import { NextResponse } from "next/server";
import { listJobs, writeJobs, setJobEnabled } from "@/lib/jobs";

// GET   → the jobs the scheduler runs.
// PUT   → replace the whole jobs array (the agent authors jobs).
// PATCH → toggle one job: { id, enabled } (the dashboard switch).
export async function GET() {
  return NextResponse.json(await listJobs());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
  return NextResponse.json(await writeJobs(jobs));
}

export async function PATCH(req: Request) {
  const { id, enabled } = (await req.json().catch(() => ({}))) as { id?: string; enabled?: boolean };
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json(await setJobEnabled(id, Boolean(enabled)));
}
