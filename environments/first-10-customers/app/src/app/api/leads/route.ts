import { NextResponse } from "next/server";
import { listLeads, createLead } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listLeads());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await createLead(body), { status: 201 });
}
