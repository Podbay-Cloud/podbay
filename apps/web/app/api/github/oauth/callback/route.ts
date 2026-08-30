import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createLogger } from "@podbay/shared/log";
import { getCurrentUser } from "@/lib/session";
import { exchangeCodeForToken, safeReturnPath, OAUTH_CALLBACK_PATH } from "@/lib/github-oauth";
import { storeConnection } from "@/lib/github-connect";

export const dynamic = "force-dynamic";

const log = createLogger("web-gh-oauth-callback");
const OAUTH_COOKIE = "gh_oauth";

/**
 * GitHub OAuth web-flow callback: validate the CSRF `state` against our short-lived cookie, exchange
 * the `code` for a token server-side, store the encrypted connection, and bounce back to where the
 * user started (with a `?github=connected|denied|error` marker the field reads). One-click; no device
 * code. See lib/github-oauth.ts + startGithubAccountWebConnect.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete(OAUTH_COOKIE);
  let saved: { state?: string; returnPath?: string } = {};
  try {
    saved = raw ? (JSON.parse(raw) as { state?: string; returnPath?: string }) : {};
  } catch {
    /* corrupt cookie → treat as no state, fail closed below */
  }
  const back = (status: "connected" | "denied" | "error"): Response => {
    const dest = new URL(safeReturnPath(saved.returnPath), url.origin);
    dest.searchParams.set("github", status);
    return NextResponse.redirect(dest);
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/signin", url.origin));

  // The user declined on GitHub (or GitHub returned an error) — not a failure to surface loudly.
  if (url.searchParams.get("error")) return back("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !saved.state || state !== saved.state) {
    log.warn("gh_oauth_state_mismatch", { hasCode: !!code, hasState: !!state, hasCookie: !!saved.state });
    return back("error");
  }

  try {
    const token = await exchangeCodeForToken(code, `${url.origin}${OAUTH_CALLBACK_PATH}`);
    await storeConnection(user.id, token);
    return back("connected");
  } catch (e) {
    log.error("gh_oauth_exchange_failed", { userId: user.id, err: e });
    return back("error");
  }
}
