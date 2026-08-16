import { NextResponse } from "next/server";
import { isAdmin } from "../../auth";
import { recentQuestions } from "../../rag";

export const runtime = "nodejs";

// Recent questions for the OWNER console (gated) — newest first, with whether the
// docs could ground each one. The unanswered ones are the roadmap for what to add.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await recentQuestions(200));
  } catch {
    return NextResponse.json([]);
  }
}
