"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { PhaseHeader } from "@/components/phase-header";
import { PasteCodeInput } from "@/components/paste-code-input";
import { qk } from "@/lib/query-keys";
import { getAgentStates, getPodAuthUrl, reconnectAgent, sendAgentSigninCode } from "@/lib/actions";

/**
 * Full-page takeover for Claude sign-in / reconnect (agent-control-wizards). The cockpit early-returns
 * this — like PodUpdating / T3Enabling — when the owner starts a sign-in or hits Reconnect, so the one
 * step that matters gets the whole view. Self-contained: it reads the SAME `qk.agents` cache the card
 * polls (so it stays in sync + shares the poll), finds this agent's OAuth `authUrl`, takes the pasted
 * code, and returns to the cockpit automatically once the agent reports `authed`.
 */
export default function ClaudeSigninWizard({
  slug,
  name,
  environmentName,
  agentId = "claude-code",
  mode,
  onClose,
  embedded = false,
  onComplete,
  providerLabel = "Claude",
}: {
  slug: string;
  name: string | null;
  environmentName: string;
  agentId?: string;
  mode: "signin" | "reconnect";
  onClose: () => void;
  /** Rendered as a STEP inside ProviderAuthWizard: drop the back button + PhaseHeader (the stepper owns
   * the chrome) and report success via onComplete (advance) instead of onClose (which aborts the flow). */
  embedded?: boolean;
  onComplete?: () => void;
  /** The provider's display name — this same body serves Codex device-auth (agentId="codex"). */
  providerLabel?: string;
}) {
  const queryClient = useQueryClient();
  const { data: agents } = useQuery({
    queryKey: qk.agents(slug),
    queryFn: () => getAgentStates(slug),
    refetchInterval: 3_000, // fast while a sign-in is in flight
  });
  const agent = agents?.find((a) => a.id === agentId);
  // The sign-in URL can reach us two ways: the LIVE agent state (healthz scrape) and the PERSISTED pod
  // row (the gateway's push, or the reconcile's reconnect-capture). Read BOTH — whichever has it — so a
  // gap in one path (e.g. a reconnect the live scrape lags on) still surfaces the link instead of
  // hanging on "Getting the sign-in link…" (owner, makore.app dev, 2026-08-26).
  const { data: rowAuthUrl } = useQuery({
    queryKey: ["pod", slug, "authUrl"],
    queryFn: () => getPodAuthUrl(slug),
    refetchInterval: 3_000,
  });
  const authUrl = agent?.authUrl ?? rowAuthUrl ?? null;
  const authed = agent?.authed ?? false;

  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reconnect wipes the dead token + respawns into /login; the new authUrl then appears via the poll.
  const [preparing, setPreparing] = useState(mode === "reconnect");
  const didReconnect = useRef(false);

  useEffect(() => {
    if (mode !== "reconnect" || didReconnect.current) return;
    didReconnect.current = true;
    void reconnectAgent(slug, agentId)
      .then((r) => {
        if (r?.error) setError(`Couldn't reconnect: ${r.error}`);
      })
      .finally(() => {
        setPreparing(false);
        void queryClient.invalidateQueries({ queryKey: qk.agents(slug) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in → advance the flow (or, standalone, back to the cockpit). A RECONNECT starts on a
  // STILL-authed agent (its login is only expiring, not yet dead), so closing on that initial `authed`
  // would flash the wizard shut before the wipe even runs — the bug where "Reconnect" just bounced back
  // to the card (owner, 2026-08-26). Only treat `authed` as "done" once we've seen the agent go unauthed
  // first (the reconnect landed); a plain sign-in has nothing to un-auth, so it advances immediately.
  const sawUnauthed = useRef(mode !== "reconnect");
  useEffect(() => {
    if (!authed) {
      sawUnauthed.current = true;
      return;
    }
    if (sawUnauthed.current) (onComplete ?? onClose)();
  }, [authed, onComplete, onClose]);

  // Stall recovery. A DEAD (bare-shell) agent — e.g. after `/logout`, or a crash — produces NO
  // sign-in link, and signin mode (unlike reconnect) never restarts it, so the wizard would hang on
  // "Getting the sign-in link…" forever (velsa, 2026-08-25). If no authUrl has appeared after a few
  // seconds (and we aren't already preparing/signing-in), respawn the agent into /login + drive its
  // menu — the same recovery reconnect uses. Fires once; the capture then surfaces the URL next poll.
  const didRecover = useRef(false);
  useEffect(() => {
    if (authUrl || authed || signingIn || preparing || didRecover.current) return;
    const t = window.setTimeout(() => {
      if (didRecover.current) return;
      didRecover.current = true;
      void reconnectAgent(slug, agentId).finally(() => {
        void queryClient.invalidateQueries({ queryKey: qk.agents(slug) });
      });
    }, 8_000);
    return () => window.clearTimeout(t);
  }, [authUrl, authed, signingIn, preparing, slug, agentId, queryClient]);

  // Safety: if "Signing in…" never resolves (wrong code / stall), fall back to the paste box so the
  // owner can retry instead of watching a spinner forever.
  useEffect(() => {
    if (!signingIn) return;
    const t = window.setTimeout(() => {
      setSigningIn(false);
      setSent(false);
    }, 90_000);
    return () => window.clearTimeout(t);
  }, [signingIn]);

  const submit = () => {
    const c = code.trim();
    if (!c) return;
    setSent(true);
    setSigningIn(true);
    setError(null);
    void sendAgentSigninCode(slug, agentId, c).then((r) => {
      if (r?.error) {
        setError(`Couldn't send the code: ${r.error}`);
        setSigningIn(false);
        setSent(false);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: qk.agents(slug) });
    });
  };

  const title = mode === "reconnect" ? `Reconnect ${providerLabel}` : `${providerLabel} sign-in`;

  return (
    <div className={embedded ? "" : "mx-auto w-full max-w-xl px-4 py-8"}>
      {!embedded && (
        <>
          <button
            type="button"
            onClick={onClose}
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to {name?.trim() || slug}
          </button>

          <PhaseHeader title={name?.trim() || slug} label={title} tone="warning" />
          <p className="font-mono text-[12px] text-muted-foreground/70">{environmentName} · {providerLabel}</p>
        </>
      )}
      <p className={`${embedded ? "" : "mt-3 "}text-[13.5px] text-muted-foreground`}>
        {mode === "reconnect"
          ? `Your sign-in expired or was signed out. Reconnect to keep driving ${providerLabel} from your devices.`
          : `Sign in to your ${providerLabel} account so you can drive this pod from the ${providerLabel} app or browser.`}
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {signingIn ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border/60 bg-white/[0.02] px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-warning" />
          <span className="text-[13.5px]">
            Signing in… <span className="text-muted-foreground">— returns to the cockpit when ready.</span>
          </span>
        </div>
      ) : preparing || !authUrl ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border/60 bg-white/[0.02] px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-[13.5px] text-muted-foreground">
            {preparing ? "Preparing a fresh sign-in…" : `Getting ${providerLabel}'s sign-in link…`}
          </span>
        </div>
      ) : (
        <>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Step 1 — open the sign-in page
          </p>
          <a
            className="mt-2 flex flex-col gap-0.5 rounded-lg border border-primary/70 bg-primary/10 px-3.5 py-3 transition-shadow hover:shadow-[0_0_0_3px_rgba(47,107,255,0.18)]"
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              Open the {providerLabel} sign-in page <ArrowUpRight className="size-4" />
            </span>
            <span className="text-[12.5px] text-[var(--accent-light)]">
              Approve it, then Claude shows you a code to paste back.
            </span>
          </a>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Step 2 — paste the code
          </p>
          <PasteCodeInput value={code} onChange={setCode} onSubmit={submit} submitted={sent} submitLabel="Connect" />
        </>
      )}
    </div>
  );
}
