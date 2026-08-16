import { NextResponse } from "next/server";
import { getLead, updateLead, deleteLead } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lead = await getLead((await params).id);
  return lead ? NextResponse.json(lead) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const patch = await req.json().catch(() => ({}));
  const lead = await updateLead((await params).id, patch);
  return lead ? NextResponse.json(lead) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await deleteLead((await params).id);
  return NextResponse.json({ ok: true });
}
