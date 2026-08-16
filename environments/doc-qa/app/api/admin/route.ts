import { NextResponse } from "next/server";
import { adminConfigured, isAdmin, login, logout } from "../../auth";

export const runtime = "nodejs";

// GET    → { configured, authed } so the console knows whether to show a lock, a
//          login form, or the tools.
// POST   → { password } → set the owner cookie if it matches.
// DELETE → log out.
export async function GET() {
  return NextResponse.json({ configured: adminConfigured(), authed: await isAdmin() });
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "ADMIN_PASSWORD not set" }, { status: 400 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const ok = await login(password ?? "");
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}

export async function DELETE() {
  await logout();
  return NextResponse.json({ ok: true });
}
