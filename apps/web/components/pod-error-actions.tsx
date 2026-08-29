"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { destroyPod, retryPod } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

/**
 * Actions for a pod stuck in `error` (provisioning failed). A failed pod never
 * booted, so it holds no user work — Retry re-enqueues it (the fix is usually a
 * transient box/API hiccup) and Delete removes the dead row. Delete confirms
 * only because it's irreversible, not because there's data at stake.
 */
export default function PodErrorActions({
  slug,
  canRetry = true,
}: {
  slug: string;
  /** false when the failure is permanent (e.g. the env no longer exists), so
   * retrying can't help — only Delete is offered. */
  canRetry?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  function retry() {
    setError(null);
    start(async () => {
      const r = await retryPod(slug);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  async function remove() {
    if (
      !(await confirm({
        title: "Delete this pod?",
        message:
          "It never finished building, so there’s no work to lose. This removes it from your dashboard.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setError(null);
    start(async () => {
      const r = await destroyPod(slug);
      if (r?.error) setError(r.error);
      else router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2.5">
        {canRetry && (
          <Button size="sm" disabled={pending} onClick={retry}>
            {pending ? "Working…" : "Try again"}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void remove()}>
          Delete pod
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {dialog}
    </div>
  );
}
