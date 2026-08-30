"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { qk } from "@/lib/query-keys";
import { GithubDevicePanel } from "@/components/github-device-panel";
import { RepoPicker } from "@/components/repo-picker";
import { DisconnectGithubButton } from "@/components/disconnect-github-button";
import {
  githubConnStatus,
  startGithubConnect,
  completeGithubConnect,
  startPodGhLogin,
  pollPodGhLogin,
  githubConnRepos,
  cloneRepoIntoPod,
  disconnectGithubConn,
} from "@/lib/actions";

type Repo = { fullName: string; private: boolean; updatedAt: string };

/**
 * Add GitHub to an existing pod — a dedicated, stepped wizard PAGE (mirrors the launch
 * flow): Step 1 authorize via the device flow, Step 2 choose a repo and clone it into
 * ~/work (only when empty — one pod, one repo). If the pod is already connected, it
 * opens straight on step 2.
 */
export default function GithubWizard({
  slug,
  podName,
  oss = false,
}: {
  slug: string;
  podName: string;
  /** Self-host: authorize via an IN-POD `gh` device login (no podbay OAuth app) instead of the
   * web-app device flow. Same device-code UX; the token is installed in the pod, not server-side. */
  oss?: boolean;
}) {
  // Connection status: cached via react-query (qk.github, shared with the Settings GitHub row), but
  // the device flow and disconnect flip it locally too — `flow` (when set) overrides the fetched
  // value so a just-connected/-disconnected UI doesn't wait on a refetch.
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: qk.github(slug),
    queryFn: () => githubConnStatus(slug),
  });
  const [flow, setFlow] = useState<{ connected: boolean; login: string | null } | null>(null);
  const connected: boolean | null = flow ? flow.connected : (status?.connected ?? null);
  const login: string | null = flow ? flow.login : (status?.login ?? null);

  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chosenRepo, setChosenRepo] = useState("");
  const [cloning, setCloning] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  // Repos, once connected: react-query gives a skeleton→data load, bounded retry (a reject surfaces
  // an error instead of the old permanent "Loading your repositories…"), and cache.
  const { data: repos = null, error: reposErr } = useQuery({
    queryKey: [...qk.github(slug), "repos"] as const,
    enabled: connected === true,
    queryFn: async () => {
      const r = await githubConnRepos(slug);
      if ("error" in r) throw new Error(r.error);
      return r.repos as Repo[];
    },
  });

  // Drive step 1 only: not connected → device flow. (Connected → repos is the query above.)
  useEffect(() => {
    if (connected === null || connected) return;
    let stop = false;
    // Self-host: the POD runs the device flow (startPodGhLogin/pollPodGhLogin). Cloud: the web app
    // does (startGithubConnect/completeGithubConnect). Same device-code UX either way.
    const start = oss ? startPodGhLogin : startGithubConnect;
    const pollOnce = oss
      ? (dc: string) => pollPodGhLogin(slug, dc)
      : (dc: string) => completeGithubConnect(slug, dc);
    start(slug).then((res) => {
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDevice({ userCode: res.userCode, verificationUri: res.verificationUri });
      const deadline = Date.now() + res.expiresIn * 1000;
      const iv = res.interval * 1000;
      const tick = async () => {
        if (stop) return;
        if (Date.now() > deadline) {
          setError("Code expired — reload to try again.");
          setDevice(null);
          return;
        }
        const r = await pollOnce(res.deviceCode);
        if (r.status === "connected") {
          setFlow({ connected: true, login: r.login });
          setDevice(null);
          void queryClient.invalidateQueries({ queryKey: qk.github(slug) });
          return;
        }
        if (r.status === "error") {
          setError(r.message);
          setDevice(null);
          return;
        }
        if (r.status === "expired") {
          setError("Code expired — reload to try again.");
          setDevice(null);
          return;
        }
        poll.current = setTimeout(tick, iv);
      };
      poll.current = setTimeout(tick, iv);
    });
    return () => {
      stop = true;
      if (poll.current) clearTimeout(poll.current);
    };
  }, [connected, slug]);

  const clone = useCallback(
    async (force = false) => {
      if (!chosenRepo) return;
      setCloning(true);
      setResult(null);
      setConfirmOverwrite(false);
      const r = await cloneRepoIntoPod(slug, chosenRepo, force);
      setCloning(false);
      if ("error" in r) setResult({ tone: "err", text: r.error });
      else if (r.status === "not-empty")
        // ~/work isn't empty. Offer the explicit overwrite rather than a dead end.
        setConfirmOverwrite(true);
      else setResult({ tone: "ok", text: `Cloned ${chosenRepo} into ~/work.` });
    },
    [slug, chosenRepo],
  );

  const disconnect = useCallback(async () => {
    const r = await disconnectGithubConn(slug);
    if (r?.error) {
      setError(r.error);
      return;
    }
    setFlow({ connected: false, login: null }); // back to step 1
    setChosenRepo("");
    setResult(null);
    // Drop the cached status + repos so a reconnect (possibly a different account) refetches clean.
    void queryClient.invalidateQueries({ queryKey: qk.github(slug) });
  }, [slug, queryClient]);

  const step = connected ? 2 : 1;
  const stepLabel = connected ? "Choose a repository" : "Authorize on GitHub";

  return (
    <div className="flex flex-col gap-5">
      {/* Two-step indicator, matching the launch wizard's sub-step line. */}
      <div className="flex items-center gap-3 text-[13px] font-medium">
        <span className={step === 1 ? "text-foreground" : "text-success"}>
          {step === 1 ? "1" : <Check className="inline size-3.5" />} Authorize
        </span>
        <span className="h-px w-8 bg-border" />
        <span className={step === 2 ? "text-foreground" : "text-muted-foreground"}>2 Choose repo</span>
      </div>
      <p className="text-[13px] font-medium text-muted-foreground">
        Step {step} of 2 — {stepLabel}
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4">
          {(error || reposErr) && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error ?? (reposErr as Error).message}
            </p>
          )}

          {step === 1 ? (
            <>
              <p className="text-sm text-muted-foreground">
                Authorize GitHub so this pod can clone your repositories.
              </p>
              {device ? (
                <GithubDevicePanel
                  userCode={device.userCode}
                  verificationUri={device.verificationUri}
                />
              ) : (
                !error && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Starting…
                  </p>
                )
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {login ? (
                  <>
                    <Check className="mr-1 inline-block size-3.5 align-[-0.15em] text-success" />
                    Connected as @{login}.
                  </>
                ) : (
                  "Connected."
                )}{" "}
                Pick a repository to clone into <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code>.
              </p>
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
              {confirmOverwrite && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
                  <p className="font-medium text-destructive">
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code> already
                    has a workspace.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Replace it with <span className="font-medium text-foreground">{chosenRepo}</span>?
                    This <span className="font-medium">permanently deletes</span> the current contents
                    of <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code>,
                    including anything not pushed to git.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={cloning}
                      onClick={() => clone(true)}
                    >
                      {cloning ? "Replacing…" : "Replace ~/work"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cloning}
                      onClick={() => setConfirmOverwrite(false)}
                    >
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
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            <Button asChild variant="outline">
              <Link href={`/dashboard/pods/${slug}`}>Back to {podName}</Link>
            </Button>
            <div className="flex items-center gap-2">
              {connected && <DisconnectGithubButton login={login} onConfirm={disconnect} />}
              {result?.tone === "ok" && (
                <Button asChild>
                  <Link href={`/dashboard/pods/${slug}`}>Done</Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
