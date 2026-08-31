"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import GithubMark from "@/components/github-mark";
import { GithubDevicePanel } from "@/components/github-device-panel";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  githubAccountStatus,
  startGithubAccountConnect,
  completeGithubAccountConnect,
  startGithubAccountWebConnect,
  disconnectGithubAccount,
} from "@/lib/github-connect-actions";

/**
 * The owner's ONE GitHub connection, managed in dashboard Settings (global-github-connection).
 * Connect once here and every pod reuses it; disconnect/reconnect live ONLY here (the launch and
 * add-to-pod wizards show status but can't disconnect). Disconnect is destructive — it revokes
 * GitHub from every pod — so it's behind a warning. The token never touches this component.
 */
export function GithubAccountCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [webFlow, setWebFlow] = useState(false);
  const [login, setLogin] = useState<string | null>(null);
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    githubAccountStatus()
      .then((s) => {
        setConfigured(s.configured);
        setWebFlow(s.webFlow);
        setLogin(s.login);
      })
      .catch(() => setConfigured(false));
    // A one-click return lands with ?github=connected|denied|error — surface the non-happy paths.
    const p = new URLSearchParams(window.location.search).get("github");
    if (p === "denied") setError("GitHub connection was declined.");
    else if (p === "error") setError("Couldn’t complete the GitHub connection — try again.");
    else if (p === "connected") setNotice("GitHub connected — every pod now has access.");
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  // One-click web OAuth: navigate to GitHub; the callback returns to this page with ?github=…
  async function connectWeb() {
    setError(null);
    setBusy(true);
    const r = await startGithubAccountWebConnect(window.location.pathname);
    if ("error" in r) {
      setError(r.error);
      setBusy(false);
      return;
    }
    window.location.href = r.url;
  }

  // Device-code fallback (no client secret configured).
  async function connectDevice() {
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
        setNotice("GitHub connected — every pod now has access.");
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

  const connect = () => (webFlow ? connectWeb() : connectDevice());

  function cancelConnect() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setDevice(null);
    setBusy(false);
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect GitHub?",
      message: "This disconnects GitHub from your whole account.",
      warning:
        "Every one of your pods loses GitHub access — they can’t clone, pull, or push private repos until you reconnect. Repos already cloned stay on disk. Reconnecting restores access everywhere.",
      confirmLabel: "Disconnect GitHub",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    await disconnectGithubAccount().catch(() => {});
    setLogin(null);
    setNotice("GitHub disconnected from all pods.");
  }

  if (configured === null) return null; // still loading
  if (!configured) return null; // GitHub not configured on this deployment — nothing to manage

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <GithubMark className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
          <div>
            <h2 className="text-base font-semibold">GitHub</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {login ? (
                <>
                  Connected as{" "}
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Check className="h-3.5 w-3.5 text-success" aria-hidden /> @{login}
                  </span>
                  . Every pod you launch or add reuses this connection.
                </>
              ) : (
                <>Connect once — every pod you launch or add then reuses it, no per-pod sign-in.</>
              )}
            </p>
          </div>
        </div>

        {login ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={connect} disabled={busy || !!device}>
              {busy ? "Reconnecting…" : "Reconnect"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect
            </Button>
          </div>
        ) : device ? (
          <Button variant="outline" size="sm" onClick={cancelConnect} className="shrink-0">
            Cancel
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect GitHub"}
          </Button>
        )}
      </div>

      {device && (
        <div className="mt-4">
          <GithubDevicePanel userCode={device.userCode} verificationUri={device.url} />
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
      {notice && !error && <p className="mt-3 text-[13px] text-success">{notice}</p>}
    </section>
  );
}
