"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhaseHeader } from "@/components/phase-header";
import { PasteCodeInput } from "@/components/paste-code-input";
import { startT3Connect, submitT3ConnectCode } from "@/lib/actions";

/**
 * Full-page wizard step: sign this pod's t3 into the OWNER's T3 cloud account and link the environment
 * (t3-connect-account-wizard). This is what makes the pod appear in the T3 app on EVERY device, synced —
 * a local pairing only reaches one. Same out-of-band OAuth shape as the Claude 1-year token: auto-fetch
 * the app.t3.codes/connect link on mount, open it, paste the code back.
 */
export default function T3ConnectWizard({
  slug,
  name,
  environmentName,
  onClose,
  onComplete,
  embedded = false,
}: {
  slug: string;
  name: string | null;
  environmentName: string;
  onClose: () => void;
  onComplete?: () => void;
  embedded?: boolean;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setError(null);
    const r = await startT3Connect(slug);
    setStarting(false);
    if ("error" in r) setError(r.error);
    else setAuthUrl(r.authUrl);
  };

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
    const r = await submitT3ConnectCode(slug, code.trim());
    if (r?.error) {
      setSubmitting(false);
      setError(r.error);
    } else (onComplete ?? onClose)(); // keep the spinner through the transition — no "Connect" re-flash
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
            Skip for now
          </button>
          <PhaseHeader title={name?.trim() || slug} label="Connect to T3" tone="enable" />
          <p className="font-mono text-[12px] text-muted-foreground/70">{environmentName} · T3 Code</p>
        </>
      )}
      <p className={`${embedded ? "" : "mt-3 "}text-[13.5px] text-muted-foreground`}>
        Sign in to <b className="text-foreground">T3 Code</b> to access this pod from any device. Approve
        once in your browser.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {authUrl ? (
        <>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Step 1 — sign in to T3
          </p>
          <a
            className="mt-2 flex flex-col gap-0.5 rounded-lg border border-enable/50 bg-enable/[0.06] px-3.5 py-3 transition-shadow hover:shadow-[0_0_0_3px_rgba(56,189,248,0.18)]"
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-enable">
              Open the T3 sign-in page <ArrowUpRight className="size-4" />
            </span>
            <span className="text-[12.5px] text-muted-foreground">
              Sign in to T3, then it shows you a code to paste back.
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
          <span className="text-[13.5px] text-muted-foreground">Getting your T3 sign-in link&hellip;</span>
        </div>
      )}
    </div>
  );
}
