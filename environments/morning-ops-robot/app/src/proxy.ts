import { NextResponse, type NextRequest } from "next/server";
import { pwToken, DASH_COOKIE } from "@/lib/auth";

// Gate the whole dashboard behind DASH_PASSWORD. This app has no public face (it's
// the founder's private ops data), so unlike a landing page, everything is behind
// the gate. The preview is private (owner-authed) too — this is defense-in-depth.
// Until DASH_PASSWORD is set the app is open (the kickoff drives setting it before
// real data lands).
export async function proxy(req: NextRequest) {
  const pw = process.env.DASH_PASSWORD;
  if (!pw) return NextResponse.next();

  const cookie = req.cookies.get(DASH_COOKIE)?.value;
  const expected = await pwToken(pw);
  if (cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Everything except the login page, the API (same-origin fetches + the in-pod
// agent write it), and Next internals/static.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico).*)"],
};
