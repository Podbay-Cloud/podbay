"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  adminWakePod,
  adminSleepPod,
  adminDestroyPod,
  adminUpdatePod,
  adminRollbackPod,
  adminReconcilePod,
} from "@/lib/admin-pod-actions";

type Result = { error: string } | void;

/**
 * Backoffice per-pod controls (Backoffice v2 · B1). Admin-only actions on any
 * pod; the buttons shown depend on status. Destroy is two-step (click → Confirm)
 * so a dense fleet row needs no modal. `canRollback` is passed by surfaces that
 * know a prior image exists (the drill-in reads the event log; the fleet row
 * doesn't, so it omits it).
 */
export default function FleetPodActions({
  id,
  status,
  stale,
  canRollback = false,
}: {
  id: string;
  status: string;
  stale: boolean;
  canRollback?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const run = (fn: () => Promise<Result>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
    });
  };

  const btn = "h-7 px-2 text-[12px] whitespace-nowrap";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {error && <span className="mr-1 w-full text-[11px] text-destructive sm:w-auto">{error}</span>}

      {status === "suspended" ? (
        <Button variant="outline" size="sm" className={btn} disabled={pending} onClick={() => run(() => adminWakePod(id))}>
          Resume
        </Button>
      ) : status === "running" ? (
        <Button variant="outline" size="sm" className={btn} disabled={pending} onClick={() => run(() => adminSleepPod(id))}>
          Suspend
        </Button>
      ) : null}

      {stale &&
        (confirmUpdate ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className={btn}
              disabled={pending}
              onClick={() => {
                setConfirmUpdate(false);
                run(() => adminUpdatePod(id));
              }}
            >
              Update &amp; restart
            </Button>
            <Button variant="ghost" size="sm" className={btn} disabled={pending} onClick={() => setConfirmUpdate(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className={btn} disabled={pending} onClick={() => setConfirmUpdate(true)}>
            Update
          </Button>
        ))}

      {canRollback && (
        <Button variant="ghost" size="sm" className={btn} disabled={pending} onClick={() => run(() => adminRollbackPod(id))}>
          Roll back
        </Button>
      )}

      <Button variant="ghost" size="sm" className={btn} disabled={pending} onClick={() => run(() => adminReconcilePod(id))}>
        Reconcile
      </Button>

      {confirmDestroy ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className={`${btn} border-destructive/50 text-destructive`}
            disabled={pending}
            onClick={() => run(() => adminDestroyPod(id))}
          >
            Confirm
          </Button>
          <Button variant="ghost" size="sm" className={btn} disabled={pending} onClick={() => setConfirmDestroy(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className={`${btn} text-destructive`}
          disabled={pending}
          onClick={() => setConfirmDestroy(true)}
        >
          Destroy
        </Button>
      )}
    </div>
  );
}
