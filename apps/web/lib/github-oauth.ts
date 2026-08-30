import "server-only";

/**
 * GitHub OAuth *web* (authorization-code) flow for connecting a repo account — the one-click
 * "Authorize" path, no device-code copy/paste. Preferred over the device flow (github-device.ts)
 * whenever a CLIENT SECRET is configured; the device flow stays the fallback (and the ONLY path on
 * self-host, where the pod runs its own `gh` device login). Reuses the same OAuth app as the device
 * flow (`PODBAY_GITHUB_OAUTH_CLIENT_ID`) — that app now also needs a secret + an Authorization
 * callback URL of `<origin>/api/github/oauth/callback`.
 */

const CLIENT_ID = process.env.PODBAY_GITHUB_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.PODBAY_GITHUB_OAUTH_CLIENT_SECRET;
// `repo` = clone/push private repos; `read:org` = see org-owned private repos (same as the device flow).
const SCOPE = "repo read:org";

/** The path GitHub redirects back to; must match the OAuth app's Authorization callback URL. */
export const OAUTH_CALLBACK_PATH = "/api/github/oauth/callback";

/** The web flow is available only when BOTH the client id and secret are set. Without the secret we
 * fall back to the device flow, so shipping this never breaks an env that hasn't added the secret. */
export function webFlowConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

/** The GitHub authorize URL — the browser is sent here; the user clicks Authorize once. */
export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  if (!CLIENT_ID) throw new Error("GitHub OAuth isn't configured");
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${p.toString()}`;
}

/** Exchange the callback `code` for an access token — server-side, so the secret never reaches the
 * client. `redirectUri` must exactly match the one used to start the flow. */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("GitHub OAuth isn't configured");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const d = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) {
    throw new Error(d.error_description || d.error || "GitHub token exchange failed");
  }
  return d.access_token;
}

/** Only ever redirect back to a SAME-ORIGIN path — never an absolute/`//host` URL (open-redirect guard). */
export function safeReturnPath(p: string | null | undefined): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//")) return "/dashboard";
  return p;
}
