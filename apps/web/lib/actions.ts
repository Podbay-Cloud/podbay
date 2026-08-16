"use server";

import { revalidatePath } from "next/cache";
import { createLogger } from "@podbay/shared/log";
import { getPostHogClient } from "./posthog-server";
import type { MetricsSnapshot, PodIssue } from "@podbay/shared";
import type { PodLiveSignals } from "@podbay/control-plane";
import { requireUser, editionOss } from "./session";
import { requireApprovedUser } from "./access";
import { isAdmin } from "./access-rules";
import { ACCOUNT_SLOT_CAP } from "@podbay/shared/tiers";
import { getConnectionToken } from "./github-connect";
import { getEnvironmentDetail } from "./environments";
import { getPodService, isProvisioningEnabled } from "./pod-service";
import { markWalkthroughSeenForUser, resetWalkthroughForUser } from "./walkthrough";
import { recordAttributedUserEvent } from "./landing-experiment-store";
import {
  startDeviceFlow,
  pollDeviceFlow,
  githubConnectConfigured,
  type DeviceStart,
} from "./github-device";

const log = createLogger("web");

/** Live resource metrics for the Stats tab (owner-scoped); null if unavailable. */
export async function getPodMetrics(
  slug: string,
  windowMs?: number,
): Promise<MetricsSnapshot | null> {
  const user = await requireUser();
  return getPodService()
    .podMetrics(user.id, slug, windowMs)
    .catch(() => null);
}

/** The pod's remote-control hand-off URL (owner-scoped). getPod reconciles a
 * running, logged-in pod to CAPTURE it from /healthz, so polling this during
 * onboarding surfaces the greeter's RC link even when the CLI never streamed a
 * "links" frame to the client. Null until captured. */
export async function getPodSessionUrl(slug: string): Promise<string | null> {
  const user = await requireUser();
  const pod = await getPodService()
    .getPod(user.id, slug)
    .catch(() => null);
  return pod?.sessionUrl ?? null;
}

/** The pod's captured sign-in value (owner-scoped) — Claude's auth URL, or for a
 * Codex pod the one-time device CODE the gateway scraped from the terminal. Polled
 * during the sign-in step: Claude also gets it live via the WS "links" frame, but
 * Codex's code arrives server-side only, so the cockpit must fetch it. Null until
 * captured; cleared once the pod is authed. */
export async function getPodAuthUrl(slug: string): Promise<string | null> {
  const user = await requireUser();
  const pod = await getPodService()
    .getPod(user.id, slug)
    .catch(() => null);
  return pod?.authUrl ?? null;
}

/** Mint a fresh Codex pairing code (owner-scoped) for the cockpit's "connect your
 * Codex app" hand-off — the codex analog of Claude's session URL. On demand: the code
 * is short-lived (~10 min) and single-use, so it's never persisted. Returns an `error`
 * string the UI can show (daemon still starting / pod needs updating / unreachable)
 * rather than throwing, so the wizard can offer a retry. */
export async function getCodexPairingCode(
  slug: string,
): Promise<
  | { manualPairingCode: string; pairingCode: string; expiresAt: number; deviceName: string }
  | { error: string }
> {
  const user = await requireUser();
  try {
    return await getPodService().codexPair(user.id, slug);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn’t reach this pod to pair" };
  }
}


/** Whether the pod's Codex remote-control daemon is up — i.e. this pod is registered
 * and available in the user's Codex app. NOT a claim that a device is paired (that
 * lives server-side and isn't observable from the pod). Non-throwing. */
/** Per-agent truth from the pod's /healthz (multi-agent agent cards). Empty when
 * the pod is unreachable, asleep, or its image predates per-agent reporting —
 * the cards degrade to legacy pod-level signals rather than guessing. */
export async function getAgentStates(
  slug: string,
): Promise<
  {
    id: string;
    window: number | null;
    authed: boolean;
    rcActive: boolean;
    authUrl?: string | null;
    sessionUrl?: string | null;
  }[]
> {
  const user = await requireUser();
  return getPodService()
    .agentStates(user.id, slug)
    .catch(() => []);
}

/** Is the pod's app actually serving on its preview port? The pod reports whether
 * anything LISTENS there, which is the honest way to tell a real page from a dead
 * preview — an iframe is cross-origin, so its contents can never be inspected.
 * null = unknown (pod unreachable, or an image too old to report it). */
export async function getPodAppListening(slug: string): Promise<boolean | null> {
  const user = await requireUser();
  const m = await getPodService()
    .podMetrics(user.id, slug)
    .catch(() => null);
  return m?.app ? m.app.listening : null;
}

/** Run the pod's doctor. `fix` applies the safe repairs. */
export async function runPodDoctor(
  slug: string,
  mode: "check" | "safe" | "invasive",
): Promise<
  | {
      checked: number;
      issues: {
        id: string;
        severity: string;
        title: string;
        detail: string;
        fixed: boolean;
        invasive?: boolean;
      }[];
    }
  | { error: string }
> {
  const user = await requireUser();
  try {
    return await getPodService().runDoctor(user.id, slug, mode);
  } catch (e) {
    return { error: message(e) };
  }
}

/** What PODBAY did to this pod (suspend, resume, image change, doctor repairs).
 * Owner-scoped and narrow: their pod's actions, not our lifecycle log. */
export async function getPodAdminActions(
  slug: string,
): Promise<{ action: string; at: string }[]> {
  const user = await requireUser();
  return getPodService()
    .podAdminActions(user.id, slug)
    .catch(() => []);
}

/** Problems the pod reports about itself — [] when healthy. */
export async function getPodIssues(slug: string): Promise<PodIssue[]> {
  const user = await requireUser();
  return getPodService()
    .podIssues(user.id, slug)
    .catch(() => []);
}

/** Send an agent its sign-in code from the cockpit (never via the terminal). */
export async function sendAgentSigninCode(
  slug: string,
  agent: string,
  code: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().sendAgentInput(user.id, slug, agent, code.trim());
  } catch (e) {
    return { error: message(e) };
  }
}

/** The Codex remote-control switch. OFF persists on the pod until switched on. */
export async function setCodexRc(slug: string, on: boolean): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setCodexRc(user.id, slug, on);
  } catch (e) {
    return { error: message(e) };
  }
}

export async function getCodexRcActive(slug: string): Promise<boolean> {
  const user = await requireUser();
  return getPodService()
    .codexRcActive(user.id, slug)
    .catch(() => false);
}

/** Devices the owner has CONFIRMED pairing for (self-reported). Pairing itself is
 * recorded server-side by OpenAI and can't be observed from the pod, so the owner
 * telling us is the only honest completion signal — and the name they give is the
 * only "who connected" answer available. */
export async function getCodexDevices(slug: string): Promise<{ name: string; at: string }[]> {
  const user = await requireUser();
  const pod = await getPodService()
    .getPod(user.id, slug)
    .catch(() => null);
  return pod?.codexDevices ?? [];
}

/** Record the owner's "I've paired this" confirmation, with their name for the device. */
export async function confirmCodexDevice(slug: string, name: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().confirmCodexDevice(user.id, slug, name);
  } catch (e) {
    return { error: message(e) };
  }
}

/** Drop a confirmed device (unpaired, or the label was wrong). */
export async function forgetCodexDevice(slug: string, name: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().forgetCodexDevice(user.id, slug, name);
  } catch (e) {
    return { error: message(e) };
  }
}

type ActionResult = { error: string } | void;

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Launch a pod from a catalog environment. Returns the new pod id — the
 * client opens the workspace in a new tab (a server redirect can't). */
export async function launchPod(
  environmentName: string,
  config?: {
    name?: string;
    secrets?: Record<string, string>;
    lifecycle?: string;
    size?: string;
    /** Self-host explicit sizing (self-host-pod-sizing): CPU cores + memory (MB) the owner
     * chose against the real host. Omitted ⇒ unlimited (the OSS default). Ignored in cloud. */
    cpus?: number;
    memoryMb?: number;
    githubRepo?: string;
    /** Agent(s) chosen at launch (multi-agent-plan.md slice 3). */
    agents?: string[];
    /** Auth mode + BYO key (api-key-pod-mode.md). */
    agentAuth?: "subscription" | "api-key";
    agentApiKey?: string;
  },
): Promise<{ id: string } | { error: string }> {
  // requireApprovedUser (NOT requireUser): a Server Action is a directly-invocable POST,
  // so the /pending page-gate does NOT protect it — an unapproved-but-authenticated user
  // could POST launchPod straight and provision pods, bypassing the invite gate (pre-Alpha
  // security H2). This is the one mutating action that CREATES/spends; the rest operate on
  // an owned pod, which an unapproved user has none of, so `owned(...)` already blocks them.
  const user = await requireApprovedUser();
  if (!isProvisioningEnabled()) {
    return { error: "Pod provisioning isn't enabled yet — check back soon." };
  }
  try {
    // A BYO env is defined by the user's own repo — refuse to launch one without it (cloud clones
    // at boot from a launch-time token). Self-host is the exception: it has no launch-time GitHub
    // token (the in-pod `gh` login runs only once the pod exists), so an OSS BYO pod launches with
    // an empty ~/work and the owner connects GitHub + clones from the pod afterward.
    const detail = await getEnvironmentDetail(environmentName).catch(() => null);
    if (detail?.byoRepo && !config?.githubRepo && !editionOss()) {
      return { error: "Pick the repository you want to work on before launching." };
    }
    // BYO-repo: resolve the clone token from the user's encrypted connection here,
    // so it's passed straight to the provider (injected into the pod) and never
    // logged or written to the pod row. Missing token → surface a clear error
    // rather than launching a pod that can't clone.
    let githubToken: string | undefined;
    if (config?.githubRepo) {
      githubToken = (await getConnectionToken(user.id)) ?? undefined;
      if (!githubToken) return { error: "Your GitHub connection expired — reconnect and pick the repo again." };
    }
    // Never log secret values — pass only the keys if we ever need to trace.
    const rec = await getPodService().launchPod(user.id, environmentName, {
      name: config?.name,
      secrets: config?.secrets,
      lifecycle: config?.lifecycle as never,
      size: config?.size as never,
      // Self-host only: honored for `local` pods, ignored for cloud tiers (service enforces).
      cpus: editionOss() ? config?.cpus : undefined,
      memoryMb: editionOss() ? config?.memoryMb : undefined,
      githubRepo: config?.githubRepo,
      agents: config?.agents as never,
      agentAuth: config?.agentAuth,
      agentApiKey: config?.agentApiKey,
      githubToken,
      // Account slot budget — admins are exempt (they run the fleet).
      slotCap: isAdmin(user.email) || editionOss() ? Infinity : ACCOUNT_SLOT_CAP,
    });
    if (!editionOss()) await recordAttributedUserEvent(user.id, "pod_created", rec.id);
    // Fire-and-forget, and NOT awaited inside this try. The pod exists by now: an
    // awaited flush that rejects would be caught below and reported as "launch
    // failed" for a pod that was successfully created, and with flushAt:1 it also
    // put a PostHog round-trip on the launch path. Analytics must never be able to
    // fail — or slow — the operation it observes.
    const ph = getPostHogClient();
    if (ph) {
      ph.capture({
        distinctId: user.id,
        event: "pod_created",
        properties: { pod_id: rec.id, environment: environmentName, size: config?.size },
      });
      void ph.flush().catch(() => undefined);
    }
    revalidatePath("/dashboard");
    return { id: rec.id };
  } catch (e) {
    log.error("launch_failed", { userId: user.id, environmentName, err: e });
    return { error: message(e) };
  }
}

/** Toggle whether the pod's preview URL is public (anyone with the link) or
 * owner-only. */
export async function setPodPreviewPublic(slug: string, isPublic: boolean): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setPreviewPublic(user.id, slug, isPublic);
  } catch (e) {
    log.error("set_preview_public_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Record that the owner finished/skipped the post-create connect walkthrough, so it
 * never re-runs on ANY pod (per-user, durable across devices). Idempotent. */
export async function markWalkthroughSeen(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await markWalkthroughSeenForUser(user.id);
  } catch (e) {
    log.error("mark_walkthrough_seen_failed", { userId: user.id, err: e });
    return { error: message(e) };
  }
}

/** Live signals for the owner's dashboard cards (agent activity, :3000 liveness,
 * live-critical trouble). Fetched CLIENT-side so navigating to the dashboard renders
 * the cards from lifecycle state immediately and the live sweep never blocks the page. */
export async function getOwnerLiveSignals(): Promise<PodLiveSignals[]> {
  const user = await requireUser();
  return getPodService()
    .ownerLiveSignals(user.id)
    .catch(() => []);
}

/** Persist the owner's hand-ordered pod list (drag-to-reorder on the dashboard).
 * Sends the COMPLETE order; the service ignores ids the caller doesn't own. */
export async function reorderPods(orderedSlugs: string[]): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setPodOrder(user.id, orderedSlugs);
  } catch (e) {
    log.error("reorder_pods_failed", { userId: user.id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
}

/** Replay the walkthrough: clear the per-user "seen" stamp so it shows once more. */
export async function resetWalkthrough(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await resetWalkthroughForUser(user.id);
  } catch (e) {
    log.error("reset_walkthrough_failed", { userId: user.id, err: e });
    return { error: message(e) };
  }
}

/** Whether the pod has a working GitHub login (for private-repo clones), and the
 * login name. Also reports whether GitHub connect is configured at all so the
 * cockpit can hide the chip when no OAuth app client_id is set. */
export async function githubConnStatus(
  slug: string,
): Promise<{ configured: boolean; connected: boolean; login: string | null }> {
  const user = await requireUser();
  // Self-host connects via an IN-POD `gh` device login (no podbay OAuth app), so it's always
  // "configured" in OSS; cloud still requires the OAuth client_id.
  if (!githubConnectConfigured() && !editionOss()) return { configured: false, connected: false, login: null };
  const s = await getPodService()
    .githubStatus(user.id, slug)
    .catch(() => ({ connected: false, login: null as string | null }));
  return { configured: true, ...s };
}

/** Self-host: begin an IN-POD GitHub device login (the pod runs the OAuth device flow with gh's own
 * client — no podbay OAuth app). Returns the one-time code + URL; the client polls pollPodGhLogin. */
export async function startPodGhLogin(
  slug: string,
): Promise<{ userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number } | { error: string }> {
  const user = await requireUser();
  try {
    return await getPodService().startGhLogin(user.id, slug);
  } catch (e) {
    log.error("gh_pod_login_start_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Poll the in-pod GitHub device login; the token is installed IN the pod once GitHub authorizes. */
export async function pollPodGhLogin(
  slug: string,
  deviceCode: string,
): Promise<
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "connected"; login: string }
  | { status: "error"; message: string }
> {
  const user = await requireUser();
  try {
    const r = await getPodService().pollGhLogin(user.id, slug, deviceCode);
    if (r.status === "connected") {
      revalidatePath(`/dashboard/pods/${slug}`);
      return { status: "connected", login: r.login };
    }
    if (r.status === "error") return { status: "error", message: r.error };
    return { status: r.status };
  } catch (e) {
    log.error("gh_pod_login_poll_failed", { userId: user.id, podId: slug, err: e });
    return { status: "error", message: message(e) };
  }
}

/** Begin the GitHub device flow for a pod (owner-scoped). Returns the one-time
 * code + verification URL to show the user; the client then polls
 * completeGithubConnect with the returned deviceCode. */
export async function startGithubConnect(slug: string): Promise<DeviceStart | { error: string }> {
  const user = await requireUser();
  try {
    await getPodService().getPod(user.id, slug); // ownership gate (throws if not owner)
    return await startDeviceFlow();
  } catch (e) {
    log.error("gh_connect_start_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Poll the GitHub device flow once; on authorization, push the token into the
 * pod so `git clone` of private repos works. The deviceCode is single-use and
 * short-lived, and only ever the pod owner's own login — safe to round-trip
 * through the owner's browser. */
export async function completeGithubConnect(
  slug: string,
  deviceCode: string,
): Promise<
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "connected"; login: string }
  | { status: "error"; message: string }
> {
  const user = await requireUser();
  try {
    const poll = await pollDeviceFlow(deviceCode);
    if (poll.status !== "authorized") return poll;
    const { login } = await getPodService().setGithubToken(user.id, slug, poll.token);
    revalidatePath(`/dashboard/pods/${slug}`);
    return { status: "connected", login };
  } catch (e) {
    log.error("gh_connect_complete_failed", { userId: user.id, podId: slug, err: e });
    return { status: "error", message: message(e) };
  }
}

/** Forget the pod's GitHub connection (cockpit "Disconnect", behind a confirm). */
export async function disconnectGithubConn(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().clearGithubToken(user.id, slug);
  } catch (e) {
    log.error("gh_disconnect_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** The connected user's repos (owner-gated), listed with the pod's own gh credentials. */
export async function githubConnRepos(
  slug: string,
): Promise<{ repos: { fullName: string; private: boolean; updatedAt: string }[] } | { error: string }> {
  const user = await requireUser();
  try {
    const repos = await getPodService().listPodRepos(user.id, slug);
    return { repos };
  } catch (e) {
    log.error("gh_repos_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Clone a chosen repo into the pod's ~/work — only when empty (one pod = one repo). */
export async function cloneRepoIntoPod(
  slug: string,
  repo: string,
  force = false,
): Promise<{ status: "cloned"; dest: string } | { status: "not-empty" } | { error: string }> {
  const user = await requireUser();
  try {
    const r = await getPodService().cloneRepoIntoPod(user.id, slug, repo, force);
    if (r.ok) {
      revalidatePath(`/dashboard/pods/${slug}`);
      return { status: "cloned", dest: r.dest };
    }
    if (r.reason === "not-empty") return { status: "not-empty" };
    return { error: "That doesn't look like a valid repository." };
  } catch (e) {
    log.error("gh_clone_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Change a pod's lifecycle policy (owner-scoped). */
export async function setLifecycle(slug: string, lifecycle: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setLifecycle(user.id, slug, lifecycle as never);
  } catch (e) {
    log.error("set_lifecycle_failed", { userId: user.id, podId: slug, lifecycle, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Change a pod's compute tier (owner-scoped). Brief suspend to apply. */
export async function resizePod(slug: string, size: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    // Detached: it returns as soon as the pod is marked in-flight, so the cockpit
    // can render "Resizing…" and poll for progress instead of hanging on the action.
    await getPodService().startPodResize(user.id, slug, size as never, {
      slotCap: isAdmin(user.email) || editionOss() ? Infinity : ACCOUNT_SLOT_CAP,
    });
  } catch (e) {
    log.error("resize_pod_failed", { userId: user.id, podId: slug, size, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Self-host LIVE resize: change a running pod's CPU/memory in place (docker update, no restart).
 * OSS-only; positive limits only (removing a limit needs a recreate — see resizePodLive). */
export async function resizePodLive(
  slug: string,
  sizing: { cpus?: number | null; memoryMb?: number | null },
): Promise<ActionResult> {
  const user = await requireUser();
  if (!editionOss()) return { error: "Live resize is only available in the self-host edition." };
  try {
    await getPodService().resizePodLive(user.id, slug, sizing);
  } catch (e) {
    log.error("resize_pod_live_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Rename a pod (empty → clears back to the slug). */
export async function renamePod(slug: string, name: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setName(user.id, slug, name);
  } catch (e) {
    log.error("rename_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

export async function wakePod(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().wake(user.id, slug, {
      slotCap: isAdmin(user.email) || editionOss() ? Infinity : ACCOUNT_SLOT_CAP,
    });
  } catch (e) {
    log.error("wake_failed", { userId: user.id, podId: slug, err: e });
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/pods/${slug}`);
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

export async function sleepPod(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().sleep(user.id, slug);
  } catch (e) {
    log.error("sleep_failed", { userId: user.id, podId: slug, err: e });
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/pods/${slug}`);
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** The declared secrets for a pod plus whether each is set (never the values). */
export async function listPodSecrets(slug: string): Promise<
  | {
      key: string;
      description: string | null;
      required: boolean;
      set: boolean;
      url: string | null;
      declared: boolean;
    }[]
  | { error: string }
> {
  const user = await requireUser();
  try {
    return await getPodService().listSecrets(user.id, slug);
  } catch (e) {
    log.error("list_secrets_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Secrets the agent asked for from inside the pod (names + reason only). Auto-hidden
 * once set, so this returns only what still needs filling. */
export async function getPodSecretRequests(
  slug: string,
): Promise<{ key: string; description: string; at: string }[] | { error: string }> {
  const user = await requireUser();
  try {
    return await getPodService().secretRequests(user.id, slug);
  } catch (e) {
    log.error("secret_requests_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Dismiss a pod's incident banner (OOM/crash) DURABLY — server-side, so it stays
 * dismissed across devices and reloads, not just this browser. Owner-gated. */
export async function dismissPodIncident(slug: string, eventId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().dismissIncident(user.id, slug, eventId);
  } catch (e) {
    log.error("dismiss_incident_failed", { userId: user.id, podId: slug, eventId, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Reveal ONE app secret's decrypted value for the owner. Owner-gated and audited
 * server-side (`secret_revealed`). The value crosses the wire only on this explicit,
 * per-key request — never in the list. */
export async function revealPodSecret(
  slug: string,
  key: string,
): Promise<{ value: string } | { error: string }> {
  const user = await requireUser();
  try {
    return { value: await getPodService().revealSecret(user.id, slug, key) };
  } catch (e) {
    log.error("reveal_secret_failed", { userId: user.id, podId: slug, key, err: e });
    return { error: message(e) };
  }
}

/** Reveal EVERY set secret at once, for the Secrets tab's "Export all" → `.env`. Owner-scoped +
 * audit-logged server-side (one `secrets_exported` event). Values live only in this response. */
export async function revealAllPodSecrets(
  slug: string,
): Promise<{ env: Record<string, string> } | { error: string }> {
  const user = await requireUser();
  try {
    return { env: await getPodService().revealAllSecrets(user.id, slug) };
  } catch (e) {
    log.error("reveal_all_secrets_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/** Set (or replace) an app secret's value for a pod. Write-only. */
export async function setPodSecret(slug: string, key: string, value: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().setSecret(user.id, slug, key, value);
  } catch (e) {
    log.error("set_secret_failed", { userId: user.id, podId: slug, key, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/** Clear an app secret's value for a pod. */
export async function clearPodSecret(slug: string, key: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().clearSecret(user.id, slug, key);
  } catch (e) {
    log.error("clear_secret_failed", { userId: user.id, podId: slug, key, err: e });
    return { error: message(e) };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

export async function destroyPod(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  // Teardown takes 10-20s (machine + volume detach retries). Start it, wait
  // just long enough for the "destroying" status to persist, then return —
  // the row renders as "Removing…" (server-side state, survives refreshes)
  // and disappears once the background teardown deletes it.
  const teardown = getPodService().destroy(user.id, slug);
  teardown.catch((e) => log.error("destroy_failed", { userId: user.id, podId: slug, err: e }));
  const quick = await Promise.race([
    teardown.then(() => "done" as const, () => "failed" as const),
    new Promise<"pending">((r) => setTimeout(() => r("pending"), 1500)),
  ]);
  revalidatePath("/dashboard");
  if (quick === "failed") return { error: "Couldn't remove the pod — it stays marked as removing; try again shortly." };
}

/**
 * Re-run provisioning for a FAILED pod (owner-scoped). Flips it back to
 * "provisioning"; the durable provisioner loop rebuilds it within a few seconds.
 */
export async function retryPod(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().retryProvision(user.id, slug);
  } catch (e) {
    log.error("retry_pod_failed", { userId: user.id, podId: slug, err: e });
    return { error: "Couldn't retry provisioning — try again shortly." };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pods/${slug}`);
}

/**
 * Apply the current pod image to this pod (owner-scoped), keeping its volume —
 * files, plan and Claude login survive; the pod restarts (docs P2.5).
 *
 * The image is read from OUR env, never accepted from the client: letting a
 * caller name the image would let them boot a pod on anything they like.
 */
export async function updatePodImage(slug: string): Promise<ActionResult> {
  const user = await requireUser();
  // Cloud pins the target via PODBAY_BASE_IMAGE. Self-host updates to the pod-base tag it runs
  // (LocalProvider.updateImage ignores this arg and pulls its own image) — so any non-empty value
  // lets the flow proceed; use the configured local image for honesty.
  const image =
    process.env.PODBAY_BASE_IMAGE ??
    (editionOss() ? process.env.PODBAY_LOCAL_IMAGE || "ghcr.io/podbay-cloud/pod-base:latest" : undefined);
  if (!image) return { error: "No pod image is configured" };
  try {
    // Starts the update and returns — the recreate takes minutes and awaiting it
    // here held Next's server-action queue, freezing every link and tab in the
    // dashboard. Progress is polled via podUpdateProgress below.
    await getPodService().startPodImageUpdate(user.id, slug, image);
  } catch (e) {
    log.error("update_pod_image_failed", { userId: user.id, podId: slug, err: e });
    return { error: message(e) };
  }
}

/**
 * Add a second agent (a DIFFERENT type) to a running pod — multi-agent slice 3.
 * The control plane enforces the rules (different type, env-declared, running,
 * owner-scoped, idempotent); this just surfaces the outcome to the cockpit.
 */
export async function addPodAgent(slug: string, agent: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await getPodService().addAgent(user.id, slug, agent);
  } catch (e) {
    log.error("add_pod_agent_failed", { userId: user.id, podId: slug, agent, err: e });
    return { error: message(e) };
  }
}

/** Poll target for the cockpit while an image update runs. */
export async function podUpdateProgress(
  slug: string,
): Promise<{ active: boolean; stage: string | null; startedAt: string | null; error: string | null }> {
  const user = await requireUser();
  try {
    return await getPodService().podUpdateProgress(user.id, slug);
  } catch {
    return { active: false, stage: null, startedAt: null, error: null };
  }
}

/** The signed-in owner's slot usage, for the dashboard meter + launch gating. Admins are
 * exempt (unlimited); the `used` count is real either way. */
export async function mySlotUsage(): Promise<{ used: number; cap: number; unlimited: boolean }> {
  const user = await requireUser();
  const usage = await getPodService().accountSlotUsage(user.id, ACCOUNT_SLOT_CAP);
  return { used: usage.used, cap: ACCOUNT_SLOT_CAP, unlimited: isAdmin(user.email) || editionOss() };
}
