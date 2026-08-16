import { NextResponse } from "next/server";
import { addMessage } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { channel, body } = await req.json().catch(() => ({ channel: "", body: "" }));
  const lead = await addMessage((await params).id, channel ?? "", body ?? "");
  return lead ? NextResponse.json(lead) : NextResponse.json({ error: "not found" }, { status: 404 });
}
