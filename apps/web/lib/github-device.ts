import "server-only";

/**
 * GitHub OAuth *device flow* (docs/runbooks/bulletproof-launch.md step 7). The web app
 * holds the OAuth app client_id and drives the flow; the pod only ever receives
 * the final token. Device flow needs no client_secret, so the client_id is the
 * only config and it isn't sensitive. Create the app under the `podbay` org with
 * "Enable Device Flow" checked, scope `repo`.
 */

const CLIENT_ID = process.env.PODBAY_GITHUB_OAUTH_CLIENT_ID;
// `repo` = clone/push private repos; `read:org` = see org-owned private repos.
const SCOPE = "repo read:org";

export function githubConnectConfigured(): boolean {
  return !!CLIENT_ID;
}

export interface DeviceStart {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

export async function startDeviceFlow(): Promise<DeviceStart> {
  if (!CLIENT_ID) throw new Error("GitHub connect isn't configured");
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    signal: AbortSignal.timeout(10_000),
  });
  const d = (await res.json()) as {
    user_code?: string;
    verification_uri?: string;
    device_code?: string;
    interval?: number;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !d.device_code || !d.user_code || !d.verification_uri) {
    throw new Error(d.error_description || "GitHub device-code request failed");
  }
  return {
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    deviceCode: d.device_code,
    interval: d.interval ?? 5,
    expiresIn: d.expires_in ?? 900,
  };
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "authorized"; token: string }
  | { status: "error"; message: string };

export async function pollDeviceFlow(deviceCode: string): Promise<DevicePoll> {
  if (!CLIENT_ID) return { status: "error", message: "GitHub connect isn't configured" };
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const d = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };
  if (d.access_token) return { status: "authorized", token: d.access_token };
  if (d.error === "authorization_pending") return { status: "pending" };
  if (d.error === "slow_down") return { status: "slow_down", interval: d.interval ?? 10 };
  return { status: "error", message: d.error_description || d.error || "GitHub authorization failed" };
}
