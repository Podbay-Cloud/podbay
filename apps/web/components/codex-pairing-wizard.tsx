"use client";

import { ArrowLeft } from "lucide-react";
import { CodexPairPanel } from "@/components/codex-pair-panel";

/**
 * Full-page takeover for Codex pairing — the cockpit early-returns this (like PodUpdating / T3Enabling)
 * when the owner opens pairing, so the flow owns the whole view instead of being squeezed into the
 * agent card (agent-control-wizards). It reuses CodexPairPanel verbatim — the step-1 Phone/Desktop
 * pairing instructions and the shared "Continue this Codex session" step-2 live there.
 */
export default function CodexPairingWizard({
  slug,
  name,
  onClose,
  onPaired,
}: {
  slug: string;
  name: string | null;
  onClose: () => void;
  /** Called after a device is successfully confirmed — the cockpit uses this to refetch the
   * shared device query and return here (first10 regression: the record succeeded server-side
   * but this full-page wrapper never forwarded the panel's onPaired, so it just sat there). */
  onPaired?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <button
        type="button"
        onClick={onClose}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to {name?.trim() || slug}
      </button>
      <CodexPairPanel slug={slug} podName={name} onClose={onClose} onPaired={onPaired} />
    </div>
  );
}
