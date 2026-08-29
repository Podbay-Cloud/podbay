"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhaseHeader } from "@/components/phase-header";
import { PasteCodeInput } from "@/components/paste-code-input";
import { startSetupToken, completeSetupToken } from "@/lib/actions";

/**
 * Full-page takeover for renewing a pod's Claude login as a ~1-year `setup-token` (agent-auth-lifecycle).
 * Runs `claude setup-token` on the pod, hands the owner the one-time browser-approval URL, takes the code,
 * and stores the long-lived token — so this pod goes ~a year without a re-login (driven by T3, not native
 * Remote Control). Mirrors the reconnect wizard's shape; URL-backed by the cockpit so a refresh is safe.
 */
export default function ClaudeRenewTokenWizard({
  slug,
  name,
  environmentName,
  onClose,
  embedded = false,
  onComplete,
}: {
  slug: string;
  name: string | null;
  environmentName: string;
  onClose: () => void;
  /** Rendered as a STEP inside ProviderAuthWizard — drop the chrome, report success via onComplete. */
  embedded?: boolean;
  onComplete?: () => void;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setError(null);
    const r = await startSetupToken(slug);
    setStarting(false);
    if ("error" in r) setError(r.error);
    else setAuthUrl(r.authUrl);
  };

  // Auto-start on mount — every other sign-in surface fetches its link automatically, so this one
  // shouldn't need a manual "Start" click (owner ask 2026-08-24). Ref-guarded so a re-render never
  // re-spawns `claude setup-token`.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    const r = await completeSetupToken(slug, code.trim());
    if (r?.error) {
      setSubmitting(false);
      setError(r.error);
    } else (onComplete ?? onClose)(); // keep the spinner through the transition — no "Finish" re-flash
  };

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

          <PhaseHeader title={name?.trim() || slug} label="Renew token" tone="enable" />
          <p className="font-mono text-[12px] text-muted-foreground/70">{environmentName} · Claude Code</p>
        </>
      )}
      <p className={`${embedded ? "" : "mt-3 "}text-[13.5px] text-muted-foreground`}>
        Authorize a <b className="text-foreground">~1-year Claude token</b> for T3 Code. Approve once in your
        browser&mdash;no monthly reconnects.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {authUrl ? (
        <>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Step 1 — approve in your browser
          </p>
          <a
            className="mt-2 flex flex-col gap-0.5 rounded-lg border border-enable/50 bg-enable/[0.06] px-3.5 py-3 transition-shadow hover:shadow-[0_0_0_3px_rgba(56,189,248,0.18)]"
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-enable">
              Open the approval page <ArrowUpRight className="size-4" />
            </span>
            <span className="text-[12.5px] text-muted-foreground">
              Approve for your account — it then shows you a code to paste back.
            </span>
          </a>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Step 2 — paste the code
          </p>
          <PasteCodeInput
            value={code}
            onChange={setCode}
            onSubmit={submit}
            submitting={submitting}
            submitLabel="Connect"
          />
        </>
      ) : error ? (
        <Button variant="outline" className="mt-6 self-start" onClick={start} disabled={starting}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : null} Try again
        </Button>
      ) : (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border/60 bg-white/[0.02] px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-[13.5px] text-muted-foreground">Getting your approval link&hellip;</span>
        </div>
      )}
    </div>
  );
}
