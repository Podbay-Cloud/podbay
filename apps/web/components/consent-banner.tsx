"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { readConsentFromDocument, writeConsentToDocument } from "@/lib/consent";

/**
 * Cookie-consent banner. Shown only until the visitor decides; the choice is remembered
 * in a first-party cookie. On **Accept**, PostHog is switched to persistent storage and
 * opted in; on **Decline**, it stays opted out (memory-only, no analytics cookies) — see
 * instrumentation-client.ts, which reads the same cookie so a returning visitor isn't
 * re-prompted. Deliberately a small bottom bar, never a full-screen wall (which Google
 * penalises as an intrusive interstitial and which blocks the page).
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  // Decide visibility on the client only (SSR can't read the cookie), so the markup is
  // stable and there's no hydration mismatch — it just appears once mounted if unchosen.
  useEffect(() => setOpen(readConsentFromDocument() === null), []);

  // Measure the bar so the spacer matches it exactly, and re-measure on resize (the copy
  // reflows). Runs only while the bar is shown; the spacer collapses with it.
  useEffect(() => {
    if (!open) {
      setBarHeight(0);
      return;
    }
    const measure = () => setBarHeight(barRef.current?.offsetHeight ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  if (!open) return null;

  const decide = (granted: boolean) => {
    writeConsentToDocument(granted ? "granted" : "denied");
    try {
      if (granted) {
        posthog.set_config({ persistence: "localStorage+cookie" });
        posthog.opt_in_capturing();
      } else {
        posthog.opt_out_capturing();
      }
    } catch {
      /* posthog not initialised (no token) — the choice is still recorded */
    }
    // Flip Google Analytics Consent Mode in lock-step (gtag defaults to denied until now;
    // see components/google-analytics.tsx). Guarded: GA is production-only, so window.gtag
    // is undefined in dev and the choice is still recorded above.
    window.gtag?.("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
    });
    setOpen(false);
  };

  return (
    <>
      {/* A fixed bottom bar physically covers whatever sits under it: Playwright caught this
          as "subtree intercepts pointer events", failing four cockpit tests whose buttons
          happened to be near the bottom of the viewport. A real first-time visitor hits the
          same wall — a control they cannot click and no obvious reason why. A spacer of the
          bar's own height keeps the page fully reachable while it is shown, and disappears
          with it. `ref` + measured height rather than a hardcoded value, because the copy
          wraps to two lines on narrow viewports. */}
      <div aria-hidden style={{ height: barHeight }} />
      <div
        ref={barRef}
        role="dialog"
        aria-label="Cookie consent"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          We use cookies for the app to work and, with your OK, to understand how it&rsquo;s used so we
          can improve it. Essential cookies always run.{" "}
          <Link href="/cookies" className="font-medium text-[var(--accent-light)] hover:underline">
            Cookie policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
      </div>
    </>
  );
}