import { NextResponse, type NextRequest } from "next/server";
import { pwToken, CRM_COOKIE } from "@/lib/auth";

// Gate the private pipeline behind CRM_PASSWORD. The landing (/) stays public, so
// the preview URL can be shared with prospects while the pipeline stays private.
//
// ⚠ The matcher MUST cover the DATA as well as the UI. It originally matched only
// `/crm/:path*`, which gated the pages while `/api/leads*` served every prospect's
// name, email and drafted messages unauthenticated — and this env ships
// `preview: public`, so that was readable by anyone with the pod's URL. Found by the
// agent during the first live first-10-customers run (2026-07-28). A gate on the UI
// alone is not a gate: if you add a route that reads or writes pipeline data, it
// belongs behind this matcher.
export async function proxy(req: NextRequest) {
  const pw = process.env.CRM_PASSWORD;
  const { pathname } = req.nextUrl;

  // The login page and the auth endpoint itself must stay reachable, or you can
  // never authenticate.
  if (pathname.startsWith("/crm/login") || pathname.startsWith("/api/crm-auth")) {
    return NextResponse.next();
  }

  // Not configured yet → open, so first-run setup works. The kickoff makes the
  // agent close this gate BEFORE any real prospect data is entered.
  if (!pw) return NextResponse.next();

  const cookie = req.cookies.get(CRM_COOKIE)?.value;
  const expected = await pwToken(pw);
  if (cookie === expected) return NextResponse.next();

  // An unauthenticated API call gets 401 JSON — NOT a redirect to an HTML login
  // page, which a fetch() would follow and then try to parse as JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/crm/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Covers the pipeline UI AND its data routes. `/api/crm-auth` is allowed through
// above (it is how you log in); every other /api route carries pipeline data.
export const config = { matcher: ["/crm/:path*", "/api/:path*"] };
