import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectHost } from "@/lib/canonical-host";
import {
  ACTIVE_LANDING_EXPERIMENT,
  chooseLandingVariant,
  isCrawler,
  isLandingVisitorId,
  isVariantForExperiment,
} from "@/lib/landing-experiment-config";

const LANDING_EXPERIMENT = ACTIVE_LANDING_EXPERIMENT;

/**
 * Force the canonical apex host: redirect `www.podbay.cloud` → `podbay.cloud`.
 * Keeps every request on the origin that matches BETTER_AUTH_URL + the
 * `.podbay.cloud` cookie, so a `www` visit can't produce `INVALID_ORIGIN` at
 * sign-in. 308 preserves method/body for any non-GET that slips through.
 */
export function middleware(req: NextRequest) {
  const apex = canonicalRedirectHost(req.headers.get("host"));
  if (apex) {
    const url = req.nextUrl.clone();
    // Set hostname (not host) and clear the port explicitly: nextUrl carries the
    // internal listen port (3000) behind fly-proxy, and the `host` setter keeps a
    // pre-existing port — which would leak `podbay.cloud:3000` into the redirect.
    const [hostname, port = ""] = apex.split(":");
    url.hostname = hostname;
    url.port = port;
    return NextResponse.redirect(url, 308);
  }

  if (req.nextUrl.pathname === "/selfhost/signin") {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    const response = NextResponse.redirect(url);
    response.cookies.delete(LANDING_EXPERIMENT.cookie.variant);
    response.cookies.delete(LANDING_EXPERIMENT.cookie.visitor);
    return response;
  }

  if (req.nextUrl.pathname !== "/") return NextResponse.next();

  const requestHeaders = new Headers(req.headers);
  const crawler = isCrawler(req.headers.get("user-agent"));
  if (crawler) {
    requestHeaders.set(
      LANDING_EXPERIMENT.requestHeaders.variant,
      LANDING_EXPERIMENT.crawlerVariant,
    );
    requestHeaders.set(LANDING_EXPERIMENT.requestHeaders.eligible, "0");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const storedVariant = req.cookies.get(LANDING_EXPERIMENT.cookie.variant)?.value;
  const storedVisitor = req.cookies.get(LANDING_EXPERIMENT.cookie.visitor)?.value;
  const variant = isVariantForExperiment(LANDING_EXPERIMENT, storedVariant)
    ? storedVariant
    : chooseLandingVariant(Math.random(), LANDING_EXPERIMENT);
  const visitorId = isLandingVisitorId(storedVisitor) ? storedVisitor : crypto.randomUUID();

  requestHeaders.set(LANDING_EXPERIMENT.requestHeaders.variant, variant);
  requestHeaders.set(LANDING_EXPERIMENT.requestHeaders.visitor, visitorId);
  requestHeaders.set(LANDING_EXPERIMENT.requestHeaders.eligible, "1");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: LANDING_EXPERIMENT.cookie.maxAgeSeconds,
  };
  if (!isVariantForExperiment(LANDING_EXPERIMENT, storedVariant)) {
    response.cookies.set(LANDING_EXPERIMENT.cookie.variant, variant, cookieOptions);
  }
  if (!isLandingVisitorId(storedVisitor)) {
    response.cookies.set(LANDING_EXPERIMENT.cookie.visitor, visitorId, cookieOptions);
  }
  return response;
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
