"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { destroyPod, retryPod } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setError(null);
    start(async () => {
      const r = await retryPod(slug);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  function remove() {
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
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
        >
          Delete pod
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pod?</AlertDialogTitle>
            <AlertDialogDescription>
              It never finished building, so there&rsquo;s no work to lose. This removes it from
              your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
