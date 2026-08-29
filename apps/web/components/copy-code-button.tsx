"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/clipboard";

/**
 * A code shown AS a copy button: the value with a Copy icon that flips to a Check
 * for ~1.5s on click. Shared so every "here's a one-time code, copy it" surface
 * (GitHub device flow, Codex device sign-in) has the SAME, OBVIOUS affordance —
 * the Codex code used to copy on click with no icon, so it wasn't discoverable
 * (vels, 2026-07-26). Sizing/tracking come from `className` so each caller keeps
 * its own scale.
 */
export function CopyCodeButton({
  code,
  className = "",
  title = "Copy",
}: {
  code: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    // Only flip to the check when the copy REALLY succeeded — over plain HTTP the async Clipboard
    // API is unavailable, so copyText falls back to execCommand and reports the true outcome.
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background font-mono font-semibold tabular-nums hover:bg-white/[0.06] ${className}`}
      title={title}
    >
      {/* The VALUE truncates; the icon never does. `truncate` on the button itself
          only clips (flex children don't shrink a bare text node), which cut the
          icon off-screen — so a click copied but showed no feedback at all, and a
          long value ended mid-character instead of with an ellipsis. */}
      <span className="min-w-0 truncate">{code}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-60" />
      )}
    </button>
  );
}
