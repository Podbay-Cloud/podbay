"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/query-keys";
import { GithubDevicePanel } from "@/components/github-device-panel";
import { RepoPicker } from "@/components/repo-picker";
import {
  githubConnStatus,
  startGithubConnect,
  completeGithubConnect,
  startPodGhLogin,
  pollPodGhLogin,
  githubConnRepos,
  cloneRepoIntoPod,
} from "@/lib/actions";
import { githubAccountStatus, startGithubAccountWebConnect } from "@/lib/github-connect-actions";

type Repo = { fullName: string; private: boolean; updatedAt: string };

/**
 * Add GitHub to an existing pod — a stepped wizard: Step 1 authorize, Step 2 choose a repo and clone
 * it into ~/work (only when empty — one pod, one repo). Opens straight on step 2 if already connected.
 *
 * CLOUD connects with ONE-CLICK OAuth via the owner's durable ACCOUNT connection
 * (global-github-connection) — the token then fans out to this pod, so there is no per-pod device
 * code. (Device flow is only the fallback when the one-click OAuth app has no client secret.)
 * Disconnect/reconnect live in Settings, not here. SELF-HOST keeps its per-pod in-pod `gh` device
 * login. The page frames the content, so the wizard renders NO card of its own.
 */
export default function GithubWizard({
  slug,
  backHref,
  oss = false,
}: {
  slug: string;
  /** Where "Done" returns — the cockpit tab the wizard was opened from (the page's top back-link
   * uses the same href). Defaults to the pod's cockpit. */
  backHref?: string;
  oss?: boolean;
}) {
  const back = backHref ?? `/dashboard/pods/${slug}`;
  const queryClient = useQueryClient();

  // Whether THIS pod has GitHub is the pod's own signal — on cloud the account fan-out installs it,
  // on self-host the in-pod login does. `flow` overrides while a connect is mid-flight.
  const { data: status } = useQuery({
    queryKey: qk.github(slug),
    queryFn: () => githubConnStatus(slug),
  });
  // The account's webFlow flag decides one-click OAuth vs the device fallback (cloud only).
  const { data: account } = useQuery({ queryKey: ["gh-account"], queryFn: githubAccountStatus, enabled: !oss });
  const [flow, setFlow] = useState<{ connected: boolean; login: string | null } | null>(null);
  const connected: boolean | null = flow ? flow.connected : (status?.connected ?? null);
  const login: string | null = flow ? flow.login : (status?.login ?? null);
  // What ~/work already holds (its origin remote), so we don't push "choose a repo to clone" at a
  // pod that is already working on one (velsa: podbay dev pod showed "Choose repo", 2026-08-31).
  const workRepo: string | null = status?.workRepo ?? null;
  const webFlow = !oss && account?.webFlow === true;

  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // OAuth returned; waiting for the fan-out to reach this pod
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chosenRepo, setChosenRepo] = useState("");
  const [cloneDifferent, setCloneDifferent] = useState(false); // reveal the picker to REPLACE an existing repo
  const [cloning, setCloning] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const { data: repos = null, error: reposErr } = useQuery({
    queryKey: [...qk.github(slug), "repos"] as const,
    enabled: connected === true,
    queryFn: async () => {
      const r = await githubConnRepos(slug);
      if ("error" in r) throw new Error(r.error);
      return r.repos as Repo[];
    },
  });

  // A one-click OAuth return lands with ?github=connected|denied|error. On success the account is
  // connected and the token is fanning out to this pod — poll the pod's status until it lands.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("github");
    if (p === "denied") setError("GitHub authorization was cancelled.");
    else if (p === "error") setError("Couldn’t connect GitHub — please try again.");
    else if (p === "connected") {
      setWaiting(true);
      let tries = 0;
      const tick = async () => {
        const s = await githubConnStatus(slug).catch(() => null);
        if (s?.connected) {
          setWaiting(false);
          void queryClient.invalidateQueries({ queryKey: qk.github(slug) });
          return;
        }
        if (++tries > 20) {
          setWaiting(false);
          setError("Connected your account, but this pod hasn’t picked it up yet — reload in a moment.");
          return;
        }
        poll.current = setTimeout(tick, 1500);
      };
      poll.current = setTimeout(tick, 1000);
    }
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [slug, queryClient]);

  // Cloud one-click OAuth: connect the ACCOUNT (fans out to this pod), returning to this wizard.
  const connectWeb = useCallback(async () => {
    setError(null);
    setBusy(true);
    const r = await startGithubAccountWebConnect(window.location.pathname);
    if ("url" in r) window.location.href = r.url;
    else {
      setError(r.error);
      setBusy(false);
    }
  }, []);

  // Device-code fallback: OSS runs it IN the pod; cloud-without-a-client-secret uses the per-pod flow.
  const connectDevice = useCallback(async () => {
    setError(null);
    setBusy(true);
    const start = oss ? await startPodGhLogin(slug) : await startGithubConnect(slug);
    if ("error" in start) {
      setError(start.error);
      setBusy(false);
      return;
    }
    setDevice({ userCode: start.userCode, verificationUri: start.verificationUri });
    const deadline = Date.now() + start.expiresIn * 1000;
    const iv = start.interval * 1000;
    const tick = async () => {
      const r = oss ? await pollPodGhLogin(slug, start.deviceCode) : await completeGithubConnect(slug, start.deviceCode);
      if (r.status === "connected") {
        setFlow({ connected: true, login: r.login });
        setDevice(null);
        setBusy(false);
        void queryClient.invalidateQueries({ queryKey: qk.github(slug) });
        return;
      }
      if (r.status === "error") {
        setError("message" in r ? r.message : "Couldn’t connect GitHub.");
        setDevice(null);
        setBusy(false);
        return;
      }
      if (Date.now() > deadline || r.status === "expired") {
        setError("Code expired — try connecting again.");
        setDevice(null);
        setBusy(false);
        return;
      }
      poll.current = setTimeout(tick, iv);
    };
    poll.current = setTimeout(tick, iv);
  }, [oss, slug, queryClient]);

  const connect = () => (webFlow ? connectWeb() : connectDevice());
  const cancelDevice = () => {
    if (poll.current) clearTimeout(poll.current);
    setDevice(null);
    setBusy(false);
  };

  const clone = useCallback(
    async (force = false) => {
      if (!chosenRepo) return;
      setCloning(true);
      setResult(null);
      setConfirmOverwrite(false);
      const r = await cloneRepoIntoPod(slug, chosenRepo, force);
      setCloning(false);
      if ("error" in r) setResult({ tone: "err", text: r.error });
      else if (r.status === "not-empty") setConfirmOverwrite(true);
      else setResult({ tone: "ok", text: `Cloned ${chosenRepo} into ~/work.` });
    },
    [slug, chosenRepo],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* No step rail: the two states (authorize → choose repo) aren't freely navigable, so a
          numbered indicator only read as "go back to step 1" with nowhere to go (velsa, 2026-08-31).
          The state is self-evident from the content below. */}
      {(error || reposErr) && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? (reposErr as Error).message}
        </p>
      )}

      {!connected ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {oss
              ? "Authorize GitHub so this pod can clone your repositories."
              : "Connect GitHub once — every pod reuses it. This pod gets access straight away."}
          </p>
          {waiting ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Connected — setting this pod up…
            </p>
          ) : device ? (
            <>
              <GithubDevicePanel userCode={device.userCode} verificationUri={device.verificationUri} />
              <div>
                <Button variant="outline" size="sm" onClick={cancelDevice}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button variant="outline" onClick={connect} disabled={busy || connected === null}>
                {busy ? "Connecting…" : "Connect GitHub"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {login ? (
              <>
                <Check className="mr-1 inline-block size-3.5 align-[-0.15em] text-success" />
                Connected as @{login}.
              </>
            ) : (
              "Connected."
            )}{" "}
            {workRepo && !cloneDifferent ? (
              <>
                This pod is working on{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{workRepo}</code> in{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code>.
              </>
            ) : (
              <>
                Pick a repository to clone into{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code>.
              </>
            )}
          </p>
          {workRepo && !cloneDifferent ? (
            // Already has a repo — cloning ANOTHER replaces ~/work, so it's a deliberate secondary
            // action, not the default. The clone below still hits the "replace ~/work?" confirm.
            <div>
              <Button variant="outline" size="sm" onClick={() => setCloneDifferent(true)}>
                Clone a different repository…
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <RepoPicker
                repos={repos ?? []}
                value={chosenRepo}
                onChange={setChosenRepo}
                placeholder={repos === null ? "Loading your repositories…" : "Search repositories…"}
              />
              <Button className="self-end" disabled={!chosenRepo || cloning} onClick={() => clone()}>
                {cloning ? "Cloning…" : "Clone to ~/work"}
              </Button>
            </div>
          )}
          {confirmOverwrite && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
              <p className="font-medium text-destructive">
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code> already has a workspace.
              </p>
              <p className="mt-1 text-muted-foreground">
                Replace it with <span className="font-medium text-foreground">{chosenRepo}</span>? This{" "}
                <span className="font-medium">permanently deletes</span> the current contents of{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code>, including anything not pushed to git.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button variant="destructive" size="sm" disabled={cloning} onClick={() => clone(true)}>
                  {cloning ? "Replacing…" : "Replace ~/work"}
                </Button>
                <Button variant="ghost" size="sm" disabled={cloning} onClick={() => setConfirmOverwrite(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {result && (
            <p
              className={
                result.tone === "ok"
                  ? "text-[13px] text-success"
                  : result.tone === "warn"
                    ? "text-[13px] text-warning"
                    : "text-[13px] text-destructive"
              }
            >
              {result.text}
            </p>
          )}
        </div>
      )}

      {/* No bottom "Back" button — the page's top back-link already returns to the cockpit; a second
          one just duplicated it (velsa). "Done" appears only after a successful clone. */}
      {result?.tone === "ok" && (
        <div className="flex justify-end pt-1">
          <Button asChild>
            <Link href={back}>Done</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
