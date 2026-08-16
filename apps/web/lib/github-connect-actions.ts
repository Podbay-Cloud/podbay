"use server";

import { createLogger } from "@podbay/shared/log";
import { requireUser } from "./session";
import { startDeviceFlow, pollDeviceFlow, githubConnectConfigured, type DeviceStart } from "./github-device";
import {
  connectionStatus,
  storeConnection,
  disconnect,
  listRepos,
  type Repo,
} from "./github-connect";

const log = createLogger("web-gh-connect");
const msg = (e: unknown) => (e instanceof Error ? e.message : "unexpected error");

/** Is GitHub connect configured, and is THIS user's account connected? */
export async function githubAccountStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  login: string | null;
}> {
  const user = await requireUser();
  if (!githubConnectConfigured()) return { configured: false, connected: false, login: null };
  const s = await connectionStatus(user.id).catch(() => ({ connected: false, login: null as string | null }));
  return { configured: true, ...s };
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

/** Forget our copy of the token (full revoke is the user's GitHub settings). */
export async function disconnectGithubAccount(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await disconnect(user.id).catch(() => {});
  return { ok: true };
}
