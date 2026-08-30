"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GithubDevicePanel } from "@/components/github-device-panel";
import { RepoPicker } from "@/components/repo-picker";
import { DisconnectGithubButton } from "@/components/disconnect-github-button";
import {
  githubAccountStatus,
  startGithubAccountConnect,
  completeGithubAccountConnect,
  githubAccountRepos,
  disconnectGithubAccount,
} from "@/lib/github-connect-actions";
import type { Repo } from "@/lib/github-connect";

/**
 * "Work on your repo" field for the launch form of a BYO env. Drives the account
 * device-flow connect, then lets the user pick a repo. Reports the chosen repo
 * (or null) via onSelect. The token never touches this component — only the
 * login + repo names come back from the server. The repo is REQUIRED: a BYO pod
 * without one boots to an empty ~/work.
 */
export function GithubRepoField({ onSelect }: { onSelect: (repo: string | null) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [selected, setSelected] = useState("");
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    githubAccountStatus()
      .then((s) => {
        setConfigured(s.configured);
        setLogin(s.login);
        if (s.connected) void loadRepos();
      })
      .catch(() => setConfigured(false));
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRepos() {
    setRepos(null);
    setRepos(await githubAccountRepos().catch(() => []));
  }

  function pick(repo: string) {
    setSelected(repo);
    onSelect(repo || null);
  }

  async function connect() {
    setError(null);
    setBusy(true);
    const start = await startGithubAccountConnect();
    if ("error" in start) {
      setError(start.error);
      setBusy(false);
      return;
    }
    setDevice({ userCode: start.userCode, url: start.verificationUri });
    const deadline = Date.now() + start.expiresIn * 1000;
    const poll = async () => {
      const r = await completeGithubAccountConnect(start.deviceCode);
      if (r.status === "connected") {
        setDevice(null);
        setBusy(false);
        setLogin(r.login);
        void loadRepos();
        return;
      }
      if (r.status === "error") {
        setError(r.message);
        setDevice(null);
        setBusy(false);
        return;
      }
      if (Date.now() > deadline) {
        setError("Code expired — try connecting again.");
        setDevice(null);
        setBusy(false);
        return;
      }
      const wait = (r.status === "slow_down" ? r.interval : start.interval) * 1000;
      pollTimer.current = setTimeout(poll, wait);
    };
    pollTimer.current = setTimeout(poll, start.interval * 1000);
  }

  function cancelConnect() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setDevice(null);
    setBusy(false);
  }

  async function disconnect() {
    await disconnectGithubAccount().catch(() => {});
    setLogin(null);
    setRepos(null);
    pick("");
  }

  if (configured === null) return null; // still loading status
  // No GitHub OAuth app configured. This env NEEDS a repo, so say so plainly —
  // silently hiding the field left "Create pod" disabled with nothing to act on.
  if (!configured)
    return (
      <div className="flex flex-col gap-2">
        <Label id="github-repository-label" htmlFor="github-repository-picker">
          Repository <span aria-hidden className="text-destructive">*</span>
          <span className="sr-only"> required</span>
        </Label>
        <p className="text-[13px] text-muted-foreground">
          GitHub isn&apos;t configured on this deployment.
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <Label id="github-repository-label" htmlFor="github-repository-picker">
        Repository <span aria-hidden className="text-destructive">*</span>
        <span className="sr-only"> required</span>
      </Label>

      {!login ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            Connect GitHub to choose a repository.
          </p>
          {device ? (
            <>
              <GithubDevicePanel userCode={device.userCode} verificationUri={device.url} />
              <div>
                <Button variant="outline" size="sm" onClick={cancelConnect}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={connect} disabled={busy}>
                {busy ? "Connecting…" : "Connect GitHub"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span
              aria-label={`GitHub connected as @${login}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground"
            >
              <Check className="h-3.5 w-3.5 text-success" aria-hidden /> @{login}
            </span>
            <DisconnectGithubButton onConfirm={disconnect} variant="link" login={login} />
          </div>
          {repos === null ? (
            <p className="text-[13px] text-muted-foreground" role="status">
              Loading repositories…
            </p>
          ) : (
            <RepoPicker
              repos={repos}
              value={selected}
              onChange={pick}
              placeholder="Choose a repository…"
              triggerId="github-repository-picker"
              labelledBy="github-repository-label"
            />
          )}
          {repos !== null && repos.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No repositories found. Reconnect and try again.
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
