"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "@/components/copy-code-button";
import { getPodAppListening } from "@/lib/actions";

/**
 * The pod's live preview, as a browser-window card rather than a lone button in an
 * empty row (owner feedback, 2026-07-29).
 *
 * The frame is a REAL live view, not a screenshot: the preview host is a subdomain
 * of the dashboard's own domain, so it is same-site and the owner's session cookie
 * rides along — an owner-only preview frames fine in the owner's browser (an
 * unauthenticated request gets 401, which is the point).
 *
 * Built so the card still reads correctly if the frame never paints (app not
 * started, crashed, still building): the chrome bar carries the URL, the state
 * line says what's expected, and Open is the authoritative action WHEN there is
 * something to open. A blank rectangle should never be the only thing this says —
 * and Open is hidden when nothing is serving, so it never leads to a dead page
 * (matches the dashboard card, which hides its preview button the same way).
 */
export default function PreviewCard({
  slug,
  url,
  isPublic,
  running,
}: {
  slug: string;
  url: string;
  isPublic: boolean;
  running: boolean;
}) {
  /** null = unknown. The frame is cross-origin, so we can NEVER read its contents to
   * tell "blank" from "a real page" — but the pod knows whether anything is listening
   * on the preview port, which answers the same question honestly. Without it the card
   * had to hedge with a permanent "Blank? maybe…" caption under a perfectly good page. */
  const [appUp, setAppUp] = useState<boolean | null>(null);
  // Shown without the scheme: it's the part that identifies the pod, and dropping
  // "https://" buys ~8 characters of a phone's width. Copy still yields the host.
  const host = url.replace(/^https?:\/\//, "");
  // Nothing to open when the pod is off or nothing is listening on the port; opening
  // then only lands on the "preview upstream unreachable" page. (null = still checking
  // → stay optimistic and offer Open + the frame.)
  const showPreview = running && appUp !== false;

  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = () =>
      void getPodAppListening(slug)
        .then((v) => !stop && setAppUp(v))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug, running]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {/* Browser chrome. Layout is deliberately different per width:
          desktop  — [visibility] [URL·····························] [Open]
          mobile   — [visibility]                              [Open]
                     [URL·······························································]
          i.e. the URL takes the full width on a phone rather than being squeezed
          between two fixed clusters (which read as three unrelated things stacked
          at odd offsets). `min-w-0` on the URL is what lets it actually ellipsize
          instead of forcing the row wider. Open is dropped entirely when nothing is
          serving, so the row never offers an action that leads nowhere. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-muted/40 px-3 py-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {isPublic ? <Eye className="size-3.5" /> : <Lock className="size-3.5" />}
          {isPublic ? "Public" : "Only you"}
        </span>
        {showPreview && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:order-last sm:ml-0">
            <Button asChild size="sm">
              <a href={url} target="_blank" rel="noopener">
                Open <ArrowUpRight />
              </a>
            </Button>
          </div>
        )}
        <CopyCodeButton
          code={host}
          title="Copy the preview URL"
          className="order-last w-full px-2.5 py-1.5 text-[12.5px] font-normal sm:order-none sm:w-auto sm:min-w-0 sm:flex-1"
        />
      </div>

      {!running ? (
        <p className="px-3.5 py-6 text-center text-[13px] text-muted-foreground">
          The preview is live while the pod is running.
        </p>
      ) : appUp === false ? (
        // We KNOW nothing is listening on the app port — don't frame a broken/error page; say so.
        // (appUp === null means "still checking": stay optimistic and show the frame.)
        <p className="px-3.5 py-6 text-center text-[13px] text-warning">
          Nothing is serving the preview yet — start your app in the pod (e.g. a dev server on port
          3000) and it appears here.
        </p>
      ) : (
        <div className="relative bg-background">
          {/* Scaled-down live view. pointer-events-none so scrolling the cockpit
              never gets captured by the frame; the overlay carries the click. */}
          <div className="h-[220px] overflow-hidden sm:h-[280px]">
            <iframe
              src={url}
              title="Pod preview"
              className="pointer-events-none h-[440px] w-[200%] origin-top-left scale-50 border-0 sm:h-[560px]"
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
            />
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener"
            aria-label="Open the preview in a new tab"
            className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
    </div>
  );
}
