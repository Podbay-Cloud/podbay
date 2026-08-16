import { NextResponse } from "next/server";
import { pwToken, DASH_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const pw = process.env.DASH_PASSWORD;
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!pw || password !== pw) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DASH_COOKIE, await pwToken(pw), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
