"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createLogger } from "@podbay/shared/log";
import { requireUser } from "./session";
import { startDeviceFlow, pollDeviceFlow, githubConnectConfigured, type DeviceStart } from "./github-device";
import {
  webFlowConfigured,
  buildAuthorizeUrl,
  safeReturnPath,
  OAUTH_CALLBACK_PATH,
} from "./github-oauth";
import {
  connectionStatus,
  storeConnection,
  disconnect,
  listRepos,
  type Repo,
} from "./github-connect";
import { getPodService } from "./pod-service";

/** Fan the durable account connection out to every owned pod — install the token (connect/reconnect)
 * or clear it (disconnect, token=null). Fire-and-forget with logging: connecting/disconnecting must
 * not block on reaching N pods, and an unreachable pod re-syncs on its next wake. */
function fanOutGithubToPods(userId: string, token: string | null): void {
  void getPodService()
    .syncGithubToOwnedPods(userId, token)
    .then((r) => log.info("gh_fanout", { userId, connect: token != null, ...r }))
    .catch((e) => log.error("gh_fanout_failed", { userId, connect: token != null, err: e }));
}

/** Short-lived cookie carrying the CSRF `state` + where to return after the callback. */
const OAUTH_COOKIE = "gh_oauth";

const log = createLogger("web-gh-connect");
const msg = (e: unknown) => (e instanceof Error ? e.message : "unexpected error");

/** Is GitHub connect configured, and is THIS user's account connected? */
export async function githubAccountStatus(): Promise<{
  configured: boolean;
  /** True when the one-click web OAuth flow is available (client id + secret). When false, the UI
   * falls back to the device-code flow. */
  webFlow: boolean;
  connected: boolean;
  login: string | null;
}> {
  const user = await requireUser();
  if (!githubConnectConfigured())
    return { configured: false, webFlow: false, connected: false, login: null };
  const s = await connectionStatus(user.id).catch(() => ({ connected: false, login: null as string | null }));
  return { configured: true, webFlow: webFlowConfigured(), ...s };
}

/** Start the one-click WEB OAuth flow: mint a CSRF `state`, stash it (+ where to return) in a
 * short-lived httpOnly cookie, and return the GitHub authorize URL for the browser to navigate to.
 * The callback route (`/api/github/oauth/callback`) validates the state and stores the token. */
export async function startGithubAccountWebConnect(
  returnPath: string,
): Promise<{ url: string } | { error: string }> {
  await requireUser();
  if (!webFlowConfigured()) return { error: "GitHub one-click connect isn't configured." };
  const state = randomBytes(16).toString("hex");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  // The redirect_uri MUST be the app's REGISTERED callback (its canonical URL), not the request host.
  // On a pod the host header is the internal 0.0.0.0:3000 bind, which GitHub rejects and which sent the
  // user to a dead https://0.0.0.0:3000/…?github=error (velsa, 2026-08-31). Prefer BETTER_AUTH_URL (the
  // domain the OAuth app's callback is registered under); fall back to the request host.
  const canonical = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");
  const host = h.get("host");
  const origin = canonical || (host ? `${proto}://${host}` : "");
  if (!origin) return { error: "could not determine callback origin" };
  const jar = await cookies();
  jar.set(OAUTH_COOKIE, JSON.stringify({ state, returnPath: safeReturnPath(returnPath) }), {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return { url: buildAuthorizeUrl(state, `${origin}${OAUTH_CALLBACK_PATH}`) };
}

/** Start the device flow for the ACCOUNT (not a pod). Client polls with the deviceCode. */
export async function startGithubAccountConnect(): Promise<DeviceStart | { error: string }> {
  await requireUser();
  try {
    return await startDeviceFlow();
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Poll once; on authorization, store the encrypted connection (not pod-scoped). */
export async function completeGithubAccountConnect(deviceCode: string): Promise<
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "connected"; login: string }
  | { status: "error"; message: string }
> {
  const user = await requireUser();
  try {
    const poll = await pollDeviceFlow(deviceCode);
    if (poll.status !== "authorized") return poll;
    const { login } = await storeConnection(user.id, poll.token);
    fanOutGithubToPods(user.id, poll.token); // reconnect restores access on every owned pod
    return { status: "connected", login };
  } catch (e) {
    log.error("gh_account_connect_failed", { userId: user.id, err: e });
    return { status: "error", message: msg(e) };
  }
}

/** The connected account's repos (names only). Empty if not connected. */
export async function githubAccountRepos(): Promise<Repo[]> {
  const user = await requireUser();
  return listRepos(user.id).catch(() => []);
}

/** Disconnect the account connection AND revoke GitHub from every owned pod (the damaging action the
 * Settings UI warns about). Full revoke of the token itself is the user's GitHub settings. */
export async function disconnectGithubAccount(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  fanOutGithubToPods(user.id, null); // every owned pod loses GitHub access
  await disconnect(user.id).catch(() => {});
  return { ok: true };
}
